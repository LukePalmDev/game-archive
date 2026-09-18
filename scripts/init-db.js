#!/usr/bin/env node
import { openDb, DB_PATH } from './lib/db.js';

const db = openDb();
const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").all();
console.log(`Database pronto: ${DB_PATH}`);
console.log(`Tabelle: ${tables.map((t) => t.name).join(', ')}`);
const { n } = db.prepare('SELECT count(*) AS n FROM games').get();
console.log(`Giochi presenti: ${n}`);
db.close();
