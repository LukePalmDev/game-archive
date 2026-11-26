#!/usr/bin/env node
/**
 * Aggiorna da IGDB l'elenco dei giochi inclusi nelle raccolte che possiedi.
 * Lo fanno già enrich-igdb.js, enrich-recommendations.js e set-match.js:
 * serve solo per ricostruirlo a mano.
 */
import { openDb } from './lib/db.js';
import { createClient } from './lib/igdb.js';
import { syncContents } from './lib/contents.js';

const db = openDb();
const n = await syncContents(db, await createClient());
console.log(`Contenuto delle raccolte aggiornato: ${n} voci.`);
db.close();
