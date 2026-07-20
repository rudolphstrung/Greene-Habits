import Database from 'better-sqlite3';
import { todayISO, mondayOf } from './dates.js';

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

function nomValide(nom) {
  const propre = String(nom ?? '').trim();
  if (!propre) throw new Error('Le nom ne peut pas être vide');
  return propre;
}

export function createPlayer(db, nom) {
  const propre = nomValide(nom);
  const { lastInsertRowid } = db
    .prepare('INSERT INTO players (nom, created_at) VALUES (?, ?)')
    .run(propre, todayISO());
  return { id: lastInsertRowid, nom: propre };
}

export function createHabit(db, { player_id, nom, type, couleur, objectif }) {
  const propre = nomValide(nom);
  if (type !== 'daily' && type !== 'weekly') {
    throw new Error('Type inconnu');
  }
  if (!COULEURS.includes(couleur)) {
    throw new Error('Couleur hors palette');
  }
  // Une daily est binaire par nature : son objectif vaut toujours 1.
  let cible;
  if (type === 'daily') {
    cible = 1;
  } else {
    cible = parseInt(objectif, 10);
    if (!Number.isInteger(cible) || cible < 1) throw new Error('Objectif invalide');
  }

  const { lastInsertRowid } = db.prepare(
    `INSERT INTO habits (player_id, nom, type, couleur, objectif, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).run(player_id, propre, type, couleur, cible, todayISO());

  return getHabit(db, lastInsertRowid);
}

export function getHabit(db, id) {
  return db.prepare(
    `SELECT id, player_id, nom, type, couleur, objectif, created_at, archived
     FROM habits WHERE id = ?`
  ).get(id);
}

export function updateHabit(db, id, { nom, couleur, objectif }) {
  const habit = getHabit(db, id);
  if (!habit) throw new Error('Habitude introuvable');

  const propre = nomValide(nom);
  if (!COULEURS.includes(couleur)) throw new Error('Couleur hors palette');
  // Le type reste figé : le changer rendrait l'historique des date_ref
  // incohérent entre lecture journalière et hebdomadaire.
  let cible;
  if (habit.type === 'daily') {
    cible = 1;
  } else {
    cible = parseInt(objectif, 10);
    if (!Number.isInteger(cible) || cible < 1) throw new Error('Objectif invalide');
  }

  db.prepare('UPDATE habits SET nom = ?, couleur = ?, objectif = ? WHERE id = ?')
    .run(propre, couleur, cible, id);
  return getHabit(db, id);
}

export function archiveHabit(db, id) {
  const info = db.prepare('UPDATE habits SET archived = 1 WHERE id = ?').run(id);
  if (info.changes === 0) throw new Error('Habitude introuvable');
}

export function getCounts(db, habitId) {
  const lignes = db.prepare(
    'SELECT date_ref, count FROM entries WHERE habit_id = ?'
  ).all(habitId);
  return Object.fromEntries(lignes.map((l) => [l.date_ref, l.count]));
}

export function refFor(habit, dateISO) {
  return habit.type === 'weekly' ? mondayOf(dateISO) : dateISO;
}

export function toggle(db, habitId, dateRef) {
  const habit = getHabit(db, habitId);
  if (!habit) throw new Error('Habitude introuvable');

  const ref = refFor(habit, dateRef);
  const debut = refFor(habit, habit.created_at);
  const courante = refFor(habit, todayISO());
  if (ref < debut || ref > courante) {
    throw new Error('Date hors de la fenêtre autorisée');
  }

  const actuel = db.prepare(
    'SELECT count FROM entries WHERE habit_id = ? AND date_ref = ?'
  ).get(habitId, ref)?.count || 0;

  // Un clic de plus au-delà de l'objectif remet à zéro : toute erreur se
  // répare avec le même geste, sans menu de correction.
  const suivant = actuel + 1 > habit.objectif ? 0 : actuel + 1;

  if (suivant === 0) {
    // Une entry n'existe que si count > 0 : l'absence vaut zéro.
    db.prepare('DELETE FROM entries WHERE habit_id = ? AND date_ref = ?')
      .run(habitId, ref);
  } else {
    db.prepare(
      `INSERT INTO entries (habit_id, date_ref, count) VALUES (?, ?, ?)
       ON CONFLICT (habit_id, date_ref) DO UPDATE SET count = excluded.count`
    ).run(habitId, ref, suivant);
  }
  return suivant;
}
