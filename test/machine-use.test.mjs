// ☰ > Memory and disk: grouping the running programs, and folder sizes.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { groupProcesses, folderSize } from '../machine-use.mjs';

const P = (pid, ppid, name, mem) => ({ pid, ppid, name, mem });

test('groupProcesses: the app, the runner, the session programs under the runner and their helpers below', () => {
  const list = [
    P(1, 0, 'explorer', 999), P(10, 1, 'node', 700), P(20, 1, 'node', 100),
    P(21, 20, 'claude', 200), P(22, 21, 'node', 50), P(23, 22, 'conhost', 1), P(24, 22, 'chrome', 30), P(25, 24, 'chrome', 20),
    P(26, 20, 'claude', 300), P(27, 20, 'grok', 40), P(28, 27, 'node', 5),
    P(11, 10, 'chrome', 60), // the sign-in browser the app opened
    P(30, 1, 'claude', 5000), // a Claude started outside Docket
  ];
  const { rows, total } = groupProcesses(list, { appPid: 10, runnerPid: 20 });
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
