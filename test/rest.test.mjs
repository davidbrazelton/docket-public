// Tests for rest.mjs, when an idle session is released from memory. Run with: npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { restDue, restMinutes, REST_DEFAULT } from '../rest.mjs';

const now = 10 * 3600000;
const quiet = (min) => ({ engine: 'claude', status: 'idle', lastActivity: now - min * 60000 });

test('a Claude session idle past the set time rests; one quiet for less does not', () => {
  assert.equal(restDue(quiet(61), { now }), true);
  assert.equal(restDue(quiet(60), { now }), true);
  assert.equal(restDue(quiet(59), { now }), false);
  assert.equal(restDue(quiet(2), { now, minutes: 1 }), true, 'the test threshold');
  assert.equal(restDue({ status: 'idle', lastActivity: now - 2 * 60000 }, { now, minutes: 1 }), true, 'no engine is Claude');
});

test('0 minutes means never', () => {
  assert.equal(restDue(quiet(10000), { now, minutes: 0 }), false);
});

test('a session working, waiting on the person, or with jobs under way is left alone', () => {
  for (const status of ['starting', 'running', 'requires_action', 'ended']) assert.equal(restDue({ ...quiet(120), status }, { now }), false, status);
  assert.equal(restDue({ ...quiet(120), asks: 1 }, { now }), false, 'a question or permission prompt waiting');
  assert.equal(restDue(quiet(120), { now, runningJobs: 1 }), false, 'background jobs');
  assert.equal(restDue({ ...quiet(120), heldTurn: true }, { now }), false, 'a held turn');
  assert.equal(restDue(quiet(120), { now, signInOpen: true }), false, 'its desk has a browser sign-in window open');
  assert.equal(restDue({ ...quiet(120), compacting: { start: now } }, { now }), false, 'compacting');
  assert.equal(restDue({ ...quiet(120), reloading: true }, { now }), false, 'reloading for changed config');
  assert.equal(restDue(quiet(120), { now, paused: true }), false, 'Pause all');
});

test('one already resting or waking is not rested again', () => {
  assert.equal(restDue({ ...quiet(120), resting: true }, { now }), false);
  assert.equal(restDue({ ...quiet(120), waking: true }, { now }), false);
});

test('Grok and Codex sessions never rest: their chat cannot be resumed the same way', () => {
  assert.equal(restDue({ ...quiet(120), engine: 'grok' }, { now }), false);
  assert.equal(restDue({ ...quiet(120), engine: 'codex' }, { now }), false);
});

test('the setting: whole minutes, 0 kept, anything unusable is the default', () => {
  assert.equal(restMinutes(undefined), REST_DEFAULT);
  assert.equal(REST_DEFAULT, 60);
  assert.equal(restMinutes(0), 0);
  assert.equal(restMinutes('0'), 0);
  assert.equal(restMinutes('15'), 15);
  assert.equal(restMinutes(1.6), 2);
  assert.equal(restMinutes(-5), REST_DEFAULT);
  assert.equal(restMinutes('abc'), REST_DEFAULT);
  assert.equal(restMinutes(''), REST_DEFAULT);
  assert.equal(restMinutes(10 ** 9), 7 * 24 * 60);
});
