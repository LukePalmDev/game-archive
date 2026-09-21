#!/usr/bin/env node
/**
 * Importa i titoli estratti dalle foto (data/extractions/*.json) nella tabella games.
 * Idempotente: rilanciarlo non crea doppioni (indice unico su titolo+piattaforma).
 *
 *   node scripts/import-extraction.js                    # tutti i file
 *   node scripts/import-extraction.js scaffale-01.json   # solo alcuni
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join, basename } from 'node:path';
import { openDb, ROOT } from './lib/db.js';

const DIR = join(ROOT, 'data', 'extractions');
const args = process.argv.slice(2);
const files = (args.length ? args.map((f) => basename(f)) : readdirSync(DIR)).filter((f) => f.endsWith('.json'));

if (!files.length) {
  console.log(`Nessun file in ${DIR}. Aggiungi le foto in photos/ e chiedimi di estrarre i titoli.`);
  process.exit(0);
}

const db = openDb();
const insert = db.prepare(`
  INSERT INTO games (title_raw, title, platform, edition, copies, source_photo, notes, match_status)
  VALUES (?, ?, ?, ?, ?, ?, ?, 'pending')
  ON CONFLICT DO UPDATE SET copies = max(games.copies, excluded.copies), updated_at = datetime('now')
`);
const upsertPhoto = db.prepare(`
  INSERT INTO photos (filename, item_count, notes) VALUES (?, ?, ?)
  ON CONFLICT (filename) DO UPDATE SET item_count = excluded.item_count, imported_at = datetime('now')
`);

let added = 0, skipped = 0, lowConfidence = 0;

for (const file of files) {
  const payload = JSON.parse(readFileSync(join(DIR, file), 'utf8'));
  const photo = payload.photo ?? file.replace(/\.json$/, '');
  const items = payload.items ?? [];

  for (const item of items) {
    const titleRaw = (item.title_raw ?? item.title ?? '').trim();
    if (!titleRaw) continue;
    const title = (item.title ?? titleRaw).trim();
    const platform = (item.platform ?? '').trim();
    const edition = (item.edition ?? '').trim();
    const copies = Number(item.copies ?? 1) || 1;
    const notes = [item.note, item.confidence && item.confidence !== 'high' ? `confidence: ${item.confidence}` : null]
      .filter(Boolean).join(' | ') || null;
    if (item.confidence === 'low') lowConfidence++;

    const res = insert.run(titleRaw, title, platform, edition, copies, photo, notes);
    if (res.changes) added++; else skipped++;
  }
  upsertPhoto.run(photo, items.length, payload.notes ?? null);
  console.log(`  ${photo}: ${items.length} titoli`);
}

const { n } = db.prepare('SELECT count(*) AS n FROM games').get();
console.log(`\nNuovi: ${added} | già presenti: ${skipped} | da verificare (confidence bassa): ${lowConfidence}`);
console.log(`Totale giochi in archivio: ${n}`);
db.close();
