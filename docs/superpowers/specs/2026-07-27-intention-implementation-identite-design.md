# Design — Intention d'implémentation + identité à la création d'une habitude

Date : 2026-07-27

## Contexte

Anatole veut enrichir la création d'une habitude avec le cadre « intention d'implémentation + identité » popularisé par *Atomic Habits* (James Clear) : au lieu d'une simple note libre, 3 champs structurés — ce qu'il va faire, quand/où, et le type de personne que ça sert à devenir. Référence visuelle fournie : une capture montrant 3 zones de texte empilées :
1. « I will... » + zone « habit »
2. zone « time/place (optional) »
3. « so that I can become... » + zone « type of person I want to be (optional) »

Décisions prises pendant le brainstorming :
- Le nom court affiché sur la carte (`habits.nom`, ex. "Sport") **ne change pas** — ces 3 nouveaux champs sont un détail supplémentaire, pas un remplacement du nom.
- La colonne `note` actuelle (« à quoi t'engages-tu ? ») est **remplacée** par ce nouveau cadre — pas de champ en plus, pas de doublon.
- Libellés en **français**, cohérent avec le reste de l'app.
- Style visuel : habillage identique aux champs de formulaire existants (fond `--card`, bordure `--bord`, pas d'effet visuel spécifique à la capture comme le contour vert au focus).
- Les 3 champs sont éditables après coup dans le formulaire « Modifier », au même titre que nom/couleur/objectif aujourd'hui.

## Modèle de données

Aucune perte de données : la colonne `note` existante devient sémantiquement le champ « Je vais... ». Les notes déjà écrites par les joueurs restent affichées telles quelles après la migration — c'est le même champ, seul son rôle dans l'UI change.

Deux nouvelles colonnes sur `habits`, ajoutées par une migration idempotente supplémentaire dans `src/db.js`, sur le même modèle que `migrerColonnesHabits` :

```sql
ALTER TABLE habits ADD COLUMN moment_lieu TEXT NOT NULL DEFAULT '';
ALTER TABLE habits ADD COLUMN identite    TEXT NOT NULL DEFAULT '';
```

- `moment_lieu` : le « quand / où » (ex. "chaque matin au réveil").
- `identite` : le « pour devenir... » (ex. "quelqu'un de discipliné").

Toutes deux `NOT NULL DEFAULT ''` — comme `note` aujourd'hui, l'absence de valeur est une chaîne vide, jamais NULL, pour ne pas complexifier l'affichage conditionnel.

`getHabit` / `getHabits` / `getAllHabits` (src/db.js) ajoutent ces 2 colonnes à leur `SELECT`. `createHabit` et `updateHabit` acceptent et écrivent `moment_lieu` et `identite` en plus de `note`, avec le même traitement (`String(x ?? '').trim()`, aucune validation de contenu — champs libres).

## Formulaire de création (« + habitude »)

Dans `formulaireHabitude` (`public/app.js`), à l'emplacement actuel de l'input `note`, remplacement par 3 `<textarea>` (au lieu d'`<input>`, pour permettre plusieurs lignes) :

1. Un label (`<span>` ou équivalent, style proche de `.bloc-titre`) **« Je vais... »** au-dessus d'une textarea, placeholder *« méditer 10 minutes chaque matin »*.
2. Une textarea sans label visible, placeholder **« Moment / lieu (optionnel) »**.
3. Un label **« pour devenir... »** au-dessus d'une textarea, placeholder **« type de personne que je veux devenir (optionnel) »**.

Les 3 champs sont optionnels (aucun `required`) — comportement identique à l'actuelle note, qui n'est jamais obligatoire. À la soumission, `envoyer('/api/habits', {..., note, moment_lieu, identite})` remplace l'actuel `{..., note}`.

## Formulaire d'édition

Même remplacement dans `formulaireEdition` : les 3 textareas remplacent l'input `note` unique, pré-remplies avec `donnees.note`, `donnees.moment_lieu`, `donnees.identite`. La soumission PATCH envoie les 3 champs.

`statsHabit` (src/server.js), qui alimente à la fois `/api/history` et le profil, doit inclure `moment_lieu` et `identite` dans son retour (aux côtés de `note` déjà présent) pour que le formulaire d'édition et l'affichage popup y aient accès.

## Affichage au clic sur l'habitude (popup historique)

Dans `rendreHistorique` (`public/app.js`), le bloc `.note` actuel (affiché seulement si `donnees.note` est non-vide) est remplacé par un bloc structuré, affiché seulement si **au moins un** des 3 champs est non-vide :

- Ligne « Je vais... {note} » — seulement si `note` non-vide.
- Ligne « Moment/lieu : {moment_lieu} » — seulement si `moment_lieu` non-vide.
- Ligne « pour devenir... {identite} » — seulement si `identite` non-vide.

Même classe CSS `.note` réutilisée pour le conteneur (fond `--fond`, bordure `--bord`, déjà en place) ; les 3 lignes à l'intérieur en `<div>` simples, pas de nouvelle classe nécessaire sauf si l'espacement entre lignes le demande.

## CSS

Ajout d'une règle `.formulaire textarea` dans `style.css`, calquée sur `.formulaire input, .formulaire select` existant (même padding, fond, bordure, couleur, taille de police), avec une hauteur minimale (`min-height: 44px` environ) et `resize: vertical` pour laisser le texte s'étendre si besoin.

## Tests impactés

- `test/db.test.js` : les tests de `createHabit`/`updateHabit`/`getHabit` sont étendus pour couvrir `moment_lieu` et `identite` (valeurs par défaut vides, écriture, lecture). Un test de migration vérifie que les colonnes s'ajoutent proprement sur une base existante sans les perdre.
- `test/api.test.js` : les routes `POST /api/habits` et `PATCH /api/habits/:id` sont testées avec et sans ces 2 champs.
- `test/state.test.js` : si `statsHabit` est couvert par ces tests, vérifier que `moment_lieu`/`identite` apparaissent bien dans la sortie.

Pas de test frontend (le projet n'en a pas — vérification manuelle du formulaire et de l'affichage popup après implémentation, comme pour les fonctionnalités précédentes).
