import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openDb, getPlayers, getHabit, slugifier } from '../src/db.js';
import { createServer } from '../src/server.js';
import { todayISO, mondayOf, addDays, firstOfMonth } from '../src/dates.js';

// Le serveur exige désormais, sur chaque requête mutante, le slug du joueur
// dont la page est ouverte (`/anatole`). Les tests qui ne portent pas sur
// cette règle n'ont pas à le fournir : on déduit ici le slug du propriétaire
// légitime (player_id du corps, propriétaire de habit_id, ou habitude visée
// dans l'URL). Un test d'appartenance passe `joueur` explicitement — y compris
// `null` pour simuler la page d'accueil, où personne n'agit.
function slugLegitime(db, chemin, corps) {
  const parId = (playerId) => {
    const joueur = getPlayers(db).find((j) => j.id === Number(playerId));
    return joueur ? slugifier(joueur.nom) : null;
  };
  if (corps.player_id !== undefined) return parId(corps.player_id);
  const habitId = corps.habit_id !== undefined
    ? Number(corps.habit_id)
    : Number(chemin.match(/^\/api\/habits\/(\d+)/)?.[1]);
  if (!Number.isInteger(habitId)) return null;
  const habit = getHabit(db, habitId);
  return habit ? parId(habit.player_id) : null;
}

// Les trahisons ne se comptent que dans le mois calendaire en cours : un test
// qui a besoin de jours passés à juger échoue à tort s'il tourne le 1er du
// mois (aucun jour écoulé). Ces tests-là figent « aujourd'hui » via le seam
// GREENE_TODAY. Une date FIGÉE ne se périme pas, contrairement à un
// « aujourd'hui = ... » codé en dur pendant que le temps réel avance.
const JOUR_FIGE = '2026-09-16'; // un mercredi, en milieu de mois

function figerJour() {
  process.env.GREENE_TODAY = JOUR_FIGE;
  return () => { delete process.env.GREENE_TODAY; };
}

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
    post: (chemin, donnees, methode = 'POST') => {
      const corps = { ...donnees };
      if (corps.joueur === undefined) {
        const slug = slugLegitime(db, chemin, corps);
        if (slug) corps.joueur = slug;
      }
      return {
        method: methode,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(corps)
      };
    }
  };
}

test('GET /api/state rend les 6 joueurs sans habitude, chacun avec couleur et slug', async () => {
  const s = await demarrer();
  try {
    const { statut, corps } = await s.json('/api/state');
    assert.equal(statut, 200);
    assert.equal(corps.today, todayISO());
    assert.equal(corps.couleurs.length, 12);
    assert.equal(corps.players.length, 6);
    assert.deepEqual(corps.players.map((p) => p.nom),
      ['Nicolas', 'Axel', 'Thomas', 'Owen', 'Guillaume', 'Anatole']);
    assert.ok(corps.players.every((p) => Array.isArray(p.habits) && p.habits.length === 0));
  } finally {
    await s.fermer();
  }
});

test('POST /api/players crée un joueur visible dans l\'état', async () => {
  const s = await demarrer();
  try {
    const { statut } = await s.json('/api/players', s.post('/api/players', { nom: 'Invité' }));
    assert.equal(statut, 201);
    const { corps } = await s.json('/api/state');
    assert.equal(corps.players.length, 7);
  } finally {
    await s.fermer();
  }
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
  try {
    await s.json('/api/habits', s.post('/api/habits', {
      player_id: 1, nom: 'Sport', type: 'weekly', couleur: '#4C6FFF', objectif: 3
    }));
    // Ancrage dynamique sur la semaine courante (jamais une date en dur, qui
    // se périme au fil des semaines) : semaineCreation = 2 semaines avant la
    // semaine en cours, semaineIntermediaire = la semaine pleinement écoulée
    // entre les deux.
    const semaineCourante = mondayOf(todayISO());
    const semaineIntermediaire = addDays(semaineCourante, -7);
    const semaineCreation = addDays(semaineCourante, -14);
    // Recule la création à un mercredi de sa semaine.
    s.db.prepare('UPDATE habits SET created_at = ? WHERE id = ?').run(addDays(semaineCreation, 2), 1);
    // Semaine de création : seulement 2 séances sur les 3 requises.
    await s.json('/api/toggle', s.post('/api/toggle', { habit_id: 1, date_ref: semaineCreation }));
    await s.json('/api/toggle', s.post('/api/toggle', { habit_id: 1, date_ref: semaineCreation }));
    // Semaine suivante : objectif pleinement atteint.
    await s.json('/api/toggle', s.post('/api/toggle', { habit_id: 1, date_ref: semaineIntermediaire }));
    await s.json('/api/toggle', s.post('/api/toggle', { habit_id: 1, date_ref: semaineIntermediaire }));
    await s.json('/api/toggle', s.post('/api/toggle', { habit_id: 1, date_ref: semaineIntermediaire }));

    const { corps } = await s.json('/api/history?habit_id=1');
    const pointCreation = corps.points.find((p) => p.ref === semaineCreation);
    assert.equal(pointCreation.etat, 'attente');
    assert.ok(!corps.points.some((p) => p.etat === 'rate'));
    // Sans la semaine de création non atteinte, la seule semaine écoulée
    // (semaineIntermediaire, réussie) donne 100 %, pas 50 % : la création
    // n'est pas comptée comme un échec.
    assert.equal(corps.taux, 100);
    assert.equal(corps.streak, 1);
  } finally {
    await s.fermer();
  }
});

test('une weekly dont la semaine de création est atteinte compte comme un succès partout', async () => {
  const s = await demarrer();
  try {
    await s.json('/api/habits', s.post('/api/habits', {
      player_id: 1, nom: 'Sport', type: 'weekly', couleur: '#4C6FFF', objectif: 3
    }));
    // Ancrage dynamique : la semaine de création est celle juste avant la
    // semaine en cours (jamais une date en dur, qui se périme).
    const semaineCourante = mondayOf(todayISO());
    const semaineCreation = addDays(semaineCourante, -7);
    s.db.prepare('UPDATE habits SET created_at = ? WHERE id = ?').run(addDays(semaineCreation, 2), 1);
    // Semaine de création : objectif atteint malgré la création en milieu de semaine.
    await s.json('/api/toggle', s.post('/api/toggle', { habit_id: 1, date_ref: addDays(semaineCreation, 2) }));
    await s.json('/api/toggle', s.post('/api/toggle', { habit_id: 1, date_ref: addDays(semaineCreation, 3) }));
    await s.json('/api/toggle', s.post('/api/toggle', { habit_id: 1, date_ref: addDays(semaineCreation, 4) }));

    const { corps } = await s.json('/api/history?habit_id=1');
    const pointCreation = corps.points.find((p) => p.ref === semaineCreation);
    assert.equal(pointCreation.etat, 'reussi');
    assert.equal(corps.streak, 1);
  } finally {
    await s.fermer();
  }
});

test('POST /api/habits/:id/archive sur un id inexistant rend 400', async () => {
  const s = await demarrer();
  const { statut, corps } = await s.json('/api/habits/9999/archive', s.post('/api/habits/9999/archive', {}));
  assert.equal(statut, 400);
  assert.ok(corps.erreur);
  await s.fermer();
});

test('POST /api/habits/:id/delete supprime définitivement l\'habitude ET son historique', async () => {
  const s = await demarrer();
  try {
    await s.json('/api/habits', s.post('/api/habits', {
      player_id: 1, nom: 'Lecture', type: 'daily', couleur: '#4C6FFF', objectif: 1
    }));
    await s.json('/api/toggle', s.post('/api/toggle', { habit_id: 1, date_ref: todayISO() }));

    const { statut } = await s.json('/api/habits/1/delete', s.post('/api/habits/1/delete', {}));
    assert.equal(statut, 200);

    // Absente de l'état ET du profil (ni active ni archivée).
    const st = (await s.json('/api/state')).corps;
    assert.equal(st.players[0].habits.length, 0);
    const prof = (await s.json('/api/profile?player_id=1')).corps;
    assert.equal(prof.actives.length + prof.archivees.length, 0);

    // Entries effacées, et history → 404.
    assert.equal(s.db.prepare('SELECT COUNT(*) AS n FROM entries WHERE habit_id = 1').get().n, 0);
    assert.equal((await s.json('/api/history?habit_id=1')).statut, 404);
  } finally {
    await s.fermer();
  }
});

test('POST /api/habits/:id/delete sur un id inexistant rend 400', async () => {
  const s = await demarrer();
  try {
    const { statut } = await s.json('/api/habits/9999/delete', s.post('/api/habits/9999/delete', {}));
    assert.equal(statut, 400);
  } finally {
    await s.fermer();
  }
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
  // Weekly = 4 points : la semaine en cours + les 3 précédentes.
  assert.equal(habit.points.length, 4);

  const refCourante = mondayOf(todayISO());
  // La semaine en cours est le dernier point (à droite).
  assert.equal(habit.points[3].ref, refCourante);

  const anterieurs = habit.points.filter((p) => p.ref !== refCourante);
  assert.equal(anterieurs.length, 3);
  assert.ok(anterieurs.every((p) => p.cliquable === false));

  const courant = habit.points.find((p) => p.ref === refCourante);
  assert.equal(courant.cliquable, true);
  await s.fermer();
});

test('une habitude weekly n affiche aucune semaine future', async () => {
  const s = await demarrer();
  try {
    await s.json('/api/habits', s.post('/api/habits', {
      player_id: 1, nom: 'Sport', type: 'weekly', couleur: '#4C6FFF', objectif: 2
    }));
    const { corps } = await s.json('/api/state');
    const habit = corps.players[0].habits[0];
    const refCourante = mondayOf(todayISO());
    assert.ok(habit.points.every((p) => p.ref <= refCourante),
      'aucun point postérieur à la semaine en cours');
  } finally {
    await s.fermer();
  }
});

test('seul le point de la période en cours porte actuel=true (pour le bouton valider)', async () => {
  const s = await demarrer();
  try {
    await s.json('/api/habits', s.post('/api/habits', {
      player_id: 1, nom: 'Lecture', type: 'daily', couleur: '#4C6FFF', objectif: 1
    }));
    const { corps } = await s.json('/api/state');
    const habit = corps.players[0].habits[0];
    const actuels = habit.points.filter((p) => p.actuel);
    assert.equal(actuels.length, 1, 'un seul point actuel');
    assert.equal(actuels[0].ref, todayISO());
  } finally {
    await s.fermer();
  }
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

test('POST /api/gels pose un gel sur un jour raté', async () => {
  const s = await demarrer();
  try {
    await s.json('/api/habits', s.post('/api/habits', {
      player_id: 1, nom: 'Lecture', type: 'daily', couleur: '#4C6FFF', objectif: 1
    }));
    s.db.prepare('UPDATE habits SET created_at = ? WHERE id = 1').run(addDays(todayISO(), -5));
    const hier = addDays(todayISO(), -1);
    const { statut, corps } = await s.json('/api/gels', s.post('/api/gels', { habit_id: 1, date_ref: hier }));
    assert.equal(statut, 201);
    assert.equal(corps.ref, hier);
    assert.equal(corps.gels_restants, 1);
  } finally {
    await s.fermer();
  }
});

test('POST /api/gels refuse au-delà du quota avec un 400', async () => {
  const s = await demarrer();
  try {
    await s.json('/api/habits', s.post('/api/habits', {
      player_id: 1, nom: 'Lecture', type: 'daily', couleur: '#4C6FFF', objectif: 1
    }));
    s.db.prepare('UPDATE habits SET created_at = ? WHERE id = 1').run(addDays(todayISO(), -14));
    // Tous les 3 gels dans la semaine passée pour assurer qu'ils sont dans la même semaine ISO
    const semainePassee = addDays(mondayOf(todayISO()), -7);
    const j1 = semainePassee;
    const j2 = addDays(semainePassee, 1);
    const j3 = addDays(semainePassee, 2);
    await s.json('/api/gels', s.post('/api/gels', { habit_id: 1, date_ref: j1 }));
    await s.json('/api/gels', s.post('/api/gels', { habit_id: 1, date_ref: j2 }));
    const { statut, corps } = await s.json('/api/gels', s.post('/api/gels', { habit_id: 1, date_ref: j3 }));
    assert.equal(statut, 400);
    assert.ok(corps.erreur);
  } finally {
    await s.fermer();
  }
});

test('POST /api/gels refuse une habitude weekly avec un 400', async () => {
  const s = await demarrer();
  try {
    await s.json('/api/habits', s.post('/api/habits', {
      player_id: 1, nom: 'Sport', type: 'weekly', couleur: '#4C6FFF', objectif: 2
    }));
    const semainePassee = addDays(mondayOf(todayISO()), -7);
    const { statut } = await s.json('/api/gels', s.post('/api/gels', { habit_id: 1, date_ref: semainePassee }));
    assert.equal(statut, 400);
  } finally {
    await s.fermer();
  }
});

// --- Tâche 4 : neutralise streak/record/taux/trahisons via gels + gels_restants ---

test('un jour gelé protège le streak sans le faire redescendre à 0', async () => {
  const s = await demarrer();
  try {
    await s.json('/api/habits', s.post('/api/habits', {
      player_id: 1, nom: 'Lecture', type: 'daily', couleur: '#4C6FFF', objectif: 1
    }));
    s.db.prepare('UPDATE habits SET created_at = ? WHERE id = 1').run(addDays(todayISO(), -3));
    // J-3, J-2 réussis, J-1 raté (protégé par un gel), J0 (aujourd'hui) réussi.
    await s.json('/api/toggle', s.post('/api/toggle', { habit_id: 1, date_ref: addDays(todayISO(), -3) }));
    await s.json('/api/toggle', s.post('/api/toggle', { habit_id: 1, date_ref: addDays(todayISO(), -2) }));
    await s.json('/api/toggle', s.post('/api/toggle', { habit_id: 1, date_ref: todayISO() }));
    await s.json('/api/gels', s.post('/api/gels', { habit_id: 1, date_ref: addDays(todayISO(), -1) }));

    const { corps } = await s.json('/api/state');
    const habit = corps.players[0].habits[0];
    // Le jour gelé est invisible du calcul : J-3, J-2 (gelé sauté), J0 → streak 3.
    assert.equal(habit.streak, 3);
  } finally {
    await s.fermer();
  }
});

test('un jour gelé ne compte pas comme trahison', async () => {
  const s = await demarrer();
  try {
    await s.json('/api/habits', s.post('/api/habits', {
      player_id: 1, nom: 'Lecture', type: 'daily', couleur: '#4C6FFF', objectif: 1
    }));
    const creation = addDays(todayISO(), -2);
    const gele = addDays(todayISO(), -1);
    s.db.prepare('UPDATE habits SET created_at = ? WHERE id = 1').run(creation);
    await s.json('/api/gels', s.post('/api/gels', { habit_id: 1, date_ref: gele }));

    const { corps } = await s.json('/api/state');
    // J-2 (création, non cochée) = 1 trahison ; J-1 (gelé) = 0 ; J0 (en cours) = 0.
    // trahisonsDeLHabitude exclut tout ref < firstOfMonth(aujourd'hui) : reculer
    // de 2 jours peut donc traverser un début de mois (exécution le 1er ou le
    // 2 du mois), auquel cas J-2 (et parfois J-1) tombent hors du mois en cours
    // et ne comptent plus du tout, gel ou pas. On calcule l'attendu dynamiquement
    // à partir de firstOfMonth(todayISO()) plutôt que de coder en dur 1 : le
    // test reste vrai quel que soit le jour d'exécution, tout en vérifiant
    // toujours qu'un jour gelé n'ajoute jamais de trahison (cf. raisonnement :
    // si J-2 est dans le mois en cours, J-1 l'est nécessairement aussi, donc le
    // seul cas où gel est structurellement dans le mois sans que la création le
    // soit, la protection par gel est bien exercée et rend quand même le total
    // à 0, identique à l'exclusion mensuelle).
    const attendu = creation >= firstOfMonth(todayISO()) ? 1 : 0;
    assert.equal(corps.leaderboard.find((l) => l.nom === 'Nicolas').trahisons, attendu);
  } finally {
    await s.fermer();
  }
});

test('le point d\'un jour gelé porte l\'état gele', async () => {
  const s = await demarrer();
  try {
    await s.json('/api/habits', s.post('/api/habits', {
      player_id: 1, nom: 'Lecture', type: 'daily', couleur: '#4C6FFF', objectif: 1
    }));
    s.db.prepare('UPDATE habits SET created_at = ? WHERE id = 1').run(addDays(todayISO(), -2));
    const hier = addDays(todayISO(), -1);
    await s.json('/api/gels', s.post('/api/gels', { habit_id: 1, date_ref: hier }));

    const { corps } = await s.json('/api/state');
    const point = corps.players[0].habits[0].points.find((p) => p.ref === hier);
    assert.equal(point.etat, 'gele');
  } finally {
    await s.fermer();
  }
});

test('marquer fait après coup un jour gelé le rend réussi : le gel devient sans effet', async () => {
  const s = await demarrer();
  try {
    await s.json('/api/habits', s.post('/api/habits', {
      player_id: 1, nom: 'Lecture', type: 'daily', couleur: '#4C6FFF', objectif: 1
    }));
    s.db.prepare('UPDATE habits SET created_at = ? WHERE id = 1').run(addDays(todayISO(), -2));
    const hier = addDays(todayISO(), -1);
    await s.json('/api/gels', s.post('/api/gels', { habit_id: 1, date_ref: hier }));
    await s.json('/api/toggle', s.post('/api/toggle', { habit_id: 1, date_ref: hier }));

    const { corps } = await s.json('/api/state');
    const point = corps.players[0].habits[0].points.find((p) => p.ref === hier);
    assert.equal(point.etat, 'reussi');
  } finally {
    await s.fermer();
  }
});

test('/api/state expose gels_restants par joueur, décrémenté après usage', async () => {
  const s = await demarrer();
  try {
    const avant = (await s.json('/api/state')).corps;
    assert.equal(avant.players.find((p) => p.nom === 'Nicolas').gels_restants, 2);

    await s.json('/api/habits', s.post('/api/habits', {
      player_id: 1, nom: 'Lecture', type: 'daily', couleur: '#4C6FFF', objectif: 1
    }));
    // Le quota est désormais indexé sur la semaine où le gel est POSÉ
    // (aujourd'hui), jamais sur la semaine du jour protégé : peu importe quel
    // jour passé on gèle, le compteur affiché baisse toujours de la même
    // façon. Pas besoin de distinguo selon le jour d'exécution du test.
    const jourAGeler = addDays(todayISO(), -1);
    s.db.prepare('UPDATE habits SET created_at = ? WHERE id = 1').run(addDays(todayISO(), -5));
    await s.json('/api/gels', s.post('/api/gels', { habit_id: 1, date_ref: jourAGeler }));

    const apres = (await s.json('/api/state')).corps;
    assert.equal(apres.players.find((p) => p.nom === 'Nicolas').gels_restants, 1);
    // Les autres joueurs gardent leurs 2 gels intacts (quota indépendant).
    assert.equal(apres.players.find((p) => p.nom === 'Axel').gels_restants, 2);
  } finally {
    await s.fermer();
  }
});

test('GET /api/history reflète l\'état gele et neutralise le taux de réussite', async () => {
  const s = await demarrer();
  try {
    await s.json('/api/habits', s.post('/api/habits', {
      player_id: 1, nom: 'Lecture', type: 'daily', couleur: '#4C6FFF', objectif: 1
    }));
    s.db.prepare('UPDATE habits SET created_at = ? WHERE id = 1').run(addDays(todayISO(), -3));
    await s.json('/api/toggle', s.post('/api/toggle', { habit_id: 1, date_ref: addDays(todayISO(), -3) }));
    await s.json('/api/toggle', s.post('/api/toggle', { habit_id: 1, date_ref: addDays(todayISO(), -2) }));
    await s.json('/api/gels', s.post('/api/gels', { habit_id: 1, date_ref: addDays(todayISO(), -1) }));

    const { corps } = await s.json('/api/history?habit_id=1');
    const pointGele = corps.points.find((p) => p.ref === addDays(todayISO(), -1));
    assert.equal(pointGele.etat, 'gele');
    // Sur les 2 seuls jours écoulés jugés (J-3, J-2, le gelé exclu) : 100%.
    assert.equal(corps.taux, 100);
  } finally {
    await s.fermer();
  }
});

// --- Tâche 2 : leaderboard mensuel des trahisons + profil joueur ----------

test('le leaderboard classe le moins trahi en premier', async () => {
  const liberer = figerJour();
  const s = await demarrer();
  try {
    const avant = (await s.json('/api/state')).corps;
    const anatoleId = avant.players.find((p) => p.nom === 'Anatole').id;
    // Anatole : habitude quotidienne créée il y a 5 jours, aucun jour validé
    await s.json('/api/habits', s.post('/api/habits', {
      player_id: anatoleId, nom: 'Lecture', type: 'daily', couleur: '#4C6FFF', objectif: 1
    }));
    s.db.prepare('UPDATE habits SET created_at = ? WHERE id = 1')
      .run(addDays(todayISO(), -5));
    const { corps } = await s.json('/api/state');
    const rang = corps.leaderboard.map((l) => l.nom);
    // Les 5 autres joueurs, tous à 0 trahison, triés alphabétiquement ;
    // Anatole, seul à avoir des jours ratés, ferme la marche.
    assert.deepEqual(rang, ['Axel', 'Guillaume', 'Nicolas', 'Owen', 'Thomas', 'Anatole']);
    assert.ok(corps.leaderboard.slice(0, 5).every((l) => l.trahisons === 0));
    assert.ok(corps.leaderboard[5].trahisons > 0);
  } finally {
    await s.fermer();
    liberer();
  }
});

test('la période en cours et la période de création ne sont pas des trahisons', async () => {
  const s = await demarrer();
  try {
    // player_id 1 = Nicolas (premier joueur amorcé) : on vérifie le joueur qui
    // possède réellement l'habitude, pas un tiers qui n'a rien créé.
    await s.json('/api/habits', s.post('/api/habits', {
      player_id: 1, nom: 'Lecture', type: 'daily', couleur: '#4C6FFF', objectif: 1
    }));
    // créée aujourd'hui, rien coché : ni la création ni le jour courant ne comptent
    const { corps } = await s.json('/api/state');
    assert.equal(corps.leaderboard.find((l) => l.nom === 'Nicolas').trahisons, 0);
  } finally {
    await s.fermer();
  }
});

test('une habitude archivée garde ses trahisons mais n\'en accumule plus', async () => {
  const liberer = figerJour();
  const s = await demarrer();
  try {
    // player_id 1 = Nicolas (premier joueur amorcé).
    await s.json('/api/habits', s.post('/api/habits', {
      player_id: 1, nom: 'Lecture', type: 'daily', couleur: '#4C6FFF', objectif: 1
    }));
    s.db.prepare('UPDATE habits SET created_at = ? WHERE id = 1')
      .run(addDays(todayISO(), -10));
    // Avant archivage : jours J-10 (création) à J0 (aujourd'hui) = 11 jours.
    // Pour une QUOTIDIENNE, le jour de création compte : seul J0 (en cours) est
    // exclu. Restent J-10..J-1 = 10 jours, tous non cochés → 10 trahisons.
    // Nicolas a désormais des trahisons donc il n'est plus forcément en tête
    // du classement (les 5 autres sont à 0) : on le cherche par nom.
    const avant = (await s.json('/api/state')).corps.leaderboard.find((l) => l.nom === 'Nicolas').trahisons;
    assert.equal(avant, 10);

    // archivée à J-5 : les 5 derniers jours ne doivent plus compter
    s.db.prepare('UPDATE habits SET archived = 1, archived_at = ? WHERE id = 1')
      .run(addDays(todayISO(), -5));
    const apres = (await s.json('/api/state')).corps.leaderboard.find((l) => l.nom === 'Nicolas').trahisons;
    // Après archivage à J-5 : mêmes 11 jours, exclus désormais :
    //   - J-5..J0 (jour d'archivage J-5 partiel, + J-4..J-1 après archivage, + J0 courant)
    // Le jour de création J-10 compte (quotidienne). Restent J-10, J-9, J-8,
    // J-7, J-6 = 5 jours non cochés → exactement 5 trahisons.
    assert.equal(apres, 5, 'la journée d\'archivage (J-5) est partielle, elle ne compte pas');
  } finally {
    await s.fermer();
    liberer();
  }
});

test('jour de création : compte pour une quotidienne, grâce pour la semaine d\'une hebdo', async () => {
  const liberer = figerJour();
  const s = await demarrer();
  try {
    // Quotidienne créée hier, non validée → hier (= jour de création) compte.
    await s.json('/api/habits', s.post('/api/habits', {
      player_id: 1, nom: 'Lecture', type: 'daily', couleur: '#4C6FFF', objectif: 1
    }));
    s.db.prepare('UPDATE habits SET created_at = ? WHERE id = 1').run(addDays(todayISO(), -1));
    const daily = (await s.json('/api/state')).corps.leaderboard.find((l) => l.nom === 'Nicolas').trahisons;
    assert.equal(daily, 1, 'le jour de création d\'une quotidienne compte comme trahison');

    // Hebdo créée la semaine dernière, objectif non atteint → semaine de
    // création exemptée (grâce), donc 0 trahison.
    await s.json('/api/habits', s.post('/api/habits', {
      player_id: 2, nom: 'Sport', type: 'weekly', couleur: '#22C55E', objectif: 3
    }));
    s.db.prepare('UPDATE habits SET created_at = ? WHERE id = 2')
      .run(addDays(mondayOf(todayISO()), -7));
    const weekly = (await s.json('/api/state')).corps.leaderboard.find((l) => l.nom === 'Axel').trahisons;
    assert.equal(weekly, 0, 'la semaine de création d\'une hebdo garde sa grâce');
  } finally {
    await s.fermer();
    liberer();
  }
});

test('une weekly archivée en milieu de semaine (1/3 séances) ne compte aucune trahison pour cette semaine', async () => {
  const s = await demarrer();
  try {
    await s.json('/api/habits', s.post('/api/habits', {
      player_id: 1, nom: 'Sport', type: 'weekly', couleur: '#4C6FFF', objectif: 3
    }));

    // Ancrage dynamique sur la semaine courante pour ne pas dépendre d'une
    // date en dur : semaineCourante = lundi de cette semaine (période en
    // cours, jamais jugée). semaineArchivage = la semaine pleinement passée
    // juste avant (donc dans le passé). semaineCreation = encore une semaine
    // avant, pour que l'habitude existe "depuis plusieurs semaines" au moment
    // de son archivage. Les trois semaines sont dans le mois calendaire en
    // cours tant qu'aujourd'hui n'est pas dans les ~14 premiers jours du mois
    // (vérifié : 2026-07-20, largement dans la seconde moitié de juillet).
    const semaineCourante = mondayOf(todayISO());
    const semaineArchivage = addDays(semaineCourante, -7);
    const semaineCreation = addDays(semaineCourante, -14);
    const mercrediArchivage = addDays(semaineArchivage, 2); // lundi + 2 = mercredi

    s.db.prepare('UPDATE habits SET created_at = ? WHERE id = 1').run(semaineCreation);
    // 1 séance sur les 3 requises pendant la semaine où l'habitude est arrêtée.
    await s.json('/api/toggle', s.post('/api/toggle', { habit_id: 1, date_ref: mercrediArchivage }));
    // Archivée un mercredi, en milieu de semaine.
    s.db.prepare('UPDATE habits SET archived = 1, archived_at = ? WHERE id = 1').run(mercrediArchivage);

    // toutesLesRefs = [semaineCreation, semaineArchivage, semaineCourante] :
    // exactement 3 semaines (elles s'enchaînent de 7 en 7 jours). La semaine
    // de création est exclue (partielle), la semaine courante est exclue
    // (en cours), et désormais la semaine d'archivage est exclue elle aussi
    // (partielle) malgré son 1/3 non atteint. Il ne reste donc RIEN à juger :
    // 0 trahison, alors qu'avant le correctif cette semaine à 1/3 valait 1.
    const { corps } = await s.json('/api/history?habit_id=1');
    assert.equal(corps.trahisonsMois, 0,
      'la semaine d\'archivage (1/3 séances) est partielle, elle ne doit pas compter comme trahison');
  } finally {
    await s.fermer();
  }
});

test('la note est enregistrée à la création et rendue par history', async () => {
  const s = await demarrer();
  try {
    await s.json('/api/habits', s.post('/api/habits', {
      player_id: 1, nom: 'Lecture', type: 'daily', couleur: '#4C6FFF',
      objectif: 1, note: '10 pages avant de dormir'
    }));
    const { corps } = await s.json('/api/history?habit_id=1');
    assert.equal(corps.note, '10 pages avant de dormir');
  } finally {
    await s.fermer();
  }
});

test('moment_lieu et identite sont enregistrés à la création et rendus par history', async () => {
  const s = await demarrer();
  try {
    await s.json('/api/habits', s.post('/api/habits', {
      player_id: 1, nom: 'Lecture', type: 'daily', couleur: '#4C6FFF',
      objectif: 1, note: '10 pages avant de dormir',
      moment_lieu: 'chaque soir au lit', identite: 'quelqu\'un de cultivé'
    }));
    const { corps } = await s.json('/api/history?habit_id=1');
    assert.equal(corps.moment_lieu, 'chaque soir au lit');
    assert.equal(corps.identite, 'quelqu\'un de cultivé');
  } finally {
    await s.fermer();
  }
});

test('PATCH /api/habits/:id modifie moment_lieu et identite', async () => {
  const s = await demarrer();
  try {
    await s.json('/api/habits', s.post('/api/habits', {
      player_id: 1, nom: 'Sport', type: 'weekly', couleur: '#4C6FFF', objectif: 2
    }));
    const { statut } = await s.json('/api/habits/1', s.post('/api/habits/1', {
      nom: 'Sport', couleur: '#4C6FFF', objectif: 2,
      moment_lieu: 'le lundi soir', identite: 'quelqu\'un de régulier'
    }, 'PATCH'));
    assert.equal(statut, 200);
    const { corps } = await s.json('/api/history?habit_id=1');
    assert.equal(corps.moment_lieu, 'le lundi soir');
    assert.equal(corps.identite, 'quelqu\'un de régulier');
  } finally {
    await s.fermer();
  }
});

test('le profil rend les habitudes actives et archivées séparément', async () => {
  const s = await demarrer();
  try {
    await s.json('/api/habits', s.post('/api/habits', {
      player_id: 1, nom: 'Active', type: 'daily', couleur: '#4C6FFF', objectif: 1
    }));
    await s.json('/api/habits', s.post('/api/habits', {
      player_id: 1, nom: 'Ancienne', type: 'daily', couleur: '#22C55E', objectif: 1
    }));
    await s.json('/api/habits/2/archive', s.post('/api/habits/2/archive', {}));
    const { statut, corps } = await s.json('/api/profile?player_id=1');
    assert.equal(statut, 200);
    assert.equal(corps.nom, 'Nicolas'); // player_id 1 = Nicolas, premier joueur amorcé
    assert.deepEqual(corps.actives.map((h) => h.nom), ['Active']);
    assert.deepEqual(corps.archivees.map((h) => h.nom), ['Ancienne']);
  } finally {
    await s.fermer();
  }
});

test('history fonctionne sur une habitude archivée', async () => {
  const s = await demarrer();
  try {
    await s.json('/api/habits', s.post('/api/habits', {
      player_id: 1, nom: 'Ancienne', type: 'daily', couleur: '#4C6FFF', objectif: 1
    }));
    await s.json('/api/habits/1/archive', s.post('/api/habits/1/archive', {}));
    const { statut, corps } = await s.json('/api/history?habit_id=1');
    assert.equal(statut, 200);
    assert.equal(corps.nom, 'Ancienne');
  } finally {
    await s.fermer();
  }
});

test('profil d\'un joueur inexistant rend 404', async () => {
  const s = await demarrer();
  try {
    const { statut } = await s.json('/api/profile?player_id=999');
    assert.equal(statut, 404);
  } finally {
    await s.fermer();
  }
});

// --- Tâche 1 v3 : couleur joueur, slug, routage /<slug> --------------------

test('chaque joueur de /api/state porte couleur et slug', async () => {
  const s = await demarrer();
  try {
    const { corps } = await s.json('/api/state');
    const nicolas = corps.players.find((p) => p.nom === 'Nicolas');
    assert.equal(nicolas.couleur, '#DC2626');
    assert.equal(nicolas.slug, 'nicolas');
  } finally { await s.fermer(); }
});

test('une URL de joueur sert la page (routage côté client)', async () => {
  const s = await demarrer();
  try {
    const rep = await fetch(s.base + '/nicolas');
    assert.equal(rep.status, 200);
    assert.match(await rep.text(), /Greene Habits/);
  } finally { await s.fermer(); }
});

test('un fichier manquant avec extension rend toujours 404', async () => {
  const s = await demarrer();
  try {
    const rep = await fetch(s.base + '/inexistant.css');
    assert.equal(rep.status, 404);
  } finally { await s.fermer(); }
});

// --- Appartenance : chacun n'agit que sur ses propres habitudes ------------
// L'identité est le slug de la page ouverte, envoyé dans le corps. Pas de
// comptes : la garde attrape le mauvais onglet et la page d'accueil, elle ne
// prétend pas résister à un curl monté à la main (groupe de confiance).

// Crée une habitude quotidienne appartenant à Nicolas (player_id 1) et la
// recule de quelques jours pour que les jours passés soient actionnables.
async function habitudeDeNicolas(s) {
  await s.json('/api/habits', s.post('/api/habits', {
    player_id: 1, nom: 'Lecture', type: 'daily', couleur: '#4C6FFF', objectif: 1
  }));
  s.db.prepare('UPDATE habits SET created_at = ? WHERE id = 1').run(addDays(todayISO(), -5));
}

test('POST /api/toggle avec le slug d\'un autre joueur rend 403 et ne coche rien', async () => {
  const s = await demarrer();
  try {
    await habitudeDeNicolas(s);
    const { statut, corps } = await s.json('/api/toggle',
      s.post('/api/toggle', { habit_id: 1, date_ref: todayISO(), joueur: 'axel' }));
    assert.equal(statut, 403);
    assert.ok(corps.erreur);
    const etat = (await s.json('/api/state')).corps;
    const point = etat.players[0].habits[0].points.find((p) => p.ref === todayISO());
    assert.equal(point.count, 0, 'aucune entrée écrite malgré la requête refusée');
  } finally { await s.fermer(); }
});

test('POST /api/toggle sans slug (page d\'accueil) rend 403', async () => {
  const s = await demarrer();
  try {
    await habitudeDeNicolas(s);
    const { statut } = await s.json('/api/toggle',
      s.post('/api/toggle', { habit_id: 1, date_ref: todayISO(), joueur: null }));
    assert.equal(statut, 403);
  } finally { await s.fermer(); }
});

test('POST /api/toggle avec un slug inconnu rend 403', async () => {
  const s = await demarrer();
  try {
    await habitudeDeNicolas(s);
    const { statut } = await s.json('/api/toggle',
      s.post('/api/toggle', { habit_id: 1, date_ref: todayISO(), joueur: 'fantome' }));
    assert.equal(statut, 403);
  } finally { await s.fermer(); }
});

test('POST /api/toggle avec le slug du propriétaire passe', async () => {
  const s = await demarrer();
  try {
    await habitudeDeNicolas(s);
    const { statut, corps } = await s.json('/api/toggle',
      s.post('/api/toggle', { habit_id: 1, date_ref: todayISO(), joueur: 'nicolas' }));
    assert.equal(statut, 200);
    assert.equal(corps.count, 1);
  } finally { await s.fermer(); }
});

test('POST /api/gels sur l\'habitude d\'un autre rend 403', async () => {
  const s = await demarrer();
  try {
    await habitudeDeNicolas(s);
    const { statut } = await s.json('/api/gels',
      s.post('/api/gels', { habit_id: 1, date_ref: addDays(todayISO(), -1), joueur: 'axel' }));
    assert.equal(statut, 403);
    const etat = (await s.json('/api/state')).corps;
    assert.equal(etat.players[0].gels_restants, 2, 'aucun gel dépensé');
  } finally { await s.fermer(); }
});

test('PATCH /api/habits/:id sur l\'habitude d\'un autre rend 403 et ne modifie rien', async () => {
  const s = await demarrer();
  try {
    await habitudeDeNicolas(s);
    const { statut } = await s.json('/api/habits/1', s.post('/api/habits/1', {
      nom: 'Détournée', couleur: '#22C55E', objectif: 1, joueur: 'axel'
    }, 'PATCH'));
    assert.equal(statut, 403);
    const { corps } = await s.json('/api/history?habit_id=1');
    assert.equal(corps.nom, 'Lecture');
  } finally { await s.fermer(); }
});

test('POST /api/habits/:id/archive sur l\'habitude d\'un autre rend 403', async () => {
  const s = await demarrer();
  try {
    await habitudeDeNicolas(s);
    const { statut } = await s.json('/api/habits/1/archive',
      s.post('/api/habits/1/archive', { joueur: 'axel' }));
    assert.equal(statut, 403);
    const etat = (await s.json('/api/state')).corps;
    assert.equal(etat.players[0].habits.length, 1, 'l\'habitude est toujours active');
  } finally { await s.fermer(); }
});

test('POST /api/habits/:id/delete sur l\'habitude d\'un autre rend 403', async () => {
  const s = await demarrer();
  try {
    await habitudeDeNicolas(s);
    const { statut } = await s.json('/api/habits/1/delete',
      s.post('/api/habits/1/delete', { joueur: 'axel' }));
    assert.equal(statut, 403);
    assert.equal((await s.json('/api/history?habit_id=1')).statut, 200);
  } finally { await s.fermer(); }
});

test('POST /api/habits pour le compte d\'un autre joueur rend 403', async () => {
  const s = await demarrer();
  try {
    const { statut } = await s.json('/api/habits', s.post('/api/habits', {
      player_id: 1, nom: 'Imposée', type: 'daily', couleur: '#4C6FFF', objectif: 1,
      joueur: 'axel'
    }));
    assert.equal(statut, 403);
    const etat = (await s.json('/api/state')).corps;
    assert.equal(etat.players[0].habits.length, 0);
  } finally { await s.fermer(); }
});

test('une habitude inexistante rend toujours 400, jamais 403 (message inchangé)', async () => {
  const s = await demarrer();
  try {
    const { statut } = await s.json('/api/toggle',
      s.post('/api/toggle', { habit_id: 9999, date_ref: todayISO(), joueur: 'nicolas' }));
    assert.equal(statut, 400);
  } finally { await s.fermer(); }
});

test('les lectures restent ouvertes à tous sans slug', async () => {
  const s = await demarrer();
  try {
    await habitudeDeNicolas(s);
    assert.equal((await s.json('/api/state')).statut, 200);
    assert.equal((await s.json('/api/history?habit_id=1')).statut, 200);
    assert.equal((await s.json('/api/profile?player_id=1')).statut, 200);
  } finally { await s.fermer(); }
});

test('history et profil exposent player_id (le front en déduit qui peut agir)', async () => {
  const s = await demarrer();
  try {
    await habitudeDeNicolas(s);
    const histo = (await s.json('/api/history?habit_id=1')).corps;
    assert.equal(histo.player_id, 1);
    const profil = (await s.json('/api/profile?player_id=1')).corps;
    assert.equal(profil.actives[0].player_id, 1);
  } finally { await s.fermer(); }
});
