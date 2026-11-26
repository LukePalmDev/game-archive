#!/usr/bin/env node
/**
 * Allinea la tabella recommendations a data/recommendations.json (idempotente):
 * aggiunge e aggiorna le voci del file, elimina quelle che non ci sono più.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { openDb, ROOT } from './lib/db.js';
import { canonicalPlatform } from './lib/platforms.js';

const payload = JSON.parse(readFileSync(join(ROOT, 'data', 'recommendations.json'), 'utf8'));
if (!payload.items?.length) {
  console.error('data/recommendations.json non contiene consigli: non tocco il database.');
  process.exit(1);
}
const db = openDb();

const upsert = db.prepare(`
  INSERT INTO recommendations (title, platform, kind, because, source, priority)
  VALUES (?, ?, ?, ?, ?, ?)
  ON CONFLICT DO UPDATE SET
    kind = excluded.kind, because = excluded.because, source = excluded.source,
    priority = excluded.priority, updated_at = datetime('now')
`);

const keyOf = (title, platform) => `${title.toLowerCase()}|${platform.toLowerCase()}`;
const wanted = new Set(payload.items.map((i) => keyOf(i.title.trim(), canonicalPlatform(i.platform))));
const remove = db.prepare('DELETE FROM recommendations WHERE id = ?');
let removed = 0;
for (const row of db.prepare('SELECT id, title, platform FROM recommendations').all()) {
  if (wanted.has(keyOf(row.title, row.platform))) continue;
  remove.run(row.id);
  removed++;
  console.log(`  − ${row.title} [${row.platform}] non è più nel file`);
}

let n = 0;
for (const item of payload.items) {
  upsert.run(
    item.title.trim(),
    canonicalPlatform(item.platform),
    item.kind ?? 'genere',
    item.because ?? '',
    item.source ?? '',
    Number(item.priority ?? 2),
  );
  n++;
}

const { tot } = db.prepare('SELECT count(*) AS tot FROM recommendations').get();
console.log(`Importati ${n} consigli, rimossi ${removed} (totale in archivio: ${tot})`);
for (const r of db.prepare('SELECT kind, count(*) c FROM recommendations GROUP BY kind ORDER BY c DESC').all()) {
  console.log(`  ${r.kind}: ${r.c}`);
}
db.close();
