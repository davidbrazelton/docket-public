// Tests for runner-revive.mjs (#1277): the session runner starts the supervisor again only when its own supervised app
// and that app's supervisor are both gone, never after a stop asked for, during a planned restart, or twice.
// Run with: npm test
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { reviveDecision, makeReviver, supervisorRunning, QUIET_MS, AGAIN_MS, LATE_MS } from '../runner-revive.mjs';

const now = 100 * AGAIN_MS;
const app = { pid: 5, port: 4400, supervised: true, stopped: '' };
const gone = { now, quietSince: now - QUIET_MS, app, appPort: 4400, supervisorAlive: false };

test('reviveDecision: only its own supervised app, gone a minute, with no supervisor running', () => {
  assert.equal(reviveDecision(gone).go, true);
  assert.match(reviveDecision({ ...gone, app: null }).why, /no app has run/);
  assert.match(reviveDecision({ ...gone, appPort: 4405 }).why, /port 4400, not 4405/, 'a runner for another port');
  assert.match(reviveDecision({ ...gone, app: { ...app, supervised: false } }).why, /not started by supervisor/, 'started by hand or from start-docket.cmd');
  assert.match(reviveDecision({ ...gone, app: { ...app, stopped: 'Quit' } }).why, /stopped on purpose/);
  assert.match(reviveDecision({ ...gone, quietSince: now - QUIET_MS + 1 }).why, /less than a minute/);
  assert.match(reviveDecision({ ...gone, supervisorAlive: true }).why, /supervisor is running/, 'a planned restart: the supervisor starts it');
  assert.match(reviveDecision({ ...gone, lastRevive: now - AGAIN_MS + 1 }).why, /less than five minutes/);
  assert.equal(reviveDecision({ ...gone, lastRevive: now - AGAIN_MS }).go, true);
});

test('supervisorRunning: process there, heartbeat fresh, not stopped', () => {
  const alive = (pid) => pid === 7;
  assert.equal(supervisorRunning({ pid: 7, at: now - 1000, every: 30000 }, now, alive), true);
  assert.equal(supervisorRunning({ pid: 7, at: now - 100000, every: 30000 }, now, alive), false);
  assert.equal(supervisorRunning({ pid: 8, at: now, every: 30000 }, now, alive), false);
  assert.equal(supervisorRunning({ pid: 7, at: now, stopped: 'SIGTERM' }, now, alive), false);
});

const tmps = [];
after(() => { for (const t of tmps) fs.rmSync(t, { recursive: true, force: true }); });
function setup({ answers = false, supervisor = null, run = app } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'docket-revive-')); tmps.push(dir);
  if (run) fs.writeFileSync(path.join(dir, 'app-run.json'), JSON.stringify(run));
  if (supervisor) fs.writeFileSync(path.join(dir, 'supervisor.json'), JSON.stringify(supervisor));
  let t = now;
  const spawned = [], logged = [], asked = [];
  const r = makeReviver({
    root: 'R', dataDir: dir, appPort: 4400, log: (x) => logged.push(x), now: () => t, alive: () => true,
    fetch: async (url) => { asked.push(url); if (!answers) throw new Error('ECONNREFUSED'); return { arrayBuffer: async () => null }; },
    spawn: (cmd, args, opts) => { spawned.push({ cmd, args, opts }); return {}; },
  });
  return { r, spawned, logged, asked, dir, at: (x) => { t = x; } };
}

test('makeReviver: starts one supervisor, from its own folder, once the app is gone a minute; never twice in a row', async () => {
  const s = setup();
  s.at(now); assert.equal(await s.r.tick(now - 1000), null, 'in touch a second ago');
  assert.equal(s.asked.length, 0, 'nothing is asked while the app is in touch');
  for (let x = now + 5000; x < now - 1000 + QUIET_MS; x += 5000) { s.at(x); await s.r.tick(now - 1000); }
  assert.equal(s.spawned.length, 0);
  s.at(now - 1000 + QUIET_MS); const d = await s.r.tick(now - 1000);
  assert.equal(d.go, true);
  assert.equal(s.spawned.length, 1);
  assert.equal(path.basename(s.spawned[0].args[0]), 'supervisor.mjs');
  assert.equal(s.spawned[0].opts.cwd, 'R');
  assert.match(s.logged[0], /starting the app again: no word from its app on port 4400/);
  for (let x = now + QUIET_MS; x < now + QUIET_MS + AGAIN_MS - 5000; x += 5000) { s.at(x); await s.r.tick(now - 1000); }
  assert.equal(s.spawned.length, 1, 'not again within five minutes');
});

test('makeReviver: an app that answers, a supervisor running, or a computer back from sleep starts nothing', async () => {
  const a = setup({ answers: true });
  a.at(now + QUIET_MS); await a.r.tick(now);
  assert.equal(a.spawned.length, 0, 'the app answers, just not to this runner');
  const b = setup({ supervisor: { pid: 7, at: now + QUIET_MS, every: 30000 } });
  b.at(now + QUIET_MS); await b.r.tick(now);
  assert.equal(b.spawned.length, 0, 'a supervisor is there');
  const c = setup();
  c.at(now); await c.r.tick(now);
  c.at(now + LATE_MS + 3 * 60000); await c.r.tick(now); // the first tick after a long sleep
  assert.equal(c.spawned.length, 0, 'the app gets its minute after the wake-up');
  for (let x = now + LATE_MS + 3 * 60000 + 5000; x < now + LATE_MS + 4 * 60000; x += 5000) { c.at(x); await c.r.tick(now); }
  assert.equal(c.spawned.length, 0);
  c.at(now + LATE_MS + 4 * 60000); await c.r.tick(now);
  assert.equal(c.spawned.length, 1, 'then it is gone for real');
  const d = setup({ run: { ...app, stopped: 'the app exited with 0' } });
  d.at(now + 10 * QUIET_MS); await d.r.tick(now);
  assert.equal(d.spawned.length, 0, 'Quit Docket');
});
