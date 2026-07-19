import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openDb, getPlayers, getHabits, COULEURS } from '../src/db.js';
import { todayISO, mondayOf, addDays } from '../src/dates.js';

test('openDb crée le schéma et amorce Anatole', () => {
  const db = openDb(':memory:');
  const joueurs = getPlayers(db);
  assert.equal(joueurs.length, 1);
  assert.equal(joueurs[0].nom, 'Anatole');
});

test('openDb est idempotent : deux migrations ne dupliquent pas Anatole', () => {
  const db = openDb(':memory:');
  const joueurs = getPlayers(db);
  assert.equal(joueurs.length, 1);
  assert.equal(getHabits(db).length, 0);
});

test('la palette contient 6 couleurs et jamais le rouge d\'échec', () => {
  assert.equal(COULEURS.length, 6);
  assert.ok(!COULEURS.includes('#EF4444'));
  assert.ok(!COULEURS.includes('#2A2A2E'));
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

import {
  createPlayer, createHabit, updateHabit, archiveHabit,
  getCounts, toggle, refFor
} from '../src/db.js';

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
  createPlayer(db, 'Nicolas');
  assert.deepEqual(getPlayers(db).map((j) => j.nom), ['Anatole', 'Nicolas']);
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

test('archiveHabit retire l\'habitude sans supprimer la ligne', () => {
  const { db, habit } = baseAvecHabitude();
  archiveHabit(db, habit.id);
  assert.equal(getHabits(db).length, 0);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM habits').get().n, 1);
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
  assert.deepEqual(getCounts(db, habit.id), {});
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
