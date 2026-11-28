// Keeping plans moving (#889): the plan's state for the user, the orphaned-task check, and when Docket nudges a
// stalled coordinator. Run with: npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { planMotion, orphanTasks, nudgeFor, nudgeText, freedLine, planSig, PARALLEL_PUSH, HOLD_OFF, ORPHAN_IDLE_MS, NUDGE_GRACE_MS } from '../plan-motion.mjs';
import { createPlanStore } from '../plans.mjs';
import { wakeDecision } from '../reports.mjs';

const task = (id, o = {}) => ({ id, title: `Task ${id}`, state: 'open', holder: '', holderTitle: '', after: [], forUser: false, waitsOn: '', ...o });
const plan = (tasks) => ({ id: 'p-abcd12', title: 'Ship it', tasks });
// look: session id -> standing; anything not listed has stopped
const looker = (m) => (id) => m[id] || null;
const idle = { st: 'done', idleMs: NUDGE_GRACE_MS + 1 };

test('a plan with a session working is moving; one whose coordinator works is too', () => {
  const p = plan([task('T1', { state: 'claimed', holder: 'w1' }), task('T2', { after: ['T1'] })]);
  assert.equal(planMotion({ plan: p, look: looker({ w1: { st: 'working', idleMs: 0 } }), coord: idle }).state, 'moving');
  const q = plan([task('T1', { after: ['T0'] }), task('T0', { state: 'waiting_outside', waitsOn: 'the vendor' })]);
  assert.equal(planMotion({ plan: q, look: looker({}), coord: { st: 'working' } }).state, 'moving');
});

test('your steps due, a task waiting on your answer, or the coordinator asking: waiting on you', () => {
  const mine = plan([task('T1', { forUser: true }), task('T2', { after: ['T1'] })]);
  const m = planMotion({ plan: mine, look: looker({}), coord: idle });
  assert.equal(m.state, 'waiting'); assert.match(m.why, /your step T1 is due/i);
  const asked = plan([task('T1', { state: 'claimed', holder: 'w1' })]);
  assert.equal(planMotion({ plan: asked, look: looker({ w1: { st: 'waiting', idleMs: 0 } }), coord: idle }).state, 'waiting');
  assert.equal(planMotion({ plan: plan([task('T1', { state: 'waiting_on_user', holder: 'w1' })]), look: looker({ w1: idle }), coord: idle }).state, 'waiting');
  const c = planMotion({ plan: plan([task('T1')]), look: looker({}), coord: { st: 'waiting' } });
  assert.equal(c.state, 'waiting'); assert.match(c.why, /coordinator asked you/);
});

test('stalled: nothing running and nothing asked of the user, with the reason in a line', () => {
  const free = planMotion({ plan: plan([task('T1'), task('T2')]), look: looker({}), coord: idle });
  assert.equal(free.state, 'stalled'); assert.match(free.why, /T1, T2 are free to start but no session works on them/);
  const left = planMotion({ plan: plan([task('T1', { state: 'claimed', holder: 'w1' })]), look: looker({ w1: { st: 'done', idleMs: 5000 } }), coord: idle });
  assert.equal(left.state, 'stalled'); assert.match(left.why, /T1's session finished its turn without marking it done/);
  const gone = planMotion({ plan: plan([task('T1', { state: 'claimed', holder: 'w1' })]), look: looker({}), coord: idle });
  assert.match(gone.why, /T1's session stopped without marking it done/);
  const out = planMotion({ plan: plan([task('T1', { state: 'waiting_outside', waitsOn: 'Quo' })]), look: looker({}), coord: idle });
  assert.equal(out.state, 'stalled'); assert.match(out.why, /Everything left waits outside Docket: T1 on Quo/);
  const closed = planMotion({ plan: plan([task('T1')]), look: looker({}), coord: { st: 'stopped', why: 'was closed' } });
  assert.match(closed.why, /its coordinator was closed/);
});

test('a paused plan shows paused, not stalled; a finished plan has no state', () => {
  const p = plan([task('T1'), task('T2')]);
  assert.equal(planMotion({ plan: p, look: looker({}), coord: idle, paused: 'plan' }).state, 'paused');
  assert.match(planMotion({ plan: p, look: looker({}), coord: idle, paused: 'docket' }).why, /Pause all/);
  assert.equal(planMotion({ plan: plan([task('T1', { state: 'done' }), task('T2', { state: 'dropped' })]), look: looker({}), coord: idle }), null);
});

test('orphaned tasks: a stopped holder, one idle past the limit, and one waiting on the user (told as that)', () => {
  const p = plan([task('T1', { state: 'claimed', holder: 'gone' }), task('T2', { state: 'sent_back', holder: 'slow' }), task('T3', { state: 'claimed', holder: 'asks' }),
    task('T4', { state: 'claimed', holder: 'busy' }), task('T5', { state: 'claimed', holder: 'fresh' }), task('T6', { state: 'waiting_on_user', holder: 'gone' })]);
  const look = looker({ slow: { st: 'done', idleMs: ORPHAN_IDLE_MS }, asks: { st: 'waiting', idleMs: 0 }, busy: { st: 'working', idleMs: 0 }, fresh: { st: 'done', idleMs: 60000 } });
  assert.deepEqual(orphanTasks(p, look).map((o) => [o.task.id, o.kind]), [['T1', 'stopped'], ['T2', 'idle'], ['T3', 'waiting']]);
});

test('the end-of-turn nudge: free tasks with no session, once the turn has been over a while, and never twice for the same state', () => {
  const p = plan([task('T1'), task('T2'), task('T3', { forUser: true })]);
  assert.equal(nudgeFor({ plan: p, look: looker({}), coord: { st: 'done', idleMs: 1000 } }).send, false, 'sessions it just started may not have claimed yet');
  const n = nudgeFor({ plan: p, look: looker({}), coord: idle });
  assert.equal(n.send, true); assert.deepEqual(n.free.map((t) => t.id), ['T1', 'T2'], "the user's step is not a session's");
  assert.equal(nudgeFor({ plan: p, look: looker({}), coord: idle, last: n.last }).send, false, 'same state: no second nudge');
  p.tasks[0].state = 'claimed'; p.tasks[0].holder = 'w1'; p.tasks[0].state = 'open'; p.tasks[0].holder = ''; // back where it was
  assert.equal(nudgeFor({ plan: p, look: looker({}), coord: idle, last: n.last }).send, false);
  p.tasks.push(task('T4'));
  assert.equal(nudgeFor({ plan: p, look: looker({}), coord: idle, last: n.last }).send, true, 'the plan changed: nudged again');
});

test('no nudge while paused, while the coordinator works or asked the user, or once the plan is done', () => {
  const p = plan([task('T1')]);
  for (const paused of ['plan', 'docket']) assert.equal(nudgeFor({ plan: p, look: looker({}), coord: idle, paused }).send, false);
  for (const st of ['working', 'waiting', 'stopped']) assert.equal(nudgeFor({ plan: p, look: looker({}), coord: { st, idleMs: Infinity } }).send, false);
  assert.equal(nudgeFor({ plan: p, look: looker({}), coord: null }).send, false);
  assert.equal(nudgeFor({ plan: plan([task('T1', { state: 'done' })]), look: looker({}), coord: idle }).send, false);
  assert.equal(nudgeFor({ plan: plan([task('T1', { forUser: true })]), look: looker({}), coord: idle }).send, false, "only the user's step is free");
});

test('an orphaned task is told once, and again only if it is left again after being settled', () => {
  const p = plan([task('T1', { state: 'claimed', holder: 'w1' })]);
  const gone = looker({}), back = looker({ w1: { st: 'working', idleMs: 0 } });
  const a = nudgeFor({ plan: p, look: gone, coord: idle });
  assert.equal(a.send, true); assert.equal(a.orphans[0].kind, 'stopped');
  assert.equal(nudgeFor({ plan: p, look: gone, coord: idle, last: a.last }).send, false);
  const b = nudgeFor({ plan: p, look: back, coord: idle, last: a.last });
  assert.equal(b.send, false); assert.deepEqual(b.last.told, [], 'settled: forgotten');
  assert.equal(nudgeFor({ plan: p, look: gone, coord: idle, last: b.last }).send, true);
  const w = nudgeFor({ plan: p, look: looker({ w1: { st: 'waiting', idleMs: 0 } }), coord: idle });
  assert.equal(w.orphans[0].kind, 'waiting');
  assert.equal(nudgeFor({ plan: p, look: looker({ w1: { st: 'waiting', idleMs: 0 } }), coord: idle, last: w.last }).send, false, 'waiting on the user: told once');
});

test('the nudge and the "now free" wake-up both push work side by side, and say pausing is the user\'s', () => {
  const p = plan([task('T1'), task('T2', { state: 'claimed', holder: 'w1', holderTitle: 'Build T2' }), task('T3', { state: 'claimed', holder: 'w3' })]);
  const n = nudgeFor({ plan: p, look: looker({ w3: { st: 'waiting', idleMs: 0 } }), coord: idle });
  const text = nudgeText(p, n);
  assert.match(text, /Free to start now, with no session started for it: T1 Task T1\. Start a session for it now/);
  assert.match(text, /T2 Task T2: its session "Build T2" \(w1\) stopped without marking it done \(Docket does not know it\)\. Check it/);
  assert.match(text, /T3 Task T3: its session w3 is waiting on the user in its own chat/);
  assert.ok(text.includes(PARALLEL_PUSH) && text.includes(HOLD_OFF));
  const line = freedLine({ title: 'Ship it', planId: 'p-abcd12', tasks: [{ id: 'T4', title: 'Docs' }] }, " (the user's step)");
  assert.match(line, /T4 Docs is now free to start\. Start it now/);
  assert.ok(line.includes(PARALLEL_PUSH) && line.includes('Pause plan'));
});

test('the state signature changes with a task\'s state, holder or what it waits on', () => {
  const p = plan([task('T1'), task('T2', { after: ['T1'] })]), s = planSig(p);
  p.tasks[1].after = [];
  assert.notEqual(planSig(p), s);
});

test('plan wake-ups are not held by the wake cap; session reports still are', () => {
  assert.equal(wakeDecision({ autoWakes: 8, limit: 8, reports: [{ childId: 'c' }] }).wake, false);
  assert.equal(wakeDecision({ autoWakes: 8, limit: 8, reports: [{ childId: 'c' }, { kind: 'nudge' }] }).wake, true);
  assert.equal(wakeDecision({ autoWakes: 9, limit: 8, reports: [{ kind: 'plan' }] }).wake, true);
});

test('the coordinator loosens an "after" with plan_update_task; a loop or a stranger is refused', () => {
  const s = createPlanStore({ dir: fs.mkdtempSync(path.join(os.tmpdir(), 'plans-')) });
  const p = s.create({ title: 'P', coordinator: 'c1', tasks: [{ kind: 'build', title: 'A' }, { kind: 'build', title: 'B', after: [1] }, { kind: 'test', title: 'C', after: [2] }] });
  const r = s.update(p.id, 'T2', { after: [] }, 'c1');
  assert.deepEqual(r.nowReady.map((t) => t.id), ['T2']);
  assert.deepEqual(s.read(p.id).tasks[1].after, []);
  assert.throws(() => s.update(p.id, 'T2', { after: ['T3'] }, 'c1'), /loop/);
  assert.throws(() => s.update(p.id, 'T2', { after: ['T9'] }, 'c1'), /no such task/);
  s.claim(p.id, 'T1', 'w1');
  assert.throws(() => s.update(p.id, 'T1', { after: [] }, 'w1'), /Only the plan's coordinator/);
});
