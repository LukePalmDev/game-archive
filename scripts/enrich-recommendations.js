#!/usr/bin/env node
/**
 * Arricchisce i consigli con metadati e copertine IGDB.
 * Segnala anche i consigli che risultano già presenti nella tua collezione.
 *
 *   node scripts/enrich-recommendations.js [--limit 5] [--force]
 */
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { openDb, ROOT } from './lib/db.js';
import { createClient, coverUrl, downloadCover } from './lib/igdb.js';
import { FIELDS, rank, toRecord } from './lib/match.js';

const argv = process.argv.slice(2);
const opt = (n, d = null) => { const i = argv.indexOf(`--${n}`); return i === -1 ? d : argv[i + 1]; };
const force = argv.includes('--force');
const limit = Number(opt('limit', 0)) || null;

const COVERS = join(ROOT, 'site', 'covers');
const db = openDb();

let recs = db.prepare(`SELECT * FROM recommendations ${force ? '' : "WHERE match_status = 'pending'"} ORDER BY id`).all();
if (limit) recs = recs.slice(0, limit);
if (!recs.length) { console.log('Nessun consiglio da elaborare.'); db.close(); process.exit(0); }

const owned = new Set(db.prepare('SELECT igdb_id FROM games WHERE igdb_id IS NOT NULL').all().map((r) => r.igdb_id));
const query = await createClient();

const update = db.prepare(`
  UPDATE recommendations SET
    title = ?, igdb_id = ?, igdb_slug = ?, release_year = ?, genres = ?, developer = ?, publisher = ?,
    summary = ?, rating = ?, cover_url = ?, cover_path = ?, match_status = ?, updated_at = datetime('now')
  WHERE id = ?
`);

const counts = { matched: 0, owned: 0, weak: 0, missing: 0 };

for (const rec of recs) {
  const results = await query('games', `search "${rec.title.replace(/"/g, '')}"; fields ${FIELDS}; limit 20;`);
  const ranked = rank(rec, results);
  const best = ranked[0];

  if (!best || best.score < 0.6) {
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

  const alreadyOwned = owned.has(c.id);
  const status = alreadyOwned ? 'owned' : (best.score >= 0.8 ? 'matched' : 'weak');
  update.run(r.name, c.id, r.slug, r.year, r.genres, r.developer, r.publisher, r.summary, r.rating,
    url, coverPath, status, rec.id);

  if (alreadyOwned) counts.owned++;
  else if (status === 'weak') counts.weak++;
  else counts.matched++;

  const flag = alreadyOwned ? '● già tuo' : (status === 'weak' ? `? ${best.score.toFixed(2)}` : '✓');
  console.log(`${flag} ${rec.title} [${rec.platform}] → ${r.name} (${r.year ?? 's.d.'})`);
}

console.log(`\nAbbinati: ${counts.matched} | incerti: ${counts.weak} | già posseduti: ${counts.owned} | non trovati: ${counts.missing}`);
db.close();
