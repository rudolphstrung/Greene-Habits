// Aucun état n'est stocké en base : un point se déduit toujours de son compteur,
// de l'objectif de l'habitude et de la position de sa période dans le temps.

export function dotState(count, objectif, estPasse) {
  if (count >= objectif) return 'reussi';
  return estPasse ? 'rate' : 'attente';
}

function reussi(counts, ref, objectif) {
  return (counts[ref] || 0) >= objectif;
}

export function computeStreak(refs, counts, objectif) {
  let i = refs.length - 1;
  // La période en cours ne casse jamais le streak tant qu'elle n'est pas
  // terminée : sinon le compteur retomberait à zéro chaque matin.
  if (i >= 0 && !reussi(counts, refs[i], objectif)) i--;
  let streak = 0;
  while (i >= 0 && reussi(counts, refs[i], objectif)) {
    streak++;
    i--;
  }
  return streak;
}

export function successRate(refs, counts, objectif) {
  const ecoulees = refs.slice(0, -1); // la dernière est la période en cours
  if (ecoulees.length === 0) return 0;
  const ok = ecoulees.filter((r) => reussi(counts, r, objectif)).length;
  return Math.round((ok / ecoulees.length) * 100);
}

export function bestStreak(refs, counts, objectif) {
  let meilleur = 0;
  let courant = 0;
  for (const ref of refs) {
    if (reussi(counts, ref, objectif)) {
      courant++;
      if (courant > meilleur) meilleur = courant;
    } else {
      courant = 0;
    }
  }
  return meilleur;
}
