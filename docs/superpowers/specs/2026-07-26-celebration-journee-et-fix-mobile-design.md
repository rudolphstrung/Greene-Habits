# Design — Célébration journée complète + fix disposition mobile

Date : 2026-07-26

## Contexte

Deux améliorations demandées sur l'app Greene Habits (`public/app.js` + `public/style.css`) :
1. Une animation spéciale quand un joueur valide toutes ses habitudes DAILY du jour.
2. Sur petit écran, le nom d'une habitude se retrouve écrasé et illisible (retour à la ligne quasi caractère par caractère).

## 1. Animation "journée complète"

### Portée

Seules les habitudes de type `daily` comptent. Les habitudes `weekly` ne sont pas liées à un jour précis et restent hors scope.

### Déclencheur

Dans `validerPeriode(habit, ref)` (`public/app.js`), après l'appel API et le `recharger()` :
- Avant l'action : calculer si le joueur propriétaire de l'habitude avait déjà **toutes** ses habitudes `daily` à `courant >= objectif` (`completAvant`).
- Après l'action : recalculer la même chose sur l'état rechargé (`completApres`).
- Ne déclencher la célébration que sur la transition `false → true` (jamais si déjà complet avant, jamais au simple rechargement de page hors validation).
- Si le joueur n'a aucune habitude `daily`, la condition est toujours fausse (pas de célébration possible).

Cette logique réutilise le pattern déjà en place pour le son individuel (`avant` / `enAvant`), donc aucune nouvelle route serveur n'est nécessaire — tout se calcule côté client à partir de l'état déjà chargé (`etat`).

### Rendu

- **Confettis** : ~24 petites div positionnées en `position: fixed`, calées sur `getBoundingClientRect()` de la carte du joueur (évite le clip par le `border-radius` de `.card`, qui a `overflow` implicite via son propre contexte). Palette : couleur du joueur (`--joueur`) + 2 teintes festives fixes. Chute + rotation + fondu en CSS keyframes, durée ~1s, suppression du DOM via `setTimeout` après la durée max.
- **Son** : nouvelle fonction `jouerSonJournee()` à côté de `jouerSonSucces()`, même approche WebAudio synthétisée (pas de fichier externe), mais un accord plus riche (4-5 notes) pour se distinguer clairement du son de validation individuelle.
- **Ciblage DOM** : ajouter `card.dataset.joueur = joueur.id` dans `creerCard()` pour pouvoir sélectionner `.card[data-joueur="<id>"]` depuis la fonction de célébration.

## 2. Fix disposition du nom sur petit écran

### Cause racine

Dans `.bloc-grille` (`public/style.css`), les colonnes sont définies par :
```
grid-template-columns: minmax(0, max-content) minmax(9.5rem, 1fr) max-content max-content;
```
La colonne "nom" a un plancher de largeur **0**, alors que la colonne "cases" a un minimum dur de `9.5rem`. Quand l'espace manque, la grille écrase la colonne nom en premier (jusqu'à quelques pixels), ce qui force un retour à la ligne quasi caractère par caractère malgré le `-webkit-line-clamp: 2` déjà en place sur `.habitude-nom`.

### Fix

Sous le breakpoint mobile déjà utilisé dans le fichier (`@media (max-width: 520px)`, qui gère déjà le réordonnancement du footer/leaderboard) :
- `.habitude-nom-zone` passe en `grid-column: 1 / -1` : elle occupe sa propre ligne, pleine largeur de la carte, au-dessus de la ligne cases/streak/validation.
- `.habitude-nom` perd sa contrainte `max-width: 11rem` sur mobile (plus nécessaire, la pleine largeur de la carte est disponible) ; le `-webkit-line-clamp: 2` reste comme filet de sécurité pour un nom extrêmement long.
- Aucun changement DOM ni JS : uniquement des règles CSS ajoutées dans le bloc media query existant. La ligne d'en-tête des jours (`.jours-entete`) et les colonnes cases/streak/validation ne bougent pas de structure, elles se retrouvent juste seules sur leur ligne.

S'applique identiquement aux blocs DAILY et WEEKLY puisqu'ils partagent la même classe `.bloc-grille` / `.habitude`.

## Tests

Pas de suite de tests automatisés pertinente ici (comportement visuel/CSS + interaction DOM difficile à tester unitairement dans ce projet qui n'a pas de tests front-end existants — `test/` couvre uniquement `src/` côté serveur). Vérification manuelle :
- Valider toutes les dailies d'un joueur → confettis + son se déclenchent une seule fois, pas au rechargement de page, pas en dévalidant.
- Réduire la largeur du navigateur sous 520px → le nom d'une habitude longue ("Morning Fast", "4h minimum sur BB automatique") s'affiche sur 1-2 lignes lisibles, plus jamais écrasé caractère par caractère.
