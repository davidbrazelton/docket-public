// What the user does next in a plan (#993): the "Next for you" list and the motion line come from the same place, a
// done decision is never waiting, and a coordinator whose last turn asked the user shows as asking. Run with: npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { planNext, planMotion, openDecision, nudgeFor, NUDGE_GRACE_MS } from '../plan-motion.mjs';
import { asksByNumber } from '../questions.mjs';

const task = (id, o = {}) => ({ id, title: `Task ${id}`, state: 'open', holder: '', holderTitle: '', after: [], forUser: false, waitsOn: '', q: 0, answer: '', ...o });
const plan = (tasks) => ({ id: 'p-abcd12', title: 'Handoff', coordinator: 'co', tasks });
const looker = (m) => (id) => m[id] || null;
const idle = { st: 'done', idleMs: NUDGE_GRACE_MS + 1 };

test('a decision set done (or dropped) without an answer is not open', () => {
  assert.equal(openDecision(task('T67', { q: 1, forUser: true, kind: 'decision', state: 'done' })), false);
  assert.equal(openDecision(task('T68', { q: 2, forUser: true, kind: 'decision', state: 'dropped' })), false);
  assert.equal(openDecision(task('T69', { q: 3, forUser: true, kind: 'decision' })), true);
  assert.equal(openDecision(task('T70', { q: 4, forUser: true, kind: 'decision', answer: 'Keep both' })), false);
  const p = plan([task('T67', { q: 1, forUser: true, kind: 'decision', state: 'done', note: 'All questions answered' }), task('T12', { forUser: true })]);
  const n = planNext({ plan: p, look: looker({}), coord: idle });
  assert.deepEqual(n.items.map((i) => [i.kind, i.id]), [['step', 'T12']]);
  const m = planMotion({ plan: p, look: looker({}), coord: idle });
  assert.doesNotMatch(m.why, /Q1|T67/);
});

test('Next for you lists, in order: the coordinator asking, open decisions, due steps, tasks asking you; then what waits outside', () => {
  const p = plan([
    task('T5', { state: 'claimed', holder: 'w5', holderTitle: 'Build it' }),
    task('T12', { forUser: true }),
    task('T13', { forUser: true, after: ['T5'] }), // not due yet
    task('T20', { q: 3, forUser: true, kind: 'decision', options: ['Yes', 'No'] }),
    task('T24', { state: 'waiting_outside', waitsOn: 'the colleague' }),
    task('T30', { state: 'waiting_on_user', holder: 'w30' }),
  ]);
  const look = looker({ w5: { st: 'waiting', idleMs: 0 }, w30: { st: 'done', idleMs: 0 } });
  const coord = { st: 'done', idleMs: 0, asked: true };
  const n = planNext({ plan: p, look, coord });
  assert.deepEqual(n.items.map((i) => [i.kind, i.id, i.session]), [['coord', '', 'co'], ['decision', 'T20', 'co'], ['step', 'T12', 'co'], ['answer', 'T5', 'w5'], ['answer', 'T30', 'w30']]);
  assert.deepEqual(n.outside, [{ id: 'T24', waitsOn: 'the colleague' }]);
  // the motion line names the same things
  const m = planMotion({ plan: p, look, coord });
  assert.equal(m.state, 'waiting');
  assert.equal(m.why, 'Its coordinator asked you something; decision Q3 waits on you; your step T12 is due; T5, T30 wait on your answer.');
});

test('the seen case: a step due and the coordinator asked in chat; both show, in the list and in the motion line', () => {
  const p = plan([task('T12', { forUser: true }), task('T24', { state: 'waiting_outside', waitsOn: 'the vendor' })]);
  const coord = { st: 'done', idleMs: Infinity, resting: true, asked: true }; // not running here, its last turn asked
  const n = planNext({ plan: p, look: looker({}), coord });
  assert.deepEqual(n.items.map((i) => i.kind), ['coord', 'step']);
  assert.match(planMotion({ plan: p, look: looker({}), coord }).why, /^Its coordinator asked you something; your step T12 is due\.$/);
  // once it works again (the user answered), it no longer counts as asking
  assert.deepEqual(planNext({ plan: p, look: looker({}), coord: { st: 'working', idleMs: 0, asked: true } }).items.map((i) => i.kind), ['step']);
  // a closed coordinator asks nothing
  assert.deepEqual(planNext({ plan: p, look: looker({}), coord: { st: 'stopped', why: 'was closed', asked: true } }).items.map((i) => i.kind), ['step']);
});

test('Docket does not nudge a coordinator whose last turn asked the user', () => {
  const p = plan([task('T1'), task('T2')]);
  assert.equal(nudgeFor({ plan: p, look: looker({}), coord: idle }).send, true);
  assert.equal(nudgeFor({ plan: p, look: looker({}), coord: { ...idle, asked: true } }).send, false);
});

test('a reply asks by number when a line asks with a question number, even with text after it', () => {
  assert.equal(asksByNumber('Two things for you:\n\nQ1: Take over the other team #850 as T65?\nQ2: Drop test orders from the stuck-jobs list?\n\nMeanwhile T24 waits on the vendor.'), true);
  assert.equal(asksByNumber('**Q7:** Keep both?'), true);
  assert.equal(asksByNumber('- Q7 — keep the CSV export?'), true);
  assert.equal(asksByNumber('- Q7 — kept the CSV export'), false, 'a line that starts with its number but asks nothing (#1006)');
  assert.equal(asksByNumber('Q7 answered: Keep both.'), false);
  assert.equal(asksByNumber('Revenue rose in Q4 2026.'), false);
  assert.equal(asksByNumber('I set T12 done.'), false);
});

test('the plan rules tell a coordinator to make every question to the user a plan decision', () => {
  const rules = fs.readFileSync(new URL('../prompts/optional/plans.md', import.meta.url), 'utf8');
  assert.match(rules, /every question you ask the user while you coordinate[^.]*make it a decision task first/);
});
