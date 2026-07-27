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

// --- Validation de la période en cours (bouton à droite) ------------------

function toutesDailyComplete(joueur) {
  const dailies = joueur.habits.filter((h) => h.type === 'daily');
  return dailies.length > 0 && dailies.every((h) => h.courant >= h.objectif);
}

// Petit arpège synthétisé (do-mi-sol) — gratification satisfaisante, aucun
// fichier externe. L'AudioContext se crée au 1er clic (geste utilisateur).
let audioCtx = null;
function jouerSonSucces() {
  try {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return;
    audioCtx = audioCtx || new Ctx();
    if (audioCtx.state === 'suspended') audioCtx.resume();
    const t0 = audioCtx.currentTime;
    [523.25, 659.25, 783.99].forEach((freq, i) => {
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      osc.type = 'sine';
      osc.frequency.value = freq;
      const start = t0 + i * 0.075;
      gain.gain.setValueAtTime(0.0001, start);
      gain.gain.exponentialRampToValueAtTime(0.2, start + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.28);
      osc.connect(gain).connect(audioCtx.destination);
      osc.start(start);
      osc.stop(start + 0.3);
    });
  } catch { /* audio indisponible : on ignore */ }
}

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

// Sérialisation des validations pour éviter les conditions de course :
// Si deux habitudes sont validées rapidement en succession, chaque appel
// attend que le précédent ait complètement fini (capture → API → recharge)
// avant de commencer. Cela évite que deux appels ne capturent le même
// état pré-mutation et ne déclenchent la célébration deux fois.
let filesAttenteValidation = Promise.resolve();

async function validerPeriode(habit, ref) {
  const tache = filesAttenteValidation.then(() => executerValidation(habit, ref));
  filesAttenteValidation = tache.catch(() => {}); // une erreur ne bloque pas la file
  return tache;
}

async function executerValidation(habit, ref) {
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

// --- Rendu ----------------------------------------------------------------

function creerPoint(habit, point) {
  const bouton = document.createElement('button');
  bouton.className = 'point';
  bouton.dataset.habit = habit.id;
  bouton.dataset.ref = point.ref;
  bouton.title = point.ref;

  if (point.etat === 'reussi') bouton.style.background = habit.couleur;
  else if (point.etat === 'rate') bouton.classList.add('rate');

  // Le serveur seul sait ce qui est cliquable (fenêtre créée→courante) :
  // futur ET périodes antérieures à la création de l'habitude.
  if (!point.cliquable) bouton.classList.add('futur');
  // La case de la période EN COURS n'est plus cliquable : c'est le bouton
  // « valider » à droite qui la valide. Elle reste affichée (historique).
  if (point.actuel) bouton.classList.add('actuel');
  return bouton;
}

// Une habitude = une seule ligne. `display: contents` (en CSS) fait remonter
// ses 3 enfants — nom, points, streak — comme cellules de la grille du bloc,
// pour que toutes les lignes s'alignent en colonnes.
function creerHabitude(habit) {
  const bloc = document.createElement('div');
  bloc.className = 'habitude';

  const nomZone = document.createElement('div');
  nomZone.className = 'habitude-nom-zone';

  const nom = document.createElement('button');
  nom.className = 'habitude-nom';
  nom.textContent = habit.nom;
  nom.addEventListener('click', () => window.ouvrirHistorique(habit.id));

  const supprimer = document.createElement('button');
  supprimer.type = 'button';
  supprimer.className = 'btn-supprimer';
  supprimer.textContent = '×';
  supprimer.setAttribute('aria-label', `Supprimer ${habit.nom}`);
  supprimer.addEventListener('click', (e) => {
    e.stopPropagation();
    menuSuppression(habit);
  });

  nomZone.append(nom, supprimer);

  const points = document.createElement('div');
  // Daily : 7 colonnes alignées sous l'entête LU..DI. Weekly : 4 semaines.
  points.className = habit.type === 'weekly' ? 'points points-weekly' : 'points';
  habit.points.forEach((p) => points.appendChild(creerPoint(habit, p)));

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

  // Bouton de validation de la période EN COURS (grande cible à droite).
  const pointActuel = habit.points.find((p) => p.actuel);
  const valider = document.createElement('button');
  valider.type = 'button';
  valider.className = 'valider';
  valider.dataset.habit = habit.id;
  valider.textContent = '✔';
  valider.style.setProperty('--h', habit.couleur);
  const fait = habit.courant >= habit.objectif;
  if (fait) valider.classList.add('fait');
  valider.setAttribute('aria-label',
    fait ? `Annuler la validation de ${habit.nom}` : `Valider ${habit.nom} pour la période en cours`);
  if (pointActuel) {
    valider.addEventListener('click', () => validerPeriode(habit, pointActuel.ref));
  } else {
    valider.disabled = true; // période en cours hors fenêtre (ne devrait pas arriver)
  }

  bloc.append(nomZone, points, meta, valider);
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

  const grille = document.createElement('div');
  grille.className = 'bloc-grille';

  if (avecEnteteJours) {
    // Entête = 4 cellules de grille : colonne nom vide, les 7 jours (calés
    // sur les points), colonne streak vide, colonne bouton valider vide.
    grille.appendChild(document.createElement('span'));
    const entete = document.createElement('div');
    entete.className = 'jours-entete';
    JOURS.forEach((j) => {
      const cellule = document.createElement('span');
      cellule.textContent = j;
      entete.appendChild(cellule);
    });
    grille.appendChild(entete);
    grille.appendChild(document.createElement('span'));
    grille.appendChild(document.createElement('span'));
  }

  habits.forEach((h) => grille.appendChild(creerHabitude(h)));
  bloc.appendChild(grille);
  return bloc;
}

function creerCard(joueur, misEnAvant = false) {
  const card = document.createElement('section');
  card.className = 'card';
  card.style.setProperty('--joueur', joueur.couleur);
  card.dataset.joueur = joueur.id;
  if (misEnAvant) card.classList.add('card-mise-en-avant');

  const titre = document.createElement('button');
  titre.type = 'button';
  titre.className = 'card-titre';
  titre.textContent = joueur.nom;
  titre.addEventListener('click', () => window.ouvrirProfil(joueur.id));
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

// Segment de l'URL (ex. `/anatole` → `anatole`), ou null pour `/` ou un
// chemin vide. Ne fait aucune validation : un slug inconnu est traité comme
// n'importe quel segment, ordonnerJoueurs() ne trouvera juste personne.
function segmentJoueurURL() {
  const segment = location.pathname.split('/').filter(Boolean)[0];
  return segment ? segment.toLowerCase() : null;
}

// Aucun filtrage : tout le monde reste affiché, seul l'ordre change. Un slug
// absent ou inconnu renvoie la liste telle quelle (ordre normal, pas d'erreur).
function ordonnerJoueurs(joueurs, slug) {
  if (!slug) return joueurs;
  const index = joueurs.findIndex((j) => j.slug === slug);
  if (index <= 0) return joueurs;
  const copie = joueurs.slice();
  const [promu] = copie.splice(index, 1);
  copie.unshift(promu);
  return copie;
}

function rendre() {
  document.getElementById('date-jour').textContent =
    new Date(`${etat.today}T12:00:00Z`).toLocaleDateString('fr-CH', {
      weekday: 'long', day: 'numeric', month: 'long'
    });

  rendreLeaderboard();

  const conteneur = document.getElementById('joueurs');
  conteneur.textContent = '';
  const slugCible = segmentJoueurURL();
  ordonnerJoueurs(etat.players, slugCible)
    .forEach((j) => conteneur.appendChild(creerCard(j, j.slug === slugCible)));
}

// --- Leaderboard mensuel ----------------------------------------------------

function creerLigneLeaderboard(entree, rang, estDernier) {
  const ligne = document.createElement('div');
  ligne.className = 'leaderboard-ligne';
  if (rang === 1) ligne.classList.add('leaderboard-ligne-premier');
  if (estDernier) ligne.classList.add('leaderboard-ligne-dernier');

  const rangEl = document.createElement('span');
  rangEl.className = 'leaderboard-rang';
  rangEl.textContent = String(rang);

  const nomEl = document.createElement('span');
  nomEl.className = 'leaderboard-nom';
  nomEl.textContent = entree.nom;

  const compteEl = document.createElement('span');
  compteEl.className = 'leaderboard-compte';
  compteEl.textContent = `${entree.trahisons} trahison${entree.trahisons > 1 ? 's' : ''}`;

  ligne.append(rangEl, nomEl, compteEl);
  return ligne;
}

function rendreLeaderboard() {
  const conteneur = document.getElementById('leaderboard');
  conteneur.textContent = '';

  const classement = etat.leaderboard || [];
  if (classement.length === 0) {
    conteneur.classList.add('cache');
    return;
  }
  conteneur.classList.remove('cache');

  const entete = document.createElement('div');
  entete.className = 'leaderboard-entete';
  const titre = document.createElement('h2');
  titre.textContent = 'Qui a le plus trahi ses paroles ?';
  const sousTitre = document.createElement('span');
  sousTitre.className = 'leaderboard-mois';
  sousTitre.textContent = etat.mois;
  entete.append(titre, sousTitre);
  conteneur.appendChild(entete);

  const toutesAZero = classement.every((e) => e.trahisons === 0);
  if (toutesAZero) {
    const neutre = document.createElement('p');
    neutre.className = 'leaderboard-neutre';
    neutre.textContent = 'Personne n\'a encore trahi ce mois-ci.';
    conteneur.appendChild(neutre);
    return;
  }

  const liste = document.createElement('div');
  liste.className = 'leaderboard-liste';
  classement.forEach((entree, i) => {
    const estDernier = classement.length > 1 && i === classement.length - 1;
    liste.appendChild(creerLigneLeaderboard(entree, i + 1, estDernier));
  });
  conteneur.appendChild(liste);
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

  const intentionNote = creerChampIntention('Je vais...', 'méditer 10 minutes chaque matin');
  const intentionMomentLieu = creerChampIntention(null, 'Moment / lieu (optionnel)');
  const intentionIdentite = creerChampIntention('pour devenir...', 'type de personne que je veux devenir (optionnel)');

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

  card.querySelector('.card-actions').before(form);
  nom.focus();
}

// --- Interactions globales ------------------------------------------------

document.addEventListener('click', async (e) => {
  const point = e.target.closest('.point');
  if (!point || point.classList.contains('futur')) return;
  const habitId = Number(point.dataset.habit);
  const ref = point.dataset.ref;

  // Case de la période EN COURS : même validation que le bouton (son + anim).
  if (point.classList.contains('actuel')) {
    const habit = etat && etat.players
      .flatMap((p) => p.habits)
      .find((h) => h.id === habitId);
    if (habit) validerPeriode(habit, ref);
    return;
  }

  // Cases passées : simple correction (bascule + rechargement).
  try {
    await envoyer('/api/toggle', { habit_id: habitId, date_ref: ref });
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

// --- Popup d'historique ---------------------------------------------------

const popup = document.getElementById('popup');
const popupContenu = document.getElementById('popup-contenu');
let habitOuverte = null;
let profilOuvert = null;
// null (ouvert depuis l'accueil) ou 'profil' (ouvert depuis le popup profil,
// auquel cas un lien « ← retour au profil » doit apparaître dans le détail).
let origineHistorique = null;

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

  if (origineHistorique === 'profil') {
    const retour = document.createElement('button');
    retour.type = 'button';
    retour.className = 'retour-profil';
    retour.textContent = '← retour au profil';
    retour.addEventListener('click', () => window.ouvrirProfil(profilOuvert));
    popupContenu.appendChild(retour);
  }

  const titre = document.createElement('h2');
  titre.textContent = donnees.nom;
  titre.style.margin = '0';
  popupContenu.appendChild(titre);

  if (donnees.note) {
    const note = document.createElement('div');
    note.className = 'note';
    note.textContent = donnees.note;
    popupContenu.appendChild(note);
  }

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
  actions.appendChild(modifier);

  // Archiver : seulement pour une habitude encore active.
  if (!donnees.archived_at) {
    const archiver = document.createElement('button');
    archiver.className = 'btn-discret';
    archiver.textContent = 'Archiver';
    archiver.addEventListener('click', async () => {
      if (!confirm(`Archiver « ${donnees.nom} » ? L'historique est conservé.`)) return;
      try {
        await envoyer(`/api/habits/${donnees.id}/archive`, {});
        fermerPopup();
        await recharger();
      } catch (err) {
        signaler(err.message);
      }
    });
    actions.appendChild(archiver);
  }

  // Supprimer définitivement : disponible partout, y compris pour une ancienne
  // habitude ouverte depuis le profil (c'est là qu'on supprime les archivées).
  const supprimer = document.createElement('button');
  supprimer.className = 'btn-danger';
  supprimer.textContent = 'Supprimer définitivement';
  supprimer.addEventListener('click', async () => {
    if (!confirm(`Supprimer DÉFINITIVEMENT « ${donnees.nom} » ? Tout son historique sera perdu — irréversible.`)) return;
    try {
      await envoyer(`/api/habits/${donnees.id}/delete`, {});
      await recharger();
      // Si on venait du profil, y revenir (mis à jour) ; sinon fermer.
      if (origineHistorique === 'profil' && profilOuvert !== null) {
        window.ouvrirProfil(profilOuvert);
      } else {
        fermerPopup();
      }
    } catch (err) {
      signaler(err.message);
    }
  });
  actions.appendChild(supprimer);

  popupContenu.appendChild(actions);
}

function formulaireEdition(donnees) {
  if (popupContenu.querySelector('.formulaire')) return;
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

  const intentionNote = creerChampIntention('Je vais...', 'méditer 10 minutes chaque matin', donnees.note || '');
  const intentionMomentLieu = creerChampIntention(null, 'Moment / lieu (optionnel)', donnees.moment_lieu || '');
  const intentionIdentite = creerChampIntention('pour devenir...', 'type de personne que je veux devenir (optionnel)', donnees.identite || '');

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
  annuler.addEventListener('click', () => { window.rafraichirHistorique().catch((err) => signaler(err.message)); });
  boutons.append(valider, annuler);

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

  popupContenu.appendChild(form);
  nom.focus();
}

function fermerPopup() {
  popup.classList.add('cache');
  habitOuverte = null;
  profilOuvert = null;
  origineHistorique = null;
}

// Menu au clic sur la croix : archiver (garde l'historique dans le profil) OU
// supprimer définitivement (efface l'habitude et tout son historique).
function menuSuppression(habit) {
  popupContenu.textContent = '';
  origineHistorique = null;
  habitOuverte = null;
  profilOuvert = null;
  popup.classList.remove('cache');

  const titre = document.createElement('h2');
  titre.textContent = habit.nom;
  titre.style.margin = '0';

  const question = document.createElement('div');
  question.className = 'note';
  question.textContent = 'Que faire de cette habitude ?';

  const actions = document.createElement('div');
  actions.className = 'menu-suppression';

  const archiver = document.createElement('button');
  archiver.className = 'btn-principal';
  archiver.textContent = 'Archiver (garder dans le profil)';
  archiver.addEventListener('click', async () => {
    try {
      await envoyer(`/api/habits/${habit.id}/archive`, {});
      fermerPopup();
      await recharger();
    } catch (err) { signaler(err.message); }
  });

  const supprimer = document.createElement('button');
  supprimer.className = 'btn-danger';
  supprimer.textContent = 'Supprimer définitivement';
  supprimer.addEventListener('click', async () => {
    if (!confirm(`Supprimer DÉFINITIVEMENT « ${habit.nom} » ? Tout son historique sera perdu — c'est irréversible.`)) return;
    try {
      await envoyer(`/api/habits/${habit.id}/delete`, {});
      fermerPopup();
      await recharger();
    } catch (err) { signaler(err.message); }
  });

  const annuler = document.createElement('button');
  annuler.className = 'btn-discret';
  annuler.textContent = 'Annuler';
  annuler.addEventListener('click', fermerPopup);

  actions.append(archiver, supprimer, annuler);
  popupContenu.append(titre, question, actions);
}

window.ouvrirHistorique = async (habitId, origine = null) => {
  habitOuverte = habitId;
  origineHistorique = origine;
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

// --- Popup de profil joueur -------------------------------------------------

function creerLigneProfil(habit) {
  const ligne = document.createElement('button');
  ligne.type = 'button';
  ligne.className = 'profil-ligne';
  if (habit.archived_at) ligne.classList.add('profil-ligne-archivee');
  ligne.addEventListener('click', () => window.ouvrirHistorique(habit.id, 'profil'));

  const pastille = document.createElement('span');
  pastille.className = 'profil-pastille';
  pastille.style.background = habit.couleur;

  const nom = document.createElement('span');
  nom.className = 'profil-nom';
  nom.textContent = habit.nom;

  const infos = document.createElement('span');
  infos.className = 'profil-infos';
  infos.textContent = habit.archived_at
    ? `🔥 ${habit.streak} · ${habit.taux}% · archivée le ${habit.archived_at}`
    : `🔥 ${habit.streak} · ${habit.taux}%`;

  ligne.append(pastille, nom, infos);
  return ligne;
}

function rendreProfil(donnees) {
  popupContenu.textContent = '';

  const titre = document.createElement('h2');
  titre.textContent = donnees.nom;
  titre.style.margin = '0';
  popupContenu.appendChild(titre);

  // Le slug n'est pas renvoyé par /api/profile : on le relit dans l'état déjà
  // chargé (/api/state) plutôt que de faire un aller-retour serveur dédié.
  const joueurEtat = etat && etat.players.find((j) => j.id === donnees.id);
  if (joueurEtat) {
    const lien = document.createElement('a');
    lien.className = 'profil-lien';
    lien.href = `/${joueurEtat.slug}`;
    lien.textContent = `${location.origin}/${joueurEtat.slug}`;
    popupContenu.appendChild(lien);
  }

  const trahisons = document.createElement('div');
  trahisons.className = 'profil-trahisons';
  trahisons.textContent =
    `${donnees.trahisonsMois} trahison${donnees.trahisonsMois > 1 ? 's' : ''} ce mois-ci`;
  popupContenu.appendChild(trahisons);

  const sectionActives = document.createElement('div');
  sectionActives.className = 'profil-section';
  const titreActives = document.createElement('div');
  titreActives.className = 'bloc-titre';
  titreActives.textContent = 'Habitudes actuelles';
  sectionActives.appendChild(titreActives);
  donnees.actives.forEach((h) => sectionActives.appendChild(creerLigneProfil(h)));
  popupContenu.appendChild(sectionActives);

  if (donnees.archivees.length > 0) {
    const sectionArchivees = document.createElement('div');
    sectionArchivees.className = 'profil-section';
    const titreArchivees = document.createElement('div');
    titreArchivees.className = 'bloc-titre';
    titreArchivees.textContent = 'Anciennes habitudes';
    sectionArchivees.appendChild(titreArchivees);
    donnees.archivees.forEach((h) => sectionArchivees.appendChild(creerLigneProfil(h)));
    popupContenu.appendChild(sectionArchivees);
  }
}

window.ouvrirProfil = async (playerId) => {
  profilOuvert = playerId;
  habitOuverte = null;
  origineHistorique = null;
  popup.classList.remove('cache');
  popupContenu.textContent = 'Chargement…';
  try {
    rendreProfil(await api(`/api/profile?player_id=${playerId}`));
  } catch (err) {
    signaler(err.message);
    fermerPopup();
  }
};

document.getElementById('popup-fermer').addEventListener('click', fermerPopup);
popup.addEventListener('click', (e) => { if (e.target === popup) fermerPopup(); });
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') fermerPopup(); });

recharger().catch((err) => signaler(err.message));
