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
  supprimer.addEventListener('click', async (e) => {
    e.stopPropagation();
    if (!confirm(`Supprimer « ${habit.nom} » ? Elle restera dans l'historique du profil.`)) return;
    try {
      await envoyer(`/api/habits/${habit.id}/archive`, {});
      await recharger();
    } catch (err) {
      signaler(err.message);
    }
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

  bloc.append(nomZone, points, meta);
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
    // Entête = 3 cellules de grille : colonne nom vide, les 7 jours (calés
    // sur les points), colonne streak vide.
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
  }

  habits.forEach((h) => grille.appendChild(creerHabitude(h)));
  bloc.appendChild(grille);
  return bloc;
}

function creerCard(joueur, misEnAvant = false) {
  const card = document.createElement('section');
  card.className = 'card';
  card.style.setProperty('--joueur', joueur.couleur);
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

  const note = document.createElement('input');
  note.placeholder = 'Note — à quoi t\'engages-tu ? (optionnel)';

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

  card.querySelector('.card-actions').before(form);
  nom.focus();
}

// --- Interactions globales ------------------------------------------------

document.addEventListener('click', async (e) => {
  const point = e.target.closest('.point');
  if (!point || point.classList.contains('futur')) return;
  try {
    await envoyer('/api/toggle', {
      habit_id: Number(point.dataset.habit),
      date_ref: point.dataset.ref
    });
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

  actions.append(modifier, archiver);
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

  const note = document.createElement('input');
  note.placeholder = 'Note — à quoi t\'engages-tu ? (optionnel)';
  note.value = donnees.note || '';

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

  popupContenu.appendChild(form);
  nom.focus();
}

function fermerPopup() {
  popup.classList.add('cache');
  habitOuverte = null;
  profilOuvert = null;
  origineHistorique = null;
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
