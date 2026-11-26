/**
 * Cosa possiedi davvero: i giochi in collezione più quelli inclusi nelle loro custodie
 * (raccolte come "BioShock: The Collection", edizioni speciali di un gioco base).
 */
import { DLC_TYPES } from './match.js';

const CHUNK = 50;
const PAGE = 500;

/**
 * Riscarica da IGDB il contenuto di tutte le custodie in collezione.
 * La tabella viene sostituita solo dopo che tutte le richieste sono andate a buon fine.
 */
export async function syncContents(db, query) {
  const ids = db.prepare('SELECT DISTINCT igdb_id AS id FROM games WHERE igdb_id IS NOT NULL').all().map((r) => r.id);
  const rows = [];

  for (let i = 0; i < ids.length; i += CHUNK) {
    const chunk = ids.slice(i, i + CHUNK);
    const wanted = new Set(chunk);

    // giochi che dichiarano di far parte di una di queste raccolte
    for (let offset = 0; ; offset += PAGE) {
      const res = await query('games',
        `fields name,game_type,bundles; where bundles = (${chunk.join(',')}); limit ${PAGE}; offset ${offset};`);
      for (const g of res) {
        for (const owned of g.bundles ?? []) {
          if (wanted.has(owned)) rows.push([owned, g.id, g.name, g.game_type ?? null]);
        }
      }
      if (res.length < PAGE) break;
    }

    // edizioni speciali: chi possiede "X: Deluxe Edition" possiede anche X
    const editions = await query('games',
      `fields version_parent.name,version_parent.game_type; where id = (${chunk.join(',')}) & version_parent != null; limit ${PAGE};`);
    for (const g of editions) {
      const base = g.version_parent;
      if (base?.id) rows.push([g.id, base.id, base.name, base.game_type ?? null]);
    }
  }

  const insert = db.prepare(
    'INSERT OR IGNORE INTO bundle_contents (owned_id, content_id, name, game_type) VALUES (?, ?, ?, ?)');
  db.exec('BEGIN');
  try {
    db.exec('DELETE FROM bundle_contents');
    for (const row of rows) insert.run(...row);
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
  return rows.length;
}

/** Mappa id IGDB posseduto → titolo della custodia in cui si trova. */
export function ownedIgdbIds(db) {
  const owned = new Map();
  const direct = db.prepare('SELECT igdb_id AS id, title, platform FROM games WHERE igdb_id IS NOT NULL').all();
  for (const g of direct) owned.set(g.id, `${g.title} [${g.platform}]`);

  const inside = db.prepare(`
    SELECT c.content_id AS id, g.title, g.platform
    FROM bundle_contents c JOIN games g ON g.igdb_id = c.owned_id
  `).all();
  for (const g of inside) if (!owned.has(g.id)) owned.set(g.id, `${g.title} [${g.platform}]`);
  return owned;
}

/** Nomi dei giochi inclusi in una custodia, senza DLC: servono al sito per la ricerca. */
export function contentNames(db) {
  const byOwner = new Map();
  for (const row of db.prepare('SELECT owned_id, name, game_type FROM bundle_contents ORDER BY name COLLATE NOCASE').all()) {
    if (DLC_TYPES.has(row.game_type)) continue;
    if (!byOwner.has(row.owned_id)) byOwner.set(row.owned_id, []);
    byOwner.get(row.owned_id).push(row.name);
  }
  return byOwner;
}
