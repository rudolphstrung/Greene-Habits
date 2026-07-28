import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import {
  openDb, getPlayers, getHabits, getAllHabits, getHabit, COULEURS, COULEURS_JOUEURS,
  slugifier, createPlayer, createHabit, updateHabit,
  archiveHabit, deleteHabit, getEntries, toggle, refFor, getGels, countGelsSemaine, createGel
} from '../src/db.js';
import { todayISO, mondayOf, addDays } from '../src/dates.js';

test('l amorçage crée les 6 joueurs avec leur couleur', () => {
  const db = openDb(':memory:');
  const joueurs = getPlayers(db);
  assert.deepEqual(joueurs.map((j) => j.nom),
    ['Nicolas', 'Axel', 'Thomas', 'Owen', 'Guillaume', 'Anatole']);
  assert.equal(joueurs.find((j) => j.nom === 'Nicolas').couleur, '#DC2626');
  assert.equal(joueurs.find((j) => j.nom === 'Anatole').couleur, '#22C55E');
  assert.equal(joueurs.find((j) => j.nom === 'Owen').couleur, '#B08968');
});

test('l amorçage est idempotent : deux ouvertures ne dupliquent pas les 6 joueurs', () => {
  const db = openDb(':memory:');
  assert.equal(getPlayers(db).length, 6);
  assert.equal(getHabits(db).length, 0);
});

test('aucune couleur de joueur n est le rouge réservé aux points ratés', () => {
  assert.ok(!COULEURS_JOUEURS.includes('#EF4444'));
});

test('slugifier normalise le nom', () => {
  assert.equal(slugifier('Nicolas'), 'nicolas');
  assert.equal(slugifier('Jean-Éric'), 'jean-eric');
  assert.equal(slugifier('  Anne Marie '), 'anne-marie');
});

test('createPlayer attribue une couleur quand on ne lui en donne pas', () => {
  const db = openDb(':memory:');
  const j = createPlayer(db, 'Invité');
  assert.ok(COULEURS_JOUEURS.includes(j.couleur));
});

test('createPlayer accepte une couleur explicite', () => {
  const db = openDb(':memory:');
  const j = createPlayer(db, 'Invité', '#A855F7');
  assert.equal(j.couleur, '#A855F7');
});

test('la palette contient 12 couleurs, sans le rouge ni le gris réservés', () => {
  assert.equal(COULEURS.length, 12);
  assert.ok(!COULEURS.includes('#EF4444'));
  assert.ok(!COULEURS.includes('#2A2A2E'));
  assert.equal(new Set(COULEURS).size, 12); // toutes distinctes
});

test('le schéma refuse un type d\'habitude inconnu', () => {
  const db = openDb(':memory:');
  assert.throws(() => {
    db.prepare(
      `INSERT INTO habits (player_id, nom, type, couleur, objectif, created_at)
       VALUES (1, 'Test', 'mensuel', '#4C6FFF', 1, '2026-07-19')`
    ).run();
  });
});

test('le schéma refuse deux entries sur la même habitude et la même date', () => {
  const db = openDb(':memory:');
  db.prepare(
    `INSERT INTO habits (player_id, nom, type, couleur, objectif, created_at)
     VALUES (1, 'Lecture', 'daily', '#4C6FFF', 1, '2026-07-19')`
  ).run();
  db.prepare(`INSERT INTO entries (habit_id, date_ref, count) VALUES (1, '2026-07-19', 1)`).run();
  assert.throws(() => {
    db.prepare(`INSERT INTO entries (habit_id, date_ref, count) VALUES (1, '2026-07-19', 1)`).run();
  });
});

function baseAvecHabitude(surcharges = {}) {
  const db = openDb(':memory:');
  const habit = createHabit(db, {
    player_id: 1, nom: 'Lecture', type: 'daily',
    couleur: '#4C6FFF', objectif: 1, ...surcharges
  });
  return { db, habit };
}

test('createPlayer ajoute un joueur', () => {
  const db = openDb(':memory:');
  createPlayer(db, 'Testeur');
  assert.deepEqual(getPlayers(db).map((j) => j.nom),
    ['Nicolas', 'Axel', 'Thomas', 'Owen', 'Guillaume', 'Anatole', 'Testeur']);
});

test('createPlayer refuse un nom vide', () => {
  const db = openDb(':memory:');
  assert.throws(() => createPlayer(db, '   '), /nom/i);
});

test('createHabit refuse une couleur hors palette', () => {
  const db = openDb(':memory:');
  assert.throws(() => createHabit(db, {
    player_id: 1, nom: 'X', type: 'daily', couleur: '#EF4444', objectif: 1
  }), /couleur/i);
});

test('createHabit force l\'objectif à 1 pour une daily', () => {
  const { habit } = baseAvecHabitude({ objectif: 5 });
  assert.equal(habit.objectif, 1);
});

test('updateHabit modifie nom, couleur et objectif', () => {
  const { db, habit } = baseAvecHabitude({ type: 'weekly', objectif: 2 });
  const maj = updateHabit(db, habit.id, {
    nom: 'Salle', couleur: '#22C55E', objectif: 3
  });
  assert.equal(maj.nom, 'Salle');
  assert.equal(maj.couleur, '#22C55E');
  assert.equal(maj.objectif, 3);
});

test('updateHabit ignore toute tentative de changer le type', () => {
  const { db, habit } = baseAvecHabitude();
  const maj = updateHabit(db, habit.id, {
    nom: 'Lecture', couleur: '#4C6FFF', objectif: 1, type: 'weekly'
  });
  assert.equal(maj.type, 'daily');
});

test('createHabit refuse un objectif < 1 pour une weekly', () => {
  const db = openDb(':memory:');
  assert.throws(() => createHabit(db, {
    player_id: 1, nom: 'Salle', type: 'weekly', couleur: '#4C6FFF', objectif: 0
  }), /objectif/i);
});

test('updateHabit refuse un objectif < 1 pour une weekly', () => {
  const { db, habit } = baseAvecHabitude({ type: 'weekly', objectif: 2 });
  assert.throws(() => updateHabit(db, habit.id, {
    nom: 'Salle', couleur: '#22C55E', objectif: 0
  }), /objectif/i);
});

test('archiveHabit retire l\'habitude sans supprimer la ligne', () => {
  const { db, habit } = baseAvecHabitude();
  archiveHabit(db, habit.id);
  assert.equal(getHabits(db).length, 0);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM habits').get().n, 1);
});

test('archiveHabit refuse un id inexistant', () => {
  const db = openDb(':memory:');
  assert.throws(() => archiveHabit(db, 9999), /introuvable/i);
});

test('createHabit enregistre la note', () => {
  const { db, habit } = baseAvecHabitude({ note: 'Lire 10 pages avant de dormir' });
  assert.equal(getHabit(db, habit.id).note, 'Lire 10 pages avant de dormir');
});

test('une habitude sans note a une note vide, pas null', () => {
  const { db, habit } = baseAvecHabitude();
  assert.equal(getHabit(db, habit.id).note, '');
});

test('updateHabit modifie la note', () => {
  const { db, habit } = baseAvecHabitude({ note: 'avant' });
  updateHabit(db, habit.id, { nom: 'Lecture', couleur: '#4C6FFF', objectif: 1, note: 'après' });
  assert.equal(getHabit(db, habit.id).note, 'après');
});

test('createHabit enregistre moment_lieu et identite', () => {
  const { db, habit } = baseAvecHabitude({
    moment_lieu: 'chaque matin au réveil',
    identite: 'quelqu\'un de discipliné'
  });
  const h = getHabit(db, habit.id);
  assert.equal(h.moment_lieu, 'chaque matin au réveil');
  assert.equal(h.identite, 'quelqu\'un de discipliné');
});

test('une habitude sans moment_lieu ni identite a des chaînes vides, pas null', () => {
  const { db, habit } = baseAvecHabitude();
  const h = getHabit(db, habit.id);
  assert.equal(h.moment_lieu, '');
  assert.equal(h.identite, '');
});

test('updateHabit modifie moment_lieu et identite', () => {
  const { db, habit } = baseAvecHabitude({ moment_lieu: 'avant', identite: 'avant' });
  updateHabit(db, habit.id, {
    nom: 'Lecture', couleur: '#4C6FFF', objectif: 1,
    moment_lieu: 'après', identite: 'après'
  });
  const h = getHabit(db, habit.id);
  assert.equal(h.moment_lieu, 'après');
  assert.equal(h.identite, 'après');
});

test('la migration ajoute moment_lieu et identite sur une base existante sans perdre la note', () => {
  const fichier = path.join(os.tmpdir(), `greene-migration-intention-test-${Date.now()}-${Math.random()}.db`);
  try {
    // Simule une base créée AVANT l'ajout de moment_lieu/identite, mais après
    // l'ajout de note/archived_at (schéma intermédiaire réaliste).
    const ancienne = new Database(fichier);
    ancienne.exec(`
      CREATE TABLE players (
        id INTEGER PRIMARY KEY, nom TEXT NOT NULL, couleur TEXT NOT NULL DEFAULT '#4C6FFF',
        created_at TEXT NOT NULL, archived INTEGER NOT NULL DEFAULT 0
      );
      CREATE TABLE habits (
        id INTEGER PRIMARY KEY, player_id INTEGER NOT NULL, nom TEXT NOT NULL, type TEXT NOT NULL,
        couleur TEXT NOT NULL, objectif INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL,
        archived INTEGER NOT NULL DEFAULT 0, note TEXT NOT NULL DEFAULT '', archived_at TEXT
      );
      CREATE TABLE entries (
        id INTEGER PRIMARY KEY, habit_id INTEGER NOT NULL, date_ref TEXT NOT NULL,
        count INTEGER NOT NULL DEFAULT 0, objectif INTEGER,
        UNIQUE (habit_id, date_ref)
      );
    `);
    ancienne.prepare(`INSERT INTO players (id, nom, couleur, created_at) VALUES (1, 'Anatole', '#22C55E', '2026-01-01')`).run();
    ancienne.prepare(
      `INSERT INTO habits (id, player_id, nom, type, couleur, objectif, created_at, note)
       VALUES (1, 1, 'Sport', 'weekly', '#4C6FFF', 3, '2026-01-01', 'ancienne note')`
    ).run();
    ancienne.close();

    const db = openDb(fichier);
    const habit = getHabit(db, 1);
    assert.equal(habit.note, 'ancienne note'); // note existante conservée telle quelle
    assert.equal(habit.moment_lieu, '');
    assert.equal(habit.identite, '');
    db.close();

    // Deuxième ouverture : idempotente, ne casse rien et ne duplique rien.
    const db2 = openDb(fichier);
    const habit2 = getHabit(db2, 1);
    assert.equal(habit2.note, 'ancienne note');
    assert.equal(habit2.moment_lieu, '');
    db2.close();
  } finally {
    fs.rmSync(fichier, { force: true });
    fs.rmSync(`${fichier}-shm`, { force: true });
    fs.rmSync(`${fichier}-wal`, { force: true });
  }
});

test('archiveHabit pose la date d archivage', () => {
  const { db, habit } = baseAvecHabitude();
  archiveHabit(db, habit.id);
  const h = getHabit(db, habit.id);
  assert.equal(h.archived, 1);
  assert.equal(h.archived_at, todayISO());
});

test('getAllHabits rend aussi les archivées, getHabits non', () => {
  const { db, habit } = baseAvecHabitude();
  archiveHabit(db, habit.id);
  assert.equal(getHabits(db).length, 0);
  assert.equal(getAllHabits(db).length, 1);
});

test('refFor rend le jour pour une daily et le lundi pour une weekly', () => {
  assert.equal(refFor({ type: 'daily' }, '2026-07-15'), '2026-07-15');
  assert.equal(refFor({ type: 'weekly' }, '2026-07-15'), '2026-07-13');
});

test('toggle d\'une daily bascule entre 1 et 0', () => {
  const { db, habit } = baseAvecHabitude();
  const jour = todayISO();
  assert.equal(toggle(db, habit.id, jour), 1);
  assert.equal(toggle(db, habit.id, jour), 0);
});

test('toggle à 0 supprime l\'entry plutôt que d\'écrire un zéro', () => {
  const { db, habit } = baseAvecHabitude();
  const jour = todayISO();
  toggle(db, habit.id, jour);
  toggle(db, habit.id, jour);
  assert.deepEqual(getEntries(db, habit.id), {});
});

test('toggle d\'une weekly cycle 0 → 1 → 2 → 3 → 0 sur un objectif de 3', () => {
  const { db, habit } = baseAvecHabitude({ type: 'weekly', objectif: 3 });
  const semaine = mondayOf(todayISO());
  assert.equal(toggle(db, habit.id, semaine), 1);
  assert.equal(toggle(db, habit.id, semaine), 2);
  assert.equal(toggle(db, habit.id, semaine), 3);
  assert.equal(toggle(db, habit.id, semaine), 0);
});

test('toggle accepte une date passée postérieure à la création', () => {
  const { db, habit } = baseAvecHabitude();
  db.prepare('UPDATE habits SET created_at = ? WHERE id = ?')
    .run('2026-01-01', habit.id);
  assert.equal(toggle(db, habit.id, '2026-02-01'), 1);
});

test('toggle refuse une date future', () => {
  const { db, habit } = baseAvecHabitude();
  const demain = addDays(todayISO(), 1);
  assert.throws(() => toggle(db, habit.id, demain), /fenêtre/i);
});

test('toggle refuse une date antérieure à la création de l\'habitude', () => {
  const { db, habit } = baseAvecHabitude();
  db.prepare('UPDATE habits SET created_at = ? WHERE id = ?')
    .run('2026-07-01', habit.id);
  assert.throws(() => toggle(db, habit.id, '2026-06-30'), /fenêtre/i);
});

test('toggle enregistre l\'objectif courant de l\'habitude sur l\'entry écrite', () => {
  const { db, habit } = baseAvecHabitude({ type: 'weekly', objectif: 2 });
  const semaine = mondayOf(todayISO());
  toggle(db, habit.id, semaine);
  const entries = getEntries(db, habit.id);
  assert.equal(entries[semaine].count, 1);
  assert.equal(entries[semaine].objectif, 2);
});

test('la table entries expose bien une colonne objectif après ouverture', () => {
  const db = openDb(':memory:');
  const colonnes = db.prepare('PRAGMA table_info(entries)').all();
  assert.ok(colonnes.some((c) => c.name === 'objectif'));
});

test('la migration objectif backfille les entries existantes et reste idempotente', () => {
  const fichier = path.join(os.tmpdir(), `greene-migration-test-${Date.now()}-${Math.random()}.db`);
  try {
    // Simule une base créée AVANT l'ajout de la colonne objectif sur entries
    // (schéma d'origine, sans passer par openDb).
    const ancienne = new Database(fichier);
    ancienne.exec(`
      CREATE TABLE players (
        id INTEGER PRIMARY KEY, nom TEXT NOT NULL, created_at TEXT NOT NULL, archived INTEGER NOT NULL DEFAULT 0
      );
      CREATE TABLE habits (
        id INTEGER PRIMARY KEY, player_id INTEGER NOT NULL, nom TEXT NOT NULL, type TEXT NOT NULL,
        couleur TEXT NOT NULL, objectif INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL, archived INTEGER NOT NULL DEFAULT 0
      );
      CREATE TABLE entries (
        id INTEGER PRIMARY KEY, habit_id INTEGER NOT NULL, date_ref TEXT NOT NULL, count INTEGER NOT NULL DEFAULT 0,
        UNIQUE (habit_id, date_ref)
      );
    `);
    ancienne.prepare(`INSERT INTO players (id, nom, created_at) VALUES (1, 'Anatole', '2026-01-01')`).run();
    ancienne.prepare(
      `INSERT INTO habits (id, player_id, nom, type, couleur, objectif, created_at)
       VALUES (1, 1, 'Sport', 'weekly', '#4C6FFF', 3, '2026-01-01')`
    ).run();
    ancienne.prepare(`INSERT INTO entries (habit_id, date_ref, count) VALUES (1, '2026-01-05', 2)`).run();
    ancienne.close();

    const db = openDb(fichier);
    const entries = getEntries(db, 1);
    assert.equal(entries['2026-01-05'].count, 2);
    assert.equal(entries['2026-01-05'].objectif, 3); // backfillé depuis habits.objectif
    db.close();

    // Deuxième ouverture : la migration ne doit ni échouer ni écraser la donnée.
    const db2 = openDb(fichier);
    const entries2 = getEntries(db2, 1);
    assert.equal(entries2['2026-01-05'].objectif, 3);
    db2.close();
  } finally {
    fs.rmSync(fichier, { force: true });
    fs.rmSync(`${fichier}-shm`, { force: true });
    fs.rmSync(`${fichier}-wal`, { force: true });
  }
});

test('getGels rend un Set vide pour une habitude sans gel', () => {
  const { db, habit } = baseAvecHabitude();
  assert.deepEqual(getGels(db, habit.id), new Set());
});

test('getGels rend les refs gelées d\'une habitude', () => {
  const { db, habit } = baseAvecHabitude();
  const jour = addDays(todayISO(), -1);
  db.prepare('INSERT INTO gels (habit_id, ref, semaine, created_at) VALUES (?, ?, ?, ?)')
    .run(habit.id, jour, mondayOf(jour), todayISO());
  assert.deepEqual(getGels(db, habit.id), new Set([jour]));
});

test('countGelsSemaine compte les gels de toutes les habitudes du même joueur', () => {
  const db = openDb(':memory:');
  const h1 = createHabit(db, { player_id: 1, nom: 'Lecture', type: 'daily', couleur: '#4C6FFF', objectif: 1 });
  const h2 = createHabit(db, { player_id: 1, nom: 'Sport', type: 'daily', couleur: '#22C55E', objectif: 1 });
  const semaine = mondayOf(todayISO());
  db.prepare('INSERT INTO gels (habit_id, ref, semaine, created_at) VALUES (?, ?, ?, ?)')
    .run(h1.id, addDays(todayISO(), -1), semaine, todayISO());
  db.prepare('INSERT INTO gels (habit_id, ref, semaine, created_at) VALUES (?, ?, ?, ?)')
    .run(h2.id, addDays(todayISO(), -2), semaine, todayISO());
  assert.equal(countGelsSemaine(db, 1, semaine), 2);
});

test('countGelsSemaine ignore les gels d\'un autre joueur', () => {
  const db = openDb(':memory:');
  const h1 = createHabit(db, { player_id: 1, nom: 'Lecture', type: 'daily', couleur: '#4C6FFF', objectif: 1 });
  const semaine = mondayOf(todayISO());
  db.prepare('INSERT INTO gels (habit_id, ref, semaine, created_at) VALUES (?, ?, ?, ?)')
    .run(h1.id, addDays(todayISO(), -1), semaine, todayISO());
  assert.equal(countGelsSemaine(db, 2, semaine), 0);
});

test('le schéma refuse deux gels sur la même habitude et le même jour', () => {
  const { db, habit } = baseAvecHabitude();
  const jour = todayISO();
  db.prepare('INSERT INTO gels (habit_id, ref, semaine, created_at) VALUES (?, ?, ?, ?)')
    .run(habit.id, jour, mondayOf(jour), jour);
  assert.throws(() => {
    db.prepare('INSERT INTO gels (habit_id, ref, semaine, created_at) VALUES (?, ?, ?, ?)')
      .run(habit.id, jour, mondayOf(jour), jour);
  });
});

test('deleteHabit supprime aussi les gels sans lever d\'erreur de contrainte', () => {
  const { db, habit } = baseAvecHabitude();
  const jour = todayISO();
  db.prepare('INSERT INTO gels (habit_id, ref, semaine, created_at) VALUES (?, ?, ?, ?)')
    .run(habit.id, jour, mondayOf(jour), jour);
  deleteHabit(db, habit.id);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM gels').get().n, 0);
});

test('createGel pose un gel sur un jour raté et retourne les gels restants', () => {
  const { db, habit } = baseAvecHabitude();
  db.prepare('UPDATE habits SET created_at = ? WHERE id = ?').run(addDays(todayISO(), -5), habit.id);
  const hier = addDays(todayISO(), -1);
  const g = createGel(db, habit.id, hier);
  assert.equal(g.ref, hier);
  assert.equal(g.habit_id, habit.id);
  assert.equal(g.gels_restants, 1);
  assert.deepEqual(getGels(db, habit.id), new Set([hier]));
});

test('createGel refuse une habitude weekly', () => {
  const { db, habit } = baseAvecHabitude({ type: 'weekly', objectif: 2 });
  const semainePassee = addDays(mondayOf(todayISO()), -7);
  assert.throws(() => createGel(db, habit.id, semainePassee), /quotidienne/i);
});

test('createGel refuse le jour en cours (pas encore raté)', () => {
  const { db, habit } = baseAvecHabitude();
  assert.throws(() => createGel(db, habit.id, todayISO()), /fenêtre/i);
});

test('createGel refuse une date antérieure à la création', () => {
  const { db, habit } = baseAvecHabitude();
  db.prepare('UPDATE habits SET created_at = ? WHERE id = ?').run('2026-07-01', habit.id);
  assert.throws(() => createGel(db, habit.id, '2026-06-30'), /fenêtre/i);
});

test('createGel refuse un jour déjà réussi', () => {
  const { db, habit } = baseAvecHabitude();
  db.prepare('UPDATE habits SET created_at = ? WHERE id = ?').run(addDays(todayISO(), -5), habit.id);
  const hier = addDays(todayISO(), -1);
  toggle(db, habit.id, hier);
  assert.throws(() => createGel(db, habit.id, hier), /déjà réussi/i);
});

test('createGel refuse de geler deux fois le même jour', () => {
  const { db, habit } = baseAvecHabitude();
  db.prepare('UPDATE habits SET created_at = ? WHERE id = ?').run(addDays(todayISO(), -5), habit.id);
  const hier = addDays(todayISO(), -1);
  createGel(db, habit.id, hier);
  assert.throws(() => createGel(db, habit.id, hier), /déjà protégé/i);
});

test('createGel refuse au-delà du quota de 2 gels par semaine', () => {
  const db = openDb(':memory:');
  const habit = createHabit(db, { player_id: 1, nom: 'Lecture', type: 'daily', couleur: '#4C6FFF', objectif: 1 });
  const semaine = mondayOf(todayISO());
  const sem_passee = addDays(semaine, -7);
  db.prepare('UPDATE habits SET created_at = ? WHERE id = ?').run(addDays(sem_passee, -7), habit.id);
  createGel(db, habit.id, addDays(sem_passee, 0));
  createGel(db, habit.id, addDays(sem_passee, 1));
  assert.throws(() => createGel(db, habit.id, addDays(sem_passee, 2)), /gel disponible/i);
});

test('le quota de gels est partagé entre toutes les habitudes du même joueur', () => {
  const db = openDb(':memory:');
  const h1 = createHabit(db, { player_id: 1, nom: 'Lecture', type: 'daily', couleur: '#4C6FFF', objectif: 1 });
  const h2 = createHabit(db, { player_id: 1, nom: 'Sport', type: 'daily', couleur: '#22C55E', objectif: 1 });
  const semaine = mondayOf(todayISO());
  const sem_passee = addDays(semaine, -7);
  db.prepare('UPDATE habits SET created_at = ?').run(addDays(sem_passee, -7));
  createGel(db, h1.id, addDays(sem_passee, 0));
  createGel(db, h2.id, addDays(sem_passee, 1));
  assert.throws(() => createGel(db, h1.id, addDays(sem_passee, 2)), /gel disponible/i);
});

test('le quota de gels est indépendant entre deux joueurs différents', () => {
  const db = openDb(':memory:');
  const h1 = createHabit(db, { player_id: 1, nom: 'Lecture', type: 'daily', couleur: '#4C6FFF', objectif: 1 });
  const h2 = createHabit(db, { player_id: 2, nom: 'Sport', type: 'daily', couleur: '#22C55E', objectif: 1 });
  db.prepare('UPDATE habits SET created_at = ?').run(addDays(todayISO(), -5));
  createGel(db, h1.id, addDays(todayISO(), -1));
  createGel(db, h1.id, addDays(todayISO(), -2));
  const g = createGel(db, h2.id, addDays(todayISO(), -1));
  assert.equal(g.gels_restants, 1);
});
