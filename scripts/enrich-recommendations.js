#!/usr/bin/env node
/**
 * Arricchisce i consigli con metadati e copertine IGDB.
 * Segnala anche i consigli che risultano già presenti nella tua collezione, raccolte comprese.
 * A nasconderli è export-site.js, che lo ricalcola a ogni pubblicazione.
 *
 *   node scripts/enrich-recommendations.js [--limit 5] [--force]
 */
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { openDb, ROOT } from './lib/db.js';
import { createClient, coverUrl, downloadCover } from './lib/igdb.js';
import { platformMatches } from './lib/platforms.js';
import { FIELDS, rank, isConfident, toRecord } from './lib/match.js';
import { syncContents, ownedIgdbIds } from './lib/contents.js';

const argv = process.argv.slice(2);
const opt = (n, d = null) => { const i = argv.indexOf(`--${n}`); return i === -1 ? d : argv[i + 1]; };
const force = argv.includes('--force');
const limit = Number(opt('limit', 0)) || null;

const COVERS = join(ROOT, 'site', 'covers');
const db = openDb();

let recs = db.prepare(`SELECT * FROM recommendations ${force ? '' : "WHERE match_status = 'pending'"} ORDER BY id`).all();
if (limit) recs = recs.slice(0, limit);
if (!recs.length) { console.log('Nessun consiglio da elaborare.'); db.close(); process.exit(0); }

const query = await createClient();
await syncContents(db, query);
const owned = ownedIgdbIds(db);

const update = db.prepare(`
  UPDATE recommendations SET
    igdb_id = ?, igdb_slug = ?, release_year = ?, genres = ?, developer = ?, publisher = ?,
    summary = ?, rating = ?, cover_url = ?, cover_path = ?, match_status = ?, updated_at = datetime('now')
  WHERE id = ?
`);

const counts = { matched: 0, owned: 0, weak: 0, missing: 0, errors: 0 };

for (const rec of recs) {
  try {
    // con "igdb" nel JSON la scheda è già scelta: niente ricerca per titolo
    const results = await query('games', rec.igdb_hint
      ? `fields ${FIELDS}; where id = ${rec.igdb_hint};`
      : `search "${rec.title.replace(/"/g, '')}"; fields ${FIELDS}; limit 20;`);
    const ranked = rank(rec, results);
    const best = ranked[0];

    if (!best || (!rec.igdb_hint && best.score < 0.6)) {
      db.prepare("UPDATE recommendations SET match_status = 'not_found' WHERE id = ?").run(rec.id);
      counts.missing++;
      console.log(`✗ ${rec.title} [${rec.platform}] → nessun risultato affidabile`);
      continue;
    }

    const c = best.candidate;
    const r = toRecord(c);
    const url = r.imageId ? coverUrl(r.imageId) : null;
    const coverPath = r.imageId ? `covers/${r.slug}.jpg` : null;
    if (url) {
      const dest = join(COVERS, `${r.slug}.jpg`);
      if (!existsSync(dest)) await downloadCover(url, dest);
    }

    const confident = rec.igdb_hint ? platformMatches(rec.platform, c.platforms ?? []) !== false : isConfident(rec, ranked);
    const status = confident ? 'matched' : 'weak';
    update.run(c.id, r.slug, r.year, r.genres, r.developer, r.publisher, r.summary, r.rating,
      url, coverPath, status, rec.id);

    const alreadyOwned = owned.get(c.id);
    if (alreadyOwned) counts.owned++;
    else counts[status]++;

    const flag = alreadyOwned ? '● già tuo' : (status === 'weak' ? `? da controllare (${best.score.toFixed(2)})` : '✓');
    console.log(`${flag} ${rec.title} [${rec.platform}] → ${r.name} (${r.year ?? 's.d.'})${alreadyOwned ? ` in ${alreadyOwned}` : ''}`);
  } catch (err) {
    counts.errors++;
    console.log(`! ${rec.title} [${rec.platform}] → errore: ${err.message}`);
  }
}

console.log(`\nAbbinati: ${counts.matched} | incerti: ${counts.weak} | già posseduti: ${counts.owned} | non trovati: ${counts.missing} | errori: ${counts.errors}`);
db.close();
