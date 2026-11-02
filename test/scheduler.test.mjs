// Tests for scheduler.mjs. Run with: npm test
// The clock is faked, and the time zone is US Central so the daylight saving
// change on Sunday 2026-11-01 (2 am back to 1 am) can be tested.
process.env.TZ = 'America/Chicago';
import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createScheduler, previousRun, nextRun } from '../scheduler.mjs';

function setup({ schedules, startRun, isPaused } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'docket-sched-'));
  const file = path.join(dir, 'schedules.json');
  const clients = [{ id: 'c', home: dir, folder: dir }];
  for (const s of schedules) {
    fs.mkdirSync(path.join(dir, 'scheduled-tasks', s.id), { recursive: true });
    fs.writeFileSync(path.join(dir, 'scheduled-tasks', s.id, 'SKILL.md'), '---\nname: x\n---\n\nDo the thing');
  }
  fs.writeFileSync(file, JSON.stringify(schedules));
  const runs = [];
  let n = 0;
  const scheduler = createScheduler({
    file, clients,
    startRun: startRun || ((o) => { runs.push({ at: new Date().toISOString(), ...o }); return `session-${++n}`; }),
    isRunning: () => false,
    isPaused,
    log: () => {},
  });
  const stored = () => JSON.parse(fs.readFileSync(file, 'utf8'));
  return { scheduler, runs, file, clients, stored };
}

const sched = (over) => ({ id: 'job', client: 'c', title: 'Job', cron: null, fireAt: null, folder: null, enabled: true,
  lastRunAt: '2026-10-01T00:00:00.000Z', lastSessionId: null, runs: [], ...over });

// Moves the fake clock forward a minute at a time, so every 30-second check runs.
function advanceTo(iso) {
  const target = new Date(iso).getTime();
  while (Date.now() < target) mock.timers.tick(Math.min(60 * 1000, target - Date.now()));
}

test('1. Run now on a one-time task before its time uses it up', (t) => {
  mock.timers.enable({ apis: ['setInterval', 'setTimeout', 'Date'], now: new Date('2026-10-22T15:00:00Z') });
  t.after(() => mock.timers.reset());
  const { scheduler, runs } = setup({ schedules: [sched({ fireAt: '2026-10-22T18:00:00.000Z' })] });
  scheduler.runNow('job');
  assert.equal(runs.length, 1);
  advanceTo('2026-10-22T19:00:00Z');
  scheduler.stop();
  assert.equal(runs.length, 1, 'the one-time task ran again at its set time after Run now');
  assert.equal(scheduler.get('job').enabled, false);
});

test('1b. A one-time task still runs once at its time when nobody pressed Run now', (t) => {
  mock.timers.enable({ apis: ['setInterval', 'setTimeout', 'Date'], now: new Date('2026-10-22T15:00:00Z') });
  t.after(() => mock.timers.reset());
  const { scheduler, runs } = setup({ schedules: [sched({ fireAt: '2026-10-22T18:00:00.000Z' })] });
  advanceTo('2026-10-22T19:00:00Z');
  scheduler.stop();
  assert.equal(runs.length, 1);
});

test('2. A schedule in the repeated hour runs once when the clocks go back', (t) => {
  // 1:30 am Central every day. On 2026-11-01, 1:30 am happens at 06:30Z (daylight time) and again at 07:30Z.
  mock.timers.enable({ apis: ['setInterval', 'setTimeout', 'Date'], now: new Date('2026-11-01T05:00:00Z') });
  t.after(() => mock.timers.reset());
  const { scheduler, runs } = setup({ schedules: [sched({ cron: '30 1 * * *', lastRunAt: '2026-10-31T06:30:00.000Z' })] });
  advanceTo('2026-11-01T10:00:00Z');
  scheduler.stop();
  assert.deepEqual(runs.map((r) => r.at), ['2026-11-01T06:30:00.000Z']);
});

test('2b. previousRun and nextRun around the clock changes', () => {
  // Fall back: the second 1:30 am is not a run time of its own.
  assert.equal(previousRun('30 1 * * *', new Date('2026-11-01T07:45:00Z')).toISOString(), '2026-11-01T06:30:00.000Z');
  assert.equal(nextRun('30 1 * * *', new Date('2026-11-01T06:45:00Z')).toISOString(), '2026-11-02T07:30:00.000Z');
  // Spring forward (2026-03-08, 2 am jumps to 3 am): looking back from 3:05 am must not get stuck
  // (stepping the local clock used to bounce between 3:59 and 3:00 and give up with no answer).
  assert.equal(previousRun('0 8 * * *', new Date('2026-03-08T08:05:00Z')).toISOString(), '2026-03-07T14:00:00.000Z');
  assert.equal(previousRun('0 3 * * *', new Date('2026-03-08T08:05:00Z')).toISOString(), '2026-03-08T08:00:00.000Z');
  // Ordinary days are unchanged.
  assert.equal(nextRun('0 8 */3 * *', new Date('2026-10-22T15:00:00Z')).toISOString(), '2026-10-25T13:00:00.000Z');
});

test('3. A run is saved as done before its session starts', (t) => {
  mock.timers.enable({ apis: ['setInterval', 'setTimeout', 'Date'], now: new Date('2026-10-22T12:59:00Z') });
  t.after(() => mock.timers.reset());
  let seen = null;
  const env = setup({
    schedules: [sched({ cron: '0 8 * * *' })],
    startRun: () => { seen = env.stored()[0].lastRunAt; return 'session-1'; },
  });
  advanceTo('2026-10-22T13:01:00Z');
  env.scheduler.stop();
  assert.equal(seen, '2026-10-22T13:00:00.000Z', 'lastRunAt on disk was still the old one while the session was starting');
});

test('3b. If starting the session fails partway, the run is not started again every 30 seconds', (t) => {
  mock.timers.enable({ apis: ['setInterval', 'setTimeout', 'Date'], now: new Date('2026-10-22T12:59:00Z') });
  t.after(() => mock.timers.reset());
  let starts = 0;
  const { scheduler, stored } = setup({
    schedules: [sched({ cron: '0 8 * * *' })],
    startRun: () => { starts++; throw new Error('sending the prompt failed'); }, // the session may already exist
  });
  advanceTo('2026-10-22T13:10:00Z');
  scheduler.stop();
  assert.equal(starts, 1);
  assert.match(stored()[0].runs[0].error, /sending the prompt failed/);
});

test('Each run tells the new session its run time, the one saved in the schedule\'s list of runs', (t) => {
  mock.timers.enable({ apis: ['setInterval', 'setTimeout', 'Date'], now: new Date('2026-10-28T13:00:00Z') });
  t.after(() => mock.timers.reset());
  const { scheduler, runs, stored } = setup({ schedules: [sched({ cron: '0 8 */3 * *' })] });
  scheduler.runNow('job');
  scheduler.stop();
  assert.equal(runs.length, 1);
  assert.equal(runs[0].runAt, stored()[0].runs[0].at);
  assert.equal(runs[0].scheduleId, 'job');
});

test('While Docket is paused a due run waits, and starts after Resume all', (t) => {
  mock.timers.enable({ apis: ['setInterval', 'setTimeout', 'Date'], now: new Date('2026-10-22T12:59:00Z') });
  t.after(() => mock.timers.reset());
  let paused = true;
  const { scheduler, runs } = setup({ schedules: [sched({ cron: '0 8 * * *' })], isPaused: () => paused });
  advanceTo('2026-10-22T13:30:00Z');
  assert.equal(runs.length, 0, 'a run started while paused');
  paused = false;
  advanceTo('2026-10-22T13:31:00Z');
  scheduler.stop();
  assert.equal(runs.length, 1);
});
