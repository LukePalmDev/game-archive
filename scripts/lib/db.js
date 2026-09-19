import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
export const DB_PATH = join(ROOT, 'data', 'games.db');

const SCHEMA = `
CREATE TABLE IF NOT EXISTS games (
  id                INTEGER PRIMARY KEY,
  title_raw         TEXT NOT NULL,
  title             TEXT NOT NULL,
  platform          TEXT NOT NULL DEFAULT '',
  edition           TEXT NOT NULL DEFAULT '',
  copies            INTEGER NOT NULL DEFAULT 1,
  igdb_id           INTEGER,
  igdb_slug         TEXT,
  release_year      INTEGER,
  release_date      TEXT,
  genres            TEXT,
  developer         TEXT,
  publisher         TEXT,
  summary           TEXT,
  rating            REAL,
  cover_url         TEXT,
  cover_path        TEXT,
  match_status      TEXT NOT NULL DEFAULT 'pending',
  match_confidence  REAL,
  source_photo      TEXT,
  notes             TEXT,
  created_at        TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at        TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE UNIQUE INDEX IF NOT EXISTS games_title_platform ON games (lower(title), lower(platform), lower(edition));
CREATE INDEX IF NOT EXISTS games_status ON games (match_status);

CREATE TABLE IF NOT EXISTS photos (
  id          INTEGER PRIMARY KEY,
  filename    TEXT NOT NULL UNIQUE,
  item_count  INTEGER NOT NULL DEFAULT 0,
  imported_at TEXT NOT NULL DEFAULT (datetime('now')),
  notes       TEXT
);

CREATE TABLE IF NOT EXISTS recommendations (
  id            INTEGER PRIMARY KEY,
  title         TEXT NOT NULL,
  platform      TEXT NOT NULL DEFAULT '',
  kind          TEXT NOT NULL DEFAULT 'genere',   -- saga | edizione | genere
  because       TEXT NOT NULL DEFAULT '',
  source        TEXT NOT NULL DEFAULT '',          -- i tuoi giochi da cui nasce il consiglio
  priority      INTEGER NOT NULL DEFAULT 2,
  igdb_id       INTEGER,
  igdb_slug     TEXT,
  release_year  INTEGER,
  genres        TEXT,
  developer     TEXT,
  publisher     TEXT,
  summary       TEXT,
  rating        REAL,
  cover_url     TEXT,
  cover_path    TEXT,
  match_status  TEXT NOT NULL DEFAULT 'pending',
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE UNIQUE INDEX IF NOT EXISTS recommendations_title_platform
  ON recommendations (lower(title), lower(platform));

CREATE TABLE IF NOT EXISTS match_candidates (
  id        INTEGER PRIMARY KEY,
  game_id   INTEGER NOT NULL REFERENCES games(id) ON DELETE CASCADE,
  igdb_id   INTEGER NOT NULL,
  name      TEXT NOT NULL,
  year      INTEGER,
  platforms TEXT,
  score     REAL,
  UNIQUE (game_id, igdb_id)
);
`;

export function openDb() {
  mkdirSync(dirname(DB_PATH), { recursive: true });
  const db = new DatabaseSync(DB_PATH);
  db.exec('PRAGMA journal_mode = WAL');
  db.exec('PRAGMA foreign_keys = ON');
  db.exec(SCHEMA);
  return db;
}

/** Titolo normalizzato per confronti: minuscolo, senza punteggiatura, numeri romani sciolti. */
export function normalizeTitle(s) {
  return String(s ?? '')
    .toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\b(viii|vii|vi|iv|ix|xii|xi|x|v|iii|ii|i)\b/g, (m) => String(
      { i: 1, ii: 2, iii: 3, iv: 4, v: 5, vi: 6, vii: 7, viii: 8, ix: 9, x: 10, xi: 11, xii: 12 }[m]
    ))
    .trim()
    .replace(/\s+/g, ' ');
}
