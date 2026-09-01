// Toutes les dates sont des chaînes 'YYYY-MM-DD'. Les calculs passent par des
// Date en UTC pour éviter tout décalage d'heure d'été : on ne manipule que des
// jours entiers, jamais des instants.

const JOUR_MS = 86400000;

function parse(dateISO) {
  return new Date(`${dateISO}T00:00:00Z`);
}

function format(d) {
  return d.toISOString().slice(0, 10);
}

export function todayISO(now = new Date()) {
  // Seam de test : GREENE_TODAY fige « aujourd'hui » pour les tests dont
  // l'assertion dépend du calendrier réel — les trahisons ne comptent que dans
  // le mois en cours, or un test exécuté le 1er du mois n'a aucun jour passé à
  // juger et échoue à tort. Jamais définie en production.
  if (process.env.GREENE_TODAY) return process.env.GREENE_TODAY;
  // en-CA rend justement 'YYYY-MM-DD'
  return now.toLocaleDateString('en-CA', { timeZone: 'Europe/Zurich' });
}

export function addDays(dateISO, n) {
  return format(new Date(parse(dateISO).getTime() + n * JOUR_MS));
}

export function mondayOf(dateISO) {
  const d = parse(dateISO);
  // getUTCDay : 0 = dimanche … 6 = samedi. On veut 0 = lundi.
  const decalage = (d.getUTCDay() + 6) % 7;
  return addDays(dateISO, -decalage);
}

export function currentWeekDays(todayISO) {
  const lundi = mondayOf(todayISO);
  return Array.from({ length: 7 }, (_, i) => addDays(lundi, i));
}

// Les `count` dernières semaines, la semaine en cours en dernier (à droite),
// les précédentes avant. Aucune semaine future. Ex. count=4 → 3 semaines
// passées + la semaine en cours.
export function lastWeeks(todayISO, count) {
  const lundi = mondayOf(todayISO);
  return Array.from({ length: count }, (_, i) => addDays(lundi, (i - (count - 1)) * 7));
}

export function allDaysSince(startISO, endISO) {
  const jours = [];
  let courant = startISO;
  while (courant <= endISO) {
    jours.push(courant);
    courant = addDays(courant, 1);
  }
  return jours;
}

export function allWeeksSince(startISO, endISO) {
  const semaines = [];
  let courant = mondayOf(startISO);
  const fin = mondayOf(endISO);
  while (courant <= fin) {
    semaines.push(courant);
    courant = addDays(courant, 7);
  }
  return semaines;
}

export function firstOfMonth(dateISO) {
  return `${dateISO.slice(0, 7)}-01`;
}
