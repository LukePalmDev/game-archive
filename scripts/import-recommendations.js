#!/usr/bin/env node
/** Carica data/recommendations.json nella tabella recommendations (idempotente). */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { openDb, ROOT } from './lib/db.js';
import { canonicalPlatform } from './lib/platforms.js';

const payload = JSON.parse(readFileSync(join(ROOT, 'data', 'recommendations.json'), 'utf8'));
const db = openDb();

const upsert = db.prepare(`
  INSERT INTO recommendations (title, platform, kind, because, source, priority)
  VALUES (?, ?, ?, ?, ?, ?)
  ON CONFLICT DO UPDATE SET
    kind = excluded.kind, because = excluded.because, source = excluded.source,
    priority = excluded.priority, updated_at = datetime('now')
`);

let n = 0;
for (const item of payload.items ?? []) {
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
console.log(`Importati ${n} consigli (totale in archivio: ${tot})`);
for (const r of db.prepare('SELECT kind, count(*) c FROM recommendations GROUP BY kind ORDER BY c DESC').all()) {
  console.log(`  ${r.kind}: ${r.c}`);
}
db.close();
