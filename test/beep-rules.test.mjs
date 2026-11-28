// Tests for which orange dots get a chime (the beep rules in index.html). Run with: npm test
// The page is one file with no modules, so the part under test is read out of it between its markers.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const page = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const start = page.indexOf('// ---------- beep rules');
const end = page.indexOf('// end of beep rules');
assert.ok(start > 0 && end > start, 'the beep rules part of index.html has moved or lost its markers');
const { beepDecision, beepCatchUp, familyTop } = new Function(page.slice(start, end) + '\nreturn { beepDecision, beepCatchUp, familyTop };')();

const T = 1_000_000;
// Runs dots through the rules in order and gives back each act.
function run(dots, st = null) {
  const acts = [];
  for (const d of dots) { const r = beepDecision(st, { question: false, family: d.id, ...d }); st = r.state; acts.push(r.act); }
  return { acts, st };
}

test('the first dot plays', () => {
  assert.equal(beepDecision(null, { id: 'a', family: 'a', question: false, now: T }).act, 'play');
});

test('a dot under 4 seconds after a chime merges, questions too', () => {
  assert.deepEqual(run([{ id: 'a', now: T }, { id: 'b', now: T + 3000 }]).acts, ['play', 'merge']);
  assert.deepEqual(run([{ id: 'a', now: T }, { id: 'b', now: T + 3000, question: true }]).acts, ['play', 'merge']);
});

test('the rest of a family stays quiet for 60 seconds, and is not held for a catch-up', () => {
  const { acts, st } = run([{ id: 'kid', family: 'top', now: T }, { id: 'top', family: 'top', now: T + 13000 }, { id: 'kid', family: 'top', now: T + 45000 }]);
  assert.deepEqual(acts, ['play', 'family', 'family']);
  assert.equal(st.held.length, 0);
  assert.equal(run([{ id: 'top', family: 'top', now: T + 61000 }], st).acts[0], 'play');
});

test('another family inside 30 seconds is held for the catch-up', () => {
  const r = run([{ id: 'a', now: T }, { id: 'b', now: T + 10000 }]);
  assert.deepEqual(r.acts, ['play', 'hold']);
  assert.deepEqual(r.st.held.map((h) => h.id), ['b']);
  const d = beepDecision(run([{ id: 'a', now: T }]).st, { id: 'b', family: 'b', question: false, now: T + 10000 });
  assert.equal(d.holdUntil, T + 30000);
  assert.match(d.why, /held for catch-up/);
});

test('one session turning orange again 10 seconds later stays quiet', () => {
  assert.deepEqual(run([{ id: 'a', now: T }, { id: 'a', now: T + 10000 }]).acts, ['play', 'family']);
});

test('a question skips both waits', () => {
  assert.deepEqual(run([{ id: 'a', now: T }, { id: 'a', now: T + 10000, question: true }]).acts, ['play', 'play']);
  assert.deepEqual(run([{ id: 'a', now: T }, { id: 'b', now: T + 10000, question: true }]).acts, ['play', 'play']);
});

test('the catch-up plays once for every held dot that still needs you', () => {
  const { st } = run([{ id: 'a', now: T }, { id: 'b', now: T + 5000 }, { id: 'c', now: T + 8000 }, { id: 'd', now: T + 9000 }]);
  assert.equal(st.held.length, 3);
  const r = beepCatchUp(st, { now: T + 30050, stillNeeds: (h) => h.id !== 'c' });
  assert.equal(r.play, true);
  assert.deepEqual(r.decisions.map((d) => d.act), ['play', 'drop', 'merge']);
  assert.equal(r.state.held.length, 0);
  assert.equal(r.state.last, T + 30050);
  // A second page running the same catch-up finds nothing left.
  assert.equal(beepCatchUp(r.state, { now: T + 30060, stillNeeds: () => true }).play, false);
});

test('a catch-up with nothing still orange plays nothing', () => {
  const { st } = run([{ id: 'a', now: T }, { id: 'b', now: T + 5000 }]);
  const r = beepCatchUp(st, { now: T + 30050, stillNeeds: () => false });
  assert.equal(r.play, false);
  assert.equal(r.state.last, T);
});

test('a question during the quiet moves the catch-up back', () => {
  let { st } = run([{ id: 'a', now: T }, { id: 'b', now: T + 5000 }, { id: 'q', now: T + 25000, question: true }]);
  const r = beepCatchUp(st, { now: T + 30050, stillNeeds: () => true });
  assert.equal(r.play, false);
  assert.equal(r.holdUntil, T + 55000);
  assert.deepEqual(r.state.held.map((h) => h.id), ['b']);
  assert.equal(beepCatchUp(r.state, { now: T + 55050, stillNeeds: () => true }).play, true);
});

test('two pages deciding the same dot play it once', () => {
  const first = beepDecision(null, { id: 'a', family: 'a', question: false, now: T });
  const second = beepDecision(first.state, { id: 'a', family: 'a', question: false, now: T + 40 });
  assert.deepEqual([first.act, second.act], ['play', 'merge']);
  const q = beepDecision(first.state, { id: 'a', family: 'a', question: true, now: T + 40 });
  assert.equal(q.act, 'merge');
});

test('a held dot left by a page that closed is forgotten', () => {
  const { st } = run([{ id: 'a', now: T }, { id: 'b', now: T + 5000 }]);
  assert.equal(beepDecision(st, { id: 'c', family: 'c', question: false, now: T + 120000 }).state.held.length, 0);
});

test('the family top follows parent links up, and survives a loop', () => {
  const parents = { kid: 'mid', mid: 'top', top: null, x: 'y', y: 'x' };
  const parentOf = (id) => parents[id] || null;
  assert.equal(familyTop('kid', parentOf), 'top');
  assert.equal(familyTop('top', parentOf), 'top');
  assert.equal(familyTop('lone', parentOf), 'lone');
  assert.ok(['x', 'y'].includes(familyTop('x', parentOf)));
});
