// Tests for a runner that stops for good (#740): one whose folder was removed, and a test runner whose app is gone.
// Leftover test runners used to keep running from removed worktrees and open a console window each. Run with: npm test
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { stopForGood, APP_GONE_MS, REAL_RUNNER_PORT } from '../runner-idle.mjs';
import { freePorts } from './free-port.mjs';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const now = 100 * APP_GONE_MS;
const quiet = { open: 0, filesGone: false, lastContact: now - 1000, now };

test('a runner with its files gone stops, unless a session is open', () => {
  assert.equal(stopForGood({ ...quiet, port: REAL_RUNNER_PORT }), '', 'the real runner keeps running');
  assert.match(stopForGood({ ...quiet, port: REAL_RUNNER_PORT, filesGone: true }), /files are gone/);
  assert.match(stopForGood({ ...quiet, port: 4411, filesGone: true }), /files are gone/);
  assert.equal(stopForGood({ ...quiet, port: 4411, filesGone: true, open: 1 }), '', 'an open session keeps it');
});

test('a test runner stops once its app has been gone a while; the real runner never does', () => {
  const gone = { ...quiet, lastContact: now - APP_GONE_MS };
  assert.equal(stopForGood({ ...quiet, port: 4411 }), '', 'its app was in touch a moment ago');
  assert.match(stopForGood({ ...gone, port: 4411 }), /no word from its app/);
  assert.equal(stopForGood({ ...gone, port: 4411, open: 2 }), '', 'an open session keeps it');
  assert.equal(stopForGood({ ...gone, port: REAL_RUNNER_PORT }), '', 'the real runner waits for its app however long');
  assert.equal(stopForGood({ ...gone, port: REAL_RUNNER_PORT, lastContact: 0 }), '');
});

// The real thing: a copy of the runner in a folder of its own, on a free port.
const tmps = [];
after(() => {
  for (const t of tmps) {
    try { fs.unlinkSync(path.join(t, 'r', 'node_modules')); } catch {} // the link first, so nothing reaches the real node_modules
    fs.rmSync(t, { recursive: true, force: true, maxRetries: 5 });
  }
});
async function startCopy(env = {}) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'docket-runner-stop-'));
  tmps.push(tmp);
  const dir = path.join(tmp, 'r');
  fs.mkdirSync(path.join(dir, 'engines'), { recursive: true });
  for (const f of ['runner.mjs', 'runner-idle.mjs', 'engines/claude.mjs', 'engines/acp.mjs', 'engines/codex.mjs']) fs.copyFileSync(path.join(ROOT, f), path.join(dir, f));
  fs.symlinkSync(path.join(ROOT, 'node_modules'), path.join(dir, 'node_modules'), 'junction');
  const [port] = await freePorts(1);
  const proc = spawn(process.execPath, [path.join(dir, 'runner.mjs')], {
    stdio: 'ignore', windowsHide: true, env: { ...process.env, DOCKET_RUNNER_PORT: String(port), PORTAL_DATA: path.join(tmp, 'data'), ...env },
  });
  const exited = new Promise((resolve) => proc.on('exit', (code) => resolve(code)));
  const health = () => fetch(`http://127.0.0.1:${port}/health`, { signal: AbortSignal.timeout(1000) }).then((r) => r.ok, () => false);
  for (let i = 0; i < 80 && !(await health()); i++) await new Promise((r) => setTimeout(r, 250));
  assert.ok(await health(), 'the runner started');
  return { dir, tmp, proc, exited, health };
}
const within = (p, ms, what) => Promise.race([p, new Promise((_, reject) => setTimeout(() => reject(new Error(what)), ms))]);

test('a runner whose folder is removed stops by itself', { timeout: 60000 }, async () => {
  const r = await startCopy();
  try {
    fs.rmSync(path.join(r.dir, 'runner.mjs'));
    fs.rmSync(path.join(r.dir, 'engines'), { recursive: true });
    assert.equal(await within(r.exited, 30000, 'the runner did not stop'), 0);
    assert.match(fs.readFileSync(path.join(r.tmp, 'data', 'runner-events.log'), 'utf8'), /stopping for good: its files are gone/);
  } finally { r.proc.kill(); }
});

test('a test runner stops once its app stops checking on it', { timeout: 60000 }, async () => {
  const r = await startCopy({ DOCKET_RUNNER_APP_GONE_MS: '4000' });
  try {
    // While the app checks on it (as the app does every few seconds), it keeps running past the wait.
    for (let i = 0; i < 12; i++) { await r.health(); assert.equal(r.proc.exitCode, null, 'still running while its app is in touch'); await new Promise((res) => setTimeout(res, 1000)); }
    assert.equal(await within(r.exited, 20000, 'the runner did not stop'), 0);
    assert.match(fs.readFileSync(path.join(r.tmp, 'data', 'runner-events.log'), 'utf8'), /stopping for good: test runner with no word from its app/);
  } finally { r.proc.kill(); }
});
