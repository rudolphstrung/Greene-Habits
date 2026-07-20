import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openDb } from '../src/db.js';
import { createServer } from '../src/server.js';
import { todayISO, mondayOf, addDays } from '../src/dates.js';

async function demarrer() {
  const db = openDb(':memory:');
  const serveur = createServer(db);
  await new Promise((r) => serveur.listen(0, r));
  const base = `http://127.0.0.1:${serveur.address().port}`;
  return {
    base,
    db,
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
  assert.equal(corps.couleurs.length, 12);
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

test('la semaine de création d\'une weekly non atteinte est en attente, jamais ratée, et ne pénalise pas le taux', async () => {
  const s = await demarrer();
  await s.json('/api/habits', s.post('/api/habits', {
    player_id: 1, nom: 'Sport', type: 'weekly', couleur: '#4C6FFF', objectif: 3
  }));
  // Recule la création à un mercredi, deux semaines avant aujourd'hui (lundi 2026-07-20).
  s.db.prepare('UPDATE habits SET created_at = ? WHERE id = ?').run('2026-07-08', 1);
  // Semaine de création (lundi 2026-07-06) : seulement 2 séances sur les 3 requises.
  await s.json('/api/toggle', s.post('/api/toggle', { habit_id: 1, date_ref: '2026-07-06' }));
  await s.json('/api/toggle', s.post('/api/toggle', { habit_id: 1, date_ref: '2026-07-06' }));
  // Semaine suivante (lundi 2026-07-13) : objectif pleinement atteint.
  await s.json('/api/toggle', s.post('/api/toggle', { habit_id: 1, date_ref: '2026-07-13' }));
  await s.json('/api/toggle', s.post('/api/toggle', { habit_id: 1, date_ref: '2026-07-13' }));
  await s.json('/api/toggle', s.post('/api/toggle', { habit_id: 1, date_ref: '2026-07-13' }));

  const { corps } = await s.json('/api/history?habit_id=1');
  const semaineCreation = corps.points.find((p) => p.ref === '2026-07-06');
  assert.equal(semaineCreation.etat, 'attente');
  assert.ok(!corps.points.some((p) => p.etat === 'rate'));
  // Sans la semaine de création non atteinte, la seule semaine écoulée
  // (2026-07-13, réussie) donne 100 %, pas 50 % : la création n'est pas
  // comptée comme un échec.
  assert.equal(corps.taux, 100);
  assert.equal(corps.streak, 1);
  await s.fermer();
});

test('une weekly dont la semaine de création est atteinte compte comme un succès partout', async () => {
  const s = await demarrer();
  await s.json('/api/habits', s.post('/api/habits', {
    player_id: 1, nom: 'Sport', type: 'weekly', couleur: '#4C6FFF', objectif: 3
  }));
  s.db.prepare('UPDATE habits SET created_at = ? WHERE id = ?').run('2026-07-15', 1);
  // Semaine de création (lundi 2026-07-13) : objectif atteint malgré la
  // création en milieu de semaine.
  await s.json('/api/toggle', s.post('/api/toggle', { habit_id: 1, date_ref: '2026-07-15' }));
  await s.json('/api/toggle', s.post('/api/toggle', { habit_id: 1, date_ref: '2026-07-16' }));
  await s.json('/api/toggle', s.post('/api/toggle', { habit_id: 1, date_ref: '2026-07-17' }));

  const { corps } = await s.json('/api/history?habit_id=1');
  const semaineCreation = corps.points.find((p) => p.ref === '2026-07-13');
  assert.equal(semaineCreation.etat, 'reussi');
  assert.equal(corps.streak, 1);
  await s.fermer();
});

test('POST /api/habits/:id/archive sur un id inexistant rend 400', async () => {
  const s = await demarrer();
  const { statut, corps } = await s.json('/api/habits/9999/archive', s.post('/api/habits/9999/archive', {}));
  assert.equal(statut, 400);
  assert.ok(corps.erreur);
  await s.fermer();
});

test('augmenter l\'objectif d\'une weekly ne repeint pas en rouge une semaine passée déjà réussie', async () => {
  const s = await demarrer();
  await s.json('/api/habits', s.post('/api/habits', {
    player_id: 1, nom: 'Sport', type: 'weekly', couleur: '#4C6FFF', objectif: 2
  }));
  // Recule la création pour avoir une semaine passée entièrement écoulée.
  s.db.prepare('UPDATE habits SET created_at = ? WHERE id = ?').run('2026-06-01', 1);
  // Semaine passée (lundi 2026-07-06) : objectif de 2 pleinement atteint à l'époque.
  await s.json('/api/toggle', s.post('/api/toggle', { habit_id: 1, date_ref: '2026-07-06' }));
  await s.json('/api/toggle', s.post('/api/toggle', { habit_id: 1, date_ref: '2026-07-06' }));

  // On augmente l'objectif à 3 : l'historique déjà réussi ne doit pas en souffrir.
  const { statut: statutPatch } = await s.json('/api/habits/1', s.post('/api/habits/1', {
    nom: 'Sport', couleur: '#4C6FFF', objectif: 3
  }, 'PATCH'));
  assert.equal(statutPatch, 200);

  const { corps } = await s.json('/api/history?habit_id=1');
  const semainePassee = corps.points.find((p) => p.ref === '2026-07-06');
  assert.equal(semainePassee.etat, 'reussi');
  await s.fermer();
});

test('la période courante est toujours jugée contre l\'objectif actuel de l\'habitude', async () => {
  const s = await demarrer();
  await s.json('/api/habits', s.post('/api/habits', {
    player_id: 1, nom: 'Sport', type: 'weekly', couleur: '#4C6FFF', objectif: 2
  }));
  s.db.prepare('UPDATE habits SET created_at = ? WHERE id = ?').run('2026-06-01', 1);
  const semaineCourante = mondayOf(todayISO());
  // 2 séances cette semaine : suffisant pour l'ancien objectif de 2.
  await s.json('/api/toggle', s.post('/api/toggle', { habit_id: 1, date_ref: semaineCourante }));
  await s.json('/api/toggle', s.post('/api/toggle', { habit_id: 1, date_ref: semaineCourante }));

  await s.json('/api/habits/1', s.post('/api/habits/1', {
    nom: 'Sport', couleur: '#4C6FFF', objectif: 3
  }, 'PATCH'));

  const { corps } = await s.json('/api/state');
  const habit = corps.players[0].habits[0];
  const pointCourant = habit.points.find((p) => p.ref === semaineCourante);
  // 2 < nouvel objectif 3 : plus réussi. Mais période en cours → jamais rouge.
  assert.equal(pointCourant.etat, 'attente');
  await s.fermer();
});

test('les points antérieurs à la création d\'une habitude ne sont pas cliquables, le point courant l\'est', async () => {
  const s = await demarrer();
  await s.json('/api/habits', s.post('/api/habits', {
    player_id: 1, nom: 'Sport', type: 'weekly', couleur: '#4C6FFF', objectif: 2
  }));
  const { corps } = await s.json('/api/state');
  const habit = corps.players[0].habits[0];
  assert.equal(habit.points.length, 7);

  const refCourante = mondayOf(todayISO());
  const anterieurs = habit.points.filter((p) => p.ref !== refCourante);
  assert.equal(anterieurs.length, 6);
  assert.ok(anterieurs.every((p) => p.cliquable === false));

  const courant = habit.points.find((p) => p.ref === refCourante);
  assert.equal(courant.cliquable, true);
  await s.fermer();
});

test('POST /api/toggle sur une date antérieure à la création rend toujours 400', async () => {
  const s = await demarrer();
  await s.json('/api/habits', s.post('/api/habits', {
    player_id: 1, nom: 'Sport', type: 'weekly', couleur: '#4C6FFF', objectif: 2
  }));
  const semainePrecedente = addDays(mondayOf(todayISO()), -7);
  const { statut, corps } = await s.json('/api/toggle',
    s.post('/api/toggle', { habit_id: 1, date_ref: semainePrecedente }));
  assert.equal(statut, 400);
  assert.ok(corps.erreur);
  await s.fermer();
});
