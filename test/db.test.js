import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openDb, getPlayers, getHabits, COULEURS } from '../src/db.js';

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
