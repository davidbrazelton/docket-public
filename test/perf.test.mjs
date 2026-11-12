// ☰ > Gauges > Performance (#935): keeping the samples, the pages' reports, and when a slow stretch is logged.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { loadSamples, keepSample, pageTally, checkSlow, summaryText, perfView, fileFor, KEEP, HOLD } from '../perf.mjs';

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
