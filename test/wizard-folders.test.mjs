// The setup wizard's computer check on a made-up user folder: a throwaway Docket whose user folder (USERPROFILE,
// HOME) is a temp folder holding made-up Claude Code history and a signed-in Codex setup (fixtures/fake-codex.mjs reads
// auth.json). The check suggests the working folder the history points to, and offers the Codex setup for reuse.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { freePorts } from './free-port.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.dirname(HERE);
const [PORT, RUNNER_PORT] = await freePorts(2);
const URL_ = `http://127.0.0.1:${PORT}`;
const tmp = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'docket-303s-')));
const user = path.join(tmp, 'user'), work = path.join(tmp, 'Projects');
let server;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const api = async (p, body) => {
  const r = await fetch(URL_ + p, { method: body ? 'POST' : 'GET', headers: { 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, ...(await r.json()) };
};
const runnerPid = () => fetch(`http://127.0.0.1:${RUNNER_PORT}/health`).then((r) => r.json()).then((h) => h.pid).catch(() => null);

before(async () => {
  const projects = {};
  for (const n of ['a', 'b', 'c']) { const d = path.join(work, n); fs.mkdirSync(d, { recursive: true }); projects[d] = {}; }
  // The server's PowerShell finds its local AppData through USERPROFILE; without that folder it gets an empty path
  // and writes its ModuleAnalysisCache under its working folder, the repo.
  fs.mkdirSync(path.join(user, 'AppData', 'Local'), { recursive: true });
  fs.mkdirSync(path.join(user, '.codex'), { recursive: true });
  fs.writeFileSync(path.join(user, '.codex', 'auth.json'), '{}');
  fs.writeFileSync(path.join(user, '.claude.json'), JSON.stringify({ projects }));
  fs.writeFileSync(path.join(tmp, 'clients.json'), '[]');
  fs.writeFileSync(path.join(tmp, 'state.json'), JSON.stringify({ sessions: {}, updates: { minutes: 0 } }));
  server = spawn(process.execPath, [path.join(ROOT, 'server.mjs')], {
    cwd: ROOT, stdio: 'ignore', windowsHide: true,
    env: { ...process.env, USERPROFILE: user, HOME: user, APPDATA: path.join(user, 'AppData', 'Roaming'), CODEX_HOME: '', GROK_HOME: '',
      PORTAL_PORT: String(PORT), DOCKET_RUNNER_PORT: String(RUNNER_PORT), PORTAL_CLIENTS: path.join(tmp, 'clients.json'),
      PORTAL_STATE: path.join(tmp, 'state.json'), PORTAL_SCHEDULES: path.join(tmp, 'schedules.json'), PORTAL_DATA: path.join(tmp, 'data'),
      PORTAL_CLAUDE_EXE: path.join(tmp, 'no-such-claude.exe'),
      PORTAL_CODEX_EXE: path.join(HERE, 'fixtures', 'fake-codex.mjs'), PORTAL_GROK_EXE: path.join(tmp, 'no-such-grok.exe') },
  });
  for (const until = Date.now() + 30000; ; await sleep(150)) {
    if (await fetch(URL_ + '/api/clients?quick=1').then((r) => r.ok).catch(() => false)) break;
    if (Date.now() > until) throw new Error('the test Docket did not start');
  }
});

after(async () => {
  const pid = await runnerPid();
  server?.kill();
  if (pid) try { process.kill(pid); } catch {}
  await sleep(300);
  fs.rmSync(tmp, { recursive: true, force: true, maxRetries: 5 });
});

test('the computer check suggests the working folder from the history, and offers the signed-in Codex setup', async () => {
  const c = await api('/api/setup/check');
  assert.equal(c.folders.suggested, work);
  assert.equal(c.roots.fresh, true, 'no company yet: new homes go next to the working folder');
  assert.deepEqual(c.existing, { codex: { home: path.join(user, '.codex'), email: '' } }, 'Codex is signed in; Claude and Grok are not installed');
});

test('once a company uses that Codex setup, it is not offered again', async () => {
  const r = await api('/api/clients/save-one', { name: 'Acme', home: path.join(work, 'Claude', 'Acme', 'claude-home'), folder: work, email: '',
    codexHome: path.join(user, '.codex'), grokHome: '', brandsOff: ['claude'], defaultEngine: 'codex' });
  assert.equal(r.status, 200, r.error);
  const c = await api('/api/setup/check');
  assert.deepEqual(c.existing, {});
  assert.equal(c.roots.fresh, false, 'new homes now go beside Acme\'s');
});

test('the folder step hears when a suggested home already holds a setup, with a free folder beside it', async () => {
  const used = path.join(work, 'Claude', 'Acme', 'claude-home');
  fs.mkdirSync(path.join(used, 'projects', 'C--Work-a'), { recursive: true });
  fs.writeFileSync(path.join(used, '.credentials.json'), '{}');
  fs.writeFileSync(path.join(used, '.claude.json'), JSON.stringify({ oauthAccount: { emailAddress: 'pat@acme.com' } }));
  for (const n of ['1', '2']) fs.writeFileSync(path.join(used, 'projects', 'C--Work-a', `${n}.jsonl`), '');
  const fresh = path.join(work, 'Claude', 'Beta', 'claude-home');
  const r = await api('/api/setup/home-check?' + new URLSearchParams({ claude: used, codex: path.join(tmp, 'codex_home', 'Beta') }));
  assert.deepEqual(r.claude, { home: used, found: { signedIn: true, email: 'pat@acme.com', sessions: 2 }, free: path.join(work, 'Claude', 'Acme-2', 'claude-home') });
  assert.equal(r.codex.found, null);
  assert.equal((await api('/api/setup/home-check?' + new URLSearchParams({ claude: fresh }))).claude.found, null);
});
