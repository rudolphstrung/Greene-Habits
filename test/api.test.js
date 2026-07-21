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

test('seul le point de la période en cours porte actuel=true', async () => {
  const s = await demarrer();
  try {
    await s.json('/api/habits', s.post('/api/habits', {
      player_id: 1, nom: 'Sport', type: 'weekly', couleur: '#4C6FFF', objectif: 2
    }));
    const { corps } = await s.json('/api/state');
    const habit = corps.players[0].habits[0];
    const actuels = habit.points.filter((p) => p.actuel);
    assert.equal(actuels.length, 1, 'un seul point actuel');
    assert.equal(actuels[0].ref, mondayOf(todayISO()));
    // Le point actuel est aussi cliquable (c'est là qu'on valide aujourd'hui).
    assert.equal(actuels[0].cliquable, true);
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

// --- Tâche 2 : leaderboard mensuel des trahisons + profil joueur ----------

test('le leaderboard classe le moins trahi en premier', async () => {
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
  const s = await demarrer();
  try {
    // player_id 1 = Nicolas (premier joueur amorcé).
    await s.json('/api/habits', s.post('/api/habits', {
      player_id: 1, nom: 'Lecture', type: 'daily', couleur: '#4C6FFF', objectif: 1
    }));
    s.db.prepare('UPDATE habits SET created_at = ? WHERE id = 1')
      .run(addDays(todayISO(), -10));
    // Avant archivage : jours J-10 (création) à J0 (aujourd'hui) = 11 jours.
    // Exclus : J-10 (création, partielle) et J0 (période en cours).
    // Restent J-9..J-1 = 9 jours, tous non cochés → 9 trahisons.
    // Nicolas a désormais des trahisons donc il n'est plus forcément en tête
    // du classement (les 5 autres sont à 0) : on le cherche par nom.
    const avant = (await s.json('/api/state')).corps.leaderboard.find((l) => l.nom === 'Nicolas').trahisons;
    assert.equal(avant, 9);

    // archivée à J-5 : les 5 derniers jours ne doivent plus compter
    s.db.prepare('UPDATE habits SET archived = 1, archived_at = ? WHERE id = 1')
      .run(addDays(todayISO(), -5));
    const apres = (await s.json('/api/state')).corps.leaderboard.find((l) => l.nom === 'Nicolas').trahisons;
    // Après archivage à J-5 : mêmes 11 jours (J-10..J0), mais désormais exclus :
    //   - J-10 (création, partielle)
    //   - J-5..J0 (période d'archivage J-5 elle-même, partielle au même titre
    //     que la création, PLUS J-4..J-1 après l'archivage, PLUS J0 courante)
    // Restent J-9, J-8, J-7, J-6 = 4 jours non cochés → exactement 4 trahisons.
    assert.equal(apres, 4, 'la journée d\'archivage (J-5) est partielle, elle ne compte pas');
  } finally {
    await s.fermer();
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
