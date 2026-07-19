import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  todayISO, mondayOf, addDays, currentWeekDays,
  lastSevenWeeks, allDaysSince, allWeeksSince
} from '../src/dates.js';

test('todayISO rend une date au format YYYY-MM-DD', () => {
  assert.match(todayISO(), /^\d{4}-\d{2}-\d{2}$/);
});

test('todayISO utilise le fuseau de Zurich, pas UTC', () => {
  // 2026-07-19 23:30 UTC = 2026-07-20 01:30 à Zurich (UTC+2 en été)
  const t = new Date('2026-07-19T23:30:00Z');
  assert.equal(todayISO(t), '2026-07-20');
});

test('mondayOf ramène un mercredi à son lundi', () => {
  // 2026-07-15 est un mercredi
  assert.equal(mondayOf('2026-07-15'), '2026-07-13');
});

test('mondayOf laisse un lundi inchangé', () => {
  assert.equal(mondayOf('2026-07-13'), '2026-07-13');
});

test('mondayOf ramène un dimanche au lundi qui le précède', () => {
  // 2026-07-19 est un dimanche
  assert.equal(mondayOf('2026-07-19'), '2026-07-13');
});

test('addDays traverse une fin de mois', () => {
  assert.equal(addDays('2026-07-31', 1), '2026-08-01');
});

test('addDays accepte un décalage négatif', () => {
  assert.equal(addDays('2026-08-01', -1), '2026-07-31');
});

test('currentWeekDays rend 7 jours du lundi au dimanche', () => {
  const jours = currentWeekDays('2026-07-15');
  assert.equal(jours.length, 7);
  assert.equal(jours[0], '2026-07-13');
  assert.equal(jours[6], '2026-07-19');
});

test('lastSevenWeeks finit par la semaine en cours', () => {
  const semaines = lastSevenWeeks('2026-07-15');
  assert.equal(semaines.length, 7);
  assert.equal(semaines[6], '2026-07-13');
  assert.equal(semaines[0], '2026-06-01');
});

test('allDaysSince inclut les deux bornes', () => {
  assert.deepEqual(
    allDaysSince('2026-07-13', '2026-07-15'),
    ['2026-07-13', '2026-07-14', '2026-07-15']
  );
});

test('allWeeksSince rend les lundis des deux bornes incluses', () => {
  assert.deepEqual(
    allWeeksSince('2026-07-01', '2026-07-15'),
    ['2026-06-29', '2026-07-06', '2026-07-13']
  );
});
