# Gels de streak Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Chaque joueur reçoit 2 « gels » par semaine (pool partagé entre toutes ses habitudes quotidiennes). Posé manuellement sur un jour raté, un gel protège le streak de l'habitude (ne redescend pas à 0, n'augmente pas non plus) et ne compte jamais comme une trahison — sans jamais compter comme une réussite non plus. Renouvellement chaque lundi, sans cumul au-delà de 2.

**Architecture:** Nouvelle table `gels` (`habit_id`, `ref`, `semaine`) dans `src/db.js`, avec `getGels`/`countGelsSemaine`/`createGel`. Le quota (2/semaine/joueur) est calculé à la volée, jamais stocké. `src/server.js` neutralise un jour gelé partout où les statistiques sont calculées (`reussitesPourStats`, `trahisonsDeLHabitude`), en excluant simplement la ref gelée de la séquence — même mécanisme que la « grâce » déjà appliquée à la semaine de création d'une hebdo. Le frontend (`public/app.js`) affiche un glaçon 🧊 sur un jour gelé et remplace le clic direct sur un point raté par un petit menu (« Marquer fait » / « Utiliser un gel » / « Annuler »), réutilisant le popup déjà en place.

**Tech Stack:** Node.js ESM + `better-sqlite3` côté serveur (`node --test` pour les tests), HTML/CSS/JS vanilla côté client (aucun framework, aucun build).

## Global Constraints

- Le gel s'applique **uniquement aux habitudes `type === 'daily'`** — jamais aux `weekly`.
- Pool de gels **par joueur**, partagé entre toutes ses habitudes (pas un pool par habitude).
- Quota fixe : **2 gels par semaine**, jamais de cumul au-delà de 2 même si aucun n'a été utilisé la semaine précédente.
- Renouvellement chaque **lundi** — même frontière que `mondayOf()` (`src/dates.js`), déjà utilisée pour les habitudes hebdo.
- Activation **manuelle uniquement** — jamais automatique.
- Un jour gelé et non réussi est **neutre partout** : ne compte ni comme réussite (streak/record/taux), ni comme trahison (leaderboard mensuel). Si le jour est marqué fait *après coup* malgré un gel existant, c'est la réussite réelle qui gagne.
- Utilisation **rétroactive** possible, dans la même fenêtre que `toggle()` (depuis la création de l'habitude jusqu'à hier inclus — jamais le jour en cours).
- Un nouveau joueur démarre avec ses 2 gels dès sa création (rien à coder : le quota est calculé à la volée, jamais stocké par joueur).
- Noms de colonnes DB et de variables/fonctions JS en **français**, cohérent avec le reste des fichiers.
- Pas de suite de tests automatisés frontend dans ce projet (`npm test` ne couvre que `src/` côté serveur via `node --test`) — les tâches touchant `public/` se vérifient manuellement avec `npm start`.
- Commits en français, style impératif court, préfixe conventionnel (`feat:`, `fix:`, déjà utilisés dans l'historique du projet).

---

## Fichiers concernés

- Modifier : `src/db.js` — schéma (table `gels`), `getGels`, `countGelsSemaine`, `createGel`, `deleteHabit` (cascade).
- Modifier : `test/db.test.js` — tests de la table `gels` et de `createGel`.
- Modifier : `src/server.js` — route `POST /api/gels`, `pointsDe`, `reussitesPourStats`, `trahisonsDeLHabitude`, `construireLeaderboard`, `construireEtat`, `statsHabit`, `construireHistorique`, `construireProfil`.
- Modifier : `test/api.test.js` — tests bout-en-bout de la route et de la neutralisation des stats.
- Modifier : `public/app.js` — `creerPoint`, `creerCard`, listener global de clic, nouveau helper `menuJourRate`.
- Modifier : `public/style.css` — `--gele`, `.point.gele`, `.card-entete`/`.card-gels`.

---

### Task 1 : Table `gels` + lecture (`getGels`/`countGelsSemaine`) + cascade de suppression

**Files:**
- Modify: `src/db.js:53-86` (SCHEMA), `src/db.js:291-298` (`deleteHabit`), `src/db.js` juste après `getEntries` (ligne ~309)
- Test: `test/db.test.js:1-11` (imports), nouveaux tests à la suite des tests existants sur `entries`/`toggle`

**Interfaces:**
- Consomme : `mondayOf`/`todayISO` (déjà importés dans `src/db.js` depuis `./dates.js`).
- Produit : `getGels(db, habitId)` → `Set<string>` des refs gelées d'une habitude. `countGelsSemaine(db, playerId, semaine)` → `number`, nombre de gels posés par ce joueur (toutes habitudes confondues) pour la semaine donnée (une chaîne `'YYYY-MM-DD'`, le lundi de la semaine). Ces deux noms sont utilisés tels quels par la Task 2 (validation du quota) et la Task 4 (neutralisation des stats + `gels_restants`).

- [ ] **Step 1 : Écrire les tests qui échouent**

Dans `test/db.test.js`, remplace la ligne d'import (ligne 7-11) :

```js
import {
  openDb, getPlayers, getHabits, getAllHabits, getHabit, COULEURS, COULEURS_JOUEURS,
  slugifier, createPlayer, createHabit, updateHabit,
  archiveHabit, getEntries, toggle, refFor
} from '../src/db.js';
```

par :

```js
import {
  openDb, getPlayers, getHabits, getAllHabits, getHabit, COULEURS, COULEURS_JOUEURS,
  slugifier, createPlayer, createHabit, updateHabit,
  archiveHabit, deleteHabit, getEntries, toggle, refFor, getGels, countGelsSemaine
} from '../src/db.js';
```

Puis ajoute ces tests à la fin du fichier (après le dernier test, `'la migration objectif backfille...'`) :

```js
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
```

- [ ] **Step 2 : Lancer les tests pour vérifier qu'ils échouent**

Depuis la racine du projet (`4 ARCHIVES/Z projets réussis/Greene Habits/`) :

```bash
npm test
```

Attendu : échec sur `getGels`/`countGelsSemaine is not a function` et sur `no such table: gels`.

- [ ] **Step 3 : Ajouter la table au schéma**

Dans `src/db.js`, la constante `SCHEMA` (lignes 53-86) se termine par :

```js
  CREATE INDEX IF NOT EXISTS idx_entries_habit ON entries (habit_id, date_ref);
`;
```

Remplace par :

```js
  CREATE INDEX IF NOT EXISTS idx_entries_habit ON entries (habit_id, date_ref);

  CREATE TABLE IF NOT EXISTS gels (
    id         INTEGER PRIMARY KEY,
    habit_id   INTEGER NOT NULL REFERENCES habits(id),
    ref        TEXT NOT NULL,
    semaine    TEXT NOT NULL,
    created_at TEXT NOT NULL,
    UNIQUE (habit_id, ref)
  );

  CREATE INDEX IF NOT EXISTS idx_gels_semaine ON gels (semaine);
`;
```

- [ ] **Step 4 : Ajouter `getGels` et `countGelsSemaine`**

Dans `src/db.js`, juste après `getEntries` (qui se termine par `);`, juste avant `export function refFor`), ajoute :

```js
// Toutes les refs gelées d'une habitude — même rôle que getEntries pour les
// compteurs, consommé par pointsDe/reussitesPourStats/trahisonsDeLHabitude
// (src/server.js) pour neutraliser un jour gelé partout.
export function getGels(db, habitId) {
  const lignes = db.prepare('SELECT ref FROM gels WHERE habit_id = ?').all(habitId);
  return new Set(lignes.map((l) => l.ref));
}

// Nombre de gels déjà posés par un joueur (toutes habitudes confondues) pour
// une semaine donnée (lundi de la semaine, cf. mondayOf). Calculé à la volée,
// jamais stocké — comme le streak.
export function countGelsSemaine(db, playerId, semaine) {
  return db.prepare(
    `SELECT COUNT(*) AS n FROM gels g JOIN habits h ON h.id = g.habit_id
     WHERE h.player_id = ? AND g.semaine = ?`
  ).get(playerId, semaine).n;
}
```

- [ ] **Step 5 : Cascade de suppression dans `deleteHabit`**

Dans `src/db.js`, `deleteHabit` (lignes 291-298) :

```js
export function deleteHabit(db, id) {
  const suppr = db.transaction((habitId) => {
    db.prepare('DELETE FROM entries WHERE habit_id = ?').run(habitId);
    return db.prepare('DELETE FROM habits WHERE id = ?').run(habitId);
  });
  const info = suppr(id);
  if (info.changes === 0) throw new Error('Habitude introuvable');
}
```

Remplace par :

```js
export function deleteHabit(db, id) {
  const suppr = db.transaction((habitId) => {
    db.prepare('DELETE FROM entries WHERE habit_id = ?').run(habitId);
    db.prepare('DELETE FROM gels WHERE habit_id = ?').run(habitId);
    return db.prepare('DELETE FROM habits WHERE id = ?').run(habitId);
  });
  const info = suppr(id);
  if (info.changes === 0) throw new Error('Habitude introuvable');
}
```

Sans ce changement, supprimer une habitude ayant au moins un gel échouerait avec une erreur de contrainte de clé étrangère (`gels.habit_id REFERENCES habits(id)`, `PRAGMA foreign_keys = ON`) — le même problème que `entries` posait déjà avant l'ajout de sa propre ligne de suppression.

- [ ] **Step 6 : Lancer les tests pour vérifier qu'ils passent**

```bash
npm test
```

Attendu : tous les tests passent, y compris les 6 nouveaux.

- [ ] **Step 7 : Commit**

```bash
git add src/db.js test/db.test.js
git commit -m "feat: table gels + lecture (getGels, countGelsSemaine) + cascade suppression"
```

---

### Task 2 : `createGel` — poser un gel avec validation complète

**Files:**
- Modify: `src/db.js` (fin de fichier, après `toggle`)
- Test: `test/db.test.js:7-11` (imports), nouveaux tests

**Interfaces:**
- Consomme : `getHabit`, `refFor`, `countGelsSemaine` (Task 1), `mondayOf`/`todayISO` (déjà importés).
- Produit : `createGel(db, habitId, dateRef)` → `{ id, habit_id, ref, gels_restants }` ou lève une `Error` (message contenant `quotidienne`, `fenêtre`, `déjà réussi`, `déjà protégé` ou `gel disponible` selon le cas — ces mots sont utilisés tels quels par les tests et par le message affiché à l'utilisateur côté frontend, Task 5). `gels_restants` = nombre de gels encore disponibles pour ce joueur cette semaine APRÈS la pose (donc `2 - (utilisés_avant + 1)`), consommé par la Task 3 (route API) et potentiellement affiché par le frontend.

- [ ] **Step 1 : Écrire les tests qui échouent**

Dans `test/db.test.js`, ajoute `createGel` à l'import déjà modifié en Task 1 :

```js
import {
  openDb, getPlayers, getHabits, getAllHabits, getHabit, COULEURS, COULEURS_JOUEURS,
  slugifier, createPlayer, createHabit, updateHabit,
  archiveHabit, deleteHabit, getEntries, toggle, refFor, getGels, countGelsSemaine, createGel
} from '../src/db.js';
```

Puis ajoute ces tests à la fin du fichier :

```js
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
  db.prepare('UPDATE habits SET created_at = ? WHERE id = ?').run(addDays(todayISO(), -5), habit.id);
  createGel(db, habit.id, addDays(todayISO(), -1));
  createGel(db, habit.id, addDays(todayISO(), -2));
  assert.throws(() => createGel(db, habit.id, addDays(todayISO(), -3)), /gel disponible/i);
});

test('le quota de gels est partagé entre toutes les habitudes du même joueur', () => {
  const db = openDb(':memory:');
  const h1 = createHabit(db, { player_id: 1, nom: 'Lecture', type: 'daily', couleur: '#4C6FFF', objectif: 1 });
  const h2 = createHabit(db, { player_id: 1, nom: 'Sport', type: 'daily', couleur: '#22C55E', objectif: 1 });
  db.prepare('UPDATE habits SET created_at = ?').run(addDays(todayISO(), -5));
  createGel(db, h1.id, addDays(todayISO(), -1));
  createGel(db, h2.id, addDays(todayISO(), -2));
  assert.throws(() => createGel(db, h1.id, addDays(todayISO(), -3)), /gel disponible/i);
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
```

- [ ] **Step 2 : Lancer les tests pour vérifier qu'ils échouent**

```bash
npm test
```

Attendu : `createGel is not a function`.

- [ ] **Step 3 : Implémenter `createGel`**

Dans `src/db.js`, à la toute fin du fichier (après la fonction `toggle`), ajoute :

```js
// Une habitude ne peut être gelée qu'un jour PASSÉ et non réussi, dans la
// même fenêtre que toggle() (depuis la création jusqu'à hier inclus — jamais
// le jour en cours). Le quota (2 gels/semaine par joueur, toutes habitudes
// confondues) est vérifié juste avant l'insertion.
export function createGel(db, habitId, dateRef) {
  const habit = getHabit(db, habitId);
  if (!habit) throw new Error('Habitude introuvable');
  if (habit.type !== 'daily') throw new Error('Le gel ne s\'applique qu\'aux habitudes quotidiennes');

  const ref = dateRef;
  const debut = refFor(habit, habit.created_at);
  const courante = refFor(habit, todayISO());
  if (ref < debut || ref >= courante) {
    throw new Error('Date hors de la fenêtre autorisée');
  }

  const entry = db.prepare('SELECT count, objectif FROM entries WHERE habit_id = ? AND date_ref = ?')
    .get(habitId, ref);
  const count = entry?.count || 0;
  const objectifFige = entry?.objectif ?? habit.objectif;
  if (count >= objectifFige) throw new Error('Ce jour est déjà réussi, pas besoin de gel');

  const dejaGele = db.prepare('SELECT 1 FROM gels WHERE habit_id = ? AND ref = ?').get(habitId, ref);
  if (dejaGele) throw new Error('Ce jour est déjà protégé par un gel');

  const semaine = mondayOf(ref);
  const utilises = countGelsSemaine(db, habit.player_id, semaine);
  if (utilises >= 2) throw new Error('Plus de gel disponible cette semaine');

  const { lastInsertRowid } = db.prepare(
    'INSERT INTO gels (habit_id, ref, semaine, created_at) VALUES (?, ?, ?, ?)'
  ).run(habitId, ref, semaine, todayISO());

  return { id: lastInsertRowid, habit_id: habitId, ref, gels_restants: 2 - (utilises + 1) };
}
```

`ref >= courante` (et non `>`) : le jour en cours n'est jamais « raté » tant qu'il n'est pas terminé (cf. `computeStreak`, qui traite toujours la période en cours à part) — donc jamais gelable.

- [ ] **Step 4 : Lancer les tests pour vérifier qu'ils passent**

```bash
npm test
```

Attendu : tous les tests passent, y compris les 9 nouveaux.

- [ ] **Step 5 : Commit**

```bash
git add src/db.js test/db.test.js
git commit -m "feat: createGel pose un gel avec validation (fenêtre, quota, doublon)"
```

---

### Task 3 : Route `POST /api/gels`

**Files:**
- Modify: `src/server.js:5-8` (imports), `src/server.js:341-344` (zone des routes, juste après `/api/toggle`)
- Test: `test/api.test.js`

**Interfaces:**
- Consomme : `createGel(db, habitId, dateRef)` (Task 2).
- Produit : `POST /api/gels` avec le corps `{ habit_id, date_ref }` → `201` avec `{ id, habit_id, ref, gels_restants }`, ou `400` avec `{ erreur: message }` si `createGel` lève (même mécanisme générique que toutes les autres routes, `catch` unique en bas de `createServer`).

- [ ] **Step 1 : Écrire les tests qui échouent**

Ajoute ces tests à `test/api.test.js`, à la suite du test `'POST /api/toggle sur une date antérieure à la création rend toujours 400'` (juste avant la section `// --- Tâche 2 : leaderboard mensuel...`) :

```js
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
    s.db.prepare('UPDATE habits SET created_at = ? WHERE id = 1').run(addDays(todayISO(), -5));
    await s.json('/api/gels', s.post('/api/gels', { habit_id: 1, date_ref: addDays(todayISO(), -1) }));
    await s.json('/api/gels', s.post('/api/gels', { habit_id: 1, date_ref: addDays(todayISO(), -2) }));
    const { statut, corps } = await s.json('/api/gels',
      s.post('/api/gels', { habit_id: 1, date_ref: addDays(todayISO(), -3) }));
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
```

- [ ] **Step 2 : Lancer les tests pour vérifier qu'ils échouent**

```bash
npm test
```

Attendu : `statut` reçu vaut `404` (route inconnue) au lieu de `201`/`400`.

- [ ] **Step 3 : Ajouter `createGel` aux imports**

Dans `src/server.js`, l'import depuis `./db.js` (lignes 5-8) :

```js
import {
  openDb, getPlayers, getHabits, getAllHabits, getHabit, getEntries, COULEURS,
  createPlayer, createHabit, updateHabit, archiveHabit, deleteHabit, toggle, refFor, slugifier
} from './db.js';
```

Remplace par :

```js
import {
  openDb, getPlayers, getHabits, getAllHabits, getHabit, getEntries, COULEURS,
  createPlayer, createHabit, updateHabit, archiveHabit, deleteHabit, toggle, createGel,
  getGels, countGelsSemaine, refFor, slugifier
} from './db.js';
```

(`getGels`/`countGelsSemaine` sont ajoutés ici aussi car la Task 4, juste après, en a besoin dans ce même fichier — pas de round-trip d'import supplémentaire.)

- [ ] **Step 4 : Ajouter la route**

Dans `src/server.js`, juste après le bloc `/api/toggle` (lignes 341-344) :

```js
      if (req.method === 'POST' && chemin === '/api/toggle') {
        const { habit_id, date_ref } = await lireCorps(req);
        return envoyerJson(res, 200, { count: toggle(db, Number(habit_id), date_ref) });
      }

      return envoyerJson(res, 404, { erreur: 'Route inconnue' });
```

Insère la nouvelle route entre les deux :

```js
      if (req.method === 'POST' && chemin === '/api/toggle') {
        const { habit_id, date_ref } = await lireCorps(req);
        return envoyerJson(res, 200, { count: toggle(db, Number(habit_id), date_ref) });
      }

      if (req.method === 'POST' && chemin === '/api/gels') {
        const { habit_id, date_ref } = await lireCorps(req);
        return envoyerJson(res, 201, createGel(db, Number(habit_id), date_ref));
      }

      return envoyerJson(res, 404, { erreur: 'Route inconnue' });
```

- [ ] **Step 5 : Lancer les tests pour vérifier qu'ils passent**

```bash
npm test
```

Attendu : tous les tests passent, y compris les 3 nouveaux.

- [ ] **Step 6 : Commit**

```bash
git add src/server.js test/api.test.js
git commit -m "feat: route POST /api/gels"
```

---

### Task 4 : Neutraliser un jour gelé dans le streak/record/taux/trahisons + exposer `gels_restants`

**Files:**
- Modify: `src/server.js:9-12` (import `dates.js`, ajoute `mondayOf`), `src/server.js:56-78` (`pointsDe`), `src/server.js:83-92` (`reussitesPourStats`), `src/server.js:100-117` (`trahisonsDeLHabitude`), `src/server.js:121-133` (`construireLeaderboard`), `src/server.js:135-171` (`construireEtat`), `src/server.js:175-195` (`statsHabit`), `src/server.js:197-209` (`construireHistorique`), `src/server.js:213-233` (`construireProfil`)
- Test: `test/api.test.js`

**Interfaces:**
- Consomme : `getGels(db, habitId)` → `Set<string>`, `countGelsSemaine(db, playerId, semaine)` → `number` (Task 1, déjà importés en Task 3).
- Produit : chaque point de calendrier peut désormais porter `etat: 'gele'` (en plus de `'reussi'`/`'rate'`/`'attente'`), consommé par la Task 5. Chaque joueur de `/api/state` porte désormais `gels_restants: number` (0 à 2), consommé par la Task 5.

- [ ] **Step 1 : Écrire les tests qui échouent**

Ajoute ces tests à `test/api.test.js`, à la suite des 3 tests ajoutés en Task 3 :

```js
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
    s.db.prepare('UPDATE habits SET created_at = ? WHERE id = 1').run(addDays(todayISO(), -2));
    await s.json('/api/gels', s.post('/api/gels', { habit_id: 1, date_ref: addDays(todayISO(), -1) }));

    const { corps } = await s.json('/api/state');
    // J-2 (création, non cochée) = 1 trahison ; J-1 (gelé) = 0 ; J0 (en cours) = 0.
    assert.equal(corps.leaderboard.find((l) => l.nom === 'Nicolas').trahisons, 1);
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
    s.db.prepare('UPDATE habits SET created_at = ? WHERE id = 1').run(addDays(todayISO(), -2));
    await s.json('/api/gels', s.post('/api/gels', { habit_id: 1, date_ref: addDays(todayISO(), -1) }));

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
```

- [ ] **Step 2 : Lancer les tests pour vérifier qu'ils échouent**

```bash
npm test
```

Attendu : les nouveaux tests échouent (streak à 1 au lieu de 3, `trahisons` à 2 au lieu de 1, `point.etat` à `'rate'` au lieu de `'gele'`, `gels_restants` absent/`undefined`).

- [ ] **Step 3 : Importer `mondayOf`**

Dans `src/server.js`, l'import depuis `./dates.js` (lignes 9-11) :

```js
import {
  todayISO, currentWeekDays, lastWeeks, allDaysSince, allWeeksSince, firstOfMonth
} from './dates.js';
```

Remplace par :

```js
import {
  todayISO, mondayOf, currentWeekDays, lastWeeks, allDaysSince, allWeeksSince, firstOfMonth
} from './dates.js';
```

- [ ] **Step 4 : `pointsDe` prend en compte les gels**

Dans `src/server.js`, `pointsDe` (lignes 56-78) :

```js
function pointsDe(habit, entries, refs, refCourante) {
  const refCreation = refFor(habit, habit.created_at);
  return refs.map((ref) => {
    const count = entries[ref]?.count || 0;
    // Fenêtre exacte acceptée par toggle() : hors de là, le point n'est pas cliquable.
    const cliquable = ref >= refCreation && ref <= refCourante;
    // La période en cours : c'est le bouton « valider » (à droite) qui l'actionne,
    // pas un clic sur la case. Le front s'en sert pour savoir quoi valider.
    const actuel = ref === refCourante;
    // Une période antérieure à la création n'existait pas.
    if (ref < refCreation) {
      return { ref, count: 0, etat: 'attente', cliquable, actuel };
    }
    const reussi = estReussi(habit, entries, ref, refCourante);
    // Grâce sur la période de création UNIQUEMENT pour les hebdos : une semaine
    // entamée à sa création est partielle. Pour une quotidienne, le jour de
    // création est un jour comme un autre (raté = rouge).
    if (habit.type === 'weekly' && ref === refCreation) {
      return { ref, count, etat: reussi ? 'reussi' : 'attente', cliquable, actuel };
    }
    return { ref, count, etat: dotState(reussi, ref < refCourante), cliquable, actuel };
  });
}
```

Remplace par :

```js
function pointsDe(habit, entries, refs, refCourante, gels) {
  const refCreation = refFor(habit, habit.created_at);
  return refs.map((ref) => {
    const count = entries[ref]?.count || 0;
    // Fenêtre exacte acceptée par toggle() : hors de là, le point n'est pas cliquable.
    const cliquable = ref >= refCreation && ref <= refCourante;
    // La période en cours : c'est le bouton « valider » (à droite) qui l'actionne,
    // pas un clic sur la case. Le front s'en sert pour savoir quoi valider.
    const actuel = ref === refCourante;
    // Une période antérieure à la création n'existait pas.
    if (ref < refCreation) {
      return { ref, count: 0, etat: 'attente', cliquable, actuel };
    }
    const reussi = estReussi(habit, entries, ref, refCourante);
    // Grâce sur la période de création UNIQUEMENT pour les hebdos : une semaine
    // entamée à sa création est partielle. Pour une quotidienne, le jour de
    // création est un jour comme un autre (raté = rouge).
    if (habit.type === 'weekly' && ref === refCreation) {
      return { ref, count, etat: reussi ? 'reussi' : 'attente', cliquable, actuel };
    }
    // Un jour gelé et non réussi prend le pas sur dotState : glaçon plutôt que
    // rouge. Si le jour est marqué fait après coup malgré un gel existant, la
    // réussite réelle gagne toujours — le gel devient simplement sans effet.
    if (!reussi && gels.has(ref)) {
      return { ref, count, etat: 'gele', cliquable, actuel };
    }
    return { ref, count, etat: dotState(reussi, ref < refCourante), cliquable, actuel };
  });
}
```

- [ ] **Step 5 : `reussitesPourStats` exclut les jours gelés non réussis**

Dans `src/server.js`, `reussitesPourStats` (lignes 83-92) :

```js
function reussitesPourStats(habit, entries, refs, refCourante) {
  const refCreation = refFor(habit, habit.created_at);
  // Grâce sur la semaine de création (hebdo seulement) si elle n'a pas été
  // atteinte : elle ne compte ni comme réussite ni comme échec. Pour une
  // quotidienne, le jour de création compte normalement.
  const graceCreation = habit.type === 'weekly'
    && !estReussi(habit, entries, refCreation, refCourante);
  const utiles = graceCreation ? refs.filter((r) => r !== refCreation) : refs;
  return utiles.map((ref) => estReussi(habit, entries, ref, refCourante));
}
```

Remplace par :

```js
function reussitesPourStats(habit, entries, refs, refCourante, gels) {
  const refCreation = refFor(habit, habit.created_at);
  // Grâce sur la semaine de création (hebdo seulement) si elle n'a pas été
  // atteinte : elle ne compte ni comme réussite ni comme échec. Pour une
  // quotidienne, le jour de création compte normalement.
  const graceCreation = habit.type === 'weekly'
    && !estReussi(habit, entries, refCreation, refCourante);
  // Un jour gelé et non réussi est neutralisé au même titre que la grâce de
  // création : invisible pour computeStreak/bestStreak/successRate. S'il est
  // ensuite marqué fait, estReussi devient vrai et il n'est plus filtré.
  const geleNonReussi = (ref) => gels.has(ref) && !estReussi(habit, entries, ref, refCourante);
  const utiles = refs.filter((r) => !(graceCreation && r === refCreation) && !geleNonReussi(r));
  return utiles.map((ref) => estReussi(habit, entries, ref, refCourante));
}
```

- [ ] **Step 6 : `trahisonsDeLHabitude` exclut les jours gelés non réussis**

Dans `src/server.js`, `trahisonsDeLHabitude` (lignes 100-117) :

```js
function trahisonsDeLHabitude(habit, entries, aujourdhui) {
  const debutMois = firstOfMonth(aujourdhui);
  const refCourante = refFor(habit, aujourdhui);
  const refCreation = refFor(habit, habit.created_at);
  const refFin = habit.archived_at ? refFor(habit, habit.archived_at) : refCourante;

  return toutesLesRefs(habit, aujourdhui).filter((ref) => {
    if (ref < debutMois) return false;      // hors du mois en cours
    if (ref >= refCourante) return false;   // période en cours ou future
    // La période d'archivage est partielle au même titre que celle de création :
    // l'habitude a été arrêtée en cours de route, on ne la juge pas dessus.
    if (habit.archived_at && ref >= refFin) return false;
    // Grâce sur la semaine de création (hebdo seulement) : partielle. Pour une
    // quotidienne, le jour de création compte comme n'importe quel jour.
    if (habit.type === 'weekly' && ref === refCreation) return false;
    return !estReussi(habit, entries, ref, refCourante);
  }).length;
}
```

Remplace par :

```js
function trahisonsDeLHabitude(habit, entries, aujourdhui, gels) {
  const debutMois = firstOfMonth(aujourdhui);
  const refCourante = refFor(habit, aujourdhui);
  const refCreation = refFor(habit, habit.created_at);
  const refFin = habit.archived_at ? refFor(habit, habit.archived_at) : refCourante;

  return toutesLesRefs(habit, aujourdhui).filter((ref) => {
    if (ref < debutMois) return false;      // hors du mois en cours
    if (ref >= refCourante) return false;   // période en cours ou future
    // La période d'archivage est partielle au même titre que celle de création :
    // l'habitude a été arrêtée en cours de route, on ne la juge pas dessus.
    if (habit.archived_at && ref >= refFin) return false;
    // Grâce sur la semaine de création (hebdo seulement) : partielle. Pour une
    // quotidienne, le jour de création compte comme n'importe quel jour.
    if (habit.type === 'weekly' && ref === refCreation) return false;
    // Un jour gelé et non réussi ne compte jamais comme trahison.
    if (gels.has(ref) && !estReussi(habit, entries, ref, refCourante)) return false;
    return !estReussi(habit, entries, ref, refCourante);
  }).length;
}
```

- [ ] **Step 7 : `construireLeaderboard` récupère les gels de chaque habitude**

Dans `src/server.js`, `construireLeaderboard` (lignes 121-133) :

```js
function construireLeaderboard(db, aujourdhui) {
  const habits = getAllHabits(db);
  return getPlayers(db)
    .map((joueur) => ({
      player_id: joueur.id,
      nom: joueur.nom,
      trahisons: habits
        .filter((h) => h.player_id === joueur.id)
        .reduce((total, h) =>
          total + trahisonsDeLHabitude(h, getEntries(db, h.id), aujourdhui), 0)
    }))
    .sort((a, b) => a.trahisons - b.trahisons || a.nom.localeCompare(b.nom, 'fr'));
}
```

Remplace la ligne `total + trahisonsDeLHabitude(h, getEntries(db, h.id), aujourdhui), 0)` par :

```js
          total + trahisonsDeLHabitude(h, getEntries(db, h.id), aujourdhui, getGels(db, h.id)), 0)
```

- [ ] **Step 8 : `construireEtat` propage les gels et expose `gels_restants`**

Dans `src/server.js`, `construireEtat` (lignes 135-171) :

```js
function construireEtat(db) {
  const aujourdhui = todayISO();
  const habits = getHabits(db);

  const joueurs = getPlayers(db).map((joueur) => ({
    id: joueur.id,
    nom: joueur.nom,
    couleur: joueur.couleur,
    slug: slugifier(joueur.nom),
    habits: habits
      .filter((h) => h.player_id === joueur.id)
      .map((h) => {
        const entries = getEntries(db, h.id);
        const refCourante = refFor(h, aujourdhui);
        const refs = fenetre(h, aujourdhui);
        const reussites = reussitesPourStats(h, entries, toutesLesRefs(h, aujourdhui), refCourante);
        return {
          id: h.id,
          nom: h.nom,
          type: h.type,
          couleur: h.couleur,
          objectif: h.objectif,
          courant: entries[refCourante]?.count || 0,
          streak: computeStreak(reussites),
          points: pointsDe(h, entries, refs, refCourante)
        };
      })
  }));

  return {
    today: aujourdhui,
    mois: new Date(`${aujourdhui}T12:00:00Z`).toLocaleDateString('fr-CH', { month: 'long', year: 'numeric' }),
    couleurs: COULEURS,
    players: joueurs,
    leaderboard: construireLeaderboard(db, aujourdhui)
  };
}
```

Remplace par :

```js
function construireEtat(db) {
  const aujourdhui = todayISO();
  const habits = getHabits(db);
  const semaineCourante = mondayOf(aujourdhui);

  const joueurs = getPlayers(db).map((joueur) => ({
    id: joueur.id,
    nom: joueur.nom,
    couleur: joueur.couleur,
    slug: slugifier(joueur.nom),
    gels_restants: Math.max(0, 2 - countGelsSemaine(db, joueur.id, semaineCourante)),
    habits: habits
      .filter((h) => h.player_id === joueur.id)
      .map((h) => {
        const entries = getEntries(db, h.id);
        const gels = getGels(db, h.id);
        const refCourante = refFor(h, aujourdhui);
        const refs = fenetre(h, aujourdhui);
        const reussites = reussitesPourStats(h, entries, toutesLesRefs(h, aujourdhui), refCourante, gels);
        return {
          id: h.id,
          nom: h.nom,
          type: h.type,
          couleur: h.couleur,
          objectif: h.objectif,
          courant: entries[refCourante]?.count || 0,
          streak: computeStreak(reussites),
          points: pointsDe(h, entries, refs, refCourante, gels)
        };
      })
  }));

  return {
    today: aujourdhui,
    mois: new Date(`${aujourdhui}T12:00:00Z`).toLocaleDateString('fr-CH', { month: 'long', year: 'numeric' }),
    couleurs: COULEURS,
    players: joueurs,
    leaderboard: construireLeaderboard(db, aujourdhui)
  };
}
```

- [ ] **Step 9 : `statsHabit` propage les gels**

Dans `src/server.js`, `statsHabit` (lignes 175-195) :

```js
function statsHabit(habit, entries, aujourdhui) {
  const refs = toutesLesRefs(habit, aujourdhui);
  const refCourante = refFor(habit, aujourdhui);
  const reussites = reussitesPourStats(habit, entries, refs, refCourante);
```

Remplace par :

```js
function statsHabit(habit, entries, aujourdhui, gels) {
  const refs = toutesLesRefs(habit, aujourdhui);
  const refCourante = refFor(habit, aujourdhui);
  const reussites = reussitesPourStats(habit, entries, refs, refCourante, gels);
```

Et un peu plus bas dans la même fonction :

```js
    trahisonsMois: trahisonsDeLHabitude(habit, entries, aujourdhui)
```

Remplace par :

```js
    trahisonsMois: trahisonsDeLHabitude(habit, entries, aujourdhui, gels)
```

- [ ] **Step 10 : `construireHistorique` récupère et propage les gels**

Dans `src/server.js`, `construireHistorique` (lignes 197-209) :

```js
function construireHistorique(db, habitId) {
  const habit = getHabit(db, habitId);
  if (!habit) return null;
  const aujourdhui = todayISO();
  const entries = getEntries(db, habit.id);
  const refs = toutesLesRefs(habit, aujourdhui);
  const refCourante = refFor(habit, aujourdhui);

  return {
    ...statsHabit(habit, entries, aujourdhui),
    points: pointsDe(habit, entries, refs, refCourante)
  };
}
```

Remplace par :

```js
function construireHistorique(db, habitId) {
  const habit = getHabit(db, habitId);
  if (!habit) return null;
  const aujourdhui = todayISO();
  const entries = getEntries(db, habit.id);
  const gels = getGels(db, habit.id);
  const refs = toutesLesRefs(habit, aujourdhui);
  const refCourante = refFor(habit, aujourdhui);

  return {
    ...statsHabit(habit, entries, aujourdhui, gels),
    points: pointsDe(habit, entries, refs, refCourante, gels)
  };
}
```

- [ ] **Step 11 : `construireProfil` récupère et propage les gels**

Dans `src/server.js`, `construireProfil` (lignes 213-233), les deux lignes :

```js
  const actives = habits
    .filter((h) => !h.archived)
    .map((h) => statsHabit(h, getEntries(db, h.id), aujourdhui));
  const archivees = habits
    .filter((h) => h.archived)
    .map((h) => statsHabit(h, getEntries(db, h.id), aujourdhui));
```

Remplace par :

```js
  const actives = habits
    .filter((h) => !h.archived)
    .map((h) => statsHabit(h, getEntries(db, h.id), aujourdhui, getGels(db, h.id)));
  const archivees = habits
    .filter((h) => h.archived)
    .map((h) => statsHabit(h, getEntries(db, h.id), aujourdhui, getGels(db, h.id)));
```

- [ ] **Step 12 : Lancer les tests pour vérifier qu'ils passent**

```bash
npm test
```

Attendu : tous les tests passent (ancienne suite + les 6 nouveaux de cette tâche + les tests des tâches 1-3).

- [ ] **Step 13 : Commit**

```bash
git add src/server.js test/api.test.js
git commit -m "feat: neutralise un jour gelé (streak/record/taux/trahisons) et expose gels_restants"
```

---

### Task 5 : Frontend — glaçon, compteur de gels, menu sur un jour raté/gelé

**Files:**
- Modify: `public/app.js:162-179` (`creerPoint`), `public/app.js:280-309` (`creerCard`), `public/app.js:540-563` (listener global de clic), `public/app.js` (nouveau helper `menuJourRate`, à ajouter près de `menuSuppression`)
- Modify: `public/style.css:1-11` (`:root`), `public/style.css:55-71` (zone `.card-titre`), `public/style.css:178-193` (zone `.point`)

**Interfaces:**
- Consomme : `point.etat === 'gele'` et `joueur.gels_restants` (produits par la Task 4 via `/api/state`/`/api/history`), `POST /api/gels` (Task 3).
- Produit : aucune fonction consommée par une tâche suivante (dernière tâche du plan).

**Note de conception** : la fenêtre « Utiliser un gel » reste toujours visible (pas de masquage côté client basé sur `gels_restants`) — si le quota est dépassé, le serveur refuse (`400`) et le message d'erreur s'affiche via le toast existant (`signaler`), exactement comme toutes les autres actions de l'app (créer/toggler/archiver). Ça évite un cas particulier pour les habitudes archivées consultées depuis l'historique, qui n'apparaissent pas dans `etat.players[].habits` et rendraient un calcul client-side de `gels_restants` peu fiable à cet endroit précis.

- [ ] **Step 1 : `--gele` et `.point.gele` dans le CSS**

Dans `public/style.css`, le bloc `:root` (lignes 1-11) :

```css
:root {
  --fond: #0B0B0D;
  --card: #141417;
  --bord: #232327;
  --texte: #EDEDEF;
  --doux: #8A8A93;
  --rate: #EF4444;
  --attente: #2A2A2E;
  --cell: 30px;   /* côté MAX d'un point (carré arrondi) — ils remplissent la largeur */
  --dot-gap: 6px; /* écart entre points, partagé entête/points pour l'alignement */
}
```

Remplace par :

```css
:root {
  --fond: #0B0B0D;
  --card: #141417;
  --bord: #232327;
  --texte: #EDEDEF;
  --doux: #8A8A93;
  --rate: #EF4444;
  --attente: #2A2A2E;
  --gele: #2563EB;
  --cell: 30px;   /* côté MAX d'un point (carré arrondi) — ils remplissent la largeur */
  --dot-gap: 6px; /* écart entre points, partagé entête/points pour l'alignement */
}
```

Puis, la zone `.point` (lignes 190-193) :

```css
.point:hover { transform: scale(1.12); }
.point:active { transform: scale(0.92); }
.point.rate { background: var(--rate); }
.point.futur { opacity: 0.35; cursor: not-allowed; }
.point.futur:hover { transform: none; }
```

Remplace par :

```css
.point:hover { transform: scale(1.12); }
.point:active { transform: scale(0.92); }
.point.rate { background: var(--rate); }
.point.gele {
  background: var(--gele);
  display: grid;
  place-items: center;
  font-size: 13px;
  line-height: 1;
}
.point.futur { opacity: 0.35; cursor: not-allowed; }
.point.futur:hover { transform: none; }
```

- [ ] **Step 2 : `.card-entete`/`.card-gels` dans le CSS**

Dans `public/style.css`, juste après `.card-titre:hover { color: var(--doux); }` (ligne 71), ajoute :

```css
.card-entete {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 8px;
  margin: 0 0 16px;
}
.card-entete .card-titre { margin: 0; width: auto; }
.card-gels {
  flex-shrink: 0;
  font-size: 12px;
  color: var(--doux);
  white-space: nowrap;
}
```

- [ ] **Step 3 : `creerPoint` affiche le glaçon**

Dans `public/app.js`, `creerPoint` (lignes 162-179) :

```js
function creerPoint(habit, point) {
  const bouton = document.createElement('button');
  bouton.className = 'point';
  bouton.dataset.habit = habit.id;
  bouton.dataset.ref = point.ref;
  bouton.title = point.ref;

  if (point.etat === 'reussi') bouton.style.background = habit.couleur;
  else if (point.etat === 'rate') bouton.classList.add('rate');

  // Le serveur seul sait ce qui est cliquable (fenêtre créée→courante) :
  // futur ET périodes antérieures à la création de l'habitude.
  if (!point.cliquable) bouton.classList.add('futur');
  // La case de la période EN COURS n'est plus cliquable : c'est le bouton
  // « valider » à droite qui la valide. Elle reste affichée (historique).
  if (point.actuel) bouton.classList.add('actuel');
  return bouton;
}
```

Remplace par :

```js
function creerPoint(habit, point) {
  const bouton = document.createElement('button');
  bouton.className = 'point';
  bouton.dataset.habit = habit.id;
  bouton.dataset.ref = point.ref;
  bouton.title = point.ref;

  if (point.etat === 'reussi') bouton.style.background = habit.couleur;
  else if (point.etat === 'rate') bouton.classList.add('rate');
  else if (point.etat === 'gele') {
    bouton.classList.add('gele');
    bouton.textContent = '🧊';
  }

  // Le serveur seul sait ce qui est cliquable (fenêtre créée→courante) :
  // futur ET périodes antérieures à la création de l'habitude.
  if (!point.cliquable) bouton.classList.add('futur');
  // La case de la période EN COURS n'est plus cliquable : c'est le bouton
  // « valider » à droite qui la valide. Elle reste affichée (historique).
  if (point.actuel) bouton.classList.add('actuel');
  return bouton;
}
```

- [ ] **Step 4 : `creerCard` affiche le compteur de gels**

Dans `public/app.js`, `creerCard` (lignes 280-292) :

```js
function creerCard(joueur, misEnAvant = false) {
  const card = document.createElement('section');
  card.className = 'card';
  card.style.setProperty('--joueur', joueur.couleur);
  card.dataset.joueur = joueur.id;
  if (misEnAvant) card.classList.add('card-mise-en-avant');

  const titre = document.createElement('button');
  titre.type = 'button';
  titre.className = 'card-titre';
  titre.textContent = joueur.nom;
  titre.addEventListener('click', () => window.ouvrirProfil(joueur.id));
  card.appendChild(titre);
```

Remplace par :

```js
function creerCard(joueur, misEnAvant = false) {
  const card = document.createElement('section');
  card.className = 'card';
  card.style.setProperty('--joueur', joueur.couleur);
  card.dataset.joueur = joueur.id;
  if (misEnAvant) card.classList.add('card-mise-en-avant');

  const entete = document.createElement('div');
  entete.className = 'card-entete';

  const titre = document.createElement('button');
  titre.type = 'button';
  titre.className = 'card-titre';
  titre.textContent = joueur.nom;
  titre.addEventListener('click', () => window.ouvrirProfil(joueur.id));

  const gels = document.createElement('span');
  gels.className = 'card-gels';
  gels.textContent = `🧊 ${joueur.gels_restants}/2`;
  gels.title = 'Gels de streak disponibles cette semaine';

  entete.append(titre, gels);
  card.appendChild(entete);
```

(La suite de la fonction, `const daily = creerBloc(...)` etc., ne change pas.)

- [ ] **Step 5 : Nouveau helper `menuJourRate`**

Dans `public/app.js`, juste après la fonction `menuSuppression` (qui se termine par `popupContenu.append(titre, question, actions);\n}`, juste avant `window.ouvrirHistorique`), ajoute :

```js
// Menu au clic sur un point raté ou déjà gelé : proposer de corriger (marquer
// fait) ou d'utiliser un gel pour protéger le streak sans compter le jour
// comme réussi. Même mécanique que menuSuppression (popup réutilisé).
// Si un historique était déjà ouvert (clic depuis le calendrier détaillé), on
// y revient après l'action au lieu de fermer le popup — cohérent avec
// rafraichirHistorique() qui existe précisément pour ce cas.
function menuJourRate(habitId, ref, dejaGele) {
  const historiqueEnCours = habitOuverte;
  const origineEnCours = origineHistorique;

  const retourOuFermer = async () => {
    if (historiqueEnCours !== null) {
      await window.ouvrirHistorique(historiqueEnCours, origineEnCours);
    } else {
      fermerPopup();
    }
  };

  popupContenu.textContent = '';
  popup.classList.remove('cache');

  const titre = document.createElement('h2');
  titre.textContent = ref;
  titre.style.margin = '0';

  const question = document.createElement('div');
  question.className = 'note';
  question.textContent = dejaGele
    ? 'Ce jour est déjà protégé par un gel.'
    : 'Ce jour est raté — que faire ?';

  const actions = document.createElement('div');
  actions.className = 'menu-suppression';

  const marquerFait = document.createElement('button');
  marquerFait.className = 'btn-principal';
  marquerFait.textContent = 'Marquer fait';
  marquerFait.addEventListener('click', async () => {
    try {
      await envoyer('/api/toggle', { habit_id: habitId, date_ref: ref });
      await recharger();
      await retourOuFermer();
    } catch (err) { signaler(err.message); }
  });
  actions.appendChild(marquerFait);

  if (!dejaGele) {
    const utiliserGel = document.createElement('button');
    utiliserGel.className = 'btn-discret';
    utiliserGel.textContent = 'Utiliser un gel 🧊';
    utiliserGel.addEventListener('click', async () => {
      try {
        await envoyer('/api/gels', { habit_id: habitId, date_ref: ref });
        await recharger();
        await retourOuFermer();
      } catch (err) { signaler(err.message); }
    });
    actions.appendChild(utiliserGel);
  }

  const annuler = document.createElement('button');
  annuler.className = 'btn-discret';
  annuler.textContent = 'Annuler';
  annuler.addEventListener('click', retourOuFermer);
  actions.appendChild(annuler);

  popupContenu.append(titre, question, actions);
}
```

- [ ] **Step 6 : Le listener global ouvre le menu sur un point raté ou gelé**

Dans `public/app.js`, le listener global de clic (lignes 540-563) :

```js
document.addEventListener('click', async (e) => {
  const point = e.target.closest('.point');
  if (!point || point.classList.contains('futur')) return;
  const habitId = Number(point.dataset.habit);
  const ref = point.dataset.ref;

  // Case de la période EN COURS : même validation que le bouton (son + anim).
  if (point.classList.contains('actuel')) {
    const habit = etat && etat.players
      .flatMap((p) => p.habits)
      .find((h) => h.id === habitId);
    if (habit) validerPeriode(habit, ref);
    return;
  }

  // Cases passées : simple correction (bascule + rechargement).
  try {
    await envoyer('/api/toggle', { habit_id: habitId, date_ref: ref });
    await recharger();
    if (window.rafraichirHistorique) window.rafraichirHistorique();
  } catch (err) {
    signaler(err.message);
  }
});
```

Remplace par :

```js
document.addEventListener('click', async (e) => {
  const point = e.target.closest('.point');
  if (!point || point.classList.contains('futur')) return;
  const habitId = Number(point.dataset.habit);
  const ref = point.dataset.ref;

  // Case de la période EN COURS : même validation que le bouton (son + anim).
  if (point.classList.contains('actuel')) {
    const habit = etat && etat.players
      .flatMap((p) => p.habits)
      .find((h) => h.id === habitId);
    if (habit) validerPeriode(habit, ref);
    return;
  }

  // Jour raté ou déjà gelé : ouvre un choix (marquer fait / utiliser un gel)
  // plutôt qu'une bascule directe. Un jour déjà réussi reste une simple
  // correction en un clic (comportement inchangé, juste en dessous).
  if (point.classList.contains('rate') || point.classList.contains('gele')) {
    menuJourRate(habitId, ref, point.classList.contains('gele'));
    return;
  }

  // Cases passées réussies : simple correction (bascule + rechargement).
  try {
    await envoyer('/api/toggle', { habit_id: habitId, date_ref: ref });
    await recharger();
    if (window.rafraichirHistorique) window.rafraichirHistorique();
  } catch (err) {
    signaler(err.message);
  }
});
```

- [ ] **Step 7 : Vérification manuelle**

```bash
npm test
npm start
```

`npm test` doit rester entièrement vert (cette tâche ne touche que `public/`, aucun test automatisé ne la couvre). Ouvre ensuite `http://localhost:3000` et vérifie que :
- Chaque carte joueur affiche `🧊 2/2` à côté du nom.
- Sur une habitude quotidienne créée il y a plusieurs jours et jamais cochée, les jours passés sont rouges (ratés).
- Cliquer un jour rouge ouvre un popup avec « Marquer fait » / « Utiliser un gel 🧊 » / « Annuler ».
- « Utiliser un gel » remplace le point rouge par un glaçon 🧊 sur fond bleu, et le compteur de la carte passe à `🧊 1/2`.
- Recliquer ce même point (désormais glaçon) n'ouvre plus que « Marquer fait » / « Annuler » (plus de « Utiliser un gel »).
- Poser un 3ᵉ gel dans la même semaine (sur une autre habitude quotidienne du même joueur, ou un autre jour de la même habitude) affiche un toast d'erreur et ne pose rien.
- « Marquer fait » sur un jour gelé le repasse en vert (réussi), plus de glaçon.
- Cliquer un jour rouge **depuis le popup historique détaillé** (clic sur le nom d'une habitude) ramène bien à l'historique après le choix, au lieu de fermer complètement le popup.
- Un jour déjà réussi (vert) continue de basculer directement en un clic, sans popup (comportement inchangé).
- Le bouton « valider » (✔) à droite continue de fonctionner normalement pour le jour en cours.

- [ ] **Step 8 : Commit**

```bash
git add public/app.js public/style.css
git commit -m "feat: interface des gels (glaçon, compteur, menu jour raté)"
```
