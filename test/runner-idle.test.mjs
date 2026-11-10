// Tests for runner-idle.mjs and the app's hold on it: the runner's restart waits for background commands,
// as Pause all counts them. Run with: npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { restartBlocked, notQuiet, busyHow, restartWaiter, QUIET_MS } from '../runner-idle.mjs';
import { holdsRunner, RUNNER_RESTART_NOTE } from '../pause.mjs';

const now = 10 * QUIET_MS;
const quiet = { lastAt: now - QUIET_MS - 1, asks: new Map() };

test('the runner restarts only when every open session is quiet', () => {
  assert.equal(restartBlocked([quiet], now), false);
  assert.equal(restartBlocked([], now), false);
  assert.equal(restartBlocked([{ ...quiet, busy: true }], now), true, 'a reply in progress');
  assert.equal(restartBlocked([{ ...quiet, asks: new Map([['q', {}]]) }], now), true, 'a question waiting');
  assert.equal(restartBlocked([{ ...quiet, lastAt: now - 1000 }], now), true, 'something said in the last minute');
  assert.equal(restartBlocked([{ ...quiet, busy: true, ended: true }], now), false, 'an ended session holds nothing');
});

test('a session with a background command running holds the restart until the command ends', () => {
  // The app marks the session held by the same test Pause all uses: idle, with one background command running.
  const s = { status: 'idle' };
  const r = { ...quiet, held: holdsRunner(s, 1) };
  assert.equal(r.held, true);
  assert.equal(restartBlocked([quiet, r], now), true, 'the restart waits');
  assert.equal(holdsRunner({ status: 'idle', heldTurn: true }, 0), true, 'a turn held for its last job still holds');
  r.held = holdsRunner(s, 0); // the command ended
  assert.equal(r.held, false);
  assert.equal(restartBlocked([quiet, r], now), false, 'then it goes ahead');
  assert.equal(holdsRunner({ status: 'requires_action' }, 0), false, 'a question is held by the runner itself');
  assert.equal(holdsRunner({ status: 'ended' }, 2), false);
});

test('a session the runner restarted is told to check its test servers', () => {
  assert.match(RUNNER_RESTART_NOTE, /^\(From Docket: /);
  assert.match(RUNNER_RESTART_NOTE, /restarted this session/);
  assert.match(RUNNER_RESTART_NOTE, /test server/);
});

// the app restarts by the same rule, and says in words what it waits for.
test('notQuiet says what is still working, in plain words', () => {
  assert.equal(notQuiet([quiet], now), '');
  assert.equal(notQuiet([{ ...quiet, busy: true }, { ...quiet, busy: true }], now), '2 sessions replying');
  assert.equal(notQuiet([{ ...quiet, busy: true, asks: 1 }], now), '1 session waiting on an answer', 'a count works as well as a Map');
  assert.equal(notQuiet([{ ...quiet, held: true }], now), '1 session with background work running');
  assert.equal(notQuiet([{ ...quiet, lastAt: now - 1000 }], now), '1 session active in the last minute');
  assert.equal(notQuiet([{ ...quiet, busy: true }, { ...quiet, held: true, scheduled: true }], now), '1 session replying, 1 scheduled task running');
  assert.equal(notQuiet([{ ...quiet, scheduled: true }], now), '', 'a scheduled run that has finished holds nothing');
  assert.equal(notQuiet([quiet], now, { jobs: 1 }), '1 Docket job running', 'an ask_desk run in the app');
  assert.equal(notQuiet([{ ...quiet, busy: true, ended: true }], now), '');
});

// A stand-in clock: setTimeout only records, tick() runs what is due.
function fakeTimers() {
  let list = [];
  return {
    setTimeout: (fn) => { const t = { fn }; list.push(t); return t; },
    clearTimeout: (t) => { list = list.filter((x) => x !== t); },
    tick() { const due = list; list = []; for (const t of due) t.fn(); },
    get count() { return list.length; },
  };
}

test('with nothing working, the restart goes at once and logs no wait', () => {
  const timers = fakeTimers(), went = [], logged = [];
  const w = restartWaiter({ check: () => '', go: (p, how) => went.push(how), log: (x) => logged.push(x), timers });
  w.want({ files: ['server.mjs'] });
  assert.deepEqual(went, ['nothing was working']);
  assert.deepEqual(logged, []);
  assert.equal(w.pending, null);
});

test('while something works the restart waits, logs once, looks again, and never gives up', () => {
  const timers = fakeTimers(), went = [], logged = [];
  let busy = '1 session replying', changes = 0;
  const w = restartWaiter({ check: () => busy, go: (p, how) => went.push({ p, how }), log: (x) => logged.push(x), changed: () => changes++, timers });
  w.want({ files: ['server.mjs'] });
  assert.equal(went.length, 0, 'it waits');
  assert.equal(w.pending.why, '1 session replying', 'the menu can say why');
  for (let i = 0; i < 500; i++) timers.tick(); // a long wait: still waiting, never forced
  assert.equal(went.length, 0);
  assert.equal(timers.count, 1, 'it keeps looking');
  assert.deepEqual(logged, ['1 session replying'], 'the wait is logged once');
  busy = '1 session with background work running'; timers.tick();
  assert.equal(w.pending.why, busy);
  assert.equal(changes, 2, 'the page hears when the reason changes');
  w.want({ files: ['index.html'] }); // another change while it waits joins the same restart
  assert.equal(w.pending.reasons.length, 2);
  busy = ''; timers.tick();
  assert.equal(went.length, 1);
  assert.match(went[0].how, /^quiet after waiting/);
  assert.equal(went[0].p.reasons.length, 2);
  assert.equal(w.pending, null);
  assert.equal(timers.count, 0, 'it stops looking');
});

test('Update now anyway skips the wait', () => {
  const timers = fakeTimers(), went = [];
  const w = restartWaiter({ check: () => '2 sessions replying', go: (p, how) => went.push(how), timers });
  w.now(); // nothing waiting: nothing happens
  assert.equal(went.length, 0);
  w.want({});
  w.now();
  assert.deepEqual(went, ['Restart now was pressed while waiting']);
  assert.equal(timers.count, 0);
});

test('busyHow names what one session is doing, for the update arrow\'s list', () => {
  assert.equal(busyHow(quiet, now), '');
  assert.equal(busyHow({ ...quiet, busy: true }, now), 'replying');
  assert.equal(busyHow({ ...quiet, busy: true, asks: 2 }, now), 'waiting on an answer');
  assert.equal(busyHow({ ...quiet, held: true }, now), 'background work running');
  assert.equal(busyHow({ ...quiet, held: true, scheduled: true }, now), 'scheduled task running');
  assert.equal(busyHow({ ...quiet, lastAt: now - 1000 }, now), 'active in the last minute');
  assert.equal(busyHow({ ...quiet, busy: true, ended: true }, now), '');
});

test('the update arrow: no card and no modes; nothing busy updates at once, busy asks, waiting offers Update now', async () => {
  const fs = await import('node:fs');
  const page = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  const server = fs.readFileSync(new URL('../server.mjs', import.meta.url), 'utf8');
  assert.doesNotMatch(page, /id="updateOffer"|has-update|updmode|About · update waiting/);
  assert.doesNotMatch(server, /\/api\/update\/mode|updates\??\.mode ===/);
  assert.match(page, /<span class="spacer"><\/span>\s*<button class="ghost upd-btn" id="updBtn"/, 'first of the right-aligned controls');
  assert.match(page, /if \(u\.busyNow\) return updPop\('busy', u\);\s*takeUpdate\(false\);/, 'nothing busy: no extra step');
  assert.match(page, /data-upd="now"[^>]*>Update now<\/button><button class="primary" data-upd="wait"[^>]*>Wait for them</);
  assert.match(page, /Update waiting for sessions to finish/);
  assert.match(page, /data-upd="restart"[^>]*>Update now</);
  assert.match(page, /prefers-reduced-motion: reduce\) \{ header\.top \.upd-btn\.waiting svg \{ animation: none/);
  assert.match(page, /\['about', 'About', \[\['update', 'Check for updates'\]\]\]/);
});
