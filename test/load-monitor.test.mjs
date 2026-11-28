// Tests for load-monitor.mjs, the load monitor's rules (#1067). Run with: npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { strain, loadHigh, loadReason, loadStep, batterySwitch, LOAD_HOLD, NORMAL_MS, QUIET_MS } from '../load-monitor.mjs';
import { queueOnNow, queueLimit } from '../queue.mjs';

const T0 = 1_800_000_000_000;
const ok = { loopP99: 20, cpu: 10, freeMb: 9000, working: 1 };
// n samples 30 s apart, the last at `end`, each `x` laid over a normal one.
const run = (n, x = {}, end = T0) => Array.from({ length: n }, (_, i) => ({ at: end - (n - 1 - i) * 30_000, ...ok, ...x }));

test('a sample is over on app lag above 500 ms, CPU above 85% or free memory under 3,000 MB', () => {
  assert.deepEqual([...strain(ok)], []);
  assert.deepEqual([...strain({ loopP99: 501 })], ['app']);
  assert.deepEqual([...strain({ loopP99: 500, cpu: 85, freeMb: 3000 })], [], 'the limits themselves are fine');
  assert.deepEqual([...strain({ cpu: 92, freeMb: 2500 })], ['cpu', 'mem']);
  assert.deepEqual([...strain({ freeMb: null })], [], 'no reading is no strain');
});

test('load is high only after 4 strained samples in a row, back to back and fresh', () => {
  assert.equal(LOAD_HOLD, 4);
  assert.equal(loadHigh(run(3, { loopP99: 750 }), T0), null, '1.5 minutes is not enough');
  assert.deepEqual(loadHigh(run(4, { loopP99: 750 }), T0), ['app']);
  assert.deepEqual(loadHigh([...run(10), ...run(4, { cpu: 95 }, T0 + 300_000)], T0 + 300_000), ['cpu']);
  const dip = run(4, { loopP99: 750 }); dip[2] = { ...dip[2], loopP99: 40 };
  assert.equal(loadHigh(dip, T0), null, 'one normal sample breaks the run');
  assert.equal(loadHigh(run(4, { loopP99: 750 }), T0 + 120_000), null, 'stale samples (the sampler stopped) say nothing');
  const gap = run(4, { loopP99: 750 }); gap[0] = { ...gap[0], at: gap[0].at - 600_000 };
  assert.equal(loadHigh(gap, T0), null, 'a gap (the computer slept) breaks the run');
  const woke = run(4, { loopP99: 750 }); woke[1] = { ...woke[1], slept: true };
  assert.equal(loadHigh(woke, T0), null, 'a sample that overlaps sleep or standby breaks the run');
  const mixed = run(4, { loopP99: 750 }); mixed[0] = { ...mixed[0], loopP99: 40, cpu: 95 };
  assert.deepEqual(loadHigh(mixed, T0), ['app'], 'signals taking turns still count; the reason names the newest');
  assert.deepEqual(loadHigh(run(4, { loopP99: 900, freeMb: 2000 }), T0), ['app', 'mem']);
});

test('the reason says power, what is over, for how long and how many work', () => {
  const s = run(4, { loopP99: 748, onBattery: true, working: 5 });
  assert.equal(loadReason(s, ['app']), 'on battery, app lag 750 ms for 2 min, 5 working');
  assert.equal(loadReason(run(4, { cpu: 92, freeMb: 1700, working: 8 }), ['cpu', 'mem']), 'CPU 92%, 1.7 GB free for 2 min, 8 working');
});

test('high load with queue mode off suggests it; it stays through a short dip and clears after 5 normal minutes', () => {
  const high = run(4, { loopP99: 750, working: 5 });
  let st = loadStep({}, { samples: high, now: T0 });
  assert.match(st.reason, /app lag 750 ms/);
  assert.equal(st.cap, null);
  const first = st.reason;
  st = loadStep(st, { samples: [...high, { ...ok, at: T0 + 30_000, loopP99: 900 }], now: T0 + 30_000 });
  assert.equal(st.reason, first, 'the reason holds while it lasts, so the event log is not written each sample');
  let t = T0 + 60_000;
  st = loadStep(st, { samples: run(1, {}, t), now: t });
  assert.equal(st.reason, first, 'one normal sample does not clear it');
  t += NORMAL_MS - 30_000;
  st = loadStep(st, { samples: run(1, {}, t), now: t });
  assert.equal(st.reason, first, 'not yet 5 minutes');
  t += 30_000;
  st = loadStep(st, { samples: run(1, {}, t), now: t });
  assert.equal(st.reason, null, '5 minutes normal clears it');
});

test('Not now quiets the suggestion for 2 hours, then it can come back', () => {
  assert.equal(QUIET_MS, 2 * 3600_000);
  const quietUntil = T0 + QUIET_MS;
  let st = loadStep({ reason: 'x', cap: null, normalSince: null }, { samples: run(4, { cpu: 95 }), now: T0, quietUntil });
  assert.equal(st.reason, null, 'quiet while high');
  const later = T0 + QUIET_MS - 60_000;
  st = loadStep(st, { samples: run(4, { cpu: 95 }, later), now: later, quietUntil });
  assert.equal(st.reason, null, 'still quiet just before the 2 hours end');
  const after = T0 + QUIET_MS;
  st = loadStep(st, { samples: run(4, { cpu: 95 }, after), now: after, quietUntil });
  assert.match(st.reason, /CPU 95%/, 'back after 2 hours if the load still is');
  st = loadStep({ reason: 'x', cap: null, normalSince: T0 }, { samples: run(1, {}, T0 + 60_000), now: T0 + 60_000, quietUntil: T0 + QUIET_MS });
  assert.equal(st.reason, null, 'Not now during the 5 normal minutes clears it at once');
});

test('with queue mode on, high load lowers the limit by one, never below 1, and lifts it after 5 normal minutes', () => {
  const high = run(4, { loopP99: 750 });
  let st = loadStep({ reason: 'suggested', cap: null }, { samples: high, now: T0, queueOn: true, limit: 2 });
  assert.equal(st.cap, 1);
  assert.match(st.reason, /app lag/);
  assert.equal(loadStep({}, { samples: high, now: T0, queueOn: true, limit: 1 }).reason, null, 'a limit of 1 stays 1');
  let t = T0 + 30_000;
  st = loadStep(st, { samples: run(1, {}, t), now: t, queueOn: true, limit: 2 });
  assert.equal(st.cap, 1, 'kept through a short dip');
  t += NORMAL_MS;
  st = loadStep(st, { samples: run(1, {}, t), now: t, queueOn: true, limit: 2 });
  assert.deepEqual([st.reason, st.cap], [null, null], 'lifted after 5 normal minutes');
  st = loadStep({ reason: 'x', cap: 5, normalSince: T0 }, { samples: run(1, {}, T0 + 30_000), now: T0 + 30_000, queueOn: false, limit: Infinity });
  assert.equal(st.reason, null, 'queue mode turned off ends the lowered limit');
  st = loadStep({ reason: 'x', cap: null, normalSince: T0 }, { samples: run(1, {}, T0 + 30_000), now: T0 + 30_000, queueOn: true, limit: 6 });
  assert.equal(st.reason, null, 'queue mode turned on ends the suggestion');
  assert.equal(queueLimit({ on: true, battery: 2, plugged: 6 }, { onBattery: false, cap: 5 }), 5, 'queue mode applies the cap');
});

test('automatically on battery: on while on battery, back to the person\'s own setting plugged in', () => {
  const auto = { on: false, autoBattery: true };
  assert.equal(queueOnNow(auto, true), true);
  assert.equal(queueOnNow(auto, false), false);
  assert.equal(queueOnNow(auto, null), false, 'power not known yet counts as plugged in');
  assert.equal(queueOnNow({ on: false, autoBattery: false }, true), false, 'off by default');
  assert.equal(queueOnNow({ on: true, autoBattery: true }, false), true, 'the person\'s own on stays on plugged in');
  assert.equal(queueLimit(auto, { onBattery: true }), 3, 'the default battery limit');
  assert.equal(queueLimit(auto, { onBattery: false }), Infinity);
  assert.equal(batterySwitch(auto, false, true), 'queue mode: on (on battery, automatically)');
  assert.equal(batterySwitch(auto, true, false), 'queue mode: back off (plugged in)');
  assert.equal(batterySwitch(auto, null, true), 'queue mode: on (on battery, automatically)', 'first reading on battery');
  assert.equal(batterySwitch(auto, null, false), '', 'first reading plugged in: no switch');
  assert.equal(batterySwitch({ on: true, autoBattery: true }, false, true), '', 'already on: nothing switches');
  assert.equal(batterySwitch({ on: false, autoBattery: false }, false, true), '');
});
