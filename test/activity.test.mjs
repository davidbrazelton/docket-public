// Session activity (#805): the row-dot states counted, 5-minute slots from minute samples, turns read back from a
// transcript into rebuilt slots, the run-once guard, the roll-up to hours, and the sums the footer and Usage page show.
process.env.TZ = 'America/Chicago'; // a zone with a clock change, for the rebuild across it
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { stateOf, countStates, createTally, slotKey, turnSpans, createRebuild, mergeRebuilt, runOnce, toHours, rollUp, sumDesks, tiles, heat, today } from '../activity.mjs';

const at = (h, m, s = 0, day = 9) => new Date(2026, 10, day, h, m, s).getTime();
const iso = (ms) => new Date(ms).toISOString();

test('each live session counts in the state its row dot shows', () => {
  assert.equal(stateOf({ status: 'running' }), 'w');
  assert.equal(stateOf({ status: 'idle', compacting: true }), 'w');
  assert.equal(stateOf({ status: 'requires_action' }), 'n');
  assert.equal(stateOf({ status: 'idle', unread: true }), 'n');
  assert.equal(stateOf({ status: 'idle', lastError: 'x' }), 'n');
  assert.equal(stateOf({ status: 'idle', unread: true, jobs: 1 }), 'c', 'a background job keeps the ring, not orange');
  assert.equal(stateOf({ status: 'idle', held: true }), 'c');
  assert.equal(stateOf({ status: 'idle', kidsWorking: 2 }), 'c');
  assert.equal(stateOf({ status: 'idle' }), 'i');
  assert.equal(stateOf({ status: 'ended' }), null);
  assert.deepEqual(countStates(['w', 'w', 'n', 'i', null]), { w: 2, c: 0, n: 1, i: 1 });
});

test('minute samples make one line per desk and slot, with each state\'s peak and average', () => {
  const t = createTally();
  assert.deepEqual(t.sample(at(10, 35), { a: { w: 3, i: 2 }, b: { i: 1 } }), []);
  t.sample(at(10, 36), { a: { w: 1, n: 1, i: 2 } });
  t.sample(at(10, 37), { a: { w: 0, i: 4 } });
  t.sample(at(10, 38), { a: { w: 2, i: 2 } });
  t.sample(at(10, 39), { a: { w: 2, i: 2 } });
  assert.deepEqual(t.open().map((l) => l.d), ['a', 'b']);
  const done = t.sample(at(10, 40), {});
  assert.deepEqual(done, [
    { t: '2026-11-09T10:35', d: 'a', w: [3, 1.6], c: [0, 0], n: [1, 0.2], i: [4, 2.4], b: 4 },
    { t: '2026-11-09T10:35', d: 'b', w: [0, 0], c: [0, 0], n: [0, 0], i: [1, 0.2], b: 0 },
  ]);
  assert.equal(slotKey(at(10, 44, 59)), '2026-11-09T10:40');
  assert.deepEqual(t.sample(at(10, 45), {}), [], 'a slot with nothing live writes nothing');
});

const line = (o) => JSON.stringify(o);
test('a transcript\'s turns run from each prompt to the last assistant line before the next', () => {
  const text = [
    line({ type: 'user', timestamp: iso(at(9, 0)), message: { content: 'go' } }),
    line({ type: 'assistant', timestamp: iso(at(9, 2)), message: { content: [{ type: 'tool_use' }] } }),
    line({ type: 'user', timestamp: iso(at(9, 6)), message: { content: [{ type: 'tool_result', tool_use_id: 'x' }] } }),
    line({ type: 'assistant', timestamp: iso(at(9, 7)), isSidechain: true }),
    line({ type: 'assistant', timestamp: iso(at(9, 12)), message: { content: [{ type: 'text', text: 'done' }] } }),
    line({ type: 'user', timestamp: iso(at(11, 0)), message: { content: 'again' } }),
    line({ type: 'assistant', timestamp: iso(at(11, 1)) }),
    line({ type: 'user', timestamp: iso(at(11, 3)), isCompactSummary: true, message: { content: 'summary' } }),
    line({ type: 'assistant', timestamp: iso(at(11, 4)) }),
    line({ type: 'user', timestamp: iso(at(12, 0)), message: { content: 'no reply yet' } }),
    'not json',
  ].join('\n');
  assert.deepEqual(turnSpans(text), [[at(9, 0), at(9, 12)], [at(11, 0), at(11, 4)]]);
});

test('turns become rebuilt working slots, cut where live tracking took over', () => {
  const r = createRebuild();
  r.add('a', [[at(9, 0), at(9, 12)]]);
  r.add('a', [[at(9, 3), at(9, 4)], [at(9, 5), at(9, 6)]]);
  r.add('b', [[at(9, 0), at(9, 30)]], at(9, 5));
  assert.deepEqual(r.lines(), [
    { t: '2026-11-09T09:00', d: 'a', w: [2, 1.2], b: 5, r: 1 },
    { t: '2026-11-09T09:00', d: 'b', w: [1, 1], b: 5, r: 1 },
    { t: '2026-11-09T09:05', d: 'a', w: [2, 1.2], b: 5, r: 1 },
    { t: '2026-11-09T09:10', d: 'a', w: [1, 0.4], b: 2, r: 1 },
  ]);
});

test('a turn across the hour clocks go back still ends, and its time is all counted', () => {
  const from = Date.parse('2026-11-01T05:50:00Z'), to = Date.parse('2026-11-01T08:10:00Z'); // 00:50 CDT to 02:10 CST
  const r = createRebuild();
  r.add('a', [[from, to]]);
  const lines = r.lines();
  assert.equal(lines.reduce((n, l) => n + l.b, 0), 140);
  assert.equal(lines.find((l) => l.t === '2026-11-01T01:30').b, 10, 'the two 01:30 slots fall under one name');
});

test('rebuilt slots never replace one live tracking kept', () => {
  const live = { t: '2026-11-09T09:05', d: 'a', w: [5, 4], c: [0, 0], n: [0, 0], i: [1, 1], b: 5 };
  const hour = { t: '2026-08-01T09:00', d: 'a', w: [1, 0.1], b: 1, h: 1 };
  const out = mergeRebuilt([live, hour], [
    { t: '2026-11-09T09:00', d: 'a', w: [2, 1], b: 5, r: 1 }, { t: '2026-11-09T09:05', d: 'a', w: [2, 1], b: 5, r: 1 },
    { t: '2026-08-01T09:35', d: 'a', w: [2, 1], b: 5, r: 1 },
  ]);
  assert.deepEqual(out.map((l) => [l.t, l.w[0], !!l.r]), [['2026-08-01T09:00', 1, false], ['2026-11-09T09:00', 2, true], ['2026-11-09T09:05', 5, false]]);
});

test('the rebuild runs once: after it finished it is recorded and never runs again', async () => {
  let saved = null, runs = 0;
  const io = { read: () => saved, write: (m) => { saved = m; }, now: () => at(12, 0) };
  const first = await runOnce({ ...io, run: async () => { runs++; return { slots: 12 }; } });
  assert.equal(first.skipped, false);
  assert.deepEqual(saved, { rebuilt: iso(at(12, 0)), slots: 12 });
  const again = await runOnce({ ...io, run: async () => { runs++; return {}; } });
  assert.equal(again.skipped, true);
  assert.equal(runs, 1);
  // cut short: nothing recorded, so the next start tries again
  saved = null;
  await assert.rejects(runOnce({ ...io, run: async () => { throw new Error('stopped'); } }));
  assert.equal(saved, null);
});

test('old slots roll up to hours; newer ones stay', () => {
  const slot = (t, w, r) => ({ t, d: 'a', w, c: [0, 0], n: [1, 0.5], i: [0, 0], b: 5, ...(r ? { r: 1 } : {}) });
  const lines = [slot('2026-07-01T09:00', [3, 2.4]), slot('2026-07-01T09:05', [1, 1.2], true), slot('2026-11-09T09:00', [1, 1])];
  const out = rollUp(lines, '2026-08-11');
  assert.equal(out.length, 2);
  assert.deepEqual(out[0], { t: '2026-07-01T09:00', d: 'a', w: [3, 0.3], n: [1, 0.1], b: 10, h: 1 });
  assert.deepEqual(out[1], lines[2]);
  assert.equal(rollUp(out, '2026-08-11'), out, 'already rolled up: left as it is');
  assert.deepEqual(toHours([{ t: '2026-07-01T10:00', d: 'a', w: [2, 1.2], b: 5, r: 1 }]), [{ t: '2026-07-01T10:00', d: 'a', w: [2, 0.1], b: 5, h: 1, r: 1 }]);
});

test('tiles, heatmap and the footer\'s day read the same slots', () => {
  const lines = sumDesks([
    { t: '2026-11-09T10:35', d: 'a', w: [4, 3], c: [0, 0], n: [2, 1], i: [1, 1], b: 5 },
    { t: '2026-11-09T10:35', d: 'b', w: [3, 2], c: [0, 0], n: [0, 0], i: [0, 0], b: 3 },
    { t: '2026-11-09T07:00', d: 'a', w: [1, 0.5], b: 2.5, r: 1 },
  ]);
  assert.deepEqual(lines.map((l) => [l.t, l.w, l.b]), [['2026-11-09T07:00', [1, 0.5], 2.5], ['2026-11-09T10:35', [7, 5], 5]]);
  const t = tiles(lines);
  assert.deepEqual(t, { peak: 7, peakAt: '2026-11-09T10:35', dayAvg: 0, busyMin: 8, waitAvg: 1, waitPeak: 2, waitPeakAt: '2026-11-09T10:35', rebuilt: true });
  const h = heat(lines, '2026-11-09'); // a Monday
  assert.equal(h[0][10], Math.round((5 / 48) * 100) / 100);
  assert.equal(h[1][10], 0);
  const d = today(lines, '2026-11-09');
  assert.equal(d.peak, 7); assert.equal(d.slots.length, 2); assert.equal(d.slots[0].r, 1);
});
