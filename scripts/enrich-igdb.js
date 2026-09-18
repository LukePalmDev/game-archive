#!/usr/bin/env node
/**
 * Cerca ogni gioco su IGDB, salva i metadati e scarica la copertina in site/covers/.
 *
 *   node scripts/enrich-igdb.js                 # tutti i pending
 *   node scripts/enrich-igdb.js --limit 5       # prova su pochi titoli
 *   node scripts/enrich-igdb.js --status all --force
 *   node scripts/enrich-igdb.js --id 42
 */
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { openDb, ROOT } from './lib/db.js';
import { createClient, coverUrl, downloadCover } from './lib/igdb.js';
import { canonicalPlatform, platformMatches } from './lib/platforms.js';
import { titleSimilarity } from './lib/similarity.js';

const argv = process.argv.slice(2);
const opt = (name, fallback = null) => {
  const i = argv.indexOf(`--${name}`);
  return i === -1 ? fallback : argv[i + 1];
};
const flag = (name) => argv.includes(`--${name}`);

const limit = Number(opt('limit', 0)) || null;
const onlyId = opt('id') ? Number(opt('id')) : null;
const status = opt('status', 'pending');
const force = flag('force');
const dryRun = flag('dry-run');

const COVERS_DIR = join(ROOT, 'site', 'covers');
const FIELDS = [
  'name', 'slug', 'url', 'summary', 'first_release_date', 'game_type', 'version_parent',
  'genres.name', 'platforms.name', 'platforms.abbreviation', 'cover.image_id',
  'aggregated_rating', 'rating', 'total_rating', 'total_rating_count',
  'involved_companies.developer', 'involved_companies.publisher', 'involved_companies.company.name',
].join(',');

// game_type: 1 dlc, 2 expansion, 5 mod, 6 episode, 7 season, 13 pack, 14 update — non sono giochi a sé
const DLC_TYPES = new Set([1, 2, 5, 6, 7, 13, 14]);

function scoreCandidate(game, candidate) {
  const sim = titleSimilarity(game.title, candidate.name);
  let score = sim;
  const platformOk = platformMatches(game.platform, candidate.platforms ?? []);
  if (platformOk === true) score += 0.12;
  else if (platformOk === false) score -= 0.18;
  if (DLC_TYPES.has(candidate.game_type)) score -= 0.25;
  if (candidate.version_parent) score -= 0.1;
  if ((candidate.total_rating_count ?? 0) > 50) score += 0.03;
  return { sim, score: Math.max(0, Math.min(1.2, score)) };
}

function companies(candidate, kind) {
  return (candidate.involved_companies ?? [])
    .filter((c) => c[kind])
    .map((c) => c.company?.name)
    .filter(Boolean)
    .join(', ') || null;
}

const db = openDb();
const where = onlyId ? 'id = ?' : (status === 'all' && force ? '1=1' : 'match_status IN (SELECT value FROM json_each(?))');
const params = onlyId ? [onlyId] : (status === 'all' && force ? [] : [JSON.stringify(status === 'all' ? ['pending', 'ambiguous', 'not_found'] : [status])]);
let games = db.prepare(`SELECT * FROM games WHERE ${where} ORDER BY id`).all(...params);
if (limit) games = games.slice(0, limit);

if (!games.length) {
  console.log('Nessun gioco da elaborare.');
  db.close();
  process.exit(0);
}

console.log(`Elaboro ${games.length} giochi su IGDB…\n`);
const query = await createClient();

const update = db.prepare(`
  UPDATE games SET
    title = ?, platform = ?, igdb_id = ?, igdb_slug = ?, release_year = ?, release_date = ?,
    genres = ?, developer = ?, publisher = ?, summary = ?, rating = ?, cover_url = ?, cover_path = ?,
    match_status = ?, match_confidence = ?, updated_at = datetime('now')
  WHERE id = ?
`);
const markStatus = db.prepare("UPDATE games SET match_status = ?, match_confidence = ?, updated_at = datetime('now') WHERE id = ?");
const clearCandidates = db.prepare('DELETE FROM match_candidates WHERE game_id = ?');
const addCandidate = db.prepare(`
  INSERT INTO match_candidates (game_id, igdb_id, name, year, platforms, score) VALUES (?, ?, ?, ?, ?, ?)
  ON CONFLICT (game_id, igdb_id) DO UPDATE SET score = excluded.score
`);

const counts = { matched: 0, ambiguous: 0, not_found: 0, errors: 0 };

for (const game of games) {
  const label = `#${game.id} ${game.title}${game.platform ? ` [${game.platform}]` : ''}`;
  try {
    const search = game.title.replace(/"/g, '');
    const results = await query('games', `search "${search}"; fields ${FIELDS}; limit 20;`);

    if (!results.length) {
      if (!dryRun) markStatus.run('not_found', 0, game.id);
      counts.not_found++;
      console.log(`✗ ${label} → nessun risultato`);
      continue;
    }

    const ranked = results
      .map((c) => ({ candidate: c, ...scoreCandidate(game, c) }))
      .sort((a, b) => b.score - a.score);

    const [best, second] = ranked;
    const gap = second ? best.score - second.score : 1;
    const confident = best.score >= 0.8 && (gap >= 0.12 || best.sim === 1);

    if (!dryRun) {
      clearCandidates.run(game.id);
      for (const r of ranked.slice(0, 5)) {
        addCandidate.run(
          game.id, r.candidate.id, r.candidate.name,
          r.candidate.first_release_date ? new Date(r.candidate.first_release_date * 1000).getUTCFullYear() : null,
          (r.candidate.platforms ?? []).map((p) => p.name).join(', ') || null,
          Number(r.score.toFixed(3)),
        );
      }
    }

    if (!confident) {
      if (!dryRun) markStatus.run(best.score >= 0.5 ? 'ambiguous' : 'not_found', Number(best.score.toFixed(3)), game.id);
      counts[best.score >= 0.5 ? 'ambiguous' : 'not_found']++;
      console.log(`? ${label} → incerto: "${best.candidate.name}" (${best.score.toFixed(2)}) vs "${second?.candidate.name ?? '—'}" (${second?.score.toFixed(2) ?? '—'})`);
      continue;
    }

    const c = best.candidate;
    const date = c.first_release_date ? new Date(c.first_release_date * 1000) : null;
    const platform = canonicalPlatform(game.platform) ||
      ((c.platforms ?? []).map((p) => p.name)[0] ?? '');
    const imageId = c.cover?.image_id ?? null;
    const url = imageId ? coverUrl(imageId) : null;
    const coverPath = imageId ? `covers/${c.slug}.jpg` : null;

    if (url && !dryRun) {
      const dest = join(COVERS_DIR, `${c.slug}.jpg`);
      if (!existsSync(dest) || force) await downloadCover(url, dest);
    }

    if (!dryRun) {
      update.run(
        c.name, platform, c.id, c.slug ?? null,
        date ? date.getUTCFullYear() : null,
        date ? date.toISOString().slice(0, 10) : null,
        JSON.stringify((c.genres ?? []).map((g) => g.name)),
        companies(c, 'developer'), companies(c, 'publisher'),
        c.summary ?? null,
        c.aggregated_rating ?? c.total_rating ?? c.rating ?? null,
        url, coverPath,
        game.match_status === 'manual' ? 'manual' : 'matched',
        Number(best.score.toFixed(3)),
        game.id,
      );
    }
    counts.matched++;
    console.log(`✓ ${label} → ${c.name} (${date ? date.getUTCFullYear() : 's.d.'}) ${imageId ? '' : '— senza copertina'}`);
  } catch (err) {
    counts.errors++;
    console.log(`! ${label} → errore: ${err.message}`);
  }
}

console.log(`\nMatch: ${counts.matched} | incerti: ${counts.ambiguous} | non trovati: ${counts.not_found} | errori: ${counts.errors}`);
if (counts.ambiguous || counts.not_found) console.log('Genera il report con: node scripts/review-report.js');
db.close();
