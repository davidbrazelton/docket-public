// Tests for #1020: when the welcome-back card shows ("away from a session"), and the desk's Welcome back after hours. Runs that part of index.html on its own, and summary-check.mjs. Run with: npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { awayHours, AWAY } from '../summary-check.mjs';

const page = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const start = page.indexOf('// ---------- away from a session ----------');
const end = page.indexOf('// end of away from a session');
assert.ok(start > 0 && end > start, 'the away-from-a-session part of index.html has moved or lost its markers');
const { isAway, awayWords } = new Function(page.slice(start, end) + '\nreturn { isAway, awayWords };')();

const H = 3600000, now = 1_000_000_000_000;

test('away: seen at least the threshold ago, and not working', () => {
  assert.equal(isAway(now - 25 * H, 24, false, now), true);
  assert.equal(isAway(now - 24 * H, 24, false, now), true, 'exactly the threshold counts');
  assert.equal(isAway(now - 23 * H, 24, false, now), false, 'seen lately');
  assert.equal(isAway(now - 30 * 24 * H, 24, true, now), false, 'never while it works');
  assert.equal(isAway(null, 24, false, now), false, 'never opened since seenAt was saved: not away');
  assert.equal(isAway(now - 99 * 24 * H, 0, false, now), false, '0 turns it off');
});

test('the words say days, then hours', () => {
  assert.equal(awayWords(now - 9 * 24 * H - 5 * H, now), '9 days');
  assert.equal(awayWords(now - 24 * H, now), '1 day');
  assert.equal(awayWords(now - 5 * H, now), '5 hours');
  assert.equal(awayWords(now - H, now), '1 hour');
  assert.equal(awayWords(now - 60000, now), 'less than an hour');
});

test('the desk threshold: a day at first, 0 turns it off', () => {
  assert.equal(awayHours(undefined), AWAY.defaultHours);
  assert.equal(AWAY.defaultHours, 24);
  assert.equal(awayHours('0'), 0);
  assert.equal(awayHours(48), 48);
  assert.equal(awayHours(-3), 24);
  assert.equal(awayHours('x'), 24);
  assert.equal(awayHours(1e9), AWAY.maxHours);
});
