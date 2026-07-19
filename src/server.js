import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  openDb, getPlayers, getHabits, getHabit, getCounts, COULEURS,
  createPlayer, createHabit, updateHabit, archiveHabit, toggle, refFor
} from './db.js';
import {
  todayISO, currentWeekDays, lastSevenWeeks, allDaysSince, allWeeksSince
} from './dates.js';
import { dotState, computeStreak, successRate, bestStreak } from './state.js';

const RACINE = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'public');

const TYPES_MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8'
};

// --- Assemblage de l'état -------------------------------------------------

function fenetre(habit, aujourdhui) {
  return habit.type === 'weekly' ? lastSevenWeeks(aujourdhui) : currentWeekDays(aujourdhui);
}

function toutesLesRefs(habit, aujourdhui) {
  return habit.type === 'weekly'
    ? allWeeksSince(habit.created_at, aujourdhui)
    : allDaysSince(habit.created_at, aujourdhui);
}

function pointsDe(habit, counts, refs, refCourante) {
  return refs.map((ref) => {
    const count = counts[ref] || 0;
    // Une période antérieure à la création n'est ni ratée ni en attente :
    // l'habitude n'existait pas, on la neutralise en 'attente'.
    if (ref < refFor(habit, habit.created_at)) {
      return { ref, count: 0, etat: 'attente' };
    }
    return { ref, count, etat: dotState(count, habit.objectif, ref < refCourante) };
  });
}

function construireEtat(db) {
  const aujourdhui = todayISO();
  const habits = getHabits(db);

  const joueurs = getPlayers(db).map((joueur) => ({
    id: joueur.id,
    nom: joueur.nom,
    habits: habits
      .filter((h) => h.player_id === joueur.id)
      .map((h) => {
        const counts = getCounts(db, h.id);
        const refCourante = refFor(h, aujourdhui);
        const refs = fenetre(h, aujourdhui);
        return {
          id: h.id,
          nom: h.nom,
          type: h.type,
          couleur: h.couleur,
          objectif: h.objectif,
          courant: counts[refCourante] || 0,
          streak: computeStreak(toutesLesRefs(h, aujourdhui), counts, h.objectif),
          points: pointsDe(h, counts, refs, refCourante)
        };
      })
  }));

  return { today: aujourdhui, couleurs: COULEURS, players: joueurs };
}

function construireHistorique(db, habitId) {
  const habit = getHabit(db, habitId);
  if (!habit) return null;
  const aujourdhui = todayISO();
  const counts = getCounts(db, habit.id);
  const refs = toutesLesRefs(habit, aujourdhui);
  const refCourante = refFor(habit, aujourdhui);

  return {
    id: habit.id,
    nom: habit.nom,
    type: habit.type,
    couleur: habit.couleur,
    objectif: habit.objectif,
    streak: computeStreak(refs, counts, habit.objectif),
    record: bestStreak(refs, counts, habit.objectif),
    taux: successRate(refs, counts, habit.objectif),
    points: pointsDe(habit, counts, refs, refCourante)
  };
}

// --- Serveur --------------------------------------------------------------

function lireCorps(req) {
  return new Promise((resoudre, rejeter) => {
    let brut = '';
    req.on('data', (m) => {
      brut += m;
      if (brut.length > 1e5) rejeter(new Error('Corps trop volumineux'));
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
  if (!fichier.startsWith(RACINE) || !fs.existsSync(fichier)) {
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

// Démarrage réel uniquement hors tests.
if (process.env.NODE_ENV !== 'test' && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const port = process.env.PORT || 3000;
  createServer(openDb()).listen(port, () => {
    console.log(`Greene Habits écoute sur le port ${port}`);
  });
}
