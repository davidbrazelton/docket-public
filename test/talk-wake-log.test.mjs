// Tests for hands-free Talk's comparison log and model files (#1228): what a row keeps, the numbers for methods A and
// B, their words in the settings, and the model folder. Run with: npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { wakeRow, listenRow, cleanWakeRow, wakeStats, statWords, wakeWords, TEXT_MAX } from '../talk-wake-log.mjs';
import { modelList, modelFile, labelOf, validName, KNOWN } from '../wake-models.mjs';

const T = Date.parse('2026-11-24T10:42:00Z');
test('a wake row keeps the methods, the words (cut), the scores and what came of it, and never audio', () => {
  const r = wakeRow({ at: T, mode: 'live', ran: ['a', 'b', 'x'], first: 'a', a: { hit: true, score: 0.9234, words: 'Docket, tell it yes. ' + 'x'.repeat(200), ms: 412.6, device: 'webgpu', audio: [1, 2] }, b: { hit: false, score: 0.31 }, outcome: 'sent', target: 'Relay fix' });
  assert.deepEqual(Object.keys(r), ['kind', 'at', 'mode', 'ran', 'first', 'a', 'b', 'outcome', 'target']);
  assert.deepEqual(r.ran, ['a', 'b']);
  assert.equal(r.a.score, 0.923); assert.equal(r.a.ms, 413); assert.equal(r.a.words.length, TEXT_MAX);
  assert.equal(r.a.audio, undefined);
  assert.equal(cleanWakeRow({ ...r, outcome: 'maybe' }), null, 'an unknown outcome');
  assert.equal(cleanWakeRow({ kind: 'other', at: r.at }), null);
  assert.equal(cleanWakeRow({ ...r, at: 'yesterday' }), null);
  const l = listenRow({ at: T, minutes: 30.456, ran: ['a'], vadMs: 1200.4, bMs: 0, aMs: 9000, aRuns: 12, aDevice: 'webgpu' });
  assert.deepEqual(l, { kind: 'listen', at: new Date(T).toISOString(), minutes: 30.46, ran: ['a'], vadMs: 1200, bMs: 0, aMs: 9000, aRuns: 12, aDevice: 'webgpu' });
});

test('the numbers: right and wrong wakes, wrong ones an hour, misses, and the work an hour', () => {
  const rows = [
    listenRow({ at: T, minutes: 60, ran: ['a', 'b'], vadMs: 3000, bMs: 6000, aMs: 12000, aRuns: 30, aDevice: 'webgpu' }),
    listenRow({ at: T, minutes: 60, ran: ['a'], vadMs: 3000, bMs: 0, aMs: 4000, aRuns: 10, aDevice: 'wasm' }),
    wakeRow({ at: T, mode: 'compare', ran: ['a', 'b'], first: 'a', a: { hit: true, score: 0.9 }, b: { hit: true, score: 0.8 }, outcome: 'confirmed' }),
    wakeRow({ at: T, mode: 'compare', ran: ['a', 'b'], first: 'a', a: { hit: true, score: 0.85 }, b: { hit: false, score: 0.1 }, outcome: 'confirmed' }), // B missed it
    wakeRow({ at: T, mode: 'compare', ran: ['a', 'b'], first: 'b', a: { hit: false, score: 0.4 }, b: { hit: true, score: 0.6 }, outcome: 'none' }), // B woke on the television
    wakeRow({ at: T, mode: 'live', ran: ['a'], first: 'a', a: { hit: true, score: 0.8 }, b: null, outcome: 'cancelled' }),
  ];
  const s = wakeStats(rows);
  assert.deepEqual(s.a, { hours: 2, wakes: 3, good: 2, bad: 1, missed: 0, badPerHour: 0.5, cpuMsPerHour: Math.round((3000 + 3000 + 4000) / 2), gpuMsPerHour: 6000 });
  assert.deepEqual(s.b, { hours: 1, wakes: 2, good: 1, bad: 1, missed: 1, badPerHour: 1, cpuMsPerHour: 6000, gpuMsPerHour: 0 });
  assert.equal(statWords('a', s.a), 'A · 2 h listening · 3 wakes: 2 right, 1 wrong (0.5 an hour) · 0 missed · 5.0 s of processor an hour · 6.0 s of graphics card an hour');
  assert.equal(statWords('b', wakeStats([]).b), 'B: nothing logged yet.');
  assert.match(wakeWords(rows[3]), /compare · A \(0\.85\) · you said yes$/);
  assert.match(wakeWords(wakeRow({ at: T, mode: 'live', ran: ['a'], first: 'a', a: { hit: true, score: 0.9, words: 'Docket, yes' }, outcome: 'sent', target: 'Relay fix' })), /A \(0\.9\) · "Docket, yes" · sent to Relay fix$/);
});

test('the model folder: the pre-trained ones, then your own by file name; known files fetched once, unknown ones refused', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'docket-wake-'));
  try {
    fs.writeFileSync(path.join(dir, 'hey_desk_v0.2.onnx'), 'x'); fs.writeFileSync(path.join(dir, 'melspectrogram.onnx'), 'x'); fs.writeFileSync(path.join(dir, 'notes.txt'), 'x');
    const list = modelList(dir);
    assert.equal(list[0].id, 'hey_jarvis_v0.1');
    assert.deepEqual(list.at(-1), { id: 'hey_desk_v0.2', label: 'Hey desk', custom: true });
    assert.equal(list.filter((m) => m.custom).length, 1, 'support files are not wake models');
    assert.equal(labelOf('docket'), 'Docket');
    assert.ok(validName('hey_desk_v0.2')); assert.ok(!validName('../secret')); assert.ok(!validName('a/b'));
    assert.equal(await modelFile(dir, '../secret'), null);
    assert.equal(await modelFile(dir, 'not_known'), null);
    assert.equal(await modelFile(dir, 'hey_desk_v0.2'), path.join(dir, 'hey_desk_v0.2.onnx'), 'yours, from the folder');
    let calls = 0;
    const fetchFn = async (url) => { calls++; assert.equal(url, KNOWN.silero_vad); return { ok: true, arrayBuffer: async () => new Uint8Array(5000).buffer }; };
    const [a, b] = await Promise.all([modelFile(dir, 'silero_vad', { fetchFn }), modelFile(dir, 'silero_vad', { fetchFn })]);
    assert.equal(a, b); assert.equal(calls, 1, 'one fetch for both');
    assert.equal(fs.statSync(a).size, 5000);
    await modelFile(dir, 'silero_vad', { fetchFn }); assert.equal(calls, 1, 'kept');
    await assert.rejects(modelFile(dir, 'alexa_v0.1', { fetchFn: async () => ({ ok: false, status: 404 }) }), /404/);
    assert.match(KNOWN.silero_vad, /\/resolve\/[0-9a-f]{40}\//, 'pinned to one revision');
    assert.match(KNOWN['hey_jarvis_v0.1'], /releases\/download\/v0\.5\.1\//);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
