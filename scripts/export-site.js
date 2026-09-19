#!/usr/bin/env node
/** Esporta il DB verso il sito statico: site/data/games.js (+ games.json). */
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { openDb, ROOT } from './lib/db.js';

const db = openDb();
const rows = db.prepare(`
  SELECT id, title, title_raw, platform, edition, copies, igdb_id, igdb_slug, release_year, genres, developer, publisher,
         summary, rating, cover_path, match_status, source_photo, notes
  FROM games ORDER BY title COLLATE NOCASE
`).all();

const games = rows.map((r) => ({
  id: r.id,
  title: r.title,
  titleRaw: r.title_raw !== r.title ? r.title_raw : undefined,
  platform: r.platform || null,
  edition: r.edition || null,
  copies: r.copies > 1 ? r.copies : undefined,
  year: r.release_year ?? null,
  genres: r.genres ? JSON.parse(r.genres) : [],
  developer: r.developer ?? null,
  publisher: r.publisher ?? null,
  summary: r.summary ?? null,
  rating: r.rating != null ? Math.round(r.rating) : null,
  cover: r.cover_path ?? null,
  igdbUrl: r.igdb_slug ? `https://www.igdb.com/games/${r.igdb_slug}` : null,
  status: r.match_status,
  photo: r.source_photo ?? null,
  notes: r.notes ?? null,
}));

const meta = {
  generated: new Date().toISOString(),
  total: games.length,
  cases: games.reduce((n, g) => n + (g.copies ?? 1), 0),
  matched: games.filter((g) => g.status === 'matched' || g.status === 'manual').length,
  pending: games.filter((g) => g.status === 'pending').length,
  toReview: games.filter((g) => g.status === 'ambiguous' || g.status === 'not_found').length,
  platforms: [...new Set(games.map((g) => g.platform).filter(Boolean))].sort(),
  genres: [...new Set(games.flatMap((g) => g.genres))].sort(),
};

// ---- consigli ----
const recRows = db.prepare(`
  SELECT id, title, platform, kind, because, source, priority, igdb_slug, release_year,
         genres, developer, publisher, summary, rating, cover_path, match_status
  FROM recommendations
  WHERE match_status IN ('matched', 'weak', 'owned')
  ORDER BY priority, title COLLATE NOCASE
`).all();

const recs = recRows.map((r) => ({
  id: r.id,
  title: r.title,
  platform: r.platform || null,
  kind: r.kind,
  because: r.because,
  source: r.source,
  priority: r.priority,
  owned: r.match_status === 'owned' || undefined,
  year: r.release_year ?? null,
  genres: r.genres ? JSON.parse(r.genres) : [],
  developer: r.developer ?? null,
  publisher: r.publisher ?? null,
  summary: r.summary ?? null,
  rating: r.rating != null ? Math.round(r.rating) : null,
  cover: r.cover_path ?? null,
  igdbUrl: r.igdb_slug ? `https://www.igdb.com/games/${r.igdb_slug}` : null,
}));

const KIND_LABELS = { saga: 'Capitoli mancanti', edizione: 'Remaster ed edizioni', genere: 'Affinità di genere' };
const recMeta = {
  generated: new Date().toISOString(),
  page: 'consigliati',
  total: recs.length,
  platforms: [...new Set(recs.map((r) => r.platform).filter(Boolean))].sort(),
  genres: [...new Set(recs.flatMap((r) => r.genres))].sort(),
  kinds: [...new Set(recs.map((r) => r.kind))].map((k) => ({ value: k, label: KIND_LABELS[k] ?? k })),
};

const outDir = join(ROOT, 'site', 'data');
mkdirSync(outDir, { recursive: true });
writeFileSync(join(outDir, 'games.js'),
  `// Generato da scripts/export-site.js — non modificare a mano.\n` +
  `window.GAMES_META = ${JSON.stringify(meta, null, 2)};\n` +
  `window.GAMES = ${JSON.stringify(games, null, 2)};\n`);
writeFileSync(join(outDir, 'games.json'), JSON.stringify({ meta, games }, null, 2));
writeFileSync(join(outDir, 'recommendations.js'),
  `// Generato da scripts/export-site.js — non modificare a mano.\n` +
  `window.GAMES_META = ${JSON.stringify(recMeta, null, 2)};\n` +
  `window.GAMES = ${JSON.stringify(recs, null, 2)};\n`);
writeFileSync(join(outDir, 'recommendations.json'), JSON.stringify({ meta: recMeta, games: recs }, null, 2));

console.log(`Esportati ${games.length} giochi (${meta.cases} custodie): ${meta.matched} con metadati, ${meta.toReview} da rivedere → site/data/games.js`);
console.log(`Esportati ${recs.length} consigli → site/data/recommendations.js`);
db.close();
