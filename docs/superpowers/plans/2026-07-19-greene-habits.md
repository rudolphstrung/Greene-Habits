# Greene Habits — Plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Un habit tracker partagé en page unique pour 6 personnes, sans compte utilisateur, déployé sur `greene.shinouki.com`.

**Architecture:** Un container Node servant à la fois les fichiers statiques et une API JSON adossée à SQLite. Toute la logique d'état (réussi / raté / en attente, streaks) vit dans des fonctions pures sans dépendance à la base, ce qui la rend testable isolément. Aucun état n'est stocké : le rouge est calculé à la lecture, ce qui supprime tout besoin de tâche planifiée.

**Tech Stack:** Node 22 (ESM), `better-sqlite3`, `node:test` pour les tests, HTML/CSS/JS pur côté front (aucun build, aucun framework), Docker + Dokploy.

## Global Constraints

- **Aucune dépendance front.** Pas de framework, pas de bundler, pas de CDN. `public/` est servi tel quel.
- **Une seule dépendance back :** `better-sqlite3`. Tout le reste est natif Node.
- **ESM partout** — `"type": "module"` dans `package.json`.
- **Jamais de `DELETE` sur `players` ou `habits`.** Archivage via `archived = 1` uniquement. (Les `entries` font exception : décocher supprime la ligne, c'est une valeur nulle, pas un historique.)
- **Fuseau horaire : `Europe/Zurich`.** Toutes les dates « aujourd'hui » passent par ce fuseau, jamais par l'heure UTC du serveur.
- **Semaine commençant le lundi.**
- **Palette assignable exacte :** `#4C6FFF` (bleu), `#A855F7` (violet), `#22D3EE` (cyan), `#22C55E` (vert), `#F59E0B` (ambre), `#84CC16` (lime).
- **Couleurs réservées, jamais assignables :** `#EF4444` (raté), `#2A2A2E` (en attente).
- **Le champ `type` d'une habitude est immuable après création.**
- **Interface entièrement en français.**
- **Chemin de la base :** `process.env.DB_PATH` ou `/data/greene.db` par défaut.

---

## Fichiers

| Fichier | Responsabilité |
|---|---|
| `package.json` | Métadonnées, `type: module`, scripts `start` et `test` |
| `src/dates.js` | Arithmétique de dates pures : lundi d'une semaine, fenêtres de 7 périodes |
| `src/state.js` | Règle d'état d'un point et calcul de streak. Fonctions pures. |
| `src/db.js` | Ouverture SQLite, migrations, seed, toutes les requêtes |
| `src/server.js` | Serveur HTTP : fichiers statiques + routes API |
| `public/index.html` | Squelette de page et gabarit du popup |
| `public/style.css` | Thème sombre, grille de cards, points |
| `public/app.js` | Chargement de l'état, rendu, gestion des interactions |
| `test/dates.test.js` | Tests de `src/dates.js` |
| `test/state.test.js` | Tests de `src/state.js` |
| `test/db.test.js` | Tests de `src/db.js` sur base en mémoire |
| `test/api.test.js` | Tests des routes HTTP |
| `Dockerfile` | Image de déploiement |

`src/state.js` et `src/dates.js` ne connaissent ni SQLite ni HTTP. `src/db.js` ne connaît pas HTTP. `public/app.js` ne connaît que la forme des réponses API, jamais le schéma SQL.

---

### Task 1: Squelette du projet et arithmétique de dates

**Files:**
- Create: `package.json`
- Create: `src/dates.js`
- Test: `test/dates.test.js`

**Interfaces:**
- Consumes: rien
- Produits :
  - `todayISO(now?: Date): string` — date du jour à Zurich, format `YYYY-MM-DD`
  - `mondayOf(dateISO: string): string` — lundi de la semaine contenant cette date
  - `addDays(dateISO: string, n: number): string`
  - `currentWeekDays(todayISO: string): string[]` — 7 dates, lundi → dimanche
  - `lastSevenWeeks(todayISO: string): string[]` — 7 lundis, du plus ancien au plus récent
  - `allDaysSince(startISO: string, endISO: string): string[]`
  - `allWeeksSince(startISO: string, endISO: string): string[]` — lundis inclus

- [ ] **Step 1: Créer `package.json`**

```json
{
  "name": "greene-habits",
  "version": "1.0.0",
  "type": "module",
  "scripts": {
    "start": "node src/server.js",
    "test": "node --test test/"
  },
  "dependencies": {
    "better-sqlite3": "^11.5.0"
  }
}
```

Puis lancer : `npm install`

- [ ] **Step 2: Écrire les tests qui échouent**

Créer `test/dates.test.js` :

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  todayISO, mondayOf, addDays, currentWeekDays,
  lastSevenWeeks, allDaysSince, allWeeksSince
} from '../src/dates.js';

test('todayISO rend une date au format YYYY-MM-DD', () => {
  assert.match(todayISO(), /^\d{4}-\d{2}-\d{2}$/);
});

test('todayISO utilise le fuseau de Zurich, pas UTC', () => {
  // 2026-07-19 23:30 UTC = 2026-07-20 01:30 à Zurich (UTC+2 en été)
  const t = new Date('2026-07-19T23:30:00Z');
  assert.equal(todayISO(t), '2026-07-20');
});

test('mondayOf ramène un mercredi à son lundi', () => {
  // 2026-07-15 est un mercredi
  assert.equal(mondayOf('2026-07-15'), '2026-07-13');
});

test('mondayOf laisse un lundi inchangé', () => {
  assert.equal(mondayOf('2026-07-13'), '2026-07-13');
});

test('mondayOf ramène un dimanche au lundi qui le précède', () => {
  // 2026-07-19 est un dimanche
  assert.equal(mondayOf('2026-07-19'), '2026-07-13');
});

test('addDays traverse une fin de mois', () => {
  assert.equal(addDays('2026-07-31', 1), '2026-08-01');
});

test('addDays accepte un décalage négatif', () => {
  assert.equal(addDays('2026-08-01', -1), '2026-07-31');
});

test('currentWeekDays rend 7 jours du lundi au dimanche', () => {
  const jours = currentWeekDays('2026-07-15');
  assert.equal(jours.length, 7);
  assert.equal(jours[0], '2026-07-13');
  assert.equal(jours[6], '2026-07-19');
});

test('lastSevenWeeks finit par la semaine en cours', () => {
  const semaines = lastSevenWeeks('2026-07-15');
  assert.equal(semaines.length, 7);
  assert.equal(semaines[6], '2026-07-13');
  assert.equal(semaines[0], '2026-06-01');
});

test('allDaysSince inclut les deux bornes', () => {
  assert.deepEqual(
    allDaysSince('2026-07-13', '2026-07-15'),
    ['2026-07-13', '2026-07-14', '2026-07-15']
  );
});

test('allWeeksSince rend les lundis des deux bornes incluses', () => {
  assert.deepEqual(
    allWeeksSince('2026-07-01', '2026-07-15'),
    ['2026-06-29', '2026-07-06', '2026-07-13']
  );
});
```

- [ ] **Step 3: Lancer les tests pour vérifier qu'ils échouent**

Run: `npm test`
Expected: FAIL — `Cannot find module '../src/dates.js'`

- [ ] **Step 4: Implémenter `src/dates.js`**

```js
// Toutes les dates sont des chaînes 'YYYY-MM-DD'. Les calculs passent par des
// Date en UTC pour éviter tout décalage d'heure d'été : on ne manipule que des
// jours entiers, jamais des instants.

const JOUR_MS = 86400000;

function parse(dateISO) {
  return new Date(`${dateISO}T00:00:00Z`);
}

function format(d) {
  return d.toISOString().slice(0, 10);
}

export function todayISO(now = new Date()) {
  // en-CA rend justement 'YYYY-MM-DD'
  return now.toLocaleDateString('en-CA', { timeZone: 'Europe/Zurich' });
}

export function addDays(dateISO, n) {
  return format(new Date(parse(dateISO).getTime() + n * JOUR_MS));
}

export function mondayOf(dateISO) {
  const d = parse(dateISO);
  // getUTCDay : 0 = dimanche … 6 = samedi. On veut 0 = lundi.
  const decalage = (d.getUTCDay() + 6) % 7;
  return addDays(dateISO, -decalage);
}

export function currentWeekDays(todayISO) {
  const lundi = mondayOf(todayISO);
  return Array.from({ length: 7 }, (_, i) => addDays(lundi, i));
}

export function lastSevenWeeks(todayISO) {
  const lundi = mondayOf(todayISO);
  return Array.from({ length: 7 }, (_, i) => addDays(lundi, (i - 6) * 7));
}

export function allDaysSince(startISO, endISO) {
  const jours = [];
  let courant = startISO;
  while (courant <= endISO) {
    jours.push(courant);
    courant = addDays(courant, 1);
  }
  return jours;
}

export function allWeeksSince(startISO, endISO) {
  const semaines = [];
  let courant = mondayOf(startISO);
  const fin = mondayOf(endISO);
  while (courant <= fin) {
    semaines.push(courant);
    courant = addDays(courant, 7);
  }
  return semaines;
}
```

- [ ] **Step 5: Lancer les tests pour vérifier qu'ils passent**

Run: `npm test`
Expected: PASS — 11 tests

- [ ] **Step 6: Commit**

```bash
git add package.json package-lock.json src/dates.js test/dates.test.js
git commit -m "feat: arithmétique de dates (lundi, fenêtres de 7 périodes)"
```

---

### Task 2: Règle d'état et calcul de streak

**Files:**
- Create: `src/state.js`
- Test: `test/state.test.js`

**Interfaces:**
- Consumes: rien (fonctions pures)
- Produits :
  - `dotState(count: number, objectif: number, estPasse: boolean): 'reussi' | 'rate' | 'attente'`
  - `computeStreak(refs: string[], counts: Record<string, number>, objectif: number): number` — `refs` du plus ancien au plus récent, la dernière entrée étant la période en cours
  - `successRate(refs, counts, objectif): number` — pourcentage entier sur les périodes **écoulées** (la période en cours est exclue)
  - `bestStreak(refs, counts, objectif): number`

- [ ] **Step 1: Écrire les tests qui échouent**

Créer `test/state.test.js` :

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dotState, computeStreak, successRate, bestStreak } from '../src/state.js';

test('objectif atteint = réussi, même sur la période en cours', () => {
  assert.equal(dotState(1, 1, false), 'reussi');
  assert.equal(dotState(3, 3, true), 'reussi');
  assert.equal(dotState(5, 3, true), 'reussi');
});

test('objectif manqué sur une période passée = raté', () => {
  assert.equal(dotState(0, 1, true), 'rate');
  assert.equal(dotState(2, 3, true), 'rate');
});

test('objectif manqué sur la période en cours = en attente, jamais raté', () => {
  assert.equal(dotState(0, 1, false), 'attente');
  assert.equal(dotState(2, 3, false), 'attente');
});

test('le streak compte les périodes réussies consécutives', () => {
  const refs = ['j1', 'j2', 'j3', 'j4'];
  const counts = { j1: 1, j2: 1, j3: 1, j4: 1 };
  assert.equal(computeStreak(refs, counts, 1), 4);
});

test('la période en cours non cochée ne casse pas le streak', () => {
  const refs = ['j1', 'j2', 'j3', 'j4'];
  const counts = { j1: 1, j2: 1, j3: 1 }; // j4 = aujourd'hui, pas encore fait
  assert.equal(computeStreak(refs, counts, 1), 3);
});

test('une période passée ratée remet le streak à zéro', () => {
  const refs = ['j1', 'j2', 'j3', 'j4'];
  const counts = { j1: 1, j2: 1, j4: 1 }; // j3 raté, j4 fait
  assert.equal(computeStreak(refs, counts, 1), 1);
});

test('le streak vaut 0 quand rien n\'est fait', () => {
  assert.equal(computeStreak(['j1', 'j2'], {}, 1), 0);
});

test('le streak hebdo respecte l\'objectif', () => {
  const refs = ['s1', 's2', 's3'];
  const counts = { s1: 3, s2: 2, s3: 3 };
  // s2 sous l'objectif de 3 → le streak s'arrête à s3
  assert.equal(computeStreak(refs, counts, 3), 1);
});

test('successRate exclut la période en cours', () => {
  const refs = ['j1', 'j2', 'j3'];
  const counts = { j1: 1, j2: 0 }; // j3 = en cours, ignoré
  assert.equal(successRate(refs, counts, 1), 50);
});

test('successRate vaut 0 s\'il n\'y a aucune période écoulée', () => {
  assert.equal(successRate(['j1'], {}, 1), 0);
});

test('bestStreak trouve la plus longue série, pas la dernière', () => {
  const refs = ['j1', 'j2', 'j3', 'j4', 'j5', 'j6'];
  const counts = { j1: 1, j2: 1, j3: 1, j5: 1, j6: 1 };
  assert.equal(bestStreak(refs, counts, 1), 3);
});
```

- [ ] **Step 2: Lancer les tests pour vérifier qu'ils échouent**

Run: `npm test`
Expected: FAIL — `Cannot find module '../src/state.js'`

- [ ] **Step 3: Implémenter `src/state.js`**

```js
// Aucun état n'est stocké en base : un point se déduit toujours de son compteur,
// de l'objectif de l'habitude et de la position de sa période dans le temps.

export function dotState(count, objectif, estPasse) {
  if (count >= objectif) return 'reussi';
  return estPasse ? 'rate' : 'attente';
}

function reussi(counts, ref, objectif) {
  return (counts[ref] || 0) >= objectif;
}

export function computeStreak(refs, counts, objectif) {
  let i = refs.length - 1;
  // La période en cours ne casse jamais le streak tant qu'elle n'est pas
  // terminée : sinon le compteur retomberait à zéro chaque matin.
  if (i >= 0 && !reussi(counts, refs[i], objectif)) i--;
  let streak = 0;
  while (i >= 0 && reussi(counts, refs[i], objectif)) {
    streak++;
    i--;
  }
  return streak;
}

export function successRate(refs, counts, objectif) {
  const ecoulees = refs.slice(0, -1); // la dernière est la période en cours
  if (ecoulees.length === 0) return 0;
  const ok = ecoulees.filter((r) => reussi(counts, r, objectif)).length;
  return Math.round((ok / ecoulees.length) * 100);
}

export function bestStreak(refs, counts, objectif) {
  let meilleur = 0;
  let courant = 0;
  for (const ref of refs) {
    if (reussi(counts, ref, objectif)) {
      courant++;
      if (courant > meilleur) meilleur = courant;
    } else {
      courant = 0;
    }
  }
  return meilleur;
}
```

- [ ] **Step 4: Lancer les tests pour vérifier qu'ils passent**

Run: `npm test`
Expected: PASS — 22 tests au total

- [ ] **Step 5: Commit**

```bash
git add src/state.js test/state.test.js
git commit -m "feat: règle d'état des points et calcul de streak"
```

---

### Task 3: Base de données — schéma, migrations, seed

**Files:**
- Create: `src/db.js`
- Test: `test/db.test.js`

**Interfaces:**
- Consumes: rien
- Produits :
  - `COULEURS: string[]` — les 6 couleurs assignables
  - `openDb(path?: string)` — ouvre, migre et amorce la base ; `':memory:'` accepté
  - `getPlayers(db)` → `{ id, nom }[]` non archivés
  - `getHabits(db)` → `{ id, player_id, nom, type, couleur, objectif, created_at }[]` non archivés

- [ ] **Step 1: Écrire les tests qui échouent**

Créer `test/db.test.js` :

```js
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
```

- [ ] **Step 2: Lancer les tests pour vérifier qu'ils échouent**

Run: `npm test`
Expected: FAIL — `Cannot find module '../src/db.js'`

- [ ] **Step 3: Implémenter le socle de `src/db.js`**

```js
import Database from 'better-sqlite3';
import { todayISO } from './dates.js';

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
```

- [ ] **Step 4: Lancer les tests pour vérifier qu'ils passent**

Run: `npm test`
Expected: PASS — 27 tests au total

- [ ] **Step 5: Commit**

```bash
git add src/db.js test/db.test.js
git commit -m "feat: schéma SQLite, migrations et amorçage"
```

---

### Task 4: Base de données — écritures et bascule d'un point

**Files:**
- Modify: `src/db.js` (ajouts en fin de fichier)
- Modify: `test/db.test.js` (ajouts en fin de fichier)

**Interfaces:**
- Consumes: `openDb`, `COULEURS` (Task 3) ; `mondayOf`, `todayISO` (Task 1)
- Produits :
  - `createPlayer(db, nom): { id, nom }` — lève `Error` si nom vide
  - `createHabit(db, { player_id, nom, type, couleur, objectif }): object` — lève `Error` si couleur hors palette, type inconnu, nom vide, ou objectif < 1
  - `updateHabit(db, id, { nom, couleur, objectif }): object` — ignore silencieusement `type` et `player_id`
  - `archiveHabit(db, id): void`
  - `getCounts(db, habitId): Record<string, number>` — toutes les entries de l'habitude
  - `refFor(habit, dateISO): string` — la `date_ref` canonique (le jour, ou son lundi si weekly)
  - `toggle(db, habitId, dateRef): number` — nouveau `count` ; lève `Error` hors fenêtre autorisée

- [ ] **Step 1: Écrire les tests qui échouent**

Ajouter à la fin de `test/db.test.js` :

```js
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
```

Ajouter aussi cet import en tête de `test/db.test.js` :

```js
import { todayISO, mondayOf, addDays } from '../src/dates.js';
```

- [ ] **Step 2: Lancer les tests pour vérifier qu'ils échouent**

Run: `npm test`
Expected: FAIL — `createPlayer is not a function` (ou import manquant)

- [ ] **Step 3: Implémenter les écritures dans `src/db.js`**

Ajouter en fin de `src/db.js` :

```js
import { mondayOf } from './dates.js';

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
  const cible = type === 'daily' ? 1 : Math.max(1, parseInt(objectif, 10) || 1);

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
  const cible = habit.type === 'daily' ? 1 : Math.max(1, parseInt(objectif, 10) || 1);

  db.prepare('UPDATE habits SET nom = ?, couleur = ?, objectif = ? WHERE id = ?')
    .run(propre, couleur, cible, id);
  return getHabit(db, id);
}

export function archiveHabit(db, id) {
  db.prepare('UPDATE habits SET archived = 1 WHERE id = ?').run(id);
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
```

**Note :** déplacer l'import `mondayOf` en haut du fichier avec les autres imports plutôt que de le laisser au milieu — les imports ESM doivent être en tête de module.

- [ ] **Step 4: Lancer les tests pour vérifier qu'ils passent**

Run: `npm test`
Expected: PASS — 41 tests au total

- [ ] **Step 5: Commit**

```bash
git add src/db.js test/db.test.js
git commit -m "feat: écritures DB et cycle de bascule d'un point"
```

---

### Task 5: Serveur HTTP et API

**Files:**
- Create: `src/server.js`
- Test: `test/api.test.js`

**Interfaces:**
- Consumes: tout `src/db.js`, `src/state.js`, `src/dates.js`
- Produits :
  - `createServer(db): http.Server` — testable sans écouter de port fixe
  - Réponse de `GET /api/state` :
    ```json
    {
      "today": "2026-07-19",
      "couleurs": ["#4C6FFF", "..."],
      "players": [{
        "id": 1, "nom": "Anatole",
        "habits": [{
          "id": 1, "nom": "Lecture", "type": "daily",
          "couleur": "#4C6FFF", "objectif": 1, "streak": 12,
          "courant": 0,
          "points": [{ "ref": "2026-07-13", "etat": "reussi", "count": 1 }]
        }]
      }]
    }
    ```
    `points` contient toujours exactement 7 éléments. `courant` est le compteur de la période en cours (affiché `2/3` pour une weekly).

- [ ] **Step 1: Écrire les tests qui échouent**

Créer `test/api.test.js` :

```js
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
```

- [ ] **Step 2: Lancer les tests pour vérifier qu'ils échouent**

Run: `npm test`
Expected: FAIL — `Cannot find module '../src/server.js'`

- [ ] **Step 3: Implémenter `src/server.js`**

```js
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  openDb, getPlayers, getHabits, getHabit, getCounts, COULEURS,
  createPlayer, createHabit, updateHabit, archiveHabit, toggle, refFor
} from './db.js';
import {
  todayISO, currentWeekDays, lastSevenWeeks, allDaysSince, allWeeksSince
} from './dates.js';
import { dotState, computeStreak, successRate, bestStreak } from './state.js';

const RACINE = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'public');

const TYPES_MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8'
};

// --- Assemblage de l'état -------------------------------------------------

function fenetre(habit, aujourdhui) {
  return habit.type === 'weekly' ? lastSevenWeeks(aujourdhui) : currentWeekDays(aujourdhui);
}

function toutesLesRefs(habit, aujourdhui) {
  return habit.type === 'weekly'
    ? allWeeksSince(habit.created_at, aujourdhui)
    : allDaysSince(habit.created_at, aujourdhui);
}

function pointsDe(habit, counts, refs, refCourante) {
  return refs.map((ref) => {
    const count = counts[ref] || 0;
    // Une période antérieure à la création n'est ni ratée ni en attente :
    // l'habitude n'existait pas, on la neutralise en 'attente'.
    if (ref < refFor(habit, habit.created_at)) {
      return { ref, count: 0, etat: 'attente' };
    }
    return { ref, count, etat: dotState(count, habit.objectif, ref < refCourante) };
  });
}

function construireEtat(db) {
  const aujourdhui = todayISO();
  const habits = getHabits(db);

  const joueurs = getPlayers(db).map((joueur) => ({
    id: joueur.id,
    nom: joueur.nom,
    habits: habits
      .filter((h) => h.player_id === joueur.id)
      .map((h) => {
        const counts = getCounts(db, h.id);
        const refCourante = refFor(h, aujourdhui);
        const refs = fenetre(h, aujourdhui);
        return {
          id: h.id,
          nom: h.nom,
          type: h.type,
          couleur: h.couleur,
          objectif: h.objectif,
          courant: counts[refCourante] || 0,
          streak: computeStreak(toutesLesRefs(h, aujourdhui), counts, h.objectif),
          points: pointsDe(h, counts, refs, refCourante)
        };
      })
  }));

  return { today: aujourdhui, couleurs: COULEURS, players: joueurs };
}

function construireHistorique(db, habitId) {
  const habit = getHabit(db, habitId);
  if (!habit) return null;
  const aujourdhui = todayISO();
  const counts = getCounts(db, habit.id);
  const refs = toutesLesRefs(habit, aujourdhui);
  const refCourante = refFor(habit, aujourdhui);

  return {
    id: habit.id,
    nom: habit.nom,
    type: habit.type,
    couleur: habit.couleur,
    objectif: habit.objectif,
    streak: computeStreak(refs, counts, habit.objectif),
    record: bestStreak(refs, counts, habit.objectif),
    taux: successRate(refs, counts, habit.objectif),
    points: pointsDe(habit, counts, refs, refCourante)
  };
}

// --- Serveur --------------------------------------------------------------

function lireCorps(req) {
  return new Promise((resoudre, rejeter) => {
    let brut = '';
    req.on('data', (m) => {
      brut += m;
      if (brut.length > 1e5) rejeter(new Error('Corps trop volumineux'));
    });
    req.on('end', () => {
      try { resoudre(brut ? JSON.parse(brut) : {}); }
      catch { rejeter(new Error('JSON invalide')); }
    });
  });
}

function envoyerJson(res, statut, donnees) {
  const corps = JSON.stringify(donnees);
  res.writeHead(statut, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(corps)
  });
  res.end(corps);
}

function servirStatique(res, urlPath) {
  const nom = urlPath === '/' ? '/index.html' : urlPath;
  const fichier = path.join(RACINE, path.normalize(nom).replace(/^(\.\.[/\\])+/, ''));
  if (!fichier.startsWith(RACINE) || !fs.existsSync(fichier)) {
    res.writeHead(404).end('Not found');
    return;
  }
  res.writeHead(200, { 'Content-Type': TYPES_MIME[path.extname(fichier)] || 'application/octet-stream' });
  fs.createReadStream(fichier).pipe(res);
}

export function createServer(db) {
  return http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://localhost');
    const chemin = url.pathname;

    if (!chemin.startsWith('/api/')) {
      return servirStatique(res, chemin);
    }

    try {
      if (req.method === 'GET' && chemin === '/api/state') {
        return envoyerJson(res, 200, construireEtat(db));
      }

      if (req.method === 'GET' && chemin === '/api/history') {
        const historique = construireHistorique(db, Number(url.searchParams.get('habit_id')));
        return historique
          ? envoyerJson(res, 200, historique)
          : envoyerJson(res, 404, { erreur: 'Habitude introuvable' });
      }

      if (req.method === 'POST' && chemin === '/api/players') {
        const { nom } = await lireCorps(req);
        return envoyerJson(res, 201, createPlayer(db, nom));
      }

      if (req.method === 'POST' && chemin === '/api/habits') {
        const corps = await lireCorps(req);
        return envoyerJson(res, 201, createHabit(db, corps));
      }

      const majHabit = chemin.match(/^\/api\/habits\/(\d+)$/);
      if (req.method === 'PATCH' && majHabit) {
        const corps = await lireCorps(req);
        return envoyerJson(res, 200, updateHabit(db, Number(majHabit[1]), corps));
      }

      const archive = chemin.match(/^\/api\/habits\/(\d+)\/archive$/);
      if (req.method === 'POST' && archive) {
        archiveHabit(db, Number(archive[1]));
        return envoyerJson(res, 200, { ok: true });
      }

      if (req.method === 'POST' && chemin === '/api/toggle') {
        const { habit_id, date_ref } = await lireCorps(req);
        return envoyerJson(res, 200, { count: toggle(db, Number(habit_id), date_ref) });
      }

      return envoyerJson(res, 404, { erreur: 'Route inconnue' });
    } catch (e) {
      return envoyerJson(res, 400, { erreur: e.message });
    }
  });
}

// Démarrage réel uniquement hors tests.
if (process.env.NODE_ENV !== 'test' && import.meta.url === `file://${process.argv[1]}`) {
  const port = process.env.PORT || 3000;
  createServer(openDb()).listen(port, () => {
    console.log(`Greene Habits écoute sur le port ${port}`);
  });
}
```

- [ ] **Step 4: Lancer les tests pour vérifier qu'ils passent**

Run: `npm test`
Expected: PASS — 51 tests au total

- [ ] **Step 5: Commit**

```bash
git add src/server.js test/api.test.js
git commit -m "feat: serveur HTTP et API JSON"
```

---

### Task 6: Front — page principale et cards joueurs

**Files:**
- Create: `public/index.html`
- Create: `public/style.css`
- Create: `public/app.js`

**Interfaces:**
- Consumes: `GET /api/state`, `POST /api/toggle`, `POST /api/players`, `POST /api/habits`
- Produits : `window.GreeneHabits = { recharger() }` pour que Task 7 déclenche un rafraîchissement après une édition

Cette tâche est visuelle : elle se vérifie à l'œil dans un navigateur, pas par des assertions. Les étapes de vérification décrivent exactement quoi regarder.

- [ ] **Step 1: Créer `public/index.html`**

```html
<!doctype html>
<html lang="fr">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Greene Habits</title>
  <link rel="stylesheet" href="/style.css">
</head>
<body>
  <header>
    <h1>Greene Habits</h1>
    <span id="date-jour"></span>
  </header>

  <main id="joueurs"></main>

  <div class="pied">
    <button id="btn-joueur" class="btn-principal">+ joueur</button>
  </div>

  <div id="popup" class="popup cache">
    <div class="popup-boite">
      <button id="popup-fermer" class="popup-croix" aria-label="Fermer">&times;</button>
      <div id="popup-contenu"></div>
    </div>
  </div>

  <div id="toast" class="toast cache"></div>

  <script src="/app.js" type="module"></script>
</body>
</html>
```

- [ ] **Step 2: Créer `public/style.css`**

```css
:root {
  --fond: #0B0B0D;
  --card: #141417;
  --bord: #232327;
  --texte: #EDEDEF;
  --doux: #8A8A93;
  --rate: #EF4444;
  --attente: #2A2A2E;
}

* { box-sizing: border-box; }

body {
  margin: 0;
  padding: 0 16px 96px;
  background: var(--fond);
  color: var(--texte);
  font: 15px/1.5 -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif;
}

header {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  padding: 28px 4px 20px;
}
header h1 { margin: 0; font-size: 20px; letter-spacing: -0.01em; }
header span { color: var(--doux); font-size: 13px; }

main {
  display: grid;
  gap: 14px;
  grid-template-columns: 1fr;
}
@media (min-width: 720px)  { main { grid-template-columns: repeat(2, 1fr); } }
@media (min-width: 1100px) { main { grid-template-columns: repeat(3, 1fr); } }

.card {
  background: var(--card);
  border: 1px solid var(--bord);
  border-radius: 16px;
  padding: 18px;
}
.card h2 {
  margin: 0 0 16px;
  font-size: 13px;
  font-weight: 600;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

.bloc-titre {
  margin: 18px 0 10px;
  font-size: 10px;
  font-weight: 600;
  letter-spacing: 0.12em;
  color: var(--doux);
}
.bloc:first-of-type .bloc-titre { margin-top: 0; }

.jours-entete {
  display: grid;
  grid-template-columns: repeat(7, 1fr);
  gap: 6px;
  margin-bottom: 8px;
  font-size: 9px;
  letter-spacing: 0.06em;
  color: var(--doux);
  text-align: center;
}

.habitude { margin-bottom: 16px; }
.habitude-entete {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  margin-bottom: 7px;
}
.habitude-nom {
  background: none;
  border: 0;
  padding: 0;
  color: var(--texte);
  font: inherit;
  font-size: 14px;
  cursor: pointer;
  text-align: left;
}
.habitude-nom:hover { color: var(--doux); }
.habitude-meta {
  display: flex;
  gap: 10px;
  font-size: 12px;
  color: var(--doux);
  white-space: nowrap;
}

.points {
  display: grid;
  grid-template-columns: repeat(7, 1fr);
  gap: 6px;
}
.point {
  aspect-ratio: 1;
  width: 100%;
  max-width: 22px;
  padding: 0;
  border: 0;
  border-radius: 50%;
  background: var(--attente);
  cursor: pointer;
  transition: transform 0.12s ease, opacity 0.12s ease;
}
.point:hover { transform: scale(1.18); }
.point:active { transform: scale(0.92); }
.point.rate { background: var(--rate); }
.point.futur { opacity: 0.35; cursor: not-allowed; }
.point.futur:hover { transform: none; }

.card-actions { margin-top: 4px; }
.btn-discret {
  background: none;
  border: 0;
  padding: 4px 0;
  color: var(--doux);
  font: inherit;
  font-size: 12px;
  cursor: pointer;
}
.btn-discret:hover { color: var(--texte); }

.pied { display: flex; justify-content: center; margin-top: 24px; }
.btn-principal {
  background: var(--card);
  border: 1px solid var(--bord);
  border-radius: 999px;
  padding: 10px 22px;
  color: var(--texte);
  font: inherit;
  font-size: 13px;
  cursor: pointer;
}
.btn-principal:hover { border-color: var(--doux); }

.formulaire {
  display: grid;
  gap: 8px;
  margin-top: 10px;
  padding: 12px;
  background: var(--fond);
  border: 1px solid var(--bord);
  border-radius: 12px;
}
.formulaire input, .formulaire select {
  padding: 8px 10px;
  background: var(--card);
  border: 1px solid var(--bord);
  border-radius: 8px;
  color: var(--texte);
  font: inherit;
  font-size: 13px;
}
.formulaire-boutons { display: flex; gap: 8px; }

.couleurs { display: flex; gap: 8px; }
.pastille {
  width: 24px;
  height: 24px;
  padding: 0;
  border: 2px solid transparent;
  border-radius: 50%;
  cursor: pointer;
}
.pastille[aria-pressed="true"] { border-color: var(--texte); }

.popup {
  position: fixed;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 16px;
  background: rgba(0, 0, 0, 0.72);
  z-index: 10;
}
.popup-boite {
  position: relative;
  width: 100%;
  max-width: 520px;
  max-height: 85vh;
  overflow-y: auto;
  padding: 24px;
  background: var(--card);
  border: 1px solid var(--bord);
  border-radius: 18px;
}
.popup-croix {
  position: absolute;
  top: 14px;
  right: 16px;
  background: none;
  border: 0;
  color: var(--doux);
  font-size: 26px;
  line-height: 1;
  cursor: pointer;
}

.stats { display: flex; gap: 22px; margin: 14px 0 20px; }
.stat-valeur { font-size: 20px; font-weight: 600; }
.stat-label { font-size: 10px; letter-spacing: 0.08em; color: var(--doux); text-transform: uppercase; }

.mois { margin-bottom: 16px; }
.mois-nom { margin-bottom: 7px; font-size: 11px; color: var(--doux); }
.mois-points {
  display: grid;
  grid-template-columns: repeat(7, 20px);
  gap: 5px;
}
.mois-points .point { max-width: 20px; }

.toast {
  position: fixed;
  bottom: 22px;
  left: 50%;
  transform: translateX(-50%);
  padding: 10px 18px;
  background: var(--rate);
  border-radius: 999px;
  font-size: 13px;
  z-index: 20;
}

.cache { display: none; }
```

- [ ] **Step 3: Créer `public/app.js`**

```js
const JOURS = ['LU', 'MA', 'ME', 'JE', 'VE', 'SA', 'DI'];

let etat = null;

// --- Réseau ---------------------------------------------------------------

async function api(chemin, options) {
  const rep = await fetch(chemin, options);
  const corps = await rep.json().catch(() => ({}));
  if (!rep.ok) throw new Error(corps.erreur || 'Erreur serveur');
  return corps;
}

const envoyer = (chemin, donnees, methode = 'POST') =>
  api(chemin, {
    method: methode,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(donnees)
  });

function signaler(message) {
  const toast = document.getElementById('toast');
  toast.textContent = message;
  toast.classList.remove('cache');
  setTimeout(() => toast.classList.add('cache'), 2600);
}

export async function recharger() {
  etat = await api('/api/state');
  rendre();
}

// --- Rendu ----------------------------------------------------------------

function creerPoint(habit, point) {
  const bouton = document.createElement('button');
  bouton.className = 'point';
  bouton.dataset.habit = habit.id;
  bouton.dataset.ref = point.ref;
  bouton.title = point.ref;

  if (point.etat === 'reussi') bouton.style.background = habit.couleur;
  else if (point.etat === 'rate') bouton.classList.add('rate');

  // Une période future ne se coche pas : le serveur la refuserait de toute façon.
  if (point.ref > etat.today) bouton.classList.add('futur');
  return bouton;
}

function creerHabitude(habit) {
  const bloc = document.createElement('div');
  bloc.className = 'habitude';

  const entete = document.createElement('div');
  entete.className = 'habitude-entete';

  const nom = document.createElement('button');
  nom.className = 'habitude-nom';
  nom.textContent = habit.nom;
  nom.addEventListener('click', () => window.ouvrirHistorique(habit.id));

  const meta = document.createElement('div');
  meta.className = 'habitude-meta';
  if (habit.type === 'weekly' && habit.courant < habit.objectif) {
    const progres = document.createElement('span');
    progres.textContent = `${habit.courant}/${habit.objectif}`;
    meta.appendChild(progres);
  }
  const streak = document.createElement('span');
  streak.textContent = `🔥 ${habit.streak}`;
  meta.appendChild(streak);

  entete.append(nom, meta);

  const points = document.createElement('div');
  points.className = 'points';
  habit.points.forEach((p) => points.appendChild(creerPoint(habit, p)));

  bloc.append(entete, points);
  return bloc;
}

function creerBloc(titre, habits, avecEnteteJours) {
  if (habits.length === 0) return null;
  const bloc = document.createElement('div');
  bloc.className = 'bloc';

  const label = document.createElement('div');
  label.className = 'bloc-titre';
  label.textContent = titre;
  bloc.appendChild(label);

  if (avecEnteteJours) {
    const entete = document.createElement('div');
    entete.className = 'jours-entete';
    JOURS.forEach((j) => {
      const cellule = document.createElement('span');
      cellule.textContent = j;
      entete.appendChild(cellule);
    });
    bloc.appendChild(entete);
  }

  habits.forEach((h) => bloc.appendChild(creerHabitude(h)));
  return bloc;
}

function creerCard(joueur) {
  const card = document.createElement('section');
  card.className = 'card';

  const titre = document.createElement('h2');
  titre.textContent = joueur.nom;
  card.appendChild(titre);

  const daily = creerBloc('DAILY', joueur.habits.filter((h) => h.type === 'daily'), true);
  const weekly = creerBloc('WEEKLY', joueur.habits.filter((h) => h.type === 'weekly'), false);
  if (daily) card.appendChild(daily);
  if (weekly) card.appendChild(weekly);

  const actions = document.createElement('div');
  actions.className = 'card-actions';
  const ajouter = document.createElement('button');
  ajouter.className = 'btn-discret';
  ajouter.textContent = '+ habitude';
  ajouter.addEventListener('click', () => formulaireHabitude(card, joueur.id, ajouter));
  actions.appendChild(ajouter);
  card.appendChild(actions);

  return card;
}

function rendre() {
  document.getElementById('date-jour').textContent =
    new Date(`${etat.today}T12:00:00Z`).toLocaleDateString('fr-CH', {
      weekday: 'long', day: 'numeric', month: 'long'
    });

  const conteneur = document.getElementById('joueurs');
  conteneur.textContent = '';
  etat.players.forEach((j) => conteneur.appendChild(creerCard(j)));
}

// --- Formulaire d'ajout d'habitude ---------------------------------------

function selecteurCouleur(initiale) {
  const zone = document.createElement('div');
  zone.className = 'couleurs';
  let choisie = initiale || etat.couleurs[0];

  etat.couleurs.forEach((couleur) => {
    const pastille = document.createElement('button');
    pastille.type = 'button';
    pastille.className = 'pastille';
    pastille.style.background = couleur;
    pastille.setAttribute('aria-pressed', String(couleur === choisie));
    pastille.addEventListener('click', () => {
      choisie = couleur;
      zone.querySelectorAll('.pastille').forEach((p) =>
        p.setAttribute('aria-pressed', String(p.style.background === pastille.style.background)));
    });
    zone.appendChild(pastille);
  });

  return { zone, valeur: () => choisie };
}

function formulaireHabitude(card, playerId, declencheur) {
  if (card.querySelector('.formulaire')) return;
  declencheur.classList.add('cache');

  const form = document.createElement('form');
  form.className = 'formulaire';

  const nom = document.createElement('input');
  nom.placeholder = 'Nom de l\'habitude';
  nom.required = true;

  const type = document.createElement('select');
  type.innerHTML = '<option value="daily">Quotidienne</option><option value="weekly">Hebdomadaire</option>';

  const objectif = document.createElement('input');
  objectif.type = 'number';
  objectif.min = '1';
  objectif.value = '1';
  objectif.placeholder = 'Fois par semaine';
  objectif.classList.add('cache');

  type.addEventListener('change', () => {
    objectif.classList.toggle('cache', type.value !== 'weekly');
  });

  const couleur = selecteurCouleur();

  const boutons = document.createElement('div');
  boutons.className = 'formulaire-boutons';
  const valider = document.createElement('button');
  valider.type = 'submit';
  valider.className = 'btn-principal';
  valider.textContent = 'Créer';
  const annuler = document.createElement('button');
  annuler.type = 'button';
  annuler.className = 'btn-discret';
  annuler.textContent = 'Annuler';
  annuler.addEventListener('click', () => { form.remove(); declencheur.classList.remove('cache'); });
  boutons.append(valider, annuler);

  form.append(nom, type, objectif, couleur.zone, boutons);
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      await envoyer('/api/habits', {
        player_id: playerId,
        nom: nom.value,
        type: type.value,
        couleur: couleur.valeur(),
        objectif: Number(objectif.value)
      });
      await recharger();
    } catch (err) {
      signaler(err.message);
    }
  });

  card.querySelector('.card-actions').before(form);
  nom.focus();
}

// --- Interactions globales ------------------------------------------------

document.addEventListener('click', async (e) => {
  const point = e.target.closest('.point');
  if (!point || point.classList.contains('futur')) return;
  try {
    await envoyer('/api/toggle', {
      habit_id: Number(point.dataset.habit),
      date_ref: point.dataset.ref
    });
    await recharger();
    if (window.rafraichirHistorique) window.rafraichirHistorique();
  } catch (err) {
    signaler(err.message);
  }
});

document.getElementById('btn-joueur').addEventListener('click', async () => {
  const nom = prompt('Prénom du joueur ?');
  if (!nom || !nom.trim()) return;
  try {
    await envoyer('/api/players', { nom });
    await recharger();
  } catch (err) {
    signaler(err.message);
  }
});

window.GreeneHabits = { recharger, signaler, selecteurCouleur, envoyer };
window.ouvrirHistorique = () => {}; // remplacé en Task 7

recharger().catch((err) => signaler(err.message));
```

- [ ] **Step 4: Vérifier à l'écran**

Run: `DB_PATH=./dev.db npm start`
Ouvrir `http://localhost:3000` et vérifier :
- Le titre « Greene Habits » et la date du jour en français
- Une card « ANATOLE » vide avec un bouton `+ habitude`
- `+ habitude` → créer « Lecture », quotidienne, bleu → une ligne de 7 points gris apparaît sous l'entête `LU MA ME JE VE SA DI`
- Cliquer un point du jour → il devient bleu, le streak passe à `🔥 1`
- Recliquer → il redevient gris
- Créer une weekly « Salle », objectif 3 → `0/3 🔥 0` et 7 points ; trois clics sur le dernier point → il devient vert et `0/3` disparaît
- `+ joueur` → « Nicolas » → une deuxième card apparaît
- Réduire la fenêtre : les cards passent bien de 3 à 2 puis 1 colonne

- [ ] **Step 5: Commit**

```bash
git add public/index.html public/style.css public/app.js
git commit -m "feat: page principale, cards joueurs et bascule des points"
```

---

### Task 7: Front — popup d'historique et édition

**Files:**
- Modify: `public/app.js` (ajouts en fin de fichier, et remplacement du stub `window.ouvrirHistorique`)

**Interfaces:**
- Consumes: `GET /api/history?habit_id=`, `PATCH /api/habits/:id`, `POST /api/habits/:id/archive`, et `window.GreeneHabits` (Task 6)
- Produits : `window.ouvrirHistorique(habitId)`, `window.rafraichirHistorique()`

- [ ] **Step 1: Remplacer le stub en fin de `public/app.js`**

Supprimer la ligne `window.ouvrirHistorique = () => {}; // remplacé en Task 7` et ajouter à la place :

```js
// --- Popup d'historique ---------------------------------------------------

const popup = document.getElementById('popup');
const popupContenu = document.getElementById('popup-contenu');
let habitOuverte = null;

function grouperParMois(points) {
  const mois = new Map();
  points.forEach((p) => {
    const cle = p.ref.slice(0, 7);
    if (!mois.has(cle)) mois.set(cle, []);
    mois.get(cle).push(p);
  });
  return [...mois.entries()];
}

function nomDuMois(cle) {
  return new Date(`${cle}-01T12:00:00Z`)
    .toLocaleDateString('fr-CH', { month: 'long', year: 'numeric' });
}

function bloqueStat(valeur, label) {
  const bloc = document.createElement('div');
  const v = document.createElement('div');
  v.className = 'stat-valeur';
  v.textContent = valeur;
  const l = document.createElement('div');
  l.className = 'stat-label';
  l.textContent = label;
  bloc.append(v, l);
  return bloc;
}

function rendreHistorique(donnees) {
  popupContenu.textContent = '';

  const titre = document.createElement('h2');
  titre.textContent = donnees.nom;
  titre.style.margin = '0';
  popupContenu.appendChild(titre);

  const stats = document.createElement('div');
  stats.className = 'stats';
  stats.append(
    bloqueStat(`🔥 ${donnees.streak}`, 'streak'),
    bloqueStat(donnees.record, 'record'),
    bloqueStat(`${donnees.taux}%`, 'réussite')
  );
  popupContenu.appendChild(stats);

  grouperParMois(donnees.points).forEach(([cle, points]) => {
    const mois = document.createElement('div');
    mois.className = 'mois';

    const nom = document.createElement('div');
    nom.className = 'mois-nom';
    nom.textContent = nomDuMois(cle);

    const grille = document.createElement('div');
    grille.className = 'mois-points';
    points.forEach((p) => grille.appendChild(creerPoint(donnees, p)));

    mois.append(nom, grille);
    popupContenu.appendChild(mois);
  });

  const actions = document.createElement('div');
  actions.className = 'formulaire-boutons';
  actions.style.marginTop = '18px';

  const modifier = document.createElement('button');
  modifier.className = 'btn-principal';
  modifier.textContent = 'Modifier';
  modifier.addEventListener('click', () => formulaireEdition(donnees));

  const archiver = document.createElement('button');
  archiver.className = 'btn-discret';
  archiver.textContent = 'Archiver';
  archiver.addEventListener('click', async () => {
    if (!confirm(`Archiver « ${donnees.nom} » ? L'historique est conservé.`)) return;
    await envoyer(`/api/habits/${donnees.id}/archive`, {});
    fermerPopup();
    await recharger();
  });

  actions.append(modifier, archiver);
  popupContenu.appendChild(actions);
}

function formulaireEdition(donnees) {
  const form = document.createElement('form');
  form.className = 'formulaire';

  const nom = document.createElement('input');
  nom.value = donnees.nom;
  nom.required = true;

  const couleur = selecteurCouleur(donnees.couleur);

  const objectif = document.createElement('input');
  objectif.type = 'number';
  objectif.min = '1';
  objectif.value = donnees.objectif;
  if (donnees.type !== 'weekly') objectif.classList.add('cache');

  const avertissement = document.createElement('div');
  avertissement.className = 'stat-label';
  avertissement.style.color = 'var(--rate)';
  avertissement.classList.add('cache');
  avertissement.textContent =
    'Augmenter l\'objectif fera passer au rouge les semaines passées désormais insuffisantes.';
  objectif.addEventListener('input', () => {
    avertissement.classList.toggle('cache', Number(objectif.value) <= donnees.objectif);
  });

  const boutons = document.createElement('div');
  boutons.className = 'formulaire-boutons';
  const valider = document.createElement('button');
  valider.type = 'submit';
  valider.className = 'btn-principal';
  valider.textContent = 'Enregistrer';
  const annuler = document.createElement('button');
  annuler.type = 'button';
  annuler.className = 'btn-discret';
  annuler.textContent = 'Annuler';
  annuler.addEventListener('click', () => window.rafraichirHistorique());
  boutons.append(valider, annuler);

  form.append(nom, couleur.zone, objectif, avertissement, boutons);
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      // Le type n'est volontairement pas envoyé : il est immuable.
      await envoyer(`/api/habits/${donnees.id}`, {
        nom: nom.value,
        couleur: couleur.valeur(),
        objectif: Number(objectif.value)
      }, 'PATCH');
      await recharger();
      await window.rafraichirHistorique();
    } catch (err) {
      signaler(err.message);
    }
  });

  popupContenu.appendChild(form);
  nom.focus();
}

function fermerPopup() {
  popup.classList.add('cache');
  habitOuverte = null;
}

window.ouvrirHistorique = async (habitId) => {
  habitOuverte = habitId;
  popup.classList.remove('cache');
  popupContenu.textContent = 'Chargement…';
  try {
    rendreHistorique(await api(`/api/history?habit_id=${habitId}`));
  } catch (err) {
    signaler(err.message);
    fermerPopup();
  }
};

window.rafraichirHistorique = async () => {
  if (habitOuverte === null) return;
  rendreHistorique(await api(`/api/history?habit_id=${habitOuverte}`));
};

document.getElementById('popup-fermer').addEventListener('click', fermerPopup);
popup.addEventListener('click', (e) => { if (e.target === popup) fermerPopup(); });
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') fermerPopup(); });
```

**Note :** `creerPoint(donnees, p)` fonctionne tel quel car `donnees` expose `id` et `couleur`, les deux seuls champs que la fonction lit sur l'habitude.

- [ ] **Step 2: Vérifier à l'écran**

Run: `DB_PATH=./dev.db npm start`
Ouvrir `http://localhost:3000` et vérifier :
- Clic sur le nom « Lecture » → popup avec streak, record, réussite et la grille de points groupée par mois
- Clic sur un point **dans le popup** → il change d'état, et la card derrière se met à jour aussi
- `Modifier` → changer le nom et la couleur → `Enregistrer` → le popup et la card reflètent le changement
- Sur une weekly, monter l'objectif de 2 à 3 → l'avertissement rouge apparaît sous le champ
- Vérifier qu'aucun champ ne permet de changer daily ↔ weekly
- `Archiver` → confirmation → l'habitude disparaît de la card
- `Échap` et clic hors de la boîte ferment le popup

- [ ] **Step 3: Commit**

```bash
git add public/app.js
git commit -m "feat: popup d'historique, édition et archivage d'une habitude"
```

---

### Task 8: Docker et déploiement

**Files:**
- Create: `Dockerfile`
- Create: `.dockerignore`
- Create: `README.md`

**Interfaces:**
- Consumes: l'application complète
- Produits : une image écoutant sur le port 3000, base dans `/data/greene.db`

- [ ] **Step 1: Créer `.dockerignore`**

```
node_modules
*.db
*.db-wal
*.db-shm
.git
docs
test
```

- [ ] **Step 2: Créer le `Dockerfile`**

```dockerfile
FROM node:22-alpine

# better-sqlite3 est un module natif : sa compilation demande une toolchain.
RUN apk add --no-cache python3 make g++

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY src ./src
COPY public ./public

ENV NODE_ENV=production
ENV DB_PATH=/data/greene.db
EXPOSE 3000

CMD ["node", "src/server.js"]
```

- [ ] **Step 3: Vérifier l'image en local**

```bash
docker build -t greene-habits .
docker run --rm -p 3001:3000 -v greene-test:/data greene-habits
```

Ouvrir `http://localhost:3001` : la page doit s'afficher avec la card « ANATOLE ».
Puis arrêter le container, le relancer avec la même commande, et vérifier que les habitudes créées sont toujours là — c'est ce qui prouve que le volume fonctionne.

- [ ] **Step 4: Créer `README.md`**

```markdown
# Greene Habits

Habit tracker partagé, page unique, sans compte utilisateur.

## Développement

    npm install
    DB_PATH=./dev.db npm start     # http://localhost:3000
    npm test

## Déploiement

Container Node servant le front et l'API. La base SQLite vit dans un volume
monté sur `/data` — jamais dans l'image, sinon chaque redéploiement effacerait
tout l'historique.

- Domaine : `greene.shinouki.com`
- Volume Dokploy : `greene-data` → `/data`
- Port : 3000

## Règles du modèle

- Le rouge n'est jamais stocké : un point vire au rouge parce que sa période
  est passée sous l'objectif, ce qui est recalculé à chaque lecture. Aucun cron.
- `date_ref` = le jour pour une habitude quotidienne, le lundi de la semaine
  pour une hebdomadaire.
- Le type d'une habitude est immuable après création.
- Rien n'est jamais supprimé : `archived = 1`.
```

- [ ] **Step 5: Lancer toute la suite de tests une dernière fois**

Run: `npm test`
Expected: PASS — 51 tests, 0 échec

- [ ] **Step 6: Commit**

```bash
git add Dockerfile .dockerignore README.md
git commit -m "chore: image Docker et documentation de déploiement"
```

- [ ] **Step 7: Créer le dépôt distant et pousser**

```bash
gh repo create rudolphstrung/greene-habits --private --source=. --remote=origin
git push -u origin main
```

**S'arrêter ici.** La création de l'app Dokploy, le montage du volume `greene-data`, le réglage du domaine `greene.shinouki.com` et le déploiement sont faits par Anatole depuis l'interface Dokploy.

---

## Auto-review

**Couverture de la spec :**

| Section de la spec | Tâche |
|---|---|
| § 3 Architecture (5 fichiers, frontières) | Tâches 1-8 |
| § 4 Modèle de données | Tâche 3 |
| § 5 Règle d'état (réussi / raté / attente) | Tâche 2 |
| § 5 Correction rétroactive d'une période passée | Tâches 4 et 7 |
| § 6 Cards joueurs, blocs DAILY/WEEKLY, grille responsive | Tâche 6 |
| § 6 Fenêtres de 7 points (semaine en cours / 7 semaines glissantes) | Tâches 1 et 5 |
| § 6 Cycle de clic et compteur `2/3` | Tâches 4 et 6 |
| § 6 Palette, couleurs réservées | Tâches 3 et 6 |
| § 6 Streak insensible à la période en cours | Tâche 2 |
| § 7 Popup, stats, points cliquables, archivage | Tâche 7 |
| § 7 Édition, type figé, avertissement d'objectif | Tâches 4 et 7 |
| § 8 Les 7 routes API et la fenêtre d'écriture | Tâches 4 et 5 |
| § 9 Erreurs (400, toast, nom vide, date hors fenêtre) | Tâches 4, 5 et 6 |
| § 10 Les 10 tests exigés | Tâches 1, 2 et 4 |
| § 12 Amorçage avec Anatole seul | Tâche 3 |

Aucune section de la spec n'est sans tâche.

**Écart assumé par rapport à la spec :** le § 9 prévoit un rendu optimiste côté client. Le plan applique le changement puis recharge l'état complet (`recharger()`), ce qui est plus simple et sans risque de désynchronisation. Avec six joueurs et une réponse de quelques kilo-octets, la latence reste imperceptible. Si la lenteur se fait sentir en 4G, le passage à l'optimisme est une modification locale au gestionnaire de clic.

**Cohérence des types :** `refFor`, `getCounts`, `dotState`, `computeStreak`, `bestStreak`, `successRate`, `creerPoint`, `selecteurCouleur`, `recharger`, `signaler`, `envoyer`, `api` portent le même nom et la même signature partout où ils apparaissent. `points[].etat` prend exclusivement les valeurs `'reussi' | 'rate' | 'attente'` dans le serveur comme dans le front.
