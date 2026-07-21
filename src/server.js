import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  openDb, getPlayers, getHabits, getAllHabits, getHabit, getEntries, COULEURS,
  createPlayer, createHabit, updateHabit, archiveHabit, toggle, refFor, slugifier
} from './db.js';
import {
  todayISO, currentWeekDays, lastWeeks, allDaysSince, allWeeksSince, firstOfMonth
} from './dates.js';
import { dotState, computeStreak, successRate, bestStreak } from './state.js';

const RACINE = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'public');

const TYPES_MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8'
};

// --- Assemblage de l'état -------------------------------------------------

// Fenêtre affichée sur la carte : 7 jours (semaine en cours) pour une daily,
// 4 semaines (la semaine en cours + les 3 précédentes) pour une weekly.
const SEMAINES_AFFICHEES = 4;
function fenetre(habit, aujourdhui) {
  return habit.type === 'weekly'
    ? lastWeeks(aujourdhui, SEMAINES_AFFICHEES)
    : currentWeekDays(aujourdhui);
}

function toutesLesRefs(habit, aujourdhui) {
  return habit.type === 'weekly'
    ? allWeeksSince(habit.created_at, aujourdhui)
    : allDaysSince(habit.created_at, aujourdhui);
}

// L'objectif qui juge une période : celui en vigueur au moment où l'entry a
// été écrite (figé), sauf pour la période courante qui suit toujours
// l'objectif actuel de l'habitude — c'est ce qui permet d'augmenter la barre
// sans repeindre en rouge les périodes déjà réussies.
function cibleDe(habit, entries, ref, refCourante) {
  if (ref === refCourante) return habit.objectif;
  return entries[ref]?.objectif ?? habit.objectif;
}

function estReussi(habit, entries, ref, refCourante) {
  const count = entries[ref]?.count || 0;
  return count >= cibleDe(habit, entries, ref, refCourante);
}

function pointsDe(habit, entries, refs, refCourante) {
  const refCreation = refFor(habit, habit.created_at);
  return refs.map((ref) => {
    const count = entries[ref]?.count || 0;
    // Fenêtre exacte acceptée par toggle() : hors de là, le point n'est pas cliquable.
    const cliquable = ref >= refCreation && ref <= refCourante;
    // Une période antérieure à la création n'existait pas.
    if (ref < refCreation) {
      return { ref, count: 0, etat: 'attente', cliquable };
    }
    const reussi = estReussi(habit, entries, ref, refCourante);
    // La période de création est partielle : elle ne peut jamais être ratée.
    if (ref === refCreation) {
      return { ref, count, etat: reussi ? 'reussi' : 'attente', cliquable };
    }
    return { ref, count, etat: dotState(reussi, ref < refCourante), cliquable };
  });
}

// La période de création est partielle : si elle n'a pas été atteinte, elle
// ne compte ni comme réussite ni comme échec dans les statistiques. Renvoie
// directement la séquence de booléens attendue par computeStreak/bestStreak/successRate.
function reussitesPourStats(habit, entries, refs, refCourante) {
  const refCreation = refFor(habit, habit.created_at);
  const utiles = estReussi(habit, entries, refCreation, refCourante)
    ? refs
    : refs.filter((r) => r !== refCreation);
  return utiles.map((ref) => estReussi(habit, entries, ref, refCourante));
}

// Une trahison = une période PASSÉE, dans le mois calendaire en cours, que
// l'habitude n'a pas atteinte. La période de création et la période
// d'archivage sont toutes deux partielles (l'habitude n'a existé qu'une
// fraction de la période) : ni l'une ni l'autre ne compte, tout comme la
// période en cours. Une habitude archivée cesse d'accumuler des trahisons
// dès sa période d'archivage, mais garde celles d'avant.
function trahisonsDeLHabitude(habit, entries, aujourdhui) {
  const debutMois = firstOfMonth(aujourdhui);
  const refCourante = refFor(habit, aujourdhui);
  const refCreation = refFor(habit, habit.created_at);
  const refFin = habit.archived_at ? refFor(habit, habit.archived_at) : refCourante;

  return toutesLesRefs(habit, aujourdhui).filter((ref) => {
    if (ref < debutMois) return false;      // hors du mois en cours
    if (ref >= refCourante) return false;   // période en cours ou future
    // La période d'archivage est partielle au même titre que celle de création :
    // l'habitude a été arrêtée en cours de route, on ne la juge pas dessus.
    if (habit.archived_at && ref >= refFin) return false;
    if (ref === refCreation) return false;  // période de création, partielle
    return !estReussi(habit, entries, ref, refCourante);
  }).length;
}

// Classement mensuel des trahisons, toutes habitudes confondues (archivées
// comprises : elles gardent les trahisons accumulées avant leur archivage).
function construireLeaderboard(db, aujourdhui) {
  const habits = getAllHabits(db);
  return getPlayers(db)
    .map((joueur) => ({
      player_id: joueur.id,
      nom: joueur.nom,
      trahisons: habits
        .filter((h) => h.player_id === joueur.id)
        .reduce((total, h) =>
          total + trahisonsDeLHabitude(h, getEntries(db, h.id), aujourdhui), 0)
    }))
    .sort((a, b) => a.trahisons - b.trahisons || a.nom.localeCompare(b.nom, 'fr'));
}

function construireEtat(db) {
  const aujourdhui = todayISO();
  const habits = getHabits(db);

  const joueurs = getPlayers(db).map((joueur) => ({
    id: joueur.id,
    nom: joueur.nom,
    couleur: joueur.couleur,
    slug: slugifier(joueur.nom),
    habits: habits
      .filter((h) => h.player_id === joueur.id)
      .map((h) => {
        const entries = getEntries(db, h.id);
        const refCourante = refFor(h, aujourdhui);
        const refs = fenetre(h, aujourdhui);
        const reussites = reussitesPourStats(h, entries, toutesLesRefs(h, aujourdhui), refCourante);
        return {
          id: h.id,
          nom: h.nom,
          type: h.type,
          couleur: h.couleur,
          objectif: h.objectif,
          courant: entries[refCourante]?.count || 0,
          streak: computeStreak(reussites),
          points: pointsDe(h, entries, refs, refCourante)
        };
      })
  }));

  return {
    today: aujourdhui,
    mois: new Date(`${aujourdhui}T12:00:00Z`).toLocaleDateString('fr-CH', { month: 'long', year: 'numeric' }),
    couleurs: COULEURS,
    players: joueurs,
    leaderboard: construireLeaderboard(db, aujourdhui)
  };
}

// Statistiques d'une habitude, réutilisées à la fois par l'historique détaillé
// (avec les points) et par le profil joueur (sans les points).
function statsHabit(habit, entries, aujourdhui) {
  const refs = toutesLesRefs(habit, aujourdhui);
  const refCourante = refFor(habit, aujourdhui);
  const reussites = reussitesPourStats(habit, entries, refs, refCourante);

  return {
    id: habit.id,
    nom: habit.nom,
    type: habit.type,
    couleur: habit.couleur,
    objectif: habit.objectif,
    note: habit.note,
    archived_at: habit.archived_at,
    streak: computeStreak(reussites),
    record: bestStreak(reussites),
    taux: successRate(reussites),
    trahisonsMois: trahisonsDeLHabitude(habit, entries, aujourdhui)
  };
}

function construireHistorique(db, habitId) {
  const habit = getHabit(db, habitId);
  if (!habit) return null;
  const aujourdhui = todayISO();
  const entries = getEntries(db, habit.id);
  const refs = toutesLesRefs(habit, aujourdhui);
  const refCourante = refFor(habit, aujourdhui);

  return {
    ...statsHabit(habit, entries, aujourdhui),
    points: pointsDe(habit, entries, refs, refCourante)
  };
}

// Profil joueur : ses habitudes actives et archivées (celles-ci gardent leurs
// trahisons passées, cf. trahisonsDeLHabitude), null si le joueur n'existe pas.
function construireProfil(db, playerId) {
  const joueur = getPlayers(db).find((j) => j.id === playerId);
  if (!joueur) return null;

  const aujourdhui = todayISO();
  const habits = getAllHabits(db).filter((h) => h.player_id === playerId);
  const actives = habits
    .filter((h) => !h.archived)
    .map((h) => statsHabit(h, getEntries(db, h.id), aujourdhui));
  const archivees = habits
    .filter((h) => h.archived)
    .map((h) => statsHabit(h, getEntries(db, h.id), aujourdhui));

  return {
    id: joueur.id,
    nom: joueur.nom,
    trahisonsMois: [...actives, ...archivees].reduce((total, h) => total + h.trahisonsMois, 0),
    actives,
    archivees
  };
}

// --- Serveur --------------------------------------------------------------

function lireCorps(req) {
  return new Promise((resoudre, rejeter) => {
    let brut = '';
    req.on('data', (m) => {
      brut += m;
      if (brut.length > 1e5) {
        rejeter(new Error('Corps trop volumineux'));
        req.destroy();
      }
    });
    req.on('end', () => {
      try { resoudre(brut ? JSON.parse(brut) : {}); }
      catch { rejeter(new Error('JSON invalide')); }
    });
  });
}

function envoyerJson(res, statut, donnees) {
  const corps = JSON.stringify(donnees);
  res.writeHead(statut, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(corps)
  });
  res.end(corps);
}

function servirStatique(res, urlPath) {
  const nom = urlPath === '/' ? '/index.html' : urlPath;
  const fichier = path.join(RACINE, path.normalize(nom).replace(/^(\.\.[/\\])+/, ''));
  if (!fichier.startsWith(RACINE)) {
    res.writeHead(404).end('Not found');
    return;
  }
  if (!fs.existsSync(fichier)) {
    // Une URL de joueur (ex: /nicolas) n'a pas de fichier correspondant : le
    // routage se fait côté client, donc on sert index.html — mais seulement
    // si le chemin n'a pas d'extension, sinon un asset cassé (/absent.css)
    // renverrait silencieusement du HTML au lieu d'un 404 franc.
    if (path.extname(nom) === '') {
      return servirStatique(res, '/index.html');
    }
    res.writeHead(404).end('Not found');
    return;
  }
  res.writeHead(200, { 'Content-Type': TYPES_MIME[path.extname(fichier)] || 'application/octet-stream' });
  fs.createReadStream(fichier).pipe(res);
}

export function createServer(db) {
  return http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://localhost');
    const chemin = url.pathname;

    if (!chemin.startsWith('/api/')) {
      return servirStatique(res, chemin);
    }

    try {
      if (req.method === 'GET' && chemin === '/api/state') {
        return envoyerJson(res, 200, construireEtat(db));
      }

      if (req.method === 'GET' && chemin === '/api/history') {
        const historique = construireHistorique(db, Number(url.searchParams.get('habit_id')));
        return historique
          ? envoyerJson(res, 200, historique)
          : envoyerJson(res, 404, { erreur: 'Habitude introuvable' });
      }

      if (req.method === 'GET' && chemin === '/api/profile') {
        const profil = construireProfil(db, Number(url.searchParams.get('player_id')));
        return profil
          ? envoyerJson(res, 200, profil)
          : envoyerJson(res, 404, { erreur: 'Joueur introuvable' });
      }

      if (req.method === 'POST' && chemin === '/api/players') {
        const { nom } = await lireCorps(req);
        return envoyerJson(res, 201, createPlayer(db, nom));
      }

      if (req.method === 'POST' && chemin === '/api/habits') {
        const corps = await lireCorps(req);
        return envoyerJson(res, 201, createHabit(db, corps));
      }

      const majHabit = chemin.match(/^\/api\/habits\/(\d+)$/);
      if (req.method === 'PATCH' && majHabit) {
        const corps = await lireCorps(req);
        return envoyerJson(res, 200, updateHabit(db, Number(majHabit[1]), corps));
      }

      const archive = chemin.match(/^\/api\/habits\/(\d+)\/archive$/);
      if (req.method === 'POST' && archive) {
        archiveHabit(db, Number(archive[1]));
        return envoyerJson(res, 200, { ok: true });
      }

      if (req.method === 'POST' && chemin === '/api/toggle') {
        const { habit_id, date_ref } = await lireCorps(req);
        return envoyerJson(res, 200, { count: toggle(db, Number(habit_id), date_ref) });
      }

      return envoyerJson(res, 404, { erreur: 'Route inconnue' });
    } catch (e) {
      return envoyerJson(res, 400, { erreur: e.message });
    }
  });
}

// Démarrage réel uniquement hors tests. `process.argv[1]` est absent quand le
// module est importé sans script d'entrée (`node -e`, outillage) : sans ce
// garde, pathToFileURL lèverait et l'import échouerait.
const lanceDirectement =
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;

if (process.env.NODE_ENV !== 'test' && lanceDirectement) {
  const port = process.env.PORT || 3000;
  createServer(openDb()).listen(port, () => {
    console.log(`Greene Habits écoute sur le port ${port}`);
  });
}
