import Database from 'better-sqlite3';
import { todayISO } from './dates.js';

export const COULEURS = [
  '#4C6FFF', // bleu
  '#A855F7', // violet
  '#22D3EE', // cyan
  '#22C55E', // vert
  '#F59E0B', // ambre
  '#84CC16'  // lime
];

const SCHEMA = `
  CREATE TABLE IF NOT EXISTS players (
    id         INTEGER PRIMARY KEY,
    nom        TEXT NOT NULL,
    created_at TEXT NOT NULL,
    archived   INTEGER NOT NULL DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS habits (
    id         INTEGER PRIMARY KEY,
    player_id  INTEGER NOT NULL REFERENCES players(id),
    nom        TEXT NOT NULL,
    type       TEXT NOT NULL CHECK (type IN ('daily','weekly')),
    couleur    TEXT NOT NULL,
    objectif   INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL,
    archived   INTEGER NOT NULL DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS entries (
    id       INTEGER PRIMARY KEY,
    habit_id INTEGER NOT NULL REFERENCES habits(id),
    date_ref TEXT NOT NULL,
    count    INTEGER NOT NULL DEFAULT 0,
    UNIQUE (habit_id, date_ref)
  );

  CREATE INDEX IF NOT EXISTS idx_entries_habit ON entries (habit_id, date_ref);
`;

export function openDb(path = process.env.DB_PATH || '/data/greene.db') {
  const db = new Database(path);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.exec(SCHEMA);

  // Amorçage : Anatole seul. Les autres se créent via le bouton "+ joueur".
  const nb = db.prepare('SELECT COUNT(*) AS n FROM players').get().n;
  if (nb === 0) {
    db.prepare('INSERT INTO players (nom, created_at) VALUES (?, ?)')
      .run('Anatole', todayISO());
  }
  return db;
}

export function getPlayers(db) {
  return db.prepare(
    'SELECT id, nom FROM players WHERE archived = 0 ORDER BY id'
  ).all();
}

export function getHabits(db) {
  return db.prepare(
    `SELECT id, player_id, nom, type, couleur, objectif, created_at
     FROM habits WHERE archived = 0 ORDER BY id`
  ).all();
}
