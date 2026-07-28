# Design — Gels de streak (habitudes quotidiennes)

Date : 2026-07-28

## Contexte

Chaque joueur reçoit 2 « gels » par semaine (pool commun à toutes ses habitudes quotidiennes). Un gel, posé manuellement sur un jour raté, protège le streak de cette habitude : le streak ne redescend pas à 0, mais ce jour ne compte pas non plus comme une réussite. Au lundi suivant, les gels utilisés sont récupérés — le compteur ne se cumule jamais au-delà de 2 (pas de banque).

Décisions prises pendant le brainstorming (10 questions) :
- Pool **par joueur**, partagé entre toutes ses habitudes (pas un pool par habitude).
- S'applique **uniquement aux habitudes quotidiennes** (`type = 'daily'`) — les hebdomadaires n'ont pas la notion de « jour raté » isolé.
- Activation **manuelle** : le joueur choisit explicitement d'utiliser un gel, ce n'est jamais automatique.
- Affichage distinct : un jour gelé montre un **glaçon 🧊**, pas la couleur de succès.
- Un jour gelé **ne compte pas comme trahison** dans le classement mensuel.
- Renouvellement chaque **lundi** (même frontière que `mondayOf()`, déjà utilisée pour les habitudes hebdo et la vue calendrier).
- **Pas de cumul** : max 2 gels, toujours, jamais plus même si aucun n'a été utilisé la semaine précédente.
- Utilisation **rétroactive** possible (un jour raté il y a plusieurs jours peut être gelé après coup, tant qu'il reste dans la fenêtre normale de correction).
- Un nouveau joueur démarre avec ses 2 gels dès sa création, comme tout le monde.

## Modèle de données

Nouvelle table, ajoutée au `SCHEMA` de `src/db.js` (`CREATE TABLE IF NOT EXISTS`, pas de migration séparée nécessaire — comme `entries`/`habits`/`players` à leur création) :

```sql
CREATE TABLE IF NOT EXISTS gels (
  id         INTEGER PRIMARY KEY,
  habit_id   INTEGER NOT NULL REFERENCES habits(id),
  ref        TEXT NOT NULL,   -- jour raté protégé (date_ref)
  semaine    TEXT NOT NULL,   -- lundi de la semaine (mondayOf(ref)), pour le quota
  created_at TEXT NOT NULL,
  UNIQUE (habit_id, ref)
);

CREATE INDEX IF NOT EXISTS idx_gels_semaine ON gels (semaine);
```

Le quota (2/semaine par joueur) n'est **pas stocké** — calculé à la volée, comme le streak :

```js
export function countGelsSemaine(db, playerId, semaine) {
  return db.prepare(
    `SELECT COUNT(*) AS n FROM gels g JOIN habits h ON h.id = g.habit_id
     WHERE h.player_id = ? AND g.semaine = ?`
  ).get(playerId, semaine).n;
}

export function getGels(db, habitId) {
  const lignes = db.prepare('SELECT ref FROM gels WHERE habit_id = ?').all(habitId);
  return new Set(lignes.map((l) => l.ref));
}
```

`getGels` retourne un `Set` de refs gelées pour une habitude — même rôle que `getEntries` pour les compteurs, consommé par `pointsDe`, `reussitesPourStats` et `trahisonsDeLHabitude`.

**Suppression d'une habitude** : `deleteHabit` (src/db.js:291-298) supprime déjà manuellement les `entries` avant l'habitude elle-même (contrainte FK sans `ON DELETE CASCADE`). Sans changement, supprimer une habitude qui a des gels échouerait avec une erreur de contrainte de clé étrangère. La transaction doit aussi supprimer `gels` :
```js
const suppr = db.transaction((habitId) => {
  db.prepare('DELETE FROM entries WHERE habit_id = ?').run(habitId);
  db.prepare('DELETE FROM gels WHERE habit_id = ?').run(habitId);
  return db.prepare('DELETE FROM habits WHERE id = ?').run(habitId);
});
```

## Création d'un gel (`src/db.js`)

Même structure de validation que `toggle()` (bornes de la fenêtre autorisée) :

```js
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

  const entries = getEntries(db, habitId);
  const count = entries[ref]?.count || 0;
  const objectif = entries[ref]?.objectif ?? habit.objectif;
  if (count >= objectif) throw new Error('Ce jour est déjà réussi, pas besoin de gel');

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

`ref < courante` (strictement) : le jour en cours n'est jamais « raté » tant qu'il n'est pas terminé, donc jamais gelable — cohérent avec `computeStreak` qui traite toujours la période en cours à part.

## Effet sur les calculs (streak, record, taux, trahisons)

Un jour gelé est **neutralisé partout**, sur le même principe que la « grâce » déjà appliquée à la période de création d'une habitude hebdo (`reussitesPourStats`, `graceCreation`) :

- **`pointsDe`** (`src/server.js`) : avant d'appeler `dotState`, si le jour n'est pas réussi ET qu'il est dans le `Set` de gels → `etat: 'gele'` directement (prioritaire sur `dotState`). Si le jour a été marqué fait *après coup* malgré un gel existant (`estReussi` devient vrai), c'est `'reussi'` qui gagne — le gel devient sans effet, pas besoin de le supprimer.
- **`reussitesPourStats`** : nouveau paramètre `gels` (un `Set`, vide pour une habitude weekly puisque le gel ne s'y applique jamais), le filtre existant (`graceCreation`) est étendu pour exclure aussi les refs gelées **non réussies** :
  ```js
  function reussitesPourStats(habit, entries, refs, refCourante, gels) {
    const refCreation = refFor(habit, habit.created_at);
    const graceCreation = habit.type === 'weekly'
      && !estReussi(habit, entries, refCreation, refCourante);
    const geleNonReussi = (ref) => gels.has(ref) && !estReussi(habit, entries, ref, refCourante);
    const utiles = refs.filter((r) => !(graceCreation && r === refCreation) && !geleNonReussi(r));
    return utiles.map((ref) => estReussi(habit, entries, ref, refCourante));
  }
  ```
  Résultat : `computeStreak`/`bestStreak`/`successRate` ne voient jamais ce jour — le streak ne descend pas, n'augmente pas non plus, le taux de réussite n'est pas pénalisé.
- **`trahisonsDeLHabitude`** : même condition ajoutée au `.filter()` existant → un jour gelé (et non réussi) ne compte jamais comme trahison dans le classement mensuel.
- **Points** : aucun changement — `entries` n'est pas modifié par un gel, donc pas de point gagné sur un jour gelé (cohérent, l'habitude n'a pas été faite).

Toutes les fonctions qui appellent ces 3 helpers (`construireEtat`, `statsHabit`/`construireHistorique`, `construireLeaderboard`) doivent maintenant récupérer `getGels(db, habit.id)` et le transmettre.

## État exposé au frontend

`construireEtat` ajoute, par joueur, ses gels restants pour la semaine en cours :

```js
gels_restants: Math.max(0, 2 - countGelsSemaine(db, joueur.id, mondayOf(aujourdhui)))
```

## API

```
POST /api/gels { habit_id, date_ref }
```
```js
if (req.method === 'POST' && chemin === '/api/gels') {
  const { habit_id, date_ref } = await lireCorps(req);
  return envoyerJson(res, 201, createGel(db, Number(habit_id), date_ref));
}
```
Toute erreur de validation remonte via le `catch` générique déjà en place (400 + `{erreur: message}`), même mécanisme que les autres routes.

## Interaction frontend (Option B)

Aujourd'hui, cliquer un point passé rouge (`rate`) appelle directement `/api/toggle`. Ce comportement change **seulement pour les points `rate`** : le clic ouvre un petit menu dans le popup existant (même mécanique que `menuSuppression` — titre, question, boutons `.btn-principal`/`.btn-discret`, pas de nouveau composant) :

- **« Marquer fait »** → `POST /api/toggle` (comportement actuel, inchangé).
- **« Utiliser un gel (x restant·s) »** → `POST /api/gels`. Bouton masqué si `joueur.gels_restants === 0` (remplacé par un texte « Aucun gel disponible cette semaine »).
- **« Annuler »** → ferme le popup, aucune action.

Un point déjà `gele` ouvre le même menu mais **sans** le bouton "Utiliser un gel" (déjà posé) — seulement « Marquer fait » (au cas où le joueur a en fait fait l'habitude) et « Annuler ». Ça évite qu'un jour gelé par erreur reste bloqué pour toujours.

Les points `reussi` (déjà réussis) et `actuel` (jour en cours) gardent leur comportement actuel — clic direct, pas de menu (le gel ne les concerne pas).

## Affichage

- **Compteur de gels** : `🧊 x/2` affiché sur la carte du joueur, à côté de son nom (`creerCard`, `titre`), recalculé à chaque `recharger()`.
- **Point gelé** (`creerPoint`, `public/app.js`) : nouvelle branche `else if (point.etat === 'gele')` → classe CSS `.point.gele` (fond bleu clair) + glaçon 🧊 comme contenu du bouton, à la place du fond de couleur habituel.
- **CSS** (`style.css`) : règle `.point.gele` (fond `#BFDBFE` ou équivalent bleu clair, cohérent avec la palette existante), pas de nouvelle variable de thème nécessaire.

## Tests impactés

- `test/db.test.js` : nouveaux tests pour `createGel` (pose un gel valide, rejette hors fenêtre, rejette jour déjà réussi, rejette double gel, rejette au-delà du quota de 2/semaine, rejette sur habitude weekly), `countGelsSemaine`/`getGels`, et un test que `deleteHabit` sur une habitude ayant des gels ne lève pas d'erreur de contrainte FK.
- `test/state.test.js` ou `test/server.test.js` (selon où vivent déjà les tests de `computeStreak`/`reussitesPourStats`/`trahisonsDeLHabitude`) : vérifier qu'un jour gelé neutralise bien le streak (ne descend pas, n'augmente pas), le taux de réussite et les trahisons.
- `test/api.test.js` : route `POST /api/gels` — succès, erreurs 400 (quota dépassé, jour invalide, habitude weekly).
- Pas de test frontend (le projet n'en a pas) — vérification manuelle du menu et de l'affichage glaçon après implémentation.
