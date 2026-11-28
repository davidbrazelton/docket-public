// ☰ > Gauges > Performance (#935): keeping the samples, the pages' reports, and when a slow stretch is logged.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { loadSamples, keepSample, pageTally, checkSlow, summaryText, perfView, fileFor, KEEP, HOLD, sleptSample } from '../perf.mjs';

test('keepSample adds a line, then cuts the file back to a day once it is a quarter over; loadSamples reads it back', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'perf-'));
  const list = [];
  for (let i = 0; i < KEEP * 1.25; i++) keepSample(dir, list, { at: i });
  assert.equal(list.length, KEEP * 1.25);
  assert.equal(fs.readFileSync(fileFor(dir), 'utf8').trim().split('\n').length, KEEP * 1.25);
  keepSample(dir, list, { at: 99999 });
  assert.equal(list.length, KEEP);
  assert.equal(list.at(-1).at, 99999);
  fs.appendFileSync(fileFor(dir), 'not json\n');
  const back = loadSamples(dir);
  assert.equal(back.length, KEEP);
  assert.deepEqual(back.at(-1), { at: 99999 });
  assert.deepEqual(loadSamples(path.join(dir, 'none')), []);
});

test('pageTally: sums every page, as rates per minute, nulls when no page reported', () => {
  const t = pageTally();
  assert.deepEqual(t.take(), { pages: 0, pagesVisible: 0, pageTasks: null, pageMs: null, pageFrames: null });
  t.add({ tasks: 10, ms: 900, frames: 3, visible: true });
  t.add({ tasks: 2, ms: 100, frames: 'x' });
  assert.deepEqual(t.take(30_000), { pages: 2, pagesVisible: 1, pageTasks: 24, pageMs: 2000, pageFrames: 6 });
  assert.equal(t.take().pages, 0, 'each take starts again');
});

const S = (o) => ({ at: 0, onBattery: true, battery: 54, cpu: 50, loopP99: 5, pageTasks: 2, live: 9, working: 7, freeMb: 3000, ...o });

test('checkSlow: logs once when a figure stays over its limit for two minutes, and once when all are back', () => {
  const list = [S({ cpu: 95 }), S({ cpu: 95 }), S({ cpu: 95 })];
  let r = checkSlow(list);
  assert.equal(r.log, '', 'three samples are not yet two minutes');
  list.push(S({ cpu: 91 }));
  r = checkSlow(list);
  assert.deepEqual([...r.slow], ['cpu']);
  assert.match(r.log, /^performance: slow \(CPU\)\non battery 54%, CPU 94% for 2 min, 7 working of 9 live, app lag 5 ms, page long tasks 2\/min, 3000 MB free$/);
  list.push(S({ cpu: 90 }));
  r = checkSlow(list, r.slow);
  assert.equal(r.log, '', 'still slow: nothing new');
  list.push(S({ cpu: 20, pageTasks: 40 }));
  r = checkSlow(list, r.slow);
  assert.equal(r.slow.size, 0);
  assert.match(r.log, /^performance: back to normal\n/);
  for (let i = 0; i < HOLD; i++) list.push(S({ pageTasks: 40, loopP99: 300 }));
  r = checkSlow(list, r.slow);
  assert.match(r.log, /slow \(app lag, page lag\)/);
  assert.equal(checkSlow([S({ cpu: null }), S({ cpu: null }), S({ cpu: null }), S({ cpu: null })]).log, '', 'no reading is not slow');
});

test('summaryText names the power state', () => {
  assert.match(summaryText([S({ onBattery: false })]), /^plugged in, /);
  assert.match(summaryText([S({ onBattery: null })]), /^no battery, /);
  assert.match(summaryText([S({ onBattery: true, battery: 40, powerMode: 'efficiency' })]), /^on battery 40% \(power mode efficiency\), /, 'and the power mode (#1117)');
  assert.equal(summaryText([]), '');
});

test('perfView: the last hour, with averages on battery and plugged in side by side', () => {
  const now = 10_000_000;
  const list = [S({ at: now - 4000_000, cpu: 100 }), S({ at: now - 60_000, cpu: 80 }), S({ at: now - 30_000, cpu: 60 }), S({ at: now, onBattery: false, cpu: 10, pageTasks: null })];
  const v = perfView(list, { now });
  assert.equal(v.samples.length, 3);
  assert.equal(v.battery.cpu, 70);
  assert.equal(v.battery.samples, 2);
  assert.equal(v.battery.minutes, 1);
  assert.equal(v.plugged.cpu, 10);
  assert.equal(v.plugged.pageTasks, null);
});

test('sleptSample: only on evidence of sleep, never for a late timer a block explains (#1123)', () => {
  assert.equal(sleptSample({ windowMs: 30_000, loopMax: 40, loopP50: 12, woke: false }), false);
  assert.equal(sleptSample({ windowMs: 30_000, loopMax: 40, loopP50: 12, woke: true }), true, 'the power helper or the clock check saw it');
  assert.equal(sleptSample({ windowMs: 90_000, loopMax: 300, loopP50: 12 }), true, '60 s late with no block to explain it: asleep');
  assert.equal(sleptSample({ windowMs: 90_000, loopMax: null, loopP50: null }), true, 'late, and the loop recorded nothing: frozen');
  assert.equal(sleptSample({ windowMs: 30_000, loopMax: 88_000, loopP50: 88_000 }), true, 'the second laptop: 88 s with loopP50 also 88 s');
  assert.equal(sleptSample({ windowMs: 30_000, loopP50: null }), false);
});

test('sleptSample: a real 50 s stall with a low loopP50 and a matching loopMax is not slept (#1123)', () => {
  // The second laptop's plugged-in stalls: 45-52 s, loopP50 2-460 ms. The block makes the timer late by about as much.
  assert.equal(sleptSample({ windowMs: 80_000, loopMax: 50_000, loopP50: 2 }), false);
  assert.equal(sleptSample({ windowMs: 75_000, loopMax: 52_000, loopP50: 460 }), false);
  assert.equal(sleptSample({ windowMs: 47_000, loopMax: 17_000, loopP50: 5.6 }), false, 'a block of 17 s, timer 17 s late');
  assert.equal(sleptSample({ windowMs: 95_000, loopMax: 50_000, loopP50: 2 }), false, 'a block plus 15 s more is still within reach');
  assert.equal(sleptSample({ windowMs: 100_000, loopMax: 50_000, loopP50: 2 }), true, '20 s late beyond the block: asleep');
});

test('checkSlow skips slept samples, and a slept newest sample changes nothing', () => {
  const list = [S({ loopP99: 300 }), S({ loopP99: 300 }), S({ loopP99: 300 }), S({ loopP99: 88_000, slept: true })];
  assert.equal(checkSlow(list).log, '', 'the sleep is not the fourth slow sample');
  list.push(S({ loopP99: 300 }));
  assert.match(checkSlow(list).log, /slow \(app lag\)/, 'four awake samples over');
  const was = new Set(['app']);
  const r = checkSlow([...list, S({ loopP99: 5, slept: true })], was);
  assert.equal(r.log, '');
  assert.deepEqual([...r.slow], ['app']);
  assert.equal(checkSlow([S(), S(), S(), S({ loopP99: 88_000, slept: true }), S()]).log, '', 'one slept sample among calm ones logs nothing');
});

test('perfView keeps slept samples for the gap but leaves them out of the averages', () => {
  const now = 10_000_000;
  const list = [S({ at: now - 60_000, loopP99: 100 }), S({ at: now - 30_000, loopP99: 88_000, slept: true }), S({ at: now, loopP99: 200 })];
  const v = perfView(list, { now });
  assert.equal(v.samples.length, 3);
  assert.equal(v.slept, 1);
  assert.equal(v.battery.loopP99, 150);
  assert.equal(v.battery.samples, 2);
});
