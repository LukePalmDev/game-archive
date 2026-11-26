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
import { canonicalPlatform } from './lib/platforms.js';
import { FIELDS, rank, isConfident, toRecord } from './lib/match.js';
import { syncContents } from './lib/contents.js';

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

const db = openDb();
// le conferme fatte a mano con set-match non si toccano, a meno di chiederle con --id
const where = onlyId ? 'id = ?' : (status === 'all' && force ? "match_status != 'manual'" : 'match_status IN (SELECT value FROM json_each(?))');
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

    const ranked = rank(game, results);
    const [best, second] = ranked;
    const confident = isConfident(game, ranked);

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
    const r = toRecord(c);
    const platform = canonicalPlatform(game.platform) || (r.platforms[0] ?? '');
    const url = r.imageId ? coverUrl(r.imageId) : null;
    const coverPath = r.imageId ? `covers/${c.slug}.jpg` : null;

    if (url && !dryRun) {
      const dest = join(COVERS_DIR, `${c.slug}.jpg`);
      if (!existsSync(dest) || force) await downloadCover(url, dest);
    }

    if (!dryRun) {
      update.run(
        r.name, platform, c.id, r.slug, r.year, r.date, r.genres, r.developer, r.publisher,
        r.summary, r.rating, url, coverPath,
        game.match_status === 'manual' ? 'manual' : 'matched',
        Number(best.score.toFixed(3)),
        game.id,
      );
    }
    counts.matched++;
    console.log(`✓ ${label} → ${r.name} (${r.year ?? 's.d.'}) ${r.imageId ? '' : '— senza copertina'}`);
  } catch (err) {
    counts.errors++;
    console.log(`! ${label} → errore: ${err.message}`);
  }
}

if (!dryRun && counts.matched) {
  console.log(`\nContenuto delle raccolte aggiornato: ${await syncContents(db, query)} voci.`);
}

console.log(`\nMatch: ${counts.matched} | incerti: ${counts.ambiguous} | non trovati: ${counts.not_found} | errori: ${counts.errors}`);
if (counts.ambiguous || counts.not_found) console.log('Genera il report con: node scripts/review-report.js');
db.close();
