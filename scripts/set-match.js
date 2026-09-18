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

const argv = process.argv.slice(2);
const opt = (n) => { const i = argv.indexOf(`--${n}`); return i === -1 ? null : argv[i + 1]; };

const gameId = Number(opt('id'));
const igdbId = opt('igdb') ? Number(opt('igdb')) : null;
const newTitle = opt('title');
const newPlatform = opt('platform');

if (!gameId) {
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
  if (!igdbId) {
    console.log('Ora rilancia: node scripts/enrich-igdb.js --id ' + gameId);
    db.close();
    process.exit(0);
  }
}

const query = await createClient();
const FIELDS = [
  'name', 'slug', 'url', 'summary', 'first_release_date',
  'genres.name', 'platforms.name', 'cover.image_id',
  'aggregated_rating', 'rating', 'total_rating',
  'involved_companies.developer', 'involved_companies.publisher', 'involved_companies.company.name',
].join(',');

const [c] = await query('games', `fields ${FIELDS}; where id = ${igdbId};`);
if (!c) { console.error(`Nessun gioco IGDB con id ${igdbId}`); process.exit(1); }

const date = c.first_release_date ? new Date(c.first_release_date * 1000) : null;
const imageId = c.cover?.image_id ?? null;
const url = imageId ? coverUrl(imageId) : null;
const coverPath = imageId ? `covers/${c.slug}.jpg` : null;
if (url) {
  const dest = join(ROOT, 'site', 'covers', `${c.slug}.jpg`);
  if (!existsSync(dest)) await downloadCover(url, dest);
}
const comp = (kind) => (c.involved_companies ?? []).filter((x) => x[kind]).map((x) => x.company?.name).filter(Boolean).join(', ') || null;

db.prepare(`
  UPDATE games SET title = ?, platform = ?, igdb_id = ?, igdb_slug = ?, release_year = ?, release_date = ?,
    genres = ?, developer = ?, publisher = ?, summary = ?, rating = ?, cover_url = ?, cover_path = ?,
    match_status = 'manual', match_confidence = 1, updated_at = datetime('now')
  WHERE id = ?
`).run(
  c.name,
  canonicalPlatform(newPlatform ?? game.platform) || ((c.platforms ?? []).map((p) => p.name)[0] ?? ''),
  c.id, c.slug ?? null,
  date ? date.getUTCFullYear() : null,
  date ? date.toISOString().slice(0, 10) : null,
  JSON.stringify((c.genres ?? []).map((g) => g.name)),
  comp('developer'), comp('publisher'), c.summary ?? null,
  c.aggregated_rating ?? c.total_rating ?? c.rating ?? null,
  url, coverPath, gameId,
);
db.prepare('DELETE FROM match_candidates WHERE game_id = ?').run(gameId);
console.log(`✓ #${gameId} → ${c.name} (${date ? date.getUTCFullYear() : 's.d.'})`);
db.close();
