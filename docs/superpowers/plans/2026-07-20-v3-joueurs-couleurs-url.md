# Greene Habits v3 — Les 6 joueurs, couleurs de carte, URL par joueur

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development.

**Goal:** Installer les 6 vrais joueurs avec une couleur d'identité chacun, et donner à chacun une URL qui remonte sa carte en tête de page.

**Architecture:** Une colonne `couleur` sur `players`, un `slug` dérivé du nom, un amorçage qui crée les 6, une route « catch-all » qui sert `index.html` pour `/<slug>`, et un réordonnancement côté front.

## Global Constraints

- **Les 6 joueurs et leurs couleurs, exactement :**

| Joueur | Couleur demandée | Hex |
|---|---|---|
| Nicolas | rouge | `#DC2626` |
| Axel | bleu | `#4C6FFF` |
| Thomas | violet | `#A855F7` |
| Owen | marron clair | `#B08968` |
| Guillaume | jaune | `#FACC15` |
| Anatole | vert | `#22C55E` |

- **`#DC2626` (rouge joueur) est volontairement plus profond que `#EF4444` (point raté).** Les deux rouges coexistent sur la même page : l'un est du chrome de carte, l'autre l'état d'un point. Ils ne doivent pas être confondus — ne jamais utiliser `#EF4444` comme couleur de joueur, ni `#DC2626` pour un point.
- La couleur d'un joueur est **indépendante** de la palette des habitudes (12 couleurs) : ce sont deux registres différents. Un joueur peut être rouge ; une habitude ne peut pas.
- `slug` est **dérivé du nom**, jamais saisi : minuscules, accents retirés, tout caractère non alphanumérique → `-`.
- L'URL `/<slug>` **réordonne**, elle ne filtre pas : toutes les cartes restent visibles, celle du joueur passe en premier.
- Rien n'est jamais supprimé (`archived = 1`).
- Interface en français, aucune dépendance front, DOM en `textContent`.

---

### Task 1: Couleur et slug des joueurs, amorçage des 6, routage `/<slug>`

**Files:** Modify `src/db.js`, `src/server.js`, `test/db.test.js`, `test/api.test.js`

**Interfaces produites :**
- `players.couleur TEXT NOT NULL DEFAULT '#4C6FFF'` (migration idempotente, même forme que `migrerColonnesHabits`)
- `slugifier(nom): string` exporté depuis `src/db.js`
- `getPlayers(db)` renvoie `{ id, nom, couleur }`
- `createPlayer(db, nom, couleur?)` — couleur attribuée automatiquement si absente, en tournant sur `COULEURS_JOUEURS`
- `COULEURS_JOUEURS` exporté : les 6 hex ci-dessus
- `GET /api/state` : chaque joueur porte `couleur` et `slug`
- Toute requête GET qui n'est ni `/api/*` ni un fichier existant, **et sans extension**, sert `index.html`

- [ ] **Step 1 : tests d'abord**

```js
// test/db.test.js
test('l amorçage crée les 6 joueurs avec leur couleur', () => {
  const db = openDb(':memory:');
  const joueurs = getPlayers(db);
  assert.deepEqual(joueurs.map((j) => j.nom),
    ['Nicolas', 'Axel', 'Thomas', 'Owen', 'Guillaume', 'Anatole']);
  assert.equal(joueurs.find((j) => j.nom === 'Nicolas').couleur, '#DC2626');
  assert.equal(joueurs.find((j) => j.nom === 'Anatole').couleur, '#22C55E');
  assert.equal(joueurs.find((j) => j.nom === 'Owen').couleur, '#B08968');
});

test('l amorçage est idempotent', () => {
  const db = openDb(':memory:');
  assert.equal(getPlayers(db).length, 6);
});

test('aucune couleur de joueur n est le rouge réservé aux points ratés', () => {
  assert.ok(!COULEURS_JOUEURS.includes('#EF4444'));
});

test('slugifier normalise le nom', () => {
  assert.equal(slugifier('Nicolas'), 'nicolas');
  assert.equal(slugifier('Jean-Éric'), 'jean-eric');
  assert.equal(slugifier('  Anne Marie '), 'anne-marie');
});

test('createPlayer attribue une couleur quand on ne lui en donne pas', () => {
  const db = openDb(':memory:');
  const j = createPlayer(db, 'Invité');
  assert.ok(COULEURS_JOUEURS.includes(j.couleur));
});

test('createPlayer accepte une couleur explicite', () => {
  const db = openDb(':memory:');
  const j = createPlayer(db, 'Invité', '#A855F7');
  assert.equal(j.couleur, '#A855F7');
});
```

```js
// test/api.test.js
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
```

⚠️ Les tests existants comptent sur un amorçage à **1 joueur (Anatole)**. Passer à 6 va en casser plusieurs (`players.length === 1`, `players[0]`, ids en dur, leaderboard). Les mettre à jour est attendu — mais **corriger les attentes, jamais affaiblir une assertion** pour la faire passer.

- [ ] **Step 2 : lancer, vérifier l'échec**

- [ ] **Step 3 : implémenter**

`src/db.js` :
```js
export const COULEURS_JOUEURS = [
  '#DC2626', // rouge — plus profond que le #EF4444 des points ratés
  '#4C6FFF', // bleu
  '#A855F7', // violet
  '#B08968', // marron clair
  '#FACC15', // jaune
  '#22C55E'  // vert
];

const JOUEURS_INITIAUX = [
  { nom: 'Nicolas',   couleur: '#DC2626' },
  { nom: 'Axel',      couleur: '#4C6FFF' },
  { nom: 'Thomas',    couleur: '#A855F7' },
  { nom: 'Owen',      couleur: '#B08968' },
  { nom: 'Guillaume', couleur: '#FACC15' },
  { nom: 'Anatole',   couleur: '#22C55E' }
];

export function slugifier(nom) {
  return String(nom)
    .normalize('NFD').replace(/[̀-ͯ]/g, '') // retire les accents
    .toLowerCase().trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}
```

Migration `couleur` sur `players` (même forme que les autres, idempotente ; backfill des lignes existantes en tournant sur `COULEURS_JOUEURS`).
Amorçage : si `players` est vide, insérer les 6 dans l'ordre du tableau.
`createPlayer(db, nom, couleur)` : si `couleur` absente, prendre `COULEURS_JOUEURS[nbJoueurs % 6]`.

`src/server.js` :
- `construireEtat` ajoute `couleur` et `slug: slugifier(joueur.nom)` sur chaque joueur.
- `servirStatique` : si le fichier n'existe pas **et** que le chemin n'a pas d'extension (`path.extname(chemin) === ''`), servir `index.html` avec un statut 200. Sinon 404 comme aujourd'hui. Ne pas toucher au garde anti-traversée existant.

- [ ] **Step 4 : `npm test`** — signaler le compte réel et lister les tests dont l'attente a changé à cause de l'amorçage à 6.
- [ ] **Step 5 : commit** `feat: 6 joueurs amorcés avec leur couleur, slug et routage /<joueur>`

---

### Task 2: Front — couleur de carte et mise en tête par l'URL

**Files:** Modify `public/app.js`, `public/style.css`

- [ ] **Step 1 : couleur de carte**

Chaque carte porte la couleur de son joueur. Application sobre, cohérente avec le thème sombre : une bordure gauche épaisse (ou un liseré haut) dans la couleur, et le nom du joueur dans cette couleur. Ne pas remplir le fond de la carte — le contraste avec les points en pâtirait.
Poser la couleur via une variable CSS sur l'élément (`card.style.setProperty('--joueur', joueur.couleur)`) et laisser la feuille de style s'en servir, plutôt que d'éparpiller des styles inline.

⚠️ Le rouge de Nicolas (`#DC2626`) et le rouge des points ratés (`#EF4444`) vivront sur la même carte. Vérifier que le chrome de carte reste clairement distinct des points — au besoin, réduire l'intensité du liseré.

- [ ] **Step 2 : mise en tête par l'URL**

Au chargement, lire `location.pathname` (ex. `/anatole`). Si le segment correspond au `slug` d'un joueur, rendre sa carte **en premier**, les autres inchangées derrière. Aucun filtrage : tout le monde reste visible.
Marquer discrètement la carte mise en avant (par ex. un liseré plus marqué) pour qu'on comprenne pourquoi elle est là.
Un slug inconnu ou une URL racine → ordre normal, aucune erreur.

- [ ] **Step 3 : accès à son URL**

Dans le popup de profil, afficher le lien direct du joueur (`/<slug>`) pour qu'il puisse le mettre en favori. Texte seul, pas de dépendance presse-papier obligatoire.

- [ ] **Step 4 : vérifier** `node --check`, serveur sur base scratch, `curl /anatole` (200 + la page), `curl /api/state` (couleur + slug présents). Vérification visuelle déférée à Anatole.

- [ ] **Step 5 : commit** `feat: couleur d'identité par carte et mise en tête via /<joueur>`

---

## Auto-review

| Demande | Tâche |
|---|---|
| Les 6 joueurs remplacent les données de test | 1 (amorçage) + reset de la base par le contrôleur |
| Une couleur par joueur, appliquée à sa carte | 1 (stockage) + 2 (rendu) |
| Une URL par joueur qui remonte sa carte | 1 (routage serveur + slug) + 2 (réordonnancement) |

**Tension de conception assumée :** Anatole a demandé le rouge pour Nicolas alors que le rouge est réservé à l'échec. Le registre diffère (chrome de carte vs état d'un point) et les deux hex sont distincts, mais c'est le point à regarder en premier à l'écran.
