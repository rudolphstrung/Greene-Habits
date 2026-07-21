# Greene Habits — Récapitulatif du projet

**Statut :** terminé & en ligne · **Livré le :** 2026-07-21
**En ligne :** https://greene.shinouki.com
**Code :** https://github.com/rudolphstrung/Greene-Habits (public)

---

## 1. Ce que c'est

Un habit tracker **partagé**, en **une seule page**, pour le groupe des 6 (Anatole + les Networkers).

L'idée directrice, qui a guidé toutes les décisions : **ce n'est pas un suivi personnel, c'est de l'émulation de groupe.** Tout le monde voit les habitudes de tout le monde sur le même écran — c'est la pression sociale douce qui fait tenir une habitude. Conséquence : tout est public, tout est sur une page, rien n'est caché derrière un compte ou un onglet.

---

## 2. Les choix qu'on a faits (et pourquoi)

### Produit

| Choix | Décision | Pourquoi |
|---|---|---|
| **Comptes utilisateurs** | Aucun. Tout le monde peut cocher n'importe quelle case. | Zéro friction, le groupe se fait confiance. Une erreur se corrige en recliquant. |
| **Une carte par joueur** | Toutes les habitudes d'un joueur dans sa carte, en 2 blocs DAILY / WEEKLY. | Pour que les 6 tiennent sur une seule page. |
| **Le rouge (raté) n'est jamais stocké** | Il se calcule : période passée + sous l'objectif = rouge. | Aucun cron de minuit. Fonctionne même si personne n'ouvre l'app pendant 3 semaines. Et recliquer un jour oublié le repasse en vert. |
| **Objectif figé par période** | Monter l'objectif d'une hebdo (ex. 2→3 séances) ne repeint PAS en rouge les semaines déjà réussies. | Augmenter progressivement une habitude est normal ; punir le passé découragerait. Chaque validation enregistre l'exigence de l'époque. |
| **Période de création & de suppression = jamais ratées** | Une semaine partiellement vécue (créée ou supprimée en cours de route) ne compte pas comme une trahison. | On ne juge pas quelqu'un sur une période qu'il n'a pas pu vivre entièrement. |
| **Type d'habitude immuable** | Daily ↔ Weekly impossible après création. | Changer le type rendrait tout l'historique incohérent (jours vs lundis). Pour changer : archiver + recréer. |
| **Rien n'est jamais supprimé** | « Supprimer » = archiver. L'habitude disparaît de l'accueil mais reste dans le profil. | L'historique a de la valeur. Une date d'archivage fige le décompte des trahisons (sinon une habitude supprimée en accumulerait à l'infini). |
| **Hebdo = 4 semaines glissantes** | La semaine en cours (à droite) + les 3 précédentes. Pas de semaines futures. | Choix affiné à l'usage : plus lisible que les 7 semaines de départ, et on valide clairement la bonne semaine. |

### Leaderboard — « Qui a le plus trahi ses paroles ? »

- Classement **mensuel** : le moins de trahisons en haut, le plus en bas.
- **Une trahison = une période passée non atteinte**, qu'elle soit un jour raté (habitude quotidienne) ou une semaine ratée (hebdomadaire). Les deux pèsent 1 — logé à la même enseigne quel que soit le type d'habitude choisi.
- **Supprimer une habitude n'efface pas ses trahisons** du mois (sinon il suffirait de supprimer une habitude ratée pour remonter au classement — la faille évidente dans un jeu entre potes).

### Identité visuelle

- **6 joueurs pré-créés avec une couleur chacun** : Nicolas rouge, Axel bleu, Thomas violet, Owen marron clair, Guillaume jaune, Anatole vert.
- Le **rouge de Nicolas** (`#DC2626`) est volontairement plus profond que le **rouge « raté »** des points (`#EF4444`) — pour ne pas confondre le chrome d'une carte avec l'état d'un point. La couleur d'un joueur est un registre séparé de la palette des habitudes.
- **Palette de 12 couleurs** pour les habitudes. Le rouge `#EF4444` (raté) et le gris `#2A2A2E` (en attente) sont **réservés** et jamais assignables — c'est le code couleur central de l'app, il doit rester lisible d'un coup d'œil.
- **Design** : dark minimaliste. Une habitude = une seule ligne (nom · cases · streak). Cases en **carrés arrondis** qui remplissent la largeur et grossissent/rétrécissent avec la carte. Nom toujours visible (jamais tronqué sur mobile). Sur mobile, le leaderboard passe tout en bas (les cartes d'abord).

### Une URL par joueur

- `greene.shinouki.com/<prénom>` (ex. `/anatole`) **remonte la carte de ce joueur en tête** de page, sans cacher les autres. Objectif : supprimer la friction pour cocher ses habitudes quotidiennes — chacun met son URL en favori et tombe direct sur sa carte.

### Technique & méthode

| Choix | Décision | Pourquoi |
|---|---|---|
| **Stack** | HTML/CSS/JS pur + Node 22 + SQLite. Zéro framework, zéro build. | Une page, six utilisateurs. Un framework serait du poids sans contrepartie. |
| **Base de données** | SQLite dans un volume Docker (`greene-data → /data`). | La base vit hors de l'image → elle survit à chaque redéploiement. |
| **Repo public** | Décidé en fin de projet. | Pour que les 5 autres Networkers puissent aussi y avoir accès. |
| **Méthode de dev** | Spec → plan → développement piloté par sous-agents en TDD, avec une revue de code après chaque tâche. | La qualité par revues systématiques. Plusieurs vrais bugs attrapés avant qu'ils n'arrivent en prod (voir §5). |

---

## 3. Ce qui a été construit (chronologie)

1. **Base (v1)** — page unique, cartes joueurs, points quotidiens/hebdo, popup d'historique complet par mois, création/édition d'habitudes, règle d'état calculée, streaks.
2. **v2 — social** — leaderboard mensuel des trahisons, note explicative par habitude, popup profil par joueur (habitudes actuelles + archivées, cliquables), suppression depuis l'accueil, palette portée à 12 couleurs.
3. **v3 — les joueurs** — les 6 vrais joueurs avec leur couleur d'identité, slug + routage `/<joueur>`, couleur appliquée à chaque carte.
4. **Refonte visuelle** — habitudes sur une seule ligne, carrés arrondis, hebdo sur 4 semaines, adaptations mobile (nom toujours visible, leaderboard en bas).
5. **Mise en ligne** — repo GitHub, déploiement Dokploy complet, DNS, HTTPS.

**86 tests automatisés** au total (logique de dates, règle d'état, base de données, API).

---

## 4. Architecture (résumé)

```
navigateur ──HTTP──> server.js (Node) ──> greene.db (SQLite, volume greene-data)
                          │
                          └── sert public/ (index.html, style.css, app.js)
```

| Fichier | Rôle |
|---|---|
| `src/dates.js` | Arithmétique de dates pure (lundi d'une semaine, fenêtres) |
| `src/state.js` | Règle d'état d'un point + streaks (fonctions pures) |
| `src/db.js` | SQLite : schéma, migrations, requêtes |
| `src/server.js` | Serveur HTTP : fichiers statiques + API JSON |
| `public/` | Front (une page, pas de dépendance) |
| `Dockerfile` | Image de déploiement |

**Modèle de données :** 3 tables — `players` (nom, couleur), `habits` (nom, type, couleur, objectif, note, archived_at), `entries` (date_ref, count, objectif figé). `date_ref` = le jour pour une daily, le lundi de la semaine pour une weekly.

---

## 5. Bugs réels attrapés par les revues

Ces défauts n'auraient pas été visibles sans la discipline de revue — ils valent d'être notés :

- **Le serveur ne démarrait jamais** — le garde d'entrée ne matchait pas à cause des espaces dans le chemin. Le conteneur Docker serait mort au boot. (corrigé via `pathToFileURL`)
- **Le popup empilait des formulaires d'édition** à chaque clic sur « Modifier ».
- **La semaine de création d'une hebdo** était marquée ratée à tort (période partielle).
- **La semaine de suppression** avait le même défaut (symétrie manquée).
- **Monter l'objectif** repeignait en rouge les semaines déjà réussies.

---

## 6. Déploiement (infrastructure)

| Élément | Valeur |
|---|---|
| Domaine | `greene.shinouki.com` (HTTPS, Let's Encrypt) |
| Hébergement | VPS `72.61.179.228`, via Dokploy |
| Projet Dokploy | « Greene Habits » — `GbkkHl6To2vmuWTYqu_2X` |
| App Dokploy | `greene-habits` — `0cC4OBvF2SyOLqN0JbdaX` |
| Source | git public, branche `main`, build **Dockerfile** |
| Volume | `greene-data` → `/data` (la base y vit) |
| DNS | enregistrement A `greene` → `72.61.179.228` (Hostinger) |

**Redéployer après une modification :** travailler dans ce dossier → `git push` → relancer le déploiement Dokploy (l'auto-deploy n'est pas activé). L'app se déploie depuis GitHub, elle est **indépendante de ce dossier** — l'archiver n'a rien cassé.

---

## 7. Points ouverts (non bloquants)

- **Sécurité — ancien PAT GitHub** : le token `ghp_tbxvgED…` (que tu voulais révoquer) est toujours actif et en clair dans la config Dokploy de **Valdoria** (et probablement du site vitre), dans l'URL git. Le révoquer casserait ces déploiements. Greene, lui, n'utilise aucun token (repo public). À traiter un jour : remplacer par un token à portée limitée sur Valdoria/site-vitre, puis révoquer l'ancien.
- **DNS local (poste Fedora uniquement)** : le résolveur Tailscale avait gardé en cache « n'existe pas » (le record était trop récent). Un override a été ajouté dans `/etc/hosts` (`72.61.179.228 greene.shinouki.com`). Inoffensif, mais c'est un pointeur figé — à retirer si l'IP du VPS change un jour. Les autres utilisateurs ne sont pas concernés.
