import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openDb } from '../src/db.js';
import { createServer } from '../src/server.js';
import { todayISO } from '../src/dates.js';

async function demarrer() {
  const db = openDb(':memory:');
  const serveur = createServer(db);
  await new Promise((r) => serveur.listen(0, r));
  const base = `http://127.0.0.1:${serveur.address().port}`;
  return {
    base,
    fermer: () => new Promise((r) => serveur.close(r)),
    json: async (chemin, options) => {
      const rep = await fetch(base + chemin, options);
      return { statut: rep.status, corps: await rep.json().catch(() => null) };
    },
    post: (chemin, donnees, methode = 'POST') => ({
      method: methode,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(donnees)
    })
  };
}

test('GET /api/state rend Anatole sans habitude', async () => {
  const s = await demarrer();
  const { statut, corps } = await s.json('/api/state');
  assert.equal(statut, 200);
  assert.equal(corps.today, todayISO());
  assert.equal(corps.couleurs.length, 6);
  assert.equal(corps.players.length, 1);
  assert.equal(corps.players[0].nom, 'Anatole');
  assert.deepEqual(corps.players[0].habits, []);
  await s.fermer();
});

test('POST /api/players crée un joueur visible dans l\'état', async () => {
  const s = await demarrer();
  const { statut } = await s.json('/api/players', s.post('/api/players', { nom: 'Thomas' }));
  assert.equal(statut, 201);
  const { corps } = await s.json('/api/state');
  assert.equal(corps.players.length, 2);
  await s.fermer();
});

test('POST /api/players refuse un nom vide avec un 400', async () => {
  const s = await demarrer();
  const { statut } = await s.json('/api/players', s.post('/api/players', { nom: '  ' }));
  assert.equal(statut, 400);
  await s.fermer();
});

test('une habitude daily expose 7 points en attente', async () => {
  const s = await demarrer();
  await s.json('/api/habits', s.post('/api/habits', {
    player_id: 1, nom: 'Lecture', type: 'daily', couleur: '#4C6FFF', objectif: 1
  }));
  const { corps } = await s.json('/api/state');
  const habit = corps.players[0].habits[0];
  assert.equal(habit.points.length, 7);
  assert.equal(habit.streak, 0);
  // Créée aujourd'hui : aucun point ne peut déjà être rouge.
  assert.ok(!habit.points.some((p) => p.etat === 'rate'));
  await s.fermer();
});

test('POST /api/toggle passe le point du jour en réussi', async () => {
  const s = await demarrer();
  await s.json('/api/habits', s.post('/api/habits', {
    player_id: 1, nom: 'Lecture', type: 'daily', couleur: '#4C6FFF', objectif: 1
  }));
  const { statut, corps } = await s.json('/api/toggle',
    s.post('/api/toggle', { habit_id: 1, date_ref: todayISO() }));
  assert.equal(statut, 200);
  assert.equal(corps.count, 1);

  const etat = await s.json('/api/state');
  const habit = etat.corps.players[0].habits[0];
  const aujourdhui = habit.points.find((p) => p.ref === todayISO());
  assert.equal(aujourdhui.etat, 'reussi');
  assert.equal(habit.streak, 1);
  await s.fermer();
});

test('POST /api/toggle sur une date future rend 400', async () => {
  const s = await demarrer();
  await s.json('/api/habits', s.post('/api/habits', {
    player_id: 1, nom: 'Lecture', type: 'daily', couleur: '#4C6FFF', objectif: 1
  }));
  const { statut } = await s.json('/api/toggle',
    s.post('/api/toggle', { habit_id: 1, date_ref: '2099-01-01' }));
  assert.equal(statut, 400);
  await s.fermer();
});

test('PATCH /api/habits/:id modifie sans toucher au type', async () => {
  const s = await demarrer();
  await s.json('/api/habits', s.post('/api/habits', {
    player_id: 1, nom: 'Salle', type: 'weekly', couleur: '#4C6FFF', objectif: 2
  }));
  const { statut } = await s.json('/api/habits/1',
    s.post('/api/habits/1', { nom: 'Muscu', couleur: '#22C55E', objectif: 3, type: 'daily' }, 'PATCH'));
  assert.equal(statut, 200);
  const { corps } = await s.json('/api/state');
  const habit = corps.players[0].habits[0];
  assert.equal(habit.nom, 'Muscu');
  assert.equal(habit.objectif, 3);
  assert.equal(habit.type, 'weekly');
  await s.fermer();
});

test('POST /api/habits/:id/archive retire l\'habitude de l\'état', async () => {
  const s = await demarrer();
  await s.json('/api/habits', s.post('/api/habits', {
    player_id: 1, nom: 'Lecture', type: 'daily', couleur: '#4C6FFF', objectif: 1
  }));
  const { statut } = await s.json('/api/habits/1/archive', s.post('/api/habits/1/archive', {}));
  assert.equal(statut, 200);
  const { corps } = await s.json('/api/state');
  assert.deepEqual(corps.players[0].habits, []);
  await s.fermer();
});

test('GET /api/history rend stats et points depuis la création', async () => {
  const s = await demarrer();
  await s.json('/api/habits', s.post('/api/habits', {
    player_id: 1, nom: 'Lecture', type: 'daily', couleur: '#4C6FFF', objectif: 1
  }));
  await s.json('/api/toggle', s.post('/api/toggle', { habit_id: 1, date_ref: todayISO() }));
  const { statut, corps } = await s.json('/api/history?habit_id=1');
  assert.equal(statut, 200);
  assert.equal(corps.nom, 'Lecture');
  assert.equal(corps.streak, 1);
  assert.equal(corps.record, 1);
  assert.ok(Array.isArray(corps.points));
  assert.ok(corps.points.length >= 1);
  await s.fermer();
});

test('une route inconnue rend 404', async () => {
  const s = await demarrer();
  const { statut } = await s.json('/api/inexistant');
  assert.equal(statut, 404);
  await s.fermer();
});
