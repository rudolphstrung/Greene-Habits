# Célébration journée complète + fix disposition mobile Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ajouter une célébration (confettis + son) quand un joueur valide toutes ses habitudes DAILY du jour, et corriger l'écrasement illisible du nom d'habitude sur petit écran.

**Architecture:** Deux changements indépendants dans la même petite app vanilla JS/CSS (pas de framework, pas de build step) : un fix CSS pur (media query existante) pour la disposition mobile, et une extension de la logique de validation côté client (`public/app.js`) pour détecter la transition "toutes les dailies validées" et déclencher un effet confetti + son, sans nouvelle route serveur.

**Tech Stack:** HTML/CSS/JS vanilla servi statiquement par `src/server.js` (Node `http` natif), WebAudio API pour le son (déjà utilisée dans le fichier), pas de dépendance ajoutée.

## Global Constraints

- Pas de dépendance externe ajoutée (ni librairie de confettis, ni librairie audio) — même philosophie que le son existant (`jouerSonSucces`), tout en vanilla.
- Noms de variables/fonctions en français, cohérent avec le reste du fichier (`validerPeriode`, `signaler`, `jouerSonSucces`, etc.).
- Aucun changement de schéma DB ni de route API : tout se calcule côté client à partir de l'état déjà chargé (`etat`).
- Le breakpoint mobile à utiliser est celui déjà existant : `@media (max-width: 520px)` dans `public/style.css`.
- Pas de suite de tests automatisés frontend dans ce projet (`npm test` ne couvre que `src/` côté serveur, via `node --test`) — vérification manuelle via le serveur de dev (`npm start`, port 3000 par défaut, `greene.db` déjà présent à la racine).

---

## Fichiers concernés

- Modifier : `public/style.css` — media query mobile (nom d'habitude) + nouvelles règles `.confetti` / `@keyframes confetti-chute`.
- Modifier : `public/app.js` — `creerCard()` (ajout `data-joueur`), nouvelle fonction `toutesDailyComplete()`, `validerPeriode()` (détection de transition), nouvelles fonctions `jouerSonJournee()`, `lancerConfettis()`, `celebrerJournee()`.

---

### Task 1: Fix disposition du nom d'habitude sur petit écran

**Files:**
- Modify: `public/style.css:251-257` (bloc `@media (max-width: 520px)` existant)
- Modify: `public/style.css:126-138` (`.habitude-nom`, pour neutraliser `max-width` en mobile)

**Interfaces:**
- Aucune (CSS pur, ne touche à aucune interface JS).

- [ ] **Step 1 : Modifier le bloc media query mobile existant**

Dans `public/style.css`, le bloc actuel (lignes 251-257) est :

```css
@media (max-width: 520px) {
  body { display: flex; flex-direction: column; }
  header { order: 0; }
  main { order: 1; }
  .pied { order: 2; }
  .leaderboard { order: 3; margin: 20px 0 0; }
}
```

Remplace-le par (ajout des 4 règles pour empiler le nom au-dessus de la ligne cases/streak/validation) :

```css
@media (max-width: 520px) {
  body { display: flex; flex-direction: column; }
  header { order: 0; }
  main { order: 1; }
  .pied { order: 2; }
  .leaderboard { order: 3; margin: 20px 0 0; }

  /* La colonne "nom" du bloc-grille a un plancher de largeur de 0 (voir
     .bloc-grille), donc elle s'écrase en premier sur petit écran — jusqu'à
     un retour à la ligne caractère par caractère. Fix : le nom passe en
     pleine largeur sur sa propre ligne, au-dessus de cases/streak/validation
     qu'on repointe explicitement sur leurs colonnes d'origine (2/3/4) pour
     qu'ils restent alignés sous l'entête des jours malgré le décalage
     d'auto-placement provoqué par le span du nom. */
  .habitude-nom-zone { grid-column: 1 / -1; }
  .points { grid-column: 2; }
  .habitude-meta { grid-column: 3; }
  .valider { grid-column: 4; }
}
```

- [ ] **Step 2 : Neutraliser le plafond de largeur du nom en mobile**

Toujours dans `public/style.css`, `.habitude-nom` (lignes 115-138) garde son `max-width: 11rem` en desktop, mais doit pouvoir utiliser toute la largeur de la carte une fois empilé. Ajoute cette règle à l'intérieur du même bloc `@media (max-width: 520px)` (à la suite des 4 lignes ajoutées au Step 1) :

```css
  .habitude-nom { max-width: none; }
```

Le `-webkit-line-clamp: 2` déjà présent sur `.habitude-nom` reste actif comme filet de sécurité pour un nom extrêmement long.

- [ ] **Step 3 : Vérification manuelle**

Lance le serveur de dev depuis la racine du projet (le dossier contenant ce `package.json`, actuellement `4 ARCHIVES/Z projets réussis/Greene Habits/`) :

```bash
npm start
```

Ouvre `http://localhost:3000` dans le navigateur, ouvre les DevTools, réduis la largeur de la fenêtre sous 520px (ou utilise le mode responsive à ~360px de large, la largeur du screenshot qui a révélé le bug). Vérifie que :
- Le nom d'une habitude longue (ex. une habitude nommée "Morning Fast" ou équivalent) s'affiche sur 1-2 lignes lisibles, plus jamais écrasé caractère par caractère.
- Les cases, le streak et le bouton de validation restent bien alignés sur la ligne du dessous, alignés avec l'entête LU/MA/ME/... pour le bloc DAILY.
- Au-dessus de 520px de large, la disposition originale (nom + cases sur la même ligne) est inchangée.

- [ ] **Step 4 : Commit**

```bash
git add public/style.css
git commit -m "fix: empiler le nom d'habitude au-dessus sur petit écran (plus d'écrasement)"
```

---

### Task 2: Animation "journée complète" (confettis + son)

**Files:**
- Modify: `public/style.css` (ajouter les règles `.confetti` et `@keyframes confetti-chute`, à la suite du bloc `@keyframes valider-anneau` autour de la ligne 242)
- Modify: `public/app.js:38-59` (ajouter `jouerSonJournee()` à la suite de `jouerSonSucces()`)
- Modify: `public/app.js:61-76` (`validerPeriode()` : détection de la transition)
- Modify: `public/app.js:198-226` (`creerCard()` : ajout de `data-joueur`)

**Interfaces:**
- Consomme : `etat` (variable module-scope déjà existante, mise à jour par `recharger()`), `habit.type`, `habit.courant`, `habit.objectif`, `joueur.id`, `joueur.couleur` (formes déjà utilisées ailleurs dans le fichier).
- Produit : `toutesDailyComplete(joueur)` → `boolean` ; `celebrerJournee(joueur)` → `void` ; `jouerSonJournee()` → `void` ; `lancerConfettis(carteEl, couleurJoueur)` → `void`. Aucune de ces fonctions n'est exposée sur `window` (usage interne uniquement, comme `jouerSonSucces`).

- [ ] **Step 1 : Ajouter `data-joueur` sur la carte**

Dans `public/app.js`, fonction `creerCard()` (ligne ~198) :

```js
function creerCard(joueur, misEnAvant = false) {
  const card = document.createElement('section');
  card.className = 'card';
  card.style.setProperty('--joueur', joueur.couleur);
  if (misEnAvant) card.classList.add('card-mise-en-avant');
```

Ajoute une ligne juste après `card.style.setProperty(...)` :

```js
function creerCard(joueur, misEnAvant = false) {
  const card = document.createElement('section');
  card.className = 'card';
  card.style.setProperty('--joueur', joueur.couleur);
  card.dataset.joueur = joueur.id;
  if (misEnAvant) card.classList.add('card-mise-en-avant');
```

- [ ] **Step 2 : Ajouter le helper `toutesDailyComplete()`**

Toujours dans `public/app.js`, juste avant la fonction `jouerSonSucces()` (ligne ~38), ajoute :

```js
function toutesDailyComplete(joueur) {
  const dailies = joueur.habits.filter((h) => h.type === 'daily');
  return dailies.length > 0 && dailies.every((h) => h.courant >= h.objectif);
}
```

- [ ] **Step 3 : Ajouter le son de célébration `jouerSonJournee()`**

Juste après la fonction `jouerSonSucces()` existante (qui se termine ligne ~59, juste avant `async function validerPeriode`), ajoute :

```js
// Son plus riche que jouerSonSucces (validation individuelle) : 5 notes
// ascendantes avec une tenue finale plus longue, pour bien se distinguer.
function jouerSonJournee() {
  try {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return;
    audioCtx = audioCtx || new Ctx();
    if (audioCtx.state === 'suspended') audioCtx.resume();
    const t0 = audioCtx.currentTime;
    [523.25, 659.25, 783.99, 1046.5, 1318.51].forEach((freq, i) => {
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      osc.type = 'sine';
      osc.frequency.value = freq;
      const start = t0 + i * 0.09;
      const duree = i === 4 ? 0.6 : 0.28;
      gain.gain.setValueAtTime(0.0001, start);
      gain.gain.exponentialRampToValueAtTime(0.22, start + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + duree);
      osc.connect(gain).connect(audioCtx.destination);
      osc.start(start);
      osc.stop(start + duree + 0.05);
    });
  } catch { /* audio indisponible : on ignore */ }
}
```

- [ ] **Step 4 : Ajouter les confettis `lancerConfettis()` et `celebrerJournee()`**

Juste après `jouerSonJournee()` (donc toujours avant `async function validerPeriode`), ajoute :

```js
const COULEURS_CONFETTI_FESTIVES = ['#FFD700', '#FFFFFF'];

// Confettis positionnés en `fixed` et calés sur getBoundingClientRect() de la
// carte : évite d'être coupés par le border-radius/overflow de .card.
function lancerConfettis(carte, couleurJoueur) {
  const rect = carte.getBoundingClientRect();
  const palette = [couleurJoueur, ...COULEURS_CONFETTI_FESTIVES];
  for (let i = 0; i < 24; i++) {
    const piece = document.createElement('div');
    piece.className = 'confetti';
    const gauche = rect.left + Math.random() * rect.width;
    const duree = 0.8 + Math.random() * 0.6;
    const delai = Math.random() * 0.15;
    const rotation = Math.random() * 360;
    piece.style.left = `${gauche}px`;
    piece.style.top = `${rect.top}px`;
    piece.style.background = palette[Math.floor(Math.random() * palette.length)];
    piece.style.setProperty('--duree', `${duree}s`);
    piece.style.setProperty('--delai', `${delai}s`);
    piece.style.setProperty('--rotation', `${rotation}deg`);
    piece.style.setProperty('--chute', `${rect.height + 40}px`);
    document.body.appendChild(piece);
    setTimeout(() => piece.remove(), (duree + delai) * 1000 + 50);
  }
}

function celebrerJournee(joueur) {
  const carte = document.querySelector(`.card[data-joueur="${joueur.id}"]`);
  if (carte) lancerConfettis(carte, joueur.couleur);
  jouerSonJournee();
}
```

- [ ] **Step 5 : Ajouter les styles CSS des confettis**

Dans `public/style.css`, juste après le bloc `@keyframes valider-anneau { ... }` (qui se termine ligne ~242, juste avant le commentaire `/* Weekly : ... */`), ajoute :

```css
/* Confettis de célébration : toutes les habitudes DAILY du jour validées. */
.confetti {
  position: fixed;
  width: 7px;
  height: 12px;
  border-radius: 2px;
  pointer-events: none;
  z-index: 25;
  transform: rotate(var(--rotation));
  animation: confetti-chute var(--duree) var(--delai) ease-in forwards;
}
@keyframes confetti-chute {
  0%   { transform: translateY(0) rotate(var(--rotation)); opacity: 1; }
  100% { transform: translateY(var(--chute)) rotate(calc(var(--rotation) + 200deg)); opacity: 0; }
}
```

- [ ] **Step 6 : Détecter la transition dans `validerPeriode()` et déclencher la célébration**

Dans `public/app.js`, remplace la fonction `validerPeriode()` actuelle (ligne ~61) :

```js
async function validerPeriode(habit, ref) {
  const avant = habit.courant;
  try {
    const { count } = await envoyer('/api/toggle', { habit_id: habit.id, date_ref: ref });
    const enAvant = count > avant; // progression (pas une remise à zéro)
    await recharger();
    if (window.rafraichirHistorique) window.rafraichirHistorique();
    if (enAvant) {
      jouerSonSucces();
      const btn = document.querySelector(`.valider[data-habit="${habit.id}"]`);
      if (btn) { btn.classList.remove('pop'); void btn.offsetWidth; btn.classList.add('pop'); }
    }
  } catch (err) {
    signaler(err.message);
  }
}
```

par :

```js
async function validerPeriode(habit, ref) {
  const avant = habit.courant;
  const joueurAvant = etat.players.find((p) => p.habits.some((h) => h.id === habit.id));
  const completAvant = toutesDailyComplete(joueurAvant);
  try {
    const { count } = await envoyer('/api/toggle', { habit_id: habit.id, date_ref: ref });
    const enAvant = count > avant; // progression (pas une remise à zéro)
    await recharger();
    if (window.rafraichirHistorique) window.rafraichirHistorique();
    if (enAvant) {
      jouerSonSucces();
      const btn = document.querySelector(`.valider[data-habit="${habit.id}"]`);
      if (btn) { btn.classList.remove('pop'); void btn.offsetWidth; btn.classList.add('pop'); }
      const joueurApres = etat.players.find((p) => p.id === joueurAvant.id);
      if (!completAvant && toutesDailyComplete(joueurApres)) {
        celebrerJournee(joueurApres);
      }
    }
  } catch (err) {
    signaler(err.message);
  }
}
```

Note : `joueurAvant` est capturé avant l'appel API (donc sur l'état pré-mutation), `joueurApres` est relu après `recharger()` (donc sur l'état post-mutation) — c'est cette comparaison avant/après qui garantit que la célébration ne se déclenche qu'une seule fois, exactement au moment où la dernière habitude DAILY manquante du jour est validée, jamais au simple rechargement de page ni en dévalidant.

- [ ] **Step 7 : Vérification manuelle**

Avec le serveur de dev lancé (`npm start`, `http://localhost:3000`) :

1. Choisis un joueur qui a au moins 2 habitudes DAILY, avec au moins une non validée aujourd'hui.
2. Valide l'avant-dernière habitude DAILY manquante → aucune célébration (juste le son/pop individuel habituel).
3. Valide la dernière habitude DAILY manquante → confettis doivent tomber sur la carte de ce joueur + son plus riche que d'habitude.
4. Recharge la page (F5) → aucune célébration ne se redéclenche au chargement, même si toutes les dailies sont déjà validées.
5. Dévalide (reclique) une habitude déjà validée pour repasser sous l'objectif → aucune célébration ne se déclenche (seule la progression déclenche l'effet).
6. Vérifie qu'un joueur qui n'a que des habitudes WEEKLY (aucune DAILY) ne peut jamais déclencher la célébration en validant sa weekly.

- [ ] **Step 8 : Commit**

```bash
git add public/app.js public/style.css
git commit -m "feat: confettis + son quand toutes les habitudes daily du jour sont validées"
```
