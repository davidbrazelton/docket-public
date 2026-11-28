// Tests for app-keeper.mjs, what supervisor.mjs decides (#1273, #1276): crashes are started again with growing waits,
// a crash loop right after an update goes back to the last good commit, and a frozen app is told from a stall.
// Run with: npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { exitKind, afterExit, backoffMs, noCrashes, rollBack, probeVerdict, newWatch, healthStep, supervisorAlive, otherSupervisor,
  updateSkip, noticeText, crashLines, librariesDiffer, localEdits, RESTART_CODE, LOOP_CRASHES, START_CRASH_MS, CHECK_EVERY_MS, FROZEN_MS, CHECK_TIMEOUT_MS, CHECK_SLACK_MS } from '../app-keeper.mjs';

test('exitKind: 75 restarts, 0 and a stop asked for end it, anything else is a crash', () => {
  assert.equal(exitKind({ code: RESTART_CODE }), 'restart');
  assert.equal(exitKind({ code: 0 }), 'stop', 'Quit Docket, Restart Docket handing over, Ctrl+C');
  assert.equal(exitKind({ code: 1 }), 'crash');
  assert.equal(exitKind({ code: null }), 'crash', 'killed from outside');
  assert.equal(exitKind({ code: 1, stopping: true }), 'stop', 'this supervisor was stopped and ended the app');
  assert.equal(exitKind({ code: null, frozen: true }), 'frozen');
});

test('crashes are started again after about 1 s, 5 s, 30 s, then every minute, without end', () => {
  let counts = noCrashes();
  const waits = [];
  for (let i = 0; i < 6; i++) {
    const s = afterExit(counts, { kind: 'crash', upMs: 10 * START_CRASH_MS });
    assert.equal(s.action, 'start');
    waits.push(s.waitMs); counts = s.counts;
  }
  assert.deepEqual(waits, [1000, 5000, 30000, 60000, 60000, 60000]);
  assert.equal(backoffMs(0), 1000);
  assert.deepEqual(afterExit(counts, { kind: 'restart', upMs: 5 }), { counts, action: 'start', waitMs: 0, loop: false }, 'a planned restart waits for nothing');
  assert.equal(afterExit(counts, { kind: 'stop', upMs: 5 }).action, 'stop');
});

test('a crash loop on start is noticed; a crash after running a while breaks the run', () => {
  let counts = noCrashes(), s;
  for (let i = 1; i <= LOOP_CRASHES; i++) { s = afterExit(counts, { kind: 'crash', upMs: 2000 }); counts = s.counts; assert.equal(s.loop, i === LOOP_CRASHES); }
  assert.equal(counts.startCrashes, LOOP_CRASHES);
  s = afterExit(noCrashes(), { kind: 'crash', upMs: 2000 });
  s = afterExit(s.counts, { kind: 'crash', upMs: START_CRASH_MS + 1 });
  assert.deepEqual(s.counts, { crashes: 2, startCrashes: 0 });
  s = afterExit({ crashes: 0, startCrashes: 2 }, { kind: 'frozen', upMs: 2000 });
  assert.equal(s.loop, false, 'a frozen app is not a crash on start');
  assert.equal(s.waitMs, 1000);
});

// The case seen on a real computer: an update restarted cleanly, then minutes later a write to a briefly locked
// portal-state.json threw and the app exited with 1. That is restarted, never backed out.
test('a crash minutes after a clean start is started again after 1 s and never leads to going back', () => {
  let counts = noCrashes(), s;
  s = afterExit(counts, { kind: 'restart', upMs: 5 * 60000 }); // the update's planned restart
  assert.deepEqual([s.action, s.waitMs], ['start', 0]);
  s = afterExit(s.counts, { kind: 'crash', upMs: 7 * 60000 }); // EUNKNOWN writing portal-state.json, 7 minutes in
  assert.deepEqual([s.action, s.waitMs, s.loop, s.counts.startCrashes], ['start', 1000, false, 0]);
  for (let i = 0; i < 5; i++) { s = afterExit(s.counts, { kind: 'crash', upMs: 7 * 60000 }); assert.equal(s.loop, false, 'late crashes, however many'); }
  // Two crashes on start and then one late: the run of crashes on start is broken.
  s = afterExit(noCrashes(), { kind: 'crash', upMs: 500 });
  s = afterExit(s.counts, { kind: 'crash', upMs: 500 });
  s = afterExit(s.counts, { kind: 'crash', upMs: 7 * 60000 });
  assert.equal(s.loop, false); assert.equal(s.counts.startCrashes, 0);
  s = afterExit(s.counts, { kind: 'crash', upMs: 500 });
  assert.equal(s.loop, false, 'counting starts over');
});

test('rollBack: only off the last good commit, on master, with no edits, and that commit still here', () => {
  const good = { head: 'a'.repeat(40), version: '1.0.0' };
  const ok = { head: 'b'.repeat(40), good, branch: 'master', clean: true, goodExists: true };
  assert.equal(rollBack(ok).go, true);
  assert.match(rollBack({ ...ok, good: null }).why, /no commit has started cleanly/);
  assert.match(rollBack({ ...ok, head: good.head }).why, /an update is not the cause/);
  assert.match(rollBack({ ...ok, branch: 'my-fix' }).why, /git branch my-fix/, 'a working copy on its own branch is never moved');
  assert.match(rollBack({ ...ok, clean: false }).why, /edits not in a git commit/);
  assert.match(rollBack({ ...ok, goodExists: false }).why, /no longer in this folder/);
  assert.equal(rollBack({ ...ok, head: '' }).go, false);
  // npm install rewriting package-lock.json after an update is not an edit of the person's.
  assert.deepEqual(localEdits('M package-lock.json'), []);
  assert.deepEqual(localEdits(' M package-lock.json\n M server.mjs\n'), ['M server.mjs']);
  assert.deepEqual(localEdits(''), []);
  assert.deepEqual(localEdits('unknown'), ['unknown'], 'git could not say: not clean');
});

test('probeVerdict: any answer is up; a check that came back late says nothing', () => {
  assert.equal(probeVerdict({ answered: true, elapsedMs: 99999 }), 'up');
  assert.equal(probeVerdict({ answered: false, elapsedMs: CHECK_TIMEOUT_MS }), 'down');
  assert.equal(probeVerdict({ answered: false, elapsedMs: 5 }), 'down', 'refused: nothing listening');
  assert.equal(probeVerdict({ answered: false, elapsedMs: CHECK_TIMEOUT_MS + CHECK_SLACK_MS + 1 }), 'unsure');
});

test('healthStep: frozen only after several minutes of real misses; sleep and stalls start the count over', () => {
  const t0 = 1_000_000;
  let w = newWatch(t0), t = t0;
  const step = (verdict, gap = CHECK_EVERY_MS) => { t += gap; w = healthStep(w, { verdict, now: t }); return w; };
  step('up');
  for (let i = 0; i < 8; i++) assert.equal(step('down').frozen, false, `miss ${i + 1}: under ${FROZEN_MS / 60000} minutes`);
  assert.equal(step('down').frozen, true, 'four minutes of misses');
  // A short stall: an answer in between starts it over.
  w = newWatch(t); step('up'); for (let i = 0; i < 5; i++) step('down'); step('up');
  for (let i = 0; i < 7; i++) assert.equal(step('down').frozen, false);
  // The computer slept: a long gap starts the count over rather than counting the sleep as no answer.
  w = newWatch(t); step('up'); step('down'); step('down');
  assert.equal(step('down', 30 * 60000).frozen, false, 'the first miss after waking');
  assert.equal(w.misses, 1);
  // Checks spoilt by the supervisor's own stall neither count nor break the run.
  w = newWatch(t); step('up');
  for (let i = 0; i < 4; i++) { step('down'); step('unsure'); }
  assert.equal(w.misses, 4);
  // An app that never answers from its start is frozen too (hung on start).
  w = newWatch(t);
  for (let i = 0; i < 7; i++) step('down');
  assert.equal(step('down').frozen, true);
});

test('supervisor.json: a running supervisor has a live process and a fresh heartbeat; a second one leaves the app to it', () => {
  const now = 10_000_000, alive = (pid) => pid === 11 || pid === 22;
  const rec = { pid: 11, appPid: 99, at: now - 1000, every: CHECK_EVERY_MS, stopped: '' };
  assert.equal(supervisorAlive(rec, now, alive), true);
  assert.equal(supervisorAlive({ ...rec, at: now - 4 * CHECK_EVERY_MS }, now, alive), false, 'stale heartbeat: a reused process number');
  assert.equal(supervisorAlive({ ...rec, pid: 33 }, now, alive), false, 'gone');
  assert.equal(supervisorAlive({ ...rec, stopped: 'SIGTERM' }, now, alive), false);
  assert.equal(supervisorAlive(null, now, alive), false);
  assert.equal(otherSupervisor(rec, { pid: 22, now, alive }), rec, 'another keeps it: this one ends');
  assert.equal(otherSupervisor(rec, { pid: 11, now, alive }), null, 'its own record');
  assert.equal(otherSupervisor(rec, { pid: 22, after: 99, now, alive }), null, 'Restart Docket: the old one is on its way out');
});

test('updateSkip and noticeText: the bad commit is skipped until a newer one comes; the page is told once, in words', () => {
  const guard = { skip: { bad: 'b'.repeat(40), good: 'a'.repeat(40), badVersion: '1.2.0', goodVersion: '1.1.0' } };
  assert.match(updateSkip(guard, 'b'.repeat(40)), /v1\.2\.0 \(bbbbbbb\) would not start here, so Docket went back to v1\.1\.0 \(aaaaaaa\)/);
  assert.equal(updateSkip(guard, 'c'.repeat(40)), '', 'a newer commit is taken');
  assert.equal(updateSkip(null, 'b'), '');
  const text = noticeText({ badVersion: '1.2.0', goodVersion: '1.1.0', bad: 'b', good: 'a', log: 'x\nTypeError: boom\n  at server.mjs:1\n' });
  assert.match(text, /^Docket went back from v1\.2\.0 to v1\.1\.0 because v1\.2\.0 would not start\./);
  assert.match(text, /TypeError: boom/);
  const log = 'file:///C:/x/server.mjs:3\r\n  throw new TypeError(\'boom\');\r\n        ^\r\n  TypeError: boom\r\n      at file:///C:/x/server.mjs:3:7\r\n      at ModuleJob.run (node:internal)\r\n  Node.js v24.20.0\n';
  assert.equal(crashLines(log), 'TypeError: boom\nat file:///C:/x/server.mjs:3:7', 'the error, not the last stack lines');
  assert.equal(crashLines('a\nb'), 'a\nb');
});

test('librariesDiffer: a version bump alone needs no npm install; a changed library does', () => {
  const pkg = (v, deps) => JSON.stringify({ version: v, dependencies: deps });
  const lock = (v, ws) => JSON.stringify({ version: v, packages: { '': { version: v }, 'node_modules/ws': { version: ws } } });
  assert.equal(librariesDiffer({ goodPkg: pkg('1.0.0', { ws: '^8' }), badPkg: pkg('1.1.0', { ws: '^8' }), goodLock: lock('1.0.0', '8.1.0'), badLock: lock('1.1.0', '8.1.0') }), false);
  assert.equal(librariesDiffer({ goodPkg: pkg('1.0.0', { ws: '^8' }), badPkg: pkg('1.1.0', { ws: '^8' }), goodLock: lock('1.0.0', '8.1.0'), badLock: lock('1.1.0', '8.2.0') }), true);
  assert.equal(librariesDiffer({ goodPkg: pkg('1.0.0', { ws: '^8' }), badPkg: pkg('1.1.0', { ws: '^9' }), goodLock: '', badLock: '' }), true);
});
