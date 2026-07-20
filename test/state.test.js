import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dotState, computeStreak, successRate, bestStreak } from '../src/state.js';

test('objectif atteint = réussi, même sur la période en cours', () => {
  assert.equal(dotState(true, false), 'reussi');
  assert.equal(dotState(true, true), 'reussi');
});

test('objectif manqué sur une période passée = raté', () => {
  assert.equal(dotState(false, true), 'rate');
});

test('objectif manqué sur la période en cours = en attente, jamais raté', () => {
  assert.equal(dotState(false, false), 'attente');
});

test('le streak compte les périodes réussies consécutives', () => {
  const reussites = [true, true, true, true];
  assert.equal(computeStreak(reussites), 4);
});

test('la période en cours non cochée ne casse pas le streak', () => {
  const reussites = [true, true, true, false]; // dernier = aujourd'hui, pas encore fait
  assert.equal(computeStreak(reussites), 3);
});

test('une période passée ratée remet le streak à zéro', () => {
  const reussites = [true, true, false, true]; // avant-dernier raté, dernier (courant) fait
  assert.equal(computeStreak(reussites), 1);
});

test('le streak vaut 0 quand rien n\'est fait', () => {
  assert.equal(computeStreak([false, false]), 0);
});

test('le streak hebdo respecte l\'objectif', () => {
  // s2 (avant-dernier) sous l'objectif → le streak s'arrête à s3 (courant, réussi)
  const reussites = [true, false, true];
  assert.equal(computeStreak(reussites), 1);
});

test('successRate exclut la période en cours', () => {
  const reussites = [true, false, true]; // le dernier (en cours) est ignoré
  assert.equal(successRate(reussites), 50);
});

test('successRate vaut 0 s\'il n\'y a aucune période écoulée', () => {
  assert.equal(successRate([false]), 0);
});

test('bestStreak trouve la plus longue série, pas la dernière', () => {
  const reussites = [true, true, true, false, true, true];
  assert.equal(bestStreak(reussites), 3);
});
