#!/usr/bin/env node
/** Svuota l'archivio (giochi, foto, candidati). Serve --yes per confermare. */
import { openDb } from './lib/db.js';

if (!process.argv.includes('--yes')) {
  console.error('Questo cancella TUTTI i giochi dal database. Conferma con: node scripts/reset-db.js --yes');
  process.exit(1);
}
const db = openDb();
const { n } = db.prepare('SELECT count(*) AS n FROM games').get();
db.exec('DELETE FROM match_candidates; DELETE FROM games; DELETE FROM photos;');
console.log(`Cancellati ${n} giochi. Le copertine in site/covers/ restano: eliminale a mano se vuoi ripartire pulito.`);
db.close();
