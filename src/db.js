import Database from 'better-sqlite3';
import { todayISO, mondayOf } from './dates.js';

export const COULEURS = [
  '#4C6FFF', // bleu
  '#A855F7', // violet
  '#22D3EE', // cyan
  '#22C55E', // vert
  '#F59E0B', // ambre
  '#84CC16', // lime
  '#EC4899', // rose
  '#14B8A6', // turquoise
  '#8B5CF6', // indigo
  '#F5D0FE', // lilas clair
  '#38BDF8', // ciel
  '#FDE047'  // jaune
];

// Palette d'IDENTITÉ des joueurs — registre séparé de COULEURS (palette des
// habitudes). Ne jamais fusionner les deux : #EF4444 (rouge des points
// ratés) est réservé, le rouge joueur est donc volontairement plus profond
// (#DC2626) pour ne jamais être confondu avec un point raté.
export const COULEURS_JOUEURS = [
  '#DC2626', // rouge — plus profond que le #EF4444 des points ratés
  '#4C6FFF', // bleu
  '#A855F7', // violet
  '#B08968', // marron clair
  '#FACC15', // jaune
  '#22C55E'  // vert
];

// Les 6 vrais joueurs (groupe d'amis d'Anatole), amorcés dans cet ordre au
// premier démarrage. Chacun reçoit une couleur d'identité fixe.
const JOUEURS_INITIAUX = [
  { nom: 'Nicolas',   couleur: '#DC2626' },
  { nom: 'Axel',      couleur: '#4C6FFF' },
  { nom: 'Thomas',    couleur: '#A855F7' },
  { nom: 'Owen',      couleur: '#B08968' },
  { nom: 'Guillaume', couleur: '#FACC15' },
  { nom: 'Anatole',   couleur: '#22C55E' }
];

// Slug d'URL à partir d'un nom : minuscules, accents retirés, tout ce qui
// n'est pas alphanumérique devient un tiret, pas de tiret en bord de chaîne.
export function slugifier(nom) {
  return String(nom)
    .normalize('NFD').replace(/[̀-ͯ]/g, '') // retire les accents
    .toLowerCase().trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

const SCHEMA = `
  CREATE TABLE IF NOT EXISTS players (
    id         INTEGER PRIMARY KEY,
    nom        TEXT NOT NULL,
    created_at TEXT NOT NULL,
    archived   INTEGER NOT NULL DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS habits (
    id          INTEGER PRIMARY KEY,
    player_id   INTEGER NOT NULL REFERENCES players(id),
    nom         TEXT NOT NULL,
    type        TEXT NOT NULL CHECK (type IN ('daily','weekly')),
    couleur     TEXT NOT NULL,
    objectif    INTEGER NOT NULL DEFAULT 1,
    created_at  TEXT NOT NULL,
    archived    INTEGER NOT NULL DEFAULT 0,
    note        TEXT NOT NULL DEFAULT '',
    archived_at TEXT
  );

  CREATE TABLE IF NOT EXISTS entries (
    id       INTEGER PRIMARY KEY,
    habit_id INTEGER NOT NULL REFERENCES habits(id),
    date_ref TEXT NOT NULL,
    count    INTEGER NOT NULL DEFAULT 0,
    objectif INTEGER,
    UNIQUE (habit_id, date_ref)
  );

  CREATE INDEX IF NOT EXISTS idx_entries_habit ON entries (habit_id, date_ref);
`;

// Migration pour les bases créées avant l'ajout de la colonne `objectif` sur
// entries (chaque entry fige désormais l'objectif de l'habitude au moment où
// elle a été écrite, pour ne jamais repeindre l'historique quand l'objectif
// change). Idempotente : ne touche à rien si la colonne existe déjà.
function migrerObjectifEntries(db) {
  const colonnes = db.prepare('PRAGMA table_info(entries)').all();
  if (!colonnes.some((c) => c.name === 'objectif')) {
    db.exec('ALTER TABLE entries ADD COLUMN objectif INTEGER');
  }
  // Backfill inconditionnel : répare aussi les entries laissées à NULL par une
  // version antérieure du serveur qui aurait écrit après l'ajout de la colonne.
  db.exec(
    `UPDATE entries SET objectif = (SELECT objectif FROM habits WHERE habits.id = entries.habit_id)
     WHERE objectif IS NULL`
  );
}

// Migration pour les bases créées avant l'ajout de `note` et `archived_at` sur
// habits. Idempotente : ne touche à rien si les colonnes existent déjà.
function migrerColonnesHabits(db) {
  const colonnes = db.prepare('PRAGMA table_info(habits)').all().map((c) => c.name);
  if (!colonnes.includes('note')) {
    db.exec("ALTER TABLE habits ADD COLUMN note TEXT NOT NULL DEFAULT ''");
  }
  if (!colonnes.includes('archived_at')) {
    db.exec('ALTER TABLE habits ADD COLUMN archived_at TEXT');
  }
  // Une habitude déjà archivée avant l'ajout de la colonne n'a pas de date :
  // on la date d'aujourd'hui, faute de mieux, pour figer son décompte.
  db.prepare(
    `UPDATE habits SET archived_at = ? WHERE archived = 1 AND archived_at IS NULL`
  ).run(todayISO());
}

// Migration pour les bases créées avant l'ajout de la colonne `couleur` sur
// players (identité visuelle par joueur). Idempotente : ne touche à rien si
// la colonne existe déjà. Backfill : au moment où la colonne est ajoutée,
// les lignes déjà présentes reçoivent chacune une couleur distincte en
// tournant sur COULEURS_JOUEURS (plutôt que la même couleur par défaut pour
// tout le monde), dans leur ordre d'id.
function migrerColonneCouleurJoueurs(db) {
  const colonnes = db.prepare('PRAGMA table_info(players)').all().map((c) => c.name);
  const nouvelleColonne = !colonnes.includes('couleur');
  if (nouvelleColonne) {
    db.exec("ALTER TABLE players ADD COLUMN couleur TEXT NOT NULL DEFAULT '#4C6FFF'");
    const joueurs = db.prepare('SELECT id FROM players ORDER BY id').all();
    const maj = db.prepare('UPDATE players SET couleur = ? WHERE id = ?');
    joueurs.forEach((joueur, i) => {
      maj.run(COULEURS_JOUEURS[i % COULEURS_JOUEURS.length], joueur.id);
    });
  }
}

export function openDb(path = process.env.DB_PATH || '/data/greene.db') {
  const db = new Database(path);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.exec(SCHEMA);
  migrerObjectifEntries(db);
  migrerColonnesHabits(db);
  migrerColonneCouleurJoueurs(db);

  // Amorçage : les 6 vrais joueurs, dans l'ordre de JOUEURS_INITIAUX. Les
  // joueurs suivants se créent via le bouton "+ joueur".
  const nb = db.prepare('SELECT COUNT(*) AS n FROM players').get().n;
  if (nb === 0) {
    const inserer = db.prepare(
      'INSERT INTO players (nom, couleur, created_at) VALUES (?, ?, ?)'
    );
    JOUEURS_INITIAUX.forEach((joueur) => {
      inserer.run(joueur.nom, joueur.couleur, todayISO());
    });
  }
  return db;
}

export function getPlayers(db) {
  return db.prepare(
    'SELECT id, nom, couleur FROM players WHERE archived = 0 ORDER BY id'
  ).all();
}

export function getHabits(db) {
  return db.prepare(
    `SELECT id, player_id, nom, type, couleur, objectif, created_at, archived, archived_at, note
     FROM habits WHERE archived = 0 ORDER BY id`
  ).all();
}

// Toutes les habitudes, archivées comprises — utile au leaderboard mensuel
// (Tâche 2) et au profil joueur, qui doivent aussi voir les habitudes
// arrêtées en cours de mois.
export function getAllHabits(db) {
  return db.prepare(
    `SELECT id, player_id, nom, type, couleur, objectif, created_at, archived, archived_at, note
     FROM habits ORDER BY id`
  ).all();
}

function nomValide(nom) {
  const propre = String(nom ?? '').trim();
  if (!propre) throw new Error('Le nom ne peut pas être vide');
  return propre;
}

export function createPlayer(db, nom, couleur) {
  const propre = nomValide(nom);
  // Sans couleur explicite, on attribue la suivante en tournant sur
  // COULEURS_JOUEURS selon le nombre de joueurs déjà présents (archivés
  // compris, pour ne jamais réattribuer une couleur déjà prise en boucle
  // courte).
  const finale = couleur || COULEURS_JOUEURS[
    db.prepare('SELECT COUNT(*) AS n FROM players').get().n % COULEURS_JOUEURS.length
  ];
  const { lastInsertRowid } = db
    .prepare('INSERT INTO players (nom, couleur, created_at) VALUES (?, ?, ?)')
    .run(propre, finale, todayISO());
  return { id: lastInsertRowid, nom: propre, couleur: finale };
}

export function createHabit(db, { player_id, nom, type, couleur, objectif, note }) {
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
  const noteFinale = String(note ?? '').trim();

  const { lastInsertRowid } = db.prepare(
    `INSERT INTO habits (player_id, nom, type, couleur, objectif, created_at, note)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run(player_id, propre, type, couleur, cible, todayISO(), noteFinale);

  return getHabit(db, lastInsertRowid);
}

export function getHabit(db, id) {
  return db.prepare(
    `SELECT id, player_id, nom, type, couleur, objectif, created_at, archived, archived_at, note
     FROM habits WHERE id = ?`
  ).get(id);
}

export function updateHabit(db, id, { nom, couleur, objectif, note }) {
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
  const noteFinale = String(note ?? '').trim();

  db.prepare('UPDATE habits SET nom = ?, couleur = ?, objectif = ?, note = ? WHERE id = ?')
    .run(propre, couleur, cible, noteFinale, id);
  return getHabit(db, id);
}

export function archiveHabit(db, id) {
  const info = db.prepare('UPDATE habits SET archived = 1, archived_at = ? WHERE id = ?')
    .run(todayISO(), id);
  if (info.changes === 0) throw new Error('Habitude introuvable');
}

// Suppression DÉFINITIVE : efface l'habitude ET tout son historique (entries).
// Irréversible — à distinguer de l'archivage (qui garde tout dans le profil).
export function deleteHabit(db, id) {
  const suppr = db.transaction((habitId) => {
    db.prepare('DELETE FROM entries WHERE habit_id = ?').run(habitId);
    return db.prepare('DELETE FROM habits WHERE id = ?').run(habitId);
  });
  const info = suppr(id);
  if (info.changes === 0) throw new Error('Habitude introuvable');
}

// Renvoie { [date_ref]: { count, objectif } } — l'objectif est celui figé sur
// l'entry au moment où elle a été écrite (cf. migrerObjectifEntries et toggle).
export function getEntries(db, habitId) {
  const lignes = db.prepare(
    'SELECT date_ref, count, objectif FROM entries WHERE habit_id = ?'
  ).all(habitId);
  return Object.fromEntries(
    lignes.map((l) => [l.date_ref, { count: l.count, objectif: l.objectif }])
  );
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
    // L'objectif courant de l'habitude est figé sur l'entry : une période
    // passée reste jugée sur l'exigence en vigueur au moment où elle a été
    // écrite, même si l'objectif de l'habitude change ensuite.
    db.prepare(
      `INSERT INTO entries (habit_id, date_ref, count, objectif) VALUES (?, ?, ?, ?)
       ON CONFLICT (habit_id, date_ref) DO UPDATE SET count = excluded.count, objectif = excluded.objectif`
    ).run(habitId, ref, suivant, habit.objectif);
  }
  return suivant;
}
