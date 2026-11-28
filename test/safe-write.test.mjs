// Tests for safe-write.mjs: a file held for a moment never stops the app (#1279). Run with: npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { writeAtomic, createSaver, busyError, RETRY_WAITS } from '../safe-write.mjs';

const tmpDir = () => fs.mkdtempSync(path.join(os.tmpdir(), 'safe-write-'));
const busy = (code = 'UNKNOWN') => Object.assign(new Error(`${code}: unknown error, open 'portal-state.json'`), { code });
// The real fs, with the next `n` calls of one method failing with `code`.
function failing(method, n, code) {
  const calls = { [method]: 0 };
  return { calls, fsx: { ...fs, [method]: (...a) => { calls[method]++; if (n-- > 0) throw busy(code); return fs[method](...a); } } };
}
// Timers kept in a list, run by hand.
function fakeTimers() {
  const pending = new Map(); let next = 1;
  return {
    setTimeout: (fn, ms) => { const id = next++; pending.set(id, { fn, ms }); return id; },
    clearTimeout: (id) => pending.delete(id),
    waits: () => [...pending.values()].map((t) => t.ms),
    runAll() { const all = [...pending.entries()]; pending.clear(); for (const [, t] of all) t.fn(); },
  };
}

test('the codes of a busy file are told apart from others', () => {
  for (const c of ['EPERM', 'EBUSY', 'EACCES', 'UNKNOWN']) assert.ok(busyError(busy(c)), c);
  assert.ok(!busyError(busy('ENOENT')));
  assert.ok(!busyError(new Error('plain')));
});

test('writeAtomic swaps a spare file in and leaves none behind', () => {
  const dir = tmpDir(), f = path.join(dir, 'a.json');
  fs.writeFileSync(f, 'old');
  writeAtomic(f, 'new');
  assert.equal(fs.readFileSync(f, 'utf8'), 'new');
  assert.deepEqual(fs.readdirSync(dir), ['a.json']);
});

test('a rename refused for a moment is tried again', () => {
  const dir = tmpDir(), f = path.join(dir, 'a.json'), slept = [];
  const { fsx, calls } = failing('renameSync', 2, 'EPERM');
  writeAtomic(f, 'x', { fsx, sleep: (ms) => slept.push(ms) });
  assert.equal(fs.readFileSync(f, 'utf8'), 'x');
  assert.equal(calls.renameSync, 3);
  assert.equal(slept.length, 2);
});

test('a rename that keeps failing throws and removes the spare file; the old file stays whole', () => {
  const dir = tmpDir(), f = path.join(dir, 'a.json');
  fs.writeFileSync(f, 'old');
  const { fsx } = failing('renameSync', 99, 'EBUSY');
  assert.throws(() => writeAtomic(f, 'new', { fsx, sleep: () => {} }), /EBUSY/);
  assert.equal(fs.readFileSync(f, 'utf8'), 'old');
  assert.deepEqual(fs.readdirSync(dir), ['a.json']);
});

test('another error is not tried again', () => {
  const dir = tmpDir(), f = path.join(dir, 'a.json');
  const { fsx, calls } = failing('renameSync', 1, 'ENOENT');
  assert.throws(() => writeAtomic(f, 'x', { fsx, sleep: () => {} }), /ENOENT/);
  assert.equal(calls.renameSync, 1);
});

test('a save that fails once does not throw, is logged once and is retried', () => {
  const dir = tmpDir(), f = path.join(dir, 'state.json'), logs = [], timers = fakeTimers();
  let data = { a: 1 };
  const { fsx } = failing('writeFileSync', 1, 'UNKNOWN');
  const saver = createSaver({ file: f, text: () => JSON.stringify(data), log: (what) => logs.push(what), fsx, timers, sleep: () => {} });
  saver.save();
  assert.deepEqual(timers.waits(), [200]);
  assert.doesNotThrow(() => timers.runAll());
  assert.ok(saver.failing());
  assert.equal(logs.length, 1);
  assert.match(logs[0], /could not save state\.json/);
  assert.deepEqual(timers.waits(), [RETRY_WAITS[0]]);
  data = { a: 2 }; // a change while failing is kept in memory and goes with the next try
  saver.save();
  assert.deepEqual(timers.waits(), [RETRY_WAITS[0]], 'a change does not bring the next try forward');
  timers.runAll();
  assert.equal(fs.readFileSync(f, 'utf8'), '{"a":2}');
  assert.ok(!saver.failing());
  assert.equal(logs.length, 2);
  assert.match(logs[1], /saved state\.json again/);
});

test('the wait between tries grows and stops growing at the longest', () => {
  const dir = tmpDir(), f = path.join(dir, 's.json'), logs = [], timers = fakeTimers();
  const { fsx } = failing('writeFileSync', 99, 'EBUSY');
  const saver = createSaver({ file: f, text: () => '{}', log: (w) => logs.push(w), fsx, timers, sleep: () => {} });
  const seen = [];
  saver.now();
  for (let i = 0; i < RETRY_WAITS.length + 2; i++) { seen.push(...timers.waits()); timers.runAll(); }
  assert.deepEqual(seen, [...RETRY_WAITS, RETRY_WAITS.at(-1), RETRY_WAITS.at(-1)]);
  assert.equal(logs.length, 1, 'logged once, not on every try');
});

test('now and flush write at once; flush does nothing with no save waiting and never throws', () => {
  const dir = tmpDir(), f = path.join(dir, 's.json'), timers = fakeTimers();
  const saver = createSaver({ file: f, text: () => 'x', timers });
  saver.flush();
  assert.ok(!fs.existsSync(f));
  saver.save();
  saver.flush();
  assert.equal(fs.readFileSync(f, 'utf8'), 'x');
  assert.ok(!saver.pending());
  assert.equal(saver.now(), true);
  const bad = createSaver({ file: f, text: () => { throw new Error('cannot'); }, timers });
  bad.save();
  assert.doesNotThrow(() => bad.flush());
});
