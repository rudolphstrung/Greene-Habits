# Greene Habits v2 — Leaderboard, profils, notes

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Ajouter 5 fonctionnalités demandées par Anatole : leaderboard mensuel des trahisons, note explicative par habitude, popup profil joueur, suppression d'une habitude depuis l'accueil, et une palette élargie.

**Architecture:** Aucune rupture. On étend le schéma (`habits.note`, `habits.archived_at`), on ajoute deux calculs serveur (leaderboard, profil) et deux popups front. Les invariants existants ne bougent pas.

**Tech Stack:** inchangée — Node 22 ESM, better-sqlite3, HTML/CSS/JS pur.

## Global Constraints

- **Rien n'est jamais supprimé** — « supprimer » = `archived = 1`. Une habitude archivée reste visible dans le profil et son historique reste consultable.
- **Une trahison = une période passée non atteinte**, qu'elle soit un jour (habitude quotidienne) ou une semaine (hebdomadaire). Les deux pèsent `1`.
- **Supprimer une habitude n'efface pas ses trahisons du mois** — mais le décompte **s'arrête à la date d'archivage** (`archived_at`). Une habitude supprimée n'accumule plus de trahisons après sa suppression.
- **La période de création n'est jamais une trahison** (règle existante : elle est partielle).
- **La période en cours n'est jamais une trahison** (elle n'est pas encore passée).
- **Mois = mois calendaire en cours**, du 1er à hier. Une semaine appartient au mois de son **lundi**.
- Titre exact du leaderboard : **« Qui a le plus trahi ses paroles ? »** — le moins de trahisons en haut.
- Rouge `#EF4444` et gris `#2A2A2E` restent réservés, jamais assignables.
- Interface en français. Aucune dépendance front.

---

## Fichiers

| Fichier | Changement |
|---|---|
| `src/dates.js` | + `firstOfMonth(dateISO)` |
| `src/db.js` | + colonnes `note`, `archived_at` + migrations · `getAllHabits` · note dans create/update · `archiveHabit` date · palette élargie |
| `src/server.js` | + calcul leaderboard · route `/api/profile` · `note` dans les payloads |
| `public/index.html` | + conteneur leaderboard |
| `public/style.css` | + styles leaderboard, note, profil, bouton supprimer |
| `public/app.js` | + rendu leaderboard · champ note · popup profil · bouton supprimer |

---

### Task 1: Schéma — note, archived_at, palette

**Files:** Modify `src/dates.js`, `src/db.js`, `test/db.test.js`, `test/dates.test.js`

**Interfaces produites :**
- `firstOfMonth(dateISO): string` — `'2026-07-20'` → `'2026-07-01'`
- `getAllHabits(db)` → toutes les habitudes, archivées comprises, avec `archived` et `archived_at`
- `createHabit(db, {..., note})` / `updateHabit(db, id, {nom, couleur, objectif, note})`
- `archiveHabit(db, id)` pose `archived = 1` **et** `archived_at = todayISO()`
- `COULEURS` : 12 couleurs

- [ ] **Step 1 : tests d'abord**

`test/dates.test.js` :
```js
test('firstOfMonth ramène au 1er du mois', () => {
  assert.equal(firstOfMonth('2026-07-20'), '2026-07-01');
  assert.equal(firstOfMonth('2026-01-01'), '2026-01-01');
});
```

`test/db.test.js` :
```js
test('la palette contient 12 couleurs, sans le rouge ni le gris réservés', () => {
  assert.equal(COULEURS.length, 12);
  assert.ok(!COULEURS.includes('#EF4444'));
  assert.ok(!COULEURS.includes('#2A2A2E'));
  assert.equal(new Set(COULEURS).size, 12); // toutes distinctes
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
```

- [ ] **Step 2 : lancer, vérifier l'échec** — `npm test`

- [ ] **Step 3 : implémenter**

`src/dates.js` :
```js
export function firstOfMonth(dateISO) {
  return `${dateISO.slice(0, 7)}-01`;
}
```

`src/db.js` — palette portée à 12 (aucune proche du rouge réservé) :
```js
export const COULEURS = [
  '#4C6FFF', // bleu
  '#A855F7', // violet
  '#22D3EE', // cyan
  '#22C55E', // vert
  '#F59E0B', // ambre
  '#84CC16', // lime
  '#EC4899', // rose
  '#14B8A6', // turquoise
  '#8B5CF6', // indigo
  '#F5D0FE', // lilas clair
  '#38BDF8', // ciel
  '#FDE047'  // jaune
];
```

Schéma : ajouter `note TEXT NOT NULL DEFAULT ''` et `archived_at TEXT` à `habits`.

Migration (même forme que `migrerObjectifEntries`, idempotente, à appeler depuis `openDb`) :
```js
function migrerColonnesHabits(db) {
  const colonnes = db.prepare('PRAGMA table_info(habits)').all().map((c) => c.name);
  if (!colonnes.includes('note')) {
    db.exec("ALTER TABLE habits ADD COLUMN note TEXT NOT NULL DEFAULT ''");
  }
  if (!colonnes.includes('archived_at')) {
    db.exec('ALTER TABLE habits ADD COLUMN archived_at TEXT');
  }
  // Une habitude déjà archivée avant l'ajout de la colonne n'a pas de date :
  // on la date d'aujourd'hui, faute de mieux, pour figer son décompte.
  db.exec(
    `UPDATE habits SET archived_at = ? WHERE archived = 1 AND archived_at IS NULL`
  ).run?.(todayISO());
}
```
⚠️ `db.exec` ne prend pas de paramètre lié — utiliser `db.prepare(...).run(todayISO())` pour cette dernière requête.

`createHabit` accepte `note` (chaîne, `''` par défaut, `.trim()`), `updateHabit` aussi.
`archiveHabit` : `UPDATE habits SET archived = 1, archived_at = ? WHERE id = ?`, conserve le throw si `changes === 0`.
`getHabit` / `getHabits` / `getAllHabits` doivent renvoyer `note`, `archived`, `archived_at`.

- [ ] **Step 4 : `npm test` — tout passe**
- [ ] **Step 5 : commit** `feat: note et date d'archivage sur les habitudes, palette à 12 couleurs`

---

### Task 2: Leaderboard mensuel + API profil

**Files:** Modify `src/server.js`, `test/api.test.js`

**Interfaces produites :**
- `GET /api/state` gagne `mois` (libellé, ex. `"juillet 2026"`) et `leaderboard: [{ player_id, nom, trahisons }]` trié par trahisons croissantes puis nom
- `GET /api/profile?player_id=` → `{ id, nom, actives: [...], archivees: [...] }`, chaque habitude portant `{ id, nom, type, couleur, objectif, note, archived_at, streak, record, taux, trahisonsMois }`
- `POST /api/habits` et `PATCH /api/habits/:id` acceptent `note`
- `GET /api/history` renvoie `note` et fonctionne aussi pour une habitude archivée

- [ ] **Step 1 : tests d'abord**

```js
test('le leaderboard classe le moins trahi en premier', async () => {
  const s = await demarrer();
  await s.json('/api/players', s.post('/api/players', { nom: 'Nicolas' }));
  // Anatole : habitude quotidienne créée il y a 5 jours, aucun jour validé
  await s.json('/api/habits', s.post('/api/habits', {
    player_id: 1, nom: 'Lecture', type: 'daily', couleur: '#4C6FFF', objectif: 1
  }));
  s.db.prepare('UPDATE habits SET created_at = ? WHERE id = 1')
    .run(addDays(todayISO(), -5));
  const { corps } = await s.json('/api/state');
  const rang = corps.leaderboard.map((l) => l.nom);
  assert.equal(rang[0], 'Nicolas');           // 0 trahison
  assert.equal(rang[1], 'Anatole');           // des jours ratés
  assert.ok(corps.leaderboard[1].trahisons > 0);
  assert.equal(corps.leaderboard[0].trahisons, 0);
  await s.fermer();
});

test('la période en cours et la période de création ne sont pas des trahisons', async () => {
  const s = await demarrer();
  await s.json('/api/habits', s.post('/api/habits', {
    player_id: 1, nom: 'Lecture', type: 'daily', couleur: '#4C6FFF', objectif: 1
  }));
  // créée aujourd'hui, rien coché : ni la création ni le jour courant ne comptent
  const { corps } = await s.json('/api/state');
  assert.equal(corps.leaderboard.find((l) => l.nom === 'Anatole').trahisons, 0);
  await s.fermer();
});

test('une habitude archivée garde ses trahisons mais n en accumule plus', async () => {
  const s = await demarrer();
  await s.json('/api/habits', s.post('/api/habits', {
    player_id: 1, nom: 'Lecture', type: 'daily', couleur: '#4C6FFF', objectif: 1
  }));
  s.db.prepare('UPDATE habits SET created_at = ? WHERE id = 1')
    .run(addDays(todayISO(), -10));
  const avant = (await s.json('/api/state')).corps.leaderboard[0].trahisons;
  // archivée à J-5 : les 5 derniers jours ne doivent plus compter
  s.db.prepare('UPDATE habits SET archived = 1, archived_at = ? WHERE id = 1')
    .run(addDays(todayISO(), -5));
  const apres = (await s.json('/api/state')).corps.leaderboard[0].trahisons;
  assert.ok(apres > 0, 'les trahisons passées restent comptées');
  assert.ok(apres < avant, 'plus rien ne s accumule après archivage');
  await s.fermer();
});

test('la note est enregistrée à la création et rendue par history', async () => {
  const s = await demarrer();
  await s.json('/api/habits', s.post('/api/habits', {
    player_id: 1, nom: 'Lecture', type: 'daily', couleur: '#4C6FFF',
    objectif: 1, note: '10 pages avant de dormir'
  }));
  const { corps } = await s.json('/api/history?habit_id=1');
  assert.equal(corps.note, '10 pages avant de dormir');
  await s.fermer();
});

test('le profil rend les habitudes actives et archivées séparément', async () => {
  const s = await demarrer();
  await s.json('/api/habits', s.post('/api/habits', {
    player_id: 1, nom: 'Active', type: 'daily', couleur: '#4C6FFF', objectif: 1
  }));
  await s.json('/api/habits', s.post('/api/habits', {
    player_id: 1, nom: 'Ancienne', type: 'daily', couleur: '#22C55E', objectif: 1
  }));
  await s.json('/api/habits/2/archive', s.post('/api/habits/2/archive', {}));
  const { statut, corps } = await s.json('/api/profile?player_id=1');
  assert.equal(statut, 200);
  assert.equal(corps.nom, 'Anatole');
  assert.deepEqual(corps.actives.map((h) => h.nom), ['Active']);
  assert.deepEqual(corps.archivees.map((h) => h.nom), ['Ancienne']);
  await s.fermer();
});

test('history fonctionne sur une habitude archivée', async () => {
  const s = await demarrer();
  await s.json('/api/habits', s.post('/api/habits', {
    player_id: 1, nom: 'Ancienne', type: 'daily', couleur: '#4C6FFF', objectif: 1
  }));
  await s.json('/api/habits/1/archive', s.post('/api/habits/1/archive', {}));
  const { statut, corps } = await s.json('/api/history?habit_id=1');
  assert.equal(statut, 200);
  assert.equal(corps.nom, 'Ancienne');
  await s.fermer();
});

test('profil d un joueur inexistant rend 404', async () => {
  const s = await demarrer();
  const { statut } = await s.json('/api/profile?player_id=999');
  assert.equal(statut, 404);
  await s.fermer();
});
```

Le helper `demarrer()` doit exposer `db` (il l'expose déjà depuis le fix précédent — vérifier).

- [ ] **Step 2 : lancer, vérifier l'échec**

- [ ] **Step 3 : implémenter dans `src/server.js`**

```js
// Une trahison = une période PASSÉE, dans le mois calendaire en cours, que
// l'habitude n'a pas atteinte. La période de création (partielle) et la
// période en cours n'en sont jamais. Une habitude archivée cesse d'accumuler
// des trahisons à sa date d'archivage, mais garde celles d'avant.
function trahisonsDeLHabitude(habit, entries, aujourdhui) {
  const debutMois = firstOfMonth(aujourdhui);
  const refCourante = refFor(habit, aujourdhui);
  const refCreation = refFor(habit, habit.created_at);
  const refFin = habit.archived_at ? refFor(habit, habit.archived_at) : refCourante;

  return toutesLesRefs(habit, aujourdhui).filter((ref) => {
    if (ref < debutMois) return false;        // hors du mois en cours
    if (ref >= refCourante) return false;     // période en cours ou future
    if (ref > refFin) return false;           // après l'archivage
    if (ref === refCreation) return false;    // période de création, partielle
    return !estReussi(habit, entries, ref, refCourante);
  }).length;
}

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

Libellé du mois : `new Date(\`${aujourdhui}T12:00:00Z\`).toLocaleDateString('fr-CH', { month: 'long', year: 'numeric' })`.

`construireEtat` renvoie en plus `mois` et `leaderboard`.

Route profil :
```js
if (req.method === 'GET' && chemin === '/api/profile') {
  const profil = construireProfil(db, Number(url.searchParams.get('player_id')));
  return profil ? envoyerJson(res, 200, profil)
                : envoyerJson(res, 404, { erreur: 'Joueur introuvable' });
}
```
`construireProfil` réutilise `construireHistorique` pour les stats de chaque habitude (ou en extrait la partie stats) et sépare `actives` / `archivees` selon `archived`.

`construireHistorique` doit renvoyer `note` et `archived_at`.
`POST /api/habits` et `PATCH /api/habits/:id` passent `note` à la couche db.

- [ ] **Step 4 : `npm test`**
- [ ] **Step 5 : commit** `feat: leaderboard mensuel des trahisons + API profil joueur`

---

### Task 3: Front — leaderboard, note, palette

**Files:** Modify `public/index.html`, `public/style.css`, `public/app.js`

- [ ] **Step 1 : conteneur dans `index.html`**, entre `<header>` et `<main>` :
```html
<section id="leaderboard" class="leaderboard cache"></section>
```

- [ ] **Step 2 : rendu du leaderboard dans `app.js`**

Titre exact : `Qui a le plus trahi ses paroles ?`, sous-titre = `etat.mois`.
Une ligne par joueur : rang, nom, nombre de trahisons. Le premier (le moins de trahisons) est mis en avant ; le dernier est discrètement marqué. Si tous les joueurs sont à 0, afficher une ligne neutre du type « Personne n'a encore trahi ce mois-ci. » plutôt qu'un podium vide.
Construire en `textContent` uniquement (jamais `innerHTML`) — les noms sont saisis par les utilisateurs.

- [ ] **Step 3 : champ note dans le formulaire de création**

Dans `formulaireHabitude` : ajouter un `<input>` (ou `<textarea>` une ligne) `placeholder="Note — à quoi t'engages-tu ? (optionnel)"`, envoyé dans le POST. Idem dans `formulaireEdition` (pré-rempli avec `donnees.note`).

- [ ] **Step 4 : affichage de la note dans le popup d'habitude**

Dans `rendreHistorique`, sous le titre : si `donnees.note` est non vide, l'afficher dans un bloc discret (`.note`). Ne rien afficher si vide.

- [ ] **Step 5 : styles** — `.leaderboard`, `.leaderboard-ligne`, `.leaderboard-rang`, `.note`. Sobre, cohérent avec le thème sombre existant. Le sélecteur de couleurs doit rester lisible avec 12 pastilles (passer en `flex-wrap`).

- [ ] **Step 6 : vérifier** `node --check public/app.js`, démarrer le serveur, `curl` la page et `/api/state` (doit contenir `leaderboard`). La vérification visuelle revient à Anatole.

- [ ] **Step 7 : commit** `feat: leaderboard, note d'habitude et palette élargie côté front`

---

### Task 4: Front — popup profil et suppression depuis l'accueil

**Files:** Modify `public/style.css`, `public/app.js`

- [ ] **Step 1 : nom du joueur cliquable**

Dans `creerCard`, transformer le `<h2>` en bouton (`.card-titre`) qui appelle `window.ouvrirProfil(joueur.id)`. Garder l'apparence actuelle (majuscules, taille) — c'est un bouton qui ne doit pas ressembler à un bouton.

- [ ] **Step 2 : popup profil**

`window.ouvrirProfil(playerId)` : `GET /api/profile?player_id=`, rend dans le popup existant :
- le nom du joueur en titre
- ses trahisons du mois
- une section « Habitudes actuelles » et une section « Anciennes habitudes » (masquée si vide)
- chaque habitude est une ligne cliquable (nom, pastille de couleur, streak, taux) → au clic, `window.ouvrirHistorique(id)` remplace le contenu du popup par le détail de cette habitude
- depuis le détail, un lien « ← retour au profil » ramène au profil

Gérer l'état : une variable `profilOuvert` à côté de `habitOuverte`, remise à `null` par `fermerPopup`. Quand on ouvre un historique depuis un profil, mémoriser d'où l'on vient pour afficher le retour.

- [ ] **Step 3 : bouton supprimer sur l'accueil**

Dans `creerHabitude`, ajouter à droite du nom un bouton discret `×` (`.btn-supprimer`, visible au survol sur desktop, toujours visible au tactile). Au clic :
```js
if (!confirm(`Supprimer « ${habit.nom} » ? Elle restera dans l'historique du profil.`)) return;
```
puis `POST /api/habits/:id/archive`, `recharger()`, avec `try/catch` + `signaler` comme les autres handlers.
⚠️ Le clic ne doit pas déclencher l'ouverture du popup d'habitude — `e.stopPropagation()`.

- [ ] **Step 4 : styles** `.btn-supprimer`, `.profil-section`, `.profil-ligne`, `.retour-profil`.

- [ ] **Step 5 : vérifier** `node --check`, serveur + `curl /api/profile?player_id=1`. Vérification visuelle par Anatole.

- [ ] **Step 6 : commit** `feat: popup profil joueur et suppression d'une habitude depuis l'accueil`

---

## Auto-review

| Demande d'Anatole | Tâche |
|---|---|
| Leaderboard mensuel « Qui a le plus trahi ses paroles ? » | 2 (calcul) + 3 (affichage) |
| Note explicative à la création, visible dans le popup | 1 (colonne) + 2 (API) + 3 (front) |
| Popup profil par joueur, historique complet, habitudes cliquables | 1 (`getAllHabits`) + 2 (`/api/profile`) + 4 (popup) |
| Supprimer une habitude depuis l'accueil, conservée en historique | 1 (`archived_at`) + 4 (bouton) |
| Plus de couleurs | 1 (palette 12) + 3 (flex-wrap) |

**Point de conception à surveiller :** `archived_at` est ce qui empêche une habitude supprimée d'accumuler des trahisons éternellement. Sans lui, la règle « les trahisons restent comptées » rendrait toute suppression absurde.
