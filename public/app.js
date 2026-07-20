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

function creerHabitude(habit) {
  const bloc = document.createElement('div');
  bloc.className = 'habitude';

  const entete = document.createElement('div');
  entete.className = 'habitude-entete';

  const nom = document.createElement('button');
  nom.className = 'habitude-nom';
  nom.textContent = habit.nom;
  nom.addEventListener('click', () => window.ouvrirHistorique(habit.id));

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

  entete.append(nom, meta);

  const points = document.createElement('div');
  points.className = 'points';
  habit.points.forEach((p) => points.appendChild(creerPoint(habit, p)));

  bloc.append(entete, points);
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

  if (avecEnteteJours) {
    const entete = document.createElement('div');
    entete.className = 'jours-entete';
    JOURS.forEach((j) => {
      const cellule = document.createElement('span');
      cellule.textContent = j;
      entete.appendChild(cellule);
    });
    bloc.appendChild(entete);
  }

  habits.forEach((h) => bloc.appendChild(creerHabitude(h)));
  return bloc;
}

function creerCard(joueur) {
  const card = document.createElement('section');
  card.className = 'card';

  const titre = document.createElement('h2');
  titre.textContent = joueur.nom;
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

function rendre() {
  document.getElementById('date-jour').textContent =
    new Date(`${etat.today}T12:00:00Z`).toLocaleDateString('fr-CH', {
      weekday: 'long', day: 'numeric', month: 'long'
    });

  rendreLeaderboard();

  const conteneur = document.getElementById('joueurs');
  conteneur.textContent = '';
  etat.players.forEach((j) => conteneur.appendChild(creerCard(j)));
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
}

window.ouvrirHistorique = async (habitId) => {
  habitOuverte = habitId;
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

document.getElementById('popup-fermer').addEventListener('click', fermerPopup);
popup.addEventListener('click', (e) => { if (e.target === popup) fermerPopup(); });
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') fermerPopup(); });

recharger().catch((err) => signaler(err.message));
