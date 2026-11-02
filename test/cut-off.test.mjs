// Tests for cut-off.mjs, continuing a session cut off by an unplanned stop. Run with: npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { newCutOff, elsewhere, autoContinueCheck, cutOffNote, RECENT_MS, ELSEWHERE_MS } from '../cut-off.mjs';

const now = Date.parse('2026-10-30T12:00:00Z');

test('a cut-off seen as the runner went is dated now; one found at start is dated by the file', () => {
  assert.deepEqual(newCutOff('runner', now - 5000, now), { how: 'runner', at: now, mtime: now - 5000 });
  assert.deepEqual(newCutOff('start', now - 60_000, now), { how: 'start', at: now - 60_000, mtime: now - 60_000 });
  assert.deepEqual(newCutOff('start', null, now), { how: 'start', at: now, mtime: null });
});

test('elsewhere: a write after the runner went, or at start a write in the last 2 minutes', () => {
  const r = newCutOff('runner', now - 1000, now);
  assert.equal(elsewhere(r, now - 1000, now), false, 'its own last write');
  assert.equal(elsewhere(r, now + 30_000, now + 40_000), true, 'written since');
  const s = newCutOff('start', now - 30_000, now);
  assert.equal(elsewhere(s, now - 30_000, now), true);
  assert.equal(elsewhere(s, now - ELSEWHERE_MS - 1, now), false);
  assert.equal(elsewhere(s, null, now), false, 'no file to read (another brand)');
});

test('an eligible cut-off continues by itself', () => {
  const rec = { cutOff: newCutOff('runner', now - 1000, now) };
  assert.deepEqual(autoContinueCheck({ on: true, rec, mtime: now - 1000, now: now + 10_000 }), { go: true });
});

test('each guard stops it and says why', () => {
  const cutOff = newCutOff('runner', now - 1000, now);
  const ok = { on: true, rec: { cutOff }, mtime: now - 1000, now: now + 10_000 };
  const why = (o) => { const r = autoContinueCheck({ ...ok, ...o }); assert.equal(r.go, false); return r.why; };
  assert.match(why({ rec: {} }), /not cut off/);
  assert.match(why({ rec: null }), /not cut off/);
  assert.match(why({ on: false }), /setting is off/);
  assert.match(why({ rec: { cutOff, autoContinued: true } }), /already continued once/, 'one try per cut-off, so a crashing turn cannot loop');
  assert.match(why({ archived: true }), /archived/);
  assert.match(why({ paused: true }), /paused/);
  assert.match(why({ now: now + RECENT_MS + 1 }), /more than 3 hours/);
  assert.match(why({ mtime: now + 5000 }), /another app/);
});

test('an old one found at start waits for the person', () => {
  const rec = { cutOff: newCutOff('start', now - RECENT_MS - 60_000, now) };
  assert.equal(autoContinueCheck({ on: true, rec, mtime: rec.cutOff.mtime, now }).go, false);
});

test('the note says the stop was unplanned, not the user, and to check before redoing', () => {
  const n = cutOffNote(newCutOff('runner', null, now));
  assert.match(n, /^\(From Docket: Docket stopped unexpectedly/);
  assert.match(n, /did not stop it/);
  assert.match(n, /may or may not have finished/);
  assert.match(n, /git/);
  assert.match(n, /carry on/);
  assert.ok(n.endsWith(')'));
});
