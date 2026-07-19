import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dotState, computeStreak, successRate, bestStreak } from '../src/state.js';

test('objectif atteint = réussi, même sur la période en cours', () => {
  assert.equal(dotState(1, 1, false), 'reussi');
  assert.equal(dotState(3, 3, true), 'reussi');
  assert.equal(dotState(5, 3, true), 'reussi');
});

test('objectif manqué sur une période passée = raté', () => {
  assert.equal(dotState(0, 1, true), 'rate');
  assert.equal(dotState(2, 3, true), 'rate');
});

test('objectif manqué sur la période en cours = en attente, jamais raté', () => {
  assert.equal(dotState(0, 1, false), 'attente');
  assert.equal(dotState(2, 3, false), 'attente');
});

test('le streak compte les périodes réussies consécutives', () => {
  const refs = ['j1', 'j2', 'j3', 'j4'];
  const counts = { j1: 1, j2: 1, j3: 1, j4: 1 };
  assert.equal(computeStreak(refs, counts, 1), 4);
});

test('la période en cours non cochée ne casse pas le streak', () => {
  const refs = ['j1', 'j2', 'j3', 'j4'];
  const counts = { j1: 1, j2: 1, j3: 1 }; // j4 = aujourd'hui, pas encore fait
  assert.equal(computeStreak(refs, counts, 1), 3);
});

test('une période passée ratée remet le streak à zéro', () => {
  const refs = ['j1', 'j2', 'j3', 'j4'];
  const counts = { j1: 1, j2: 1, j4: 1 }; // j3 raté, j4 fait
  assert.equal(computeStreak(refs, counts, 1), 1);
});

test('le streak vaut 0 quand rien n\'est fait', () => {
  assert.equal(computeStreak(['j1', 'j2'], {}, 1), 0);
});

test('le streak hebdo respecte l\'objectif', () => {
  const refs = ['s1', 's2', 's3'];
  const counts = { s1: 3, s2: 2, s3: 3 };
  // s2 sous l'objectif de 3 → le streak s'arrête à s3
  assert.equal(computeStreak(refs, counts, 3), 1);
});

test('successRate exclut la période en cours', () => {
  const refs = ['j1', 'j2', 'j3'];
  const counts = { j1: 1, j2: 0 }; // j3 = en cours, ignoré
  assert.equal(successRate(refs, counts, 1), 50);
});

test('successRate vaut 0 s\'il n\'y a aucune période écoulée', () => {
  assert.equal(successRate(['j1'], {}, 1), 0);
});

test('bestStreak trouve la plus longue série, pas la dernière', () => {
  const refs = ['j1', 'j2', 'j3', 'j4', 'j5', 'j6'];
  const counts = { j1: 1, j2: 1, j3: 1, j5: 1, j6: 1 };
  assert.equal(bestStreak(refs, counts, 1), 3);
});
