# Intention d'implémentation + identité à la création d'habitude Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remplacer la note libre d'une habitude par 3 champs structurés — « Je vais... » (ce que je fais), « Moment/lieu » (quand/où), « pour devenir... » (l'identité visée) — remplissables à la création, éditables ensuite, et visibles au clic sur l'habitude.

**Architecture:** La colonne `note` existante change de rôle (elle porte désormais « Je vais... ») sans migration de données ; deux colonnes `TEXT NOT NULL DEFAULT ''` s'ajoutent à `habits` (`moment_lieu`, `identite`) via une migration idempotente supplémentaire dans `src/db.js`, sur le modèle des migrations déjà en place. Le serveur (`src/server.js`) expose les 2 nouveaux champs dans `statsHabit`. Le frontend vanilla JS (`public/app.js`) remplace l'unique input `note` par 3 `<textarea>` dans les 2 formulaires (création + édition) et dans l'affichage du popup historique, via un petit helper partagé `creerChampIntention`.

**Tech Stack:** Node.js ESM + `better-sqlite3` côté serveur (`node --test` pour les tests), HTML/CSS/JS vanilla côté client (aucun framework, aucun build).

## Global Constraints

- Noms de colonnes DB et de variables/fonctions JS en français, cohérent avec le reste des fichiers (`nom`, `couleur`, `objectif`, `note` existants).
- Les 2 nouvelles colonnes sont `TEXT NOT NULL DEFAULT ''` — jamais NULL, comme `note` aujourd'hui (cf. `test/db.test.js` : « une habitude sans note a une note vide, pas null »).
- Les 3 champs (note/moment_lieu/identite) sont **tous optionnels**, aucune validation de contenu (comme `note` aujourd'hui).
- Libellés utilisateur en **français** : « Je vais... », « Moment / lieu (optionnel) », « pour devenir... », placeholder « type de personne que je veux devenir (optionnel) ».
- Style visuel des 3 champs : habillage identique aux inputs de formulaire déjà en place (`--card`, `--bord`, `--texte`) — pas d'effet de focus spécial.
- Le type d'une habitude reste immuable après création (inchangé, hors scope ici).
- Pas de suite de tests automatisés frontend dans ce projet (`npm test` ne couvre que `src/` côté serveur via `node --test`) — les tâches touchant `public/` se vérifient manuellement avec `npm start`.
- Commits en français, style impératif court, préfixe conventionnel (`feat:`, déjà utilisé dans l'historique du projet).

---

## Fichiers concernés

- Modifier : `src/db.js` — schéma, nouvelle migration, `createHabit`, `updateHabit`, `getHabit`/`getHabits`/`getAllHabits`.
- Modifier : `test/db.test.js` — tests des 2 nouvelles colonnes et de la migration.
- Modifier : `src/server.js` — `statsHabit` expose `moment_lieu` et `identite`.
- Modifier : `test/api.test.js` — tests bout-en-bout création/édition avec les 2 nouveaux champs.
- Modifier : `public/app.js` — `formulaireHabitude`, `formulaireEdition`, `rendreHistorique`, nouveau helper `creerChampIntention`, nouveau helper `creerBlocIntention`.
- Modifier : `public/style.css` — style des nouvelles `textarea` de formulaire + label des champs.

---

### Task 1 : Colonnes `moment_lieu` / `identite` sur `habits` (migration + CRUD)

**Files:**
- Modify: `src/db.js:53-84` (SCHEMA), `src/db.js:103-118` (zone des migrations), `src/db.js:139-160` (`openDb`), `src/db.js:168-183` (`getHabits`/`getAllHabits`), `src/db.js:206-237` (`createHabit`/`getHabit`), `src/db.js:239-259` (`updateHabit`)
- Test: `test/db.test.js`

**Interfaces:**
- Consomme : `todayISO()` (déjà importé dans `src/db.js` depuis `./dates.js`).
- Produit : `createHabit(db, { player_id, nom, type, couleur, objectif, note, moment_lieu, identite })` → objet habitude incluant désormais `moment_lieu` et `identite` (chaînes, jamais `undefined`/`null`). `updateHabit(db, id, { nom, couleur, objectif, note, moment_lieu, identite })` → même forme étendue. `getHabit`/`getHabits`/`getAllHabits` renvoient chaque ligne avec `moment_lieu` et `identite` en plus des colonnes déjà présentes. Ces noms de champs sont utilisés tels quels par la Task 2.

- [ ] **Step 1 : Écrire les tests qui échouent**

Ajoute ces tests à `test/db.test.js`, à la suite des tests existants sur la note (juste après le test `'updateHabit modifie la note'`, ligne ~172) :

```js
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
```

- [ ] **Step 2 : Lancer les tests pour vérifier qu'ils échouent**

Depuis la racine du projet (`4 ARCHIVES/Z projets réussis/Greene Habits/`) :

```bash
npm test
```

Attendu : les 4 nouveaux tests échouent (`h.moment_lieu` est `undefined`, colonnes absentes).

- [ ] **Step 3 : Ajouter les colonnes au schéma des nouvelles bases**

Dans `src/db.js`, le bloc `SCHEMA` (lignes 53-84), la table `habits` actuelle se termine par :

```js
    note        TEXT NOT NULL DEFAULT '',
    archived_at TEXT
  );
```

Remplace par :

```js
    note        TEXT NOT NULL DEFAULT '',
    archived_at TEXT,
    moment_lieu TEXT NOT NULL DEFAULT '',
    identite    TEXT NOT NULL DEFAULT ''
  );
```

- [ ] **Step 4 : Ajouter la migration pour les bases existantes**

Toujours dans `src/db.js`, juste après la fonction `migrerColonneCouleurJoueurs` (qui se termine ligne ~137, juste avant `export function openDb`), ajoute :

```js
// Migration pour les bases créées avant l'ajout de `moment_lieu` et
// `identite` sur habits (cadre « intention d'implémentation + identité » :
// Je vais... / Moment-lieu / pour devenir...). Idempotente : ne touche à
// rien si les colonnes existent déjà. `note` n'est pas renommée : elle
// change seulement de rôle dans l'UI, aucune donnée n'est perdue.
function migrerColonnesIntention(db) {
  const colonnes = db.prepare('PRAGMA table_info(habits)').all().map((c) => c.name);
  if (!colonnes.includes('moment_lieu')) {
    db.exec("ALTER TABLE habits ADD COLUMN moment_lieu TEXT NOT NULL DEFAULT ''");
  }
  if (!colonnes.includes('identite')) {
    db.exec("ALTER TABLE habits ADD COLUMN identite TEXT NOT NULL DEFAULT ''");
  }
}
```

- [ ] **Step 5 : Appeler la migration depuis `openDb`**

Dans `src/db.js`, fonction `openDb` (ligne ~139), la séquence actuelle est :

```js
  migrerObjectifEntries(db);
  migrerColonnesHabits(db);
  migrerColonneCouleurJoueurs(db);
```

Remplace par :

```js
  migrerObjectifEntries(db);
  migrerColonnesHabits(db);
  migrerColonneCouleurJoueurs(db);
  migrerColonnesIntention(db);
```

- [ ] **Step 6 : Étendre les `SELECT` de lecture**

Dans `src/db.js`, les 3 fonctions suivantes sélectionnent explicitement les colonnes de `habits`. Ajoute `moment_lieu, identite` à la liste dans chacune :

`getHabits` (ligne ~168) :
```js
export function getHabits(db) {
  return db.prepare(
    `SELECT id, player_id, nom, type, couleur, objectif, created_at, archived, archived_at, note, moment_lieu, identite
     FROM habits WHERE archived = 0 ORDER BY id`
  ).all();
}
```

`getAllHabits` (ligne ~178) :
```js
export function getAllHabits(db) {
  return db.prepare(
    `SELECT id, player_id, nom, type, couleur, objectif, created_at, archived, archived_at, note, moment_lieu, identite
     FROM habits ORDER BY id`
  ).all();
}
```

`getHabit` (ligne ~232) :
```js
export function getHabit(db, id) {
  return db.prepare(
    `SELECT id, player_id, nom, type, couleur, objectif, created_at, archived, archived_at, note, moment_lieu, identite
     FROM habits WHERE id = ?`
  ).get(id);
}
```

- [ ] **Step 7 : Écrire les 2 nouveaux champs dans `createHabit`**

Dans `src/db.js`, `createHabit` (ligne ~206) est actuellement :

```js
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
```

Remplace par :

```js
export function createHabit(db, { player_id, nom, type, couleur, objectif, note, moment_lieu, identite }) {
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
  const momentLieuFinal = String(moment_lieu ?? '').trim();
  const identiteFinale = String(identite ?? '').trim();

  const { lastInsertRowid } = db.prepare(
    `INSERT INTO habits (player_id, nom, type, couleur, objectif, created_at, note, moment_lieu, identite)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(player_id, propre, type, couleur, cible, todayISO(), noteFinale, momentLieuFinal, identiteFinale);

  return getHabit(db, lastInsertRowid);
}
```

- [ ] **Step 8 : Écrire les 2 nouveaux champs dans `updateHabit`**

Dans `src/db.js`, `updateHabit` (ligne ~239) est actuellement :

```js
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
```

Remplace par :

```js
export function updateHabit(db, id, { nom, couleur, objectif, note, moment_lieu, identite }) {
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
  const momentLieuFinal = String(moment_lieu ?? '').trim();
  const identiteFinale = String(identite ?? '').trim();

  db.prepare('UPDATE habits SET nom = ?, couleur = ?, objectif = ?, note = ?, moment_lieu = ?, identite = ? WHERE id = ?')
    .run(propre, couleur, cible, noteFinale, momentLieuFinal, identiteFinale, id);
  return getHabit(db, id);
}
```

- [ ] **Step 9 : Lancer les tests pour vérifier qu'ils passent**

```bash
npm test
```

Attendu : tous les tests passent (les 4 nouveaux + les 90 existants, aucune régression — en particulier les tests `'createHabit force l\'objectif à 1 pour une daily'` et `'updateHabit ignore toute tentative de changer le type'`, qui appellent `createHabit`/`updateHabit` sans `moment_lieu`/`identite` et doivent continuer à fonctionner grâce à `?? ''`).

- [ ] **Step 10 : Commit**

```bash
git add src/db.js test/db.test.js
git commit -m "feat: ajoute moment_lieu et identite sur habits (migration + CRUD)"
```

---

### Task 2 : Le serveur expose `moment_lieu` et `identite`

**Files:**
- Modify: `src/server.js:175-193` (`statsHabit`)
- Test: `test/api.test.js`

**Interfaces:**
- Consomme : `habit.moment_lieu`, `habit.identite` (produits par Task 1 — présents sur tout objet renvoyé par `getHabit`/`getHabits`/`getAllHabits`).
- Produit : `statsHabit(habit, entries, aujourdhui)` renvoie désormais un objet incluant `moment_lieu` et `identite` (chaînes), en plus des champs déjà présents (`note` compris). Cette fonction alimente `/api/history` et `/api/profile` — consommée telle quelle par les Tasks 4 et 5.

- [ ] **Step 1 : Écrire les tests qui échouent**

Ajoute ces tests à `test/api.test.js`, juste après le test existant `'la note est enregistrée à la création et rendue par history'` (ligne ~509) :

```js
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
```

- [ ] **Step 2 : Lancer les tests pour vérifier qu'ils échouent**

```bash
npm test
```

Attendu : les 2 nouveaux tests échouent (`corps.moment_lieu` est `undefined`).

- [ ] **Step 3 : Étendre `statsHabit`**

Dans `src/server.js`, `statsHabit` (ligne ~175) est actuellement :

```js
function statsHabit(habit, entries, aujourdhui) {
  const refs = toutesLesRefs(habit, aujourdhui);
  const refCourante = refFor(habit, aujourdhui);
  const reussites = reussitesPourStats(habit, entries, refs, refCourante);

  return {
    id: habit.id,
    nom: habit.nom,
    type: habit.type,
    couleur: habit.couleur,
    objectif: habit.objectif,
    note: habit.note,
    archived_at: habit.archived_at,
    streak: computeStreak(reussites),
    record: bestStreak(reussites),
    taux: successRate(reussites),
    trahisonsMois: trahisonsDeLHabitude(habit, entries, aujourdhui)
  };
}
```

Remplace par :

```js
function statsHabit(habit, entries, aujourdhui) {
  const refs = toutesLesRefs(habit, aujourdhui);
  const refCourante = refFor(habit, aujourdhui);
  const reussites = reussitesPourStats(habit, entries, refs, refCourante);

  return {
    id: habit.id,
    nom: habit.nom,
    type: habit.type,
    couleur: habit.couleur,
    objectif: habit.objectif,
    note: habit.note,
    moment_lieu: habit.moment_lieu,
    identite: habit.identite,
    archived_at: habit.archived_at,
    streak: computeStreak(reussites),
    record: bestStreak(reussites),
    taux: successRate(reussites),
    trahisonsMois: trahisonsDeLHabitude(habit, entries, aujourdhui)
  };
}
```

- [ ] **Step 4 : Lancer les tests pour vérifier qu'ils passent**

```bash
npm test
```

Attendu : tous les tests passent (les 2 nouveaux + les 94 précédents).

- [ ] **Step 5 : Commit**

```bash
git add src/server.js test/api.test.js
git commit -m "feat: expose moment_lieu et identite dans l'historique/profil"
```

---

### Task 3 : Formulaire de création — 3 champs remplacent la note

**Files:**
- Modify: `public/app.js:409-431` (zone juste avant `formulaireHabitude`, pour le nouveau helper), `public/app.js:433-496` (`formulaireHabitude`)
- Modify: `public/style.css:344-352` (`.formulaire input, .formulaire select`)

**Interfaces:**
- Consomme : `selecteurCouleur(initiale)` (existant, inchangé), `envoyer(chemin, donnees, methode)` (existant, inchangé).
- Produit : `creerChampIntention(labelTexte, placeholder, valeurInitiale = '')` → `{ conteneur: HTMLElement, champ: HTMLTextAreaElement }`. `labelTexte` peut être `null` (pas de label affiché, cas du champ moment/lieu). Réutilisé tel quel par la Task 4.

- [ ] **Step 1 : Ajouter le helper `creerChampIntention`**

Dans `public/app.js`, juste après la fonction `selecteurCouleur` (qui se termine ligne ~431, juste avant `function formulaireHabitude`), ajoute :

```js
// Un champ du cadre "intention d'implémentation + identité" (Je vais... /
// Moment-lieu / pour devenir...) : une textarea, avec un label optionnel
// au-dessus (le champ moment/lieu n'en a pas). Réutilisé par le formulaire
// de création ET celui d'édition.
function creerChampIntention(labelTexte, placeholder, valeurInitiale = '') {
  const conteneur = document.createElement('div');
  conteneur.className = 'champ-intention';

  if (labelTexte) {
    const label = document.createElement('div');
    label.className = 'champ-intention-label';
    label.textContent = labelTexte;
    conteneur.appendChild(label);
  }

  const champ = document.createElement('textarea');
  champ.placeholder = placeholder;
  champ.value = valeurInitiale;
  conteneur.appendChild(champ);

  return { conteneur, champ };
}
```

- [ ] **Step 2 : Remplacer l'input `note` par les 3 champs dans `formulaireHabitude`**

Dans `public/app.js`, `formulaireHabitude` (ligne ~433) contient actuellement :

```js
  const note = document.createElement('input');
  note.placeholder = 'Note — à quoi t\'engages-tu ? (optionnel)';

  const couleur = selecteurCouleur();
```

Remplace par :

```js
  const intentionNote = creerChampIntention('Je vais...', 'méditer 10 minutes chaque matin');
  const intentionMomentLieu = creerChampIntention(null, 'Moment / lieu (optionnel)');
  const intentionIdentite = creerChampIntention('pour devenir...', 'type de personne que je veux devenir (optionnel)');

  const couleur = selecteurCouleur();
```

Puis, un peu plus bas dans la même fonction, remplace :

```js
  form.append(nom, type, objectif, note, couleur.zone, boutons);
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      await envoyer('/api/habits', {
        player_id: playerId,
        nom: nom.value,
        type: type.value,
        couleur: couleur.valeur(),
        objectif: Number(objectif.value),
        note: note.value
      });
      await recharger();
    } catch (err) {
      signaler(err.message);
    }
  });
```

par :

```js
  form.append(
    nom, type, objectif,
    intentionNote.conteneur, intentionMomentLieu.conteneur, intentionIdentite.conteneur,
    couleur.zone, boutons
  );
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      await envoyer('/api/habits', {
        player_id: playerId,
        nom: nom.value,
        type: type.value,
        couleur: couleur.valeur(),
        objectif: Number(objectif.value),
        note: intentionNote.champ.value,
        moment_lieu: intentionMomentLieu.champ.value,
        identite: intentionIdentite.champ.value
      });
      await recharger();
    } catch (err) {
      signaler(err.message);
    }
  });
```

- [ ] **Step 3 : Ajouter le style des nouvelles textarea**

Dans `public/style.css`, la règle actuelle (ligne ~344) est :

```css
.formulaire input, .formulaire select {
  padding: 8px 10px;
  background: var(--card);
  border: 1px solid var(--bord);
  border-radius: 8px;
  color: var(--texte);
  font: inherit;
  font-size: 13px;
}
```

Remplace par (ajoute `textarea` à la liste + règles dédiées) :

```css
.formulaire input, .formulaire select, .formulaire textarea {
  padding: 8px 10px;
  background: var(--card);
  border: 1px solid var(--bord);
  border-radius: 8px;
  color: var(--texte);
  font: inherit;
  font-size: 13px;
}
.formulaire textarea {
  min-height: 44px;
  resize: vertical;
}
.champ-intention { display: grid; gap: 4px; }
.champ-intention-label {
  font-size: 11px;
  font-weight: 600;
  color: var(--doux);
}
```

- [ ] **Step 4 : Vérification manuelle**

```bash
npm start
```

Ouvre `http://localhost:3000`, clique « + habitude » sur une carte joueur, et vérifie que :
- 3 zones de texte apparaissent à la place de l'ancien champ note, dans l'ordre : « Je vais... » (avec label), champ moment/lieu (sans label, placeholder visible), « pour devenir... » (avec label).
- Les 3 sont vides par défaut, redimensionnables verticalement, remplissables sur plusieurs lignes.
- Crée une habitude en remplissant les 3 champs → aucune erreur, l'habitude apparaît normalement sur la carte avec son nom court habituel (pas la phrase "Je vais...").
- Crée une deuxième habitude en laissant les 3 champs vides → aucune erreur (ils sont bien optionnels).

- [ ] **Step 5 : Commit**

```bash
git add public/app.js public/style.css
git commit -m "feat: formulaire de création — 3 champs intention/identité remplacent la note"
```

---

### Task 4 : Formulaire d'édition — mêmes 3 champs, pré-remplis

**Files:**
- Modify: `public/app.js:677-731` (`formulaireEdition`)

**Interfaces:**
- Consomme : `creerChampIntention(labelTexte, placeholder, valeurInitiale)` (produit par Task 3), `donnees.note`, `donnees.moment_lieu`, `donnees.identite` (produits par Task 2 via `/api/history`).

- [ ] **Step 1 : Remplacer l'input `note` par les 3 champs pré-remplis**

Dans `public/app.js`, `formulaireEdition` (ligne ~677) contient actuellement :

```js
  const note = document.createElement('input');
  note.placeholder = 'Note — à quoi t\'engages-tu ? (optionnel)';
  note.value = donnees.note || '';
```

Remplace par :

```js
  const intentionNote = creerChampIntention('Je vais...', 'méditer 10 minutes chaque matin', donnees.note || '');
  const intentionMomentLieu = creerChampIntention(null, 'Moment / lieu (optionnel)', donnees.moment_lieu || '');
  const intentionIdentite = creerChampIntention('pour devenir...', 'type de personne que je veux devenir (optionnel)', donnees.identite || '');
```

Puis, un peu plus bas dans la même fonction, remplace :

```js
  form.append(nom, couleur.zone, objectif, note, boutons);
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      // Le type n'est volontairement pas envoyé : il est immuable.
      await envoyer(`/api/habits/${donnees.id}`, {
        nom: nom.value,
        couleur: couleur.valeur(),
        objectif: Number(objectif.value),
        note: note.value
      }, 'PATCH');
      await recharger();
      await window.rafraichirHistorique();
    } catch (err) {
      signaler(err.message);
    }
  });
```

par :

```js
  form.append(
    nom, couleur.zone, objectif,
    intentionNote.conteneur, intentionMomentLieu.conteneur, intentionIdentite.conteneur,
    boutons
  );
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      // Le type n'est volontairement pas envoyé : il est immuable.
      await envoyer(`/api/habits/${donnees.id}`, {
        nom: nom.value,
        couleur: couleur.valeur(),
        objectif: Number(objectif.value),
        note: intentionNote.champ.value,
        moment_lieu: intentionMomentLieu.champ.value,
        identite: intentionIdentite.champ.value
      }, 'PATCH');
      await recharger();
      await window.rafraichirHistorique();
    } catch (err) {
      signaler(err.message);
    }
  });
```

- [ ] **Step 2 : Vérification manuelle**

```bash
npm start
```

Ouvre `http://localhost:3000`, clique sur le nom d'une habitude existante (ayant déjà une note) pour ouvrir le popup historique, puis clique « Modifier ». Vérifie que :
- Le champ « Je vais... » est pré-rempli avec l'ancienne note.
- Les champs moment/lieu et identité sont vides (habitude créée avant cette fonctionnalité).
- Modifie les 3 champs, clique « Enregistrer » → aucune erreur, le popup se met à jour.
- Rouvre « Modifier » sur la même habitude → les 3 valeurs enregistrées sont bien reprises.

- [ ] **Step 3 : Commit**

```bash
git add public/app.js
git commit -m "feat: formulaire d'édition — 3 champs intention/identité éditables"
```

---

### Task 5 : Affichage du popup historique

**Files:**
- Modify: `public/app.js:563-597` (zone `bloqueStat` / bloc `.note` dans `rendreHistorique`)

**Interfaces:**
- Consomme : `donnees.note`, `donnees.moment_lieu`, `donnees.identite` (produits par Task 2 via `/api/history`).
- Produit : `creerBlocIntention(donnees)` → `HTMLElement | null` (utilisé uniquement en interne par `rendreHistorique`).

- [ ] **Step 1 : Ajouter le helper `creerBlocIntention`**

Dans `public/app.js`, juste après la fonction `bloqueStat` (qui se termine ligne ~573, juste avant `function rendreHistorique`), ajoute :

```js
// Bloc "Je vais... / Moment-lieu / pour devenir..." affiché sous le titre
// dans le popup historique — null si les 3 champs sont vides (rien à montrer).
function creerBlocIntention(donnees) {
  const lignes = [];
  if (donnees.note) lignes.push(`Je vais... ${donnees.note}`);
  if (donnees.moment_lieu) lignes.push(`Moment/lieu : ${donnees.moment_lieu}`);
  if (donnees.identite) lignes.push(`pour devenir... ${donnees.identite}`);
  if (lignes.length === 0) return null;

  const bloc = document.createElement('div');
  bloc.className = 'note';
  lignes.forEach((texte) => {
    const ligne = document.createElement('div');
    ligne.textContent = texte;
    bloc.appendChild(ligne);
  });
  return bloc;
}
```

- [ ] **Step 2 : Remplacer le bloc `.note` dans `rendreHistorique`**

Dans `public/app.js`, `rendreHistorique` contient actuellement (juste après le titre) :

```js
  if (donnees.note) {
    const note = document.createElement('div');
    note.className = 'note';
    note.textContent = donnees.note;
    popupContenu.appendChild(note);
  }
```

Remplace par :

```js
  const blocIntention = creerBlocIntention(donnees);
  if (blocIntention) popupContenu.appendChild(blocIntention);
```

- [ ] **Step 3 : Vérification manuelle**

```bash
npm start
```

Ouvre `http://localhost:3000` et vérifie que :
- Une habitude avec les 3 champs remplis affiche, en cliquant sur son nom, un bloc avec 3 lignes : « Je vais... {texte} », « Moment/lieu : {texte} », « pour devenir... {texte} », dans cet ordre, avant les statistiques (streak/record/taux).
- Une habitude avec seulement « Je vais... » rempli n'affiche qu'une ligne (pas de lignes vides pour moment/lieu ou identité).
- Une habitude sans aucun des 3 champs n'affiche aucun bloc du tout (comportement identique à l'actuel quand la note est vide).
- Le popup profil (clic sur le nom du joueur) n'est pas affecté — il continue de fonctionner normalement.

- [ ] **Step 4 : Commit**

```bash
git add public/app.js
git commit -m "feat: popup historique affiche Je vais/Moment-lieu/pour devenir"
```
