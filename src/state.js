// Logique de séquence pure : ce module ne connaît ni count, ni objectif, ni
// date — seulement des booléens "réussi" ordonnés du plus ancien au plus
// récent, le dernier élément étant toujours la période en cours. Décider ce
// qui compte comme "réussi" (quel objectif, figé ou courant) est la
// responsabilité de l'appelant (server.js), pas de ce module.

export function dotState(reussi, estPasse) {
  if (reussi) return 'reussi';
  return estPasse ? 'rate' : 'attente';
}

export function computeStreak(reussites) {
  let i = reussites.length - 1;
  // La période en cours ne casse jamais le streak tant qu'elle n'est pas
  // terminée : sinon le compteur retomberait à zéro chaque matin.
  if (i >= 0 && !reussites[i]) i--;
  let streak = 0;
  while (i >= 0 && reussites[i]) {
    streak++;
    i--;
  }
  return streak;
}

export function successRate(reussites) {
  const ecoulees = reussites.slice(0, -1); // la dernière est la période en cours
  if (ecoulees.length === 0) return 0;
  const ok = ecoulees.filter(Boolean).length;
  return Math.round((ok / ecoulees.length) * 100);
}

export function bestStreak(reussites) {
  let meilleur = 0;
  let courant = 0;
  for (const r of reussites) {
    if (r) {
      courant++;
      if (courant > meilleur) meilleur = courant;
    } else {
      courant = 0;
    }
  }
  return meilleur;
}
