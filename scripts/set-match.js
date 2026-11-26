#!/usr/bin/env node
/**
 * Forza il match di un gioco su un id IGDB preciso e ne scarica i dati.
 *
 *   node scripts/set-match.js --id 42 --igdb 1020
 *   node scripts/set-match.js --id 42 --title "Gran Turismo 4" --platform PS2   # correggi il titolo letto male
 */
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { openDb, ROOT } from './lib/db.js';
import { createClient, coverUrl, downloadCover } from './lib/igdb.js';
import { canonicalPlatform } from './lib/platforms.js';
import { FIELDS, toRecord } from './lib/match.js';
import { syncContents } from './lib/contents.js';

const argv = process.argv.slice(2);
const opt = (n) => { const i = argv.indexOf(`--${n}`); return i === -1 ? null : argv[i + 1]; };

const gameId = Number(opt('id'));
const igdbId = opt('igdb') ? Number(opt('igdb')) : null;
const newTitle = opt('title');
const newPlatform = opt('platform');

if (!gameId || (!igdbId && !newTitle && !newPlatform)) {
  console.error('Uso: node scripts/set-match.js --id <id-gioco> [--igdb <id-igdb>] [--title "..."] [--platform PS2]');
  process.exit(1);
}

const db = openDb();
const game = db.prepare('SELECT * FROM games WHERE id = ?').get(gameId);
if (!game) { console.error(`Nessun gioco con id ${gameId}`); process.exit(1); }

if (newTitle || newPlatform) {
  db.prepare("UPDATE games SET title = coalesce(?, title), platform = coalesce(?, platform), match_status = 'pending', updated_at = datetime('now') WHERE id = ?")
    .run(newTitle ?? null, newPlatform ? canonicalPlatform(newPlatform) : null, gameId);
  console.log(`Aggiornato: ${newTitle ?? game.title}${newPlatform ? ` [${canonicalPlatform(newPlatform)}]` : ''}`);
  if (!Number.isFinite(igdbId)) {
    db.close();
    if (opt('igdb')) {
      console.error(`Id IGDB non valido: ${opt('igdb')}`);
      process.exit(1);
    }
    console.log('Ora rilancia: node scripts/enrich-igdb.js --id ' + gameId);
    process.exit(0);
  }
}

if (!Number.isFinite(igdbId)) {
  console.error('Manca un id IGDB valido (--igdb).');
  db.close();
  process.exit(1);
}

const query = await createClient();
const [c] = await query('games', `fields ${FIELDS}; where id = ${igdbId};`);
if (!c) { console.error(`Nessun gioco IGDB con id ${igdbId}`); process.exit(1); }

const r = toRecord(c);
const url = r.imageId ? coverUrl(r.imageId) : null;
const coverPath = r.imageId ? `covers/${c.slug}.jpg` : null;
if (url) {
  const dest = join(ROOT, 'site', 'covers', `${c.slug}.jpg`);
  if (!existsSync(dest)) await downloadCover(url, dest);
}
db.prepare(`
  UPDATE games SET title = ?, platform = ?, igdb_id = ?, igdb_slug = ?, release_year = ?, release_date = ?,
    genres = ?, developer = ?, publisher = ?, summary = ?, rating = ?, cover_url = ?, cover_path = ?,
    match_status = 'manual', match_confidence = 1, updated_at = datetime('now')
  WHERE id = ?
`).run(
  r.name,
  canonicalPlatform(newPlatform ?? game.platform) || (r.platforms[0] ?? ''),
  c.id, r.slug, r.year, r.date, r.genres, r.developer, r.publisher, r.summary, r.rating,
  url, coverPath, gameId,
);
db.prepare('DELETE FROM match_candidates WHERE game_id = ?').run(gameId);
console.log(`✓ #${gameId} → ${r.name} (${r.year ?? 's.d.'})`);
await syncContents(db, query);
db.close();
