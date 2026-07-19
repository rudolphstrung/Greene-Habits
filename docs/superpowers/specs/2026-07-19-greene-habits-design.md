# Greene Habits — Design

**Date** : 2026-07-19
**Statut** : validé, prêt pour implémentation
**Domaine cible** : `greene.shinouki.com`

---

## 1. Intention

Un habit tracker partagé, page unique, pour ~6 personnes (Anatole + les Networkers).

L'objectif n'est pas le suivi personnel — c'est **l'émulation de groupe** : chacun voit les habitudes de tous les autres sur le même écran, ce qui crée la pression sociale douce qui fait tenir une habitude.

Conséquence directe sur toutes les décisions qui suivent : tout est public, tout est sur une page, rien n'est caché derrière un compte ou un onglet.

---

## 2. Décisions cadrantes

| Décision | Choix | Raison |
|---|---|---|
| Comptes utilisateurs | **Aucun** | Friction zéro. Le groupe est petit et se fait confiance. |
| Qui peut cocher quoi | **Tout le monde peut tout cocher** | Pas d'auth à écrire. Une erreur se corrige en recliquant. |
| Passage au rouge | **Calculé, jamais stocké** | Aucun cron de minuit. Fonctionne même si l'app n'est pas ouverte pendant 3 semaines. |
| Correction d'un oubli | **Toujours possible** | Un jour passé reste cliquable. Les oublis sont certains, les punir ferait abandonner l'app. |
| Stack | **HTML/CSS/JS pur + Node + SQLite** | Une page, six utilisateurs. Un framework serait du poids sans contrepartie. |
| Suppression | **Jamais** — `archived = 1` | Règle Empire : l'historique a de la valeur. |

---

## 3. Architecture

Un seul container Docker déployé via Dokploy.

```
navigateur ──HTTP──> server.js (Node) ──> greene.db (SQLite, volume greene-data)
                          │
                          └── sert public/ (index.html, style.css, app.js)
```

**Composants :**

| Fichier | Responsabilité | Dépend de |
|---|---|---|
| `server.js` | Sert les fichiers statiques + expose l'API JSON | `db.js` |
| `db.js` | Ouverture SQLite, migrations, toutes les requêtes | `better-sqlite3` |
| `public/index.html` | Squelette de la page + template du popup | — |
| `public/style.css` | Thème sombre, grille de cards, points | — |
| `public/app.js` | Fetch de l'état, rendu, gestion des clics | l'API |

Chaque fichier a une frontière nette : `app.js` ne connaît que la forme de la réponse API, jamais le schéma SQL. `db.js` ne connaît rien du HTTP.

**Déploiement** : image `node:22-alpine`, `EXPOSE 3000`, volume Dokploy `greene-data` monté sur `/data`. Le fichier DB vit dans le volume, jamais dans l'image.

---

## 4. Modèle de données

```sql
players (
  id          INTEGER PRIMARY KEY,
  nom         TEXT NOT NULL,
  created_at  TEXT NOT NULL,
  archived    INTEGER NOT NULL DEFAULT 0
)

habits (
  id          INTEGER PRIMARY KEY,
  player_id   INTEGER NOT NULL REFERENCES players(id),
  nom         TEXT NOT NULL,
  type        TEXT NOT NULL CHECK (type IN ('daily','weekly')),
  couleur     TEXT NOT NULL,
  objectif    INTEGER NOT NULL DEFAULT 1,
  created_at  TEXT NOT NULL,
  archived    INTEGER NOT NULL DEFAULT 0
)

entries (
  id          INTEGER PRIMARY KEY,
  habit_id    INTEGER NOT NULL REFERENCES habits(id),
  date_ref    TEXT NOT NULL,
  count       INTEGER NOT NULL DEFAULT 0,
  UNIQUE (habit_id, date_ref)
)
```

**`date_ref`** est la clé de tout le système. Une seule table couvre les deux types d'habitudes :

- habitude **daily** → `date_ref` = le jour, `2026-07-19`
- habitude **weekly** → `date_ref` = le **lundi de la semaine concernée**, `2026-07-13`

`objectif` vaut toujours `1` pour une daily. Pour une weekly, c'est le nombre de fois visé dans la semaine (ex : `3`).

**Une entry n'existe que si `count > 0`.** L'absence d'entry signifie zéro, ce qui garde la table petite et rend le calcul du rouge trivial.

---

## 5. La règle d'état (cœur de l'app)

Pour une habitude donnée et une `date_ref` donnée, l'état d'un point se déduit de trois valeurs : `count`, `objectif`, et la position de la période par rapport à maintenant.

| Condition | État | Rendu |
|---|---|---|
| `count >= objectif` | **réussi** | point plein, couleur de l'habitude |
| `count < objectif` et période **passée** | **raté** | point plein rouge `#EF4444` |
| `count < objectif` et période **en cours ou future** | **en attente** | cercle gris `#2A2A2E` |

Rien de tout cela n'est écrit en base. Le rouge apparaît de lui-même quand la période bascule dans le passé. C'est ce qui permet de supprimer entièrement le cron de minuit.

Une période **passée** reste modifiable : cliquer un point rouge crée l'entry manquante et le point devient vert rétroactivement.

---

## 6. Affichage

### Structure de la page

```
              Greene Habits              dim. 19 juil.

 ┌──────────────────────────┐  ┌──────────────────────────┐
 │ ANATOLE                  │  │ NICOLAS                  │
 │                          │  │                          │
 │ DAILY   LU MA ME JE VE SA DI                           │
 │ Lecture           🔥 12  │  │ Trading           🔥 4   │
 │ ●  ●  ●  ●  ○  ◌  ◌      │  │ ●  ●  ◌  ◌  ◌  ◌  ◌      │
 │ Sport             🔥 3   │  │                          │
 │ ●  ●  ●  ◌  ◌  ◌  ◌      │  │ WEEKLY                   │
 │ ──────────────────────   │  │ Review            🔥 2   │
 │ WEEKLY                   │  │ ●  ●  ○  ●  ●  ●  ◌      │
 │ Salle   2/3       🔥 5   │  └──────────────────────────┘
 │ ●  ●  ○  ●  ●  ●  ◌      │
 │              + habitude  │            + joueur
 └──────────────────────────┘
```

- **1 card = 1 joueur**, contenant toutes ses habitudes, séparées en deux blocs `DAILY` puis `WEEKLY`
- Un bloc vide n'est pas affiché (pas de titre `WEEKLY` orphelin)
- **1 habitude = 1 ligne** : nom, compteur de streak, et 7 points en dessous
- Grille responsive : 1 colonne sur téléphone, 2 sur tablette, 3 au-delà — les 6 joueurs tiennent sur une page

### Les 7 points

- **Daily** : les 7 jours de la semaine en cours, lundi → dimanche. Chaque lundi, la ligne repart entièrement grise.
- **Weekly** : les 7 dernières semaines glissantes. Le point le plus à droite est toujours la semaine en cours ; chaque lundi la ligne glisse d'un cran vers la gauche.

Les deux types ont donc exactement la même forme visuelle — un seul composant de rendu pour les deux.

Le bandeau `LU MA ME JE VE SA DI` n'apparaît qu'au-dessus du bloc DAILY.

### Interaction

| Geste | Effet |
|---|---|
| Clic sur un point (daily) | bascule entre 0 et 1 |
| Clic sur un point (weekly) | `count + 1` ; au-delà de l'objectif, retour à 0 |
| Clic sur le nom d'une habitude | ouvre le popup d'historique |
| `+ habitude` | formulaire inline dans la card : nom, type, couleur, objectif si weekly |
| `+ joueur` | demande un prénom, crée une card vide |
| `Modifier` dans le popup | formulaire d'édition : nom, couleur, objectif |

Le cycle « un clic de plus remet à zéro » évite d'avoir à construire un menu de correction : tout se répare avec le même geste.

Pour une weekly, le compteur `2/3` s'affiche à côté du nom tant que l'objectif de la semaine en cours n'est pas atteint.

### Couleurs

Palette assignable à une habitude :

| Nom | Hex |
|---|---|
| Bleu | `#4C6FFF` |
| Violet | `#A855F7` |
| Cyan | `#22D3EE` |
| Vert | `#22C55E` |
| Ambre | `#F59E0B` |
| Lime | `#84CC16` |

Deux couleurs sont **réservées** et ne sont jamais proposées au choix :

- Raté → `#EF4444`
- En attente → `#2A2A2E`

L'orange soutenu est volontairement absent de la palette : sur des points de 12 px il se confond avec le rouge, or c'est précisément la distinction qui doit rester lisible d'un coup d'œil.

### Streak

Nombre de périodes réussies consécutives, en remontant depuis la période la plus récente.

La période **en cours** ne casse jamais le streak tant qu'elle n'est pas terminée : une habitude quotidienne réussie 12 jours d'affilée affiche `🔥 12` toute la journée du 13e, qu'elle soit cochée ou non. Sinon le compteur retomberait à zéro chaque matin.

Le streak est calculé côté serveur et renvoyé avec l'état.

---

## 7. Popup d'historique

Déclenché par un clic sur le nom d'une habitude.

Reprend la forme de la référence visuelle : une grille dense de points couvrant **toute la vie de l'habitude** depuis sa création, groupée par mois, avec le mois en label. Mêmes règles de couleur que la vue principale.

Pour une weekly, un point = une semaine (la grille est donc bien plus courte).

En tête du popup : nom de l'habitude, streak actuel, **record**, et **taux de réussite** (périodes réussies ÷ périodes écoulées).

**Les points du popup sont cliquables**, avec exactement les mêmes règles que la vue principale. C'est le seul endroit d'où l'on peut réparer un oubli datant de plus d'une semaine — la vue principale ne montrant que 7 points, sans cela un jour manqué le mois dernier serait figé en rouge pour toujours. Le popup et la card partagent le même gestionnaire de clic et la même route API.

En pied : deux boutons, `Modifier` et `Archiver` (ce dernier met `archived = 1`, ne supprime rien).

Fermeture au clic en dehors ou sur la croix.

### Édition d'une habitude

`Modifier` ouvre un formulaire sur trois champs : **nom**, **couleur**, **objectif**.

**Le type reste figé.** Basculer une habitude de `daily` à `weekly` rendrait tout son historique incohérent : ses `date_ref` sont des jours, alors que le mode weekly les lit comme des lundis. On afficherait des semaines fantômes à partir d'entries journalières. Changer de type = archiver et recréer.

**Changer l'objectif d'une weekly recolore le passé.** L'état n'étant jamais stocké, passer un objectif de 2 à 3 fait virer au rouge les semaines passées où l'on n'avait fait que 2 séances. C'est assumé et cohérent : le but est de refléter l'exigence actuelle, pas de figer un historique flatteur. Le formulaire prévient quand l'objectif augmente.

---

## 8. API

Sept routes, toutes en JSON.

| Méthode | Route | Rôle |
|---|---|---|
| `GET` | `/api/state` | Tout l'état de la page : joueurs, habitudes, 7 points de chacune, streaks |
| `POST` | `/api/players` | `{ nom }` → crée un joueur |
| `POST` | `/api/habits` | `{ player_id, nom, type, couleur, objectif }` → crée une habitude |
| `PATCH` | `/api/habits/:id` | `{ nom, couleur, objectif }` → édite une habitude. `type` et `player_id` sont ignorés s'ils sont envoyés. |
| `POST` | `/api/habits/:id/archive` | Met `archived = 1` |
| `POST` | `/api/toggle` | `{ habit_id, date_ref }` → applique la règle de cycle, renvoie le nouveau `count` |
| `GET` | `/api/history?habit_id=` | Toutes les entries depuis la création, pour le popup |

`GET /api/state` est appelé au chargement et après chaque mutation. Avec six joueurs, renvoyer l'état complet coûte moins cher à écrire — et à déboguer — qu'une synchronisation fine côté client.

**Fenêtre d'écriture autorisée** pour `/api/toggle` : la `date_ref` doit être comprise entre la création de l'habitude et la période en cours incluse. On peut donc réparer tout le passé de l'habitude, mais jamais cocher à l'avance.

---

## 9. Gestion des erreurs

| Situation | Comportement |
|---|---|
| Requête API en échec | Le point revient à son état précédent, un toast discret signale l'échec |
| Nom de joueur ou d'habitude vide | Refusé côté client et côté serveur |
| `date_ref` hors de la fenêtre autorisée | Rejeté en 400 |
| Deux personnes cliquent en même temps | Le dernier clic gagne. `UNIQUE(habit_id, date_ref)` empêche les doublons ; conflit sans conséquence à cette échelle. |
| DB absente au démarrage | Créée et migrée automatiquement |

Le front applique le changement immédiatement (optimistic UI) puis se corrige si le serveur refuse. Sur mobile en 4G, attendre l'aller-retour rendrait chaque clic mou.

---

## 10. Tests

Le cœur logique — et donc ce qui est testé — c'est le calcul d'état et le streak. L'interface est trop simple pour justifier des tests automatisés.

Tests unitaires sur des fonctions pures, sans DB :

1. `count >= objectif` → réussi, quelle que soit la période
2. Période passée sous l'objectif → rouge
3. Période en cours sous l'objectif → gris, jamais rouge
4. Streak : jour en cours non coché → le streak tient
5. Streak : jour passé raté → le streak repart de zéro
6. Weekly : `date_ref` d'un mercredi → ramené au lundi de la même semaine
7. Weekly : cycle de clics `0 → 1 → 2 → 3 → 0` sur un objectif de 3
8. Passage de semaine : la fenêtre des 7 jours glisse correctement le lundi
9. Édition : augmenter l'objectif d'une weekly recolore bien les semaines passées désormais insuffisantes
10. Édition : une requête tentant de changer `type` laisse le type inchangé

---

## 11. Hors périmètre (YAGNI)

Volontairement absents de la v1 :

- Comptes, mots de passe, sessions
- Notifications, rappels, e-mails
- Classements, points, badges
- Changement de type d'une habitude après création (voir § 7)
- Export de données
- Mode clair

---

## 12. État initial

Un seul joueur en base : **Anatole**, sans habitude.

Les cinq autres se créent eux-mêmes via le bouton `+ joueur`.
