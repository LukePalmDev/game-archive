/**
 * Cosa possiedi davvero: i giochi in collezione più quelli inclusi nelle loro custodie
 * (raccolte come "BioShock: The Collection", edizioni speciali di un gioco base).
 */
import { DLC_TYPES } from './match.js';
import { normalizeTitle } from './db.js';

const CHUNK = 50;
const PAGE = 500;
// riga che indica la custodia stessa: conta come posseduta, ma non va elencata nel suo contenuto
const BOX = -1;

/**
 * IGDB tiene spesso il gioco e la sua custodia in due voci diverse, e noi abbiniamo il gioco.
 * Qui si risale alla custodia, per sapere cosa c'è dentro:
 * - l'edizione scritta sul dorso ("Legacy Edition" → "…: Infinite Warfare - Legacy Edition")
 * - la raccolta con lo stesso nome ("Assassin's Creed III Remastered" contiene anche Liberation)
 * Restituisce coppie [id in collezione, voce IGDB della custodia].
 */
async function findBoxes(db, query, chunk) {
  const boxes = [];
  const games = await query('games', `fields name,bundles.name; where id = (${chunk.join(',')}); limit ${PAGE};`);
  const byId = new Map(games.map((g) => [g.id, g]));

  for (const g of games) {
    for (const bundle of g.bundles ?? []) {
      if (normalizeTitle(bundle.name) === normalizeTitle(g.name)) boxes.push([g.id, bundle]);
    }
  }

  const editions = db.prepare(`
    SELECT DISTINCT igdb_id AS id, edition FROM games
    WHERE edition <> '' AND igdb_id IN (SELECT value FROM json_each(?))
  `).all(JSON.stringify(chunk));
  for (const { id, edition } of editions) {
    const wanted = normalizeTitle(`${byId.get(id)?.name ?? ''} ${edition}`);
    const versions = await query('games', `fields name; where version_parent = ${id}; limit ${PAGE};`);
    // solo il nome esatto: la "Digital Legacy Edition" non è la "Legacy Edition" su disco
    const box = versions.find((v) => normalizeTitle(v.name) === wanted);
    if (box) boxes.push([id, box]);
  }
  return boxes;
}

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

    // per ogni id da esplorare, la voce in collezione a cui attribuire quello che contiene
    const owners = new Map(chunk.map((id) => [id, [id]]));
    for (const [owned, box] of await findBoxes(db, query, chunk)) {
      rows.push([owned, box.id, box.name, BOX]);
      owners.set(box.id, [...(owners.get(box.id) ?? []), owned]);
    }

    // giochi che dichiarano di far parte di una di queste raccolte
    const explore = [...owners.keys()];
    for (let offset = 0; ; offset += PAGE) {
      const res = await query('games',
        `fields name,game_type,bundles; where bundles = (${explore.join(',')}); limit ${PAGE}; offset ${offset};`);
      for (const g of res) {
        for (const bundle of g.bundles ?? []) {
          for (const owned of owners.get(bundle) ?? []) {
            if (g.id !== owned) rows.push([owned, g.id, g.name, g.game_type ?? null]);
          }
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
    if (row.game_type === BOX || DLC_TYPES.has(row.game_type)) continue;
    if (!byOwner.has(row.owned_id)) byOwner.set(row.owned_id, []);
    byOwner.get(row.owned_id).push(row.name);
  }
  return byOwner;
}
