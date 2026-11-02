// ☰ > Memory and disk: grouping the running programs, and folder sizes.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { groupProcesses, folderSize, cpuPercent, diskKeeper } from '../machine-use.mjs';

const P = (pid, ppid, name, mem) => ({ pid, ppid, name, mem });

test('groupProcesses: the app, the runner, the session programs under the runner and their helpers below', () => {
  const list = [
    P(1, 0, 'explorer', 999), P(10, 1, 'node', 700), P(20, 1, 'node', 100),
    P(21, 20, 'claude', 200), P(22, 21, 'node', 50), P(23, 22, 'conhost', 1), P(24, 22, 'chrome', 30), P(25, 24, 'chrome', 20),
    P(26, 20, 'claude', 300), P(27, 20, 'grok', 40), P(28, 27, 'node', 5),
    P(11, 10, 'chrome', 60), // the sign-in browser the app opened
    P(30, 1, 'claude', 5000), // a Claude started outside Docket
  ];
  const { rows, total, cpu } = groupProcesses(list.map((p) => ({ ...p, cpu: 1 })), { appPid: 10, runnerPid: 20 });
  assert.deepEqual(rows, [
    { label: 'Docket app', count: 1, mem: 700 },
    { label: 'Session runner', count: 1, mem: 100 },
    { key: 'claude', label: 'Claude programs', count: 2, mem: 500 },
    { key: 'grok', label: 'Grok programs', count: 1, mem: 40 },
    { key: 'node', label: 'Helper node programs', count: 2, mem: 55 },
    { key: 'browser', label: 'Private browser', count: 3, mem: 110 },
    { key: 'other', label: 'Other helpers', count: 1, mem: 1 },
  ]);
  assert.equal(total, 700 + 100 + 500 + 40 + 55 + 110 + 1);
  assert.equal(cpu, 11); // the processor time of the 11 Docket programs, not explorer or the outside Claude
});

test('cpuPercent: the share of all cores between two readings; none until there are two', () => {
  assert.equal(cpuPercent(null, { cpu: 5, at: 1000 }, 4), null);
  assert.equal(cpuPercent({ cpu: 10, at: 0 }, { cpu: 12, at: 10_000 }, 4), 5); // 2 s of processor in 10 s on 4 cores
  assert.equal(cpuPercent({ cpu: 10, at: 0 }, { cpu: 8, at: 10_000 }, 4), 0); // a program ended in between
  assert.equal(cpuPercent({ cpu: 0, at: 0 }, { cpu: 100, at: 1000 }, 2), 100);
  assert.equal(cpuPercent({ cpu: 0, at: 5 }, { cpu: 1, at: 5 }, 2), null);
});

test('diskKeeper: a count is saved to the file and there at once for the next keeper (after a restart)', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dk-')), file = path.join(dir, 'data', 'disk-use.json');
  const a = diskKeeper({ file, count: async () => ({ docket: { bytes: 42 }, at: 123 }) });
  assert.equal(a.get(), null);
  assert.deepEqual(await a.refresh(), { docket: { bytes: 42 }, at: 123 });
  assert.equal(a.counting(), false);
  const b = diskKeeper({ file, count: async () => { throw new Error('not called'); } });
  assert.deepEqual(b.get(), { docket: { bytes: 42 }, at: 123 });
  assert.equal(fs.existsSync(file + '.tmp'), false);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('diskKeeper: one count at a time; a second refresh while one runs gets that same one', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dk-')), file = path.join(dir, 'disk-use.json');
  let calls = 0, finish;
  const k = diskKeeper({ file, count: () => { calls++; return new Promise((r) => { finish = r; }); } });
  const one = k.refresh(), two = k.refresh();
  assert.equal(one, two);
  assert.equal(k.counting(), true);
  finish({ at: 1 });
  assert.deepEqual(await two, { at: 1 });
  assert.equal(calls, 1);
  assert.equal(k.counting(), false);
  k.refresh(); finish({ at: 2 }); // once it is done, the next refresh counts again
  assert.deepEqual(await k.refresh(), { at: 2 });
  assert.equal(calls, 2);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('diskKeeper: a count that fails keeps the last one, and the next refresh tries again', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dk-')), file = path.join(dir, 'disk-use.json');
  fs.writeFileSync(file, JSON.stringify({ at: 7 }));
  const errs = [];
  let fail = true;
  const k = diskKeeper({ file, count: async () => { if (fail) throw new Error('busy'); return { at: 8 }; }, log: (e) => errs.push(e.message) });
  assert.deepEqual(await k.refresh(), { at: 7 });
  assert.deepEqual(errs, ['busy']);
  assert.deepEqual(JSON.parse(fs.readFileSync(file, 'utf8')), { at: 7 });
  fail = false;
  assert.deepEqual(await k.refresh(), { at: 8 });
  fs.rmSync(dir, { recursive: true, force: true });
});

test('groupProcesses: no runner found, and a Mac browser helper name', () => {
  const { rows } = groupProcesses([P(10, 1, 'node', 7), P(11, 10, 'google chrome for testing helper (renderer)', 3)], { appPid: 10, runnerPid: undefined });
  assert.deepEqual(rows, [
    { label: 'Docket app', count: 1, mem: 7 },
    { label: 'Session runner', count: 0, mem: 0 },
    { key: 'browser', label: 'Private browser', count: 1, mem: 3 },
  ]);
});

test('folderSize: bytes and files at every depth; a missing folder is null; a filter picks top-level names', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'docket-size-'));
  try {
    fs.writeFileSync(path.join(dir, 'a.log'), 'x'.repeat(10));
    fs.writeFileSync(path.join(dir, 'b.txt'), 'x'.repeat(5));
    fs.mkdirSync(path.join(dir, 'sub', 'deep'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'sub', 'deep', 'c'), 'x'.repeat(100));
    assert.deepEqual(await folderSize(dir), { bytes: 115, files: 3 });
    assert.deepEqual(await folderSize(dir, { filter: (n) => n.endsWith('.log') }), { bytes: 10, files: 1 });
    assert.equal(await folderSize(path.join(dir, 'nope')), null);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
