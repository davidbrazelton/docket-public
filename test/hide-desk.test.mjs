// Hiding a desk (#614), end to end on a throwaway Docket (its own ports, state and desk list in a temp folder): ☰ > Desks >
// Manage saves hidden in the desk list, a save that leaves it out keeps it, showing it again takes it out, one desk always
// stays shown, and it is still there after a restart. The page leaves a hidden desk out of the buttons and ☰ > Desks.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { freePorts, stopTree, TEST_DOCKET_ENV } from './free-port.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.dirname(HERE);
const [PORT, RUNNER_PORT] = await freePorts(2);
const URL_ = `http://127.0.0.1:${PORT}`;
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'docket-614-'));
const CLIENTS = path.join(tmp, 'clients.json');
const page = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
let server;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const get = async (p) => (await fetch(URL_ + p)).json();
const post = async (p, body) => { const r = await fetch(URL_ + p, { method: 'POST', headers: { 'content-type': 'application/json', origin: URL_ }, body: JSON.stringify(body) }); return { status: r.status, json: await r.json() }; };
const runnerPid = () => fetch(`http://127.0.0.1:${RUNNER_PORT}/health`).then((r) => r.json()).then((h) => h.pid).catch(() => null);
const desk = (id) => ({ id, name: id.toUpperCase(), home: path.join(tmp, id, 'claude'), folder: path.join(tmp, id, 'work') });
const saved = () => JSON.parse(fs.readFileSync(CLIENTS, 'utf8'));
// The list as the Desks screen sends it back, with changes to some desks.
const edit = async (changes = {}) => post('/api/clients/edit', { clients: (await get('/api/clients/edit')).map(({ id, name, home, folder }) => ({ id, name, home, folder, ...changes[id] })) });

async function start() {
  server = spawn(process.execPath, [path.join(ROOT, 'server.mjs')], {
    cwd: ROOT, stdio: 'ignore', windowsHide: true,
    env: { ...process.env, ...TEST_DOCKET_ENV, PORTAL_PORT: String(PORT), DOCKET_RUNNER_PORT: String(RUNNER_PORT), PORTAL_CLIENTS: CLIENTS,
      PORTAL_STATE: path.join(tmp, 'state.json'), PORTAL_SCHEDULES: path.join(tmp, 'schedules.json'), PORTAL_DATA: path.join(tmp, 'data') },
  });
  for (const until = Date.now() + 40000; ; await sleep(300)) {
    if (await get('/api/clients?quick=1').catch(() => null)) return;
    if (Date.now() > until) throw new Error('Timed out waiting for the test app');
  }
}
async function stop() {
  const gone = new Promise((r) => server.once('exit', r));
  server.kill();
  await gone;
}

before(async () => {
  const desks = [desk('a1'), desk('b2')];
  for (const d of desks) fs.mkdirSync(d.folder, { recursive: true });
  fs.writeFileSync(CLIENTS, JSON.stringify(desks));
  fs.writeFileSync(path.join(tmp, 'state.json'), JSON.stringify({ updates: { minutes: 0 }, sessions: {} }));
  await start();
});

after(async () => {
  const pid = await runnerPid();
  server?.kill();
  if (pid) stopTree(pid);
  await sleep(300);
  fs.rmSync(tmp, { recursive: true, force: true, maxRetries: 10 });
});

test('a hidden desk is saved in the desk list, kept by a save that leaves it out, and shown again with hidden: false', async () => {
  assert.equal((await edit({ b2: { hidden: true } })).status, 200);
  assert.equal(saved().find((c) => c.id === 'b2').hidden, true);
  assert.equal(saved().find((c) => c.id === 'a1').hidden, undefined, 'shown is the default and is not written');
  assert.equal((await get('/api/clients')).find((c) => c.id === 'b2').hidden, true, 'the page is told');
  assert.equal((await edit()).status, 200);
  assert.equal(saved().find((c) => c.id === 'b2').hidden, true, 'a save without it (the setup wizard) keeps it');
  assert.equal((await edit({ b2: { hidden: false } })).status, 200);
  assert.equal(saved().find((c) => c.id === 'b2').hidden, undefined);
  assert.equal((await get('/api/clients')).find((c) => c.id === 'b2').hidden, undefined);
});

test('one desk always stays shown', async () => {
  const r = await edit({ a1: { hidden: true }, b2: { hidden: true } });
  assert.equal(r.status, 400);
  assert.match(r.json.error, /at least one desk shown/);
  assert.ok(saved().every((c) => !c.hidden), 'nothing was saved');
});

test('a hidden desk is still hidden after the app restarts, with its sign-in folder and settings as they were', async () => {
  assert.equal((await edit({ b2: { hidden: true } })).status, 200);
  await stop();
  await start();
  const b2 = (await get('/api/clients')).find((c) => c.id === 'b2');
  assert.equal(b2.hidden, true);
  assert.equal(b2.folder, desk('b2').folder);
  assert.ok(fs.existsSync(desk('b2').home), 'its home folder is still there');
});

test('the page leaves hidden desks out of the desk buttons, ☰ > Desks and the sessions it loads', () => {
  assert.match(page, /function shownDesks\(\) \{ return S\.clients\.filter\(\(c\) => !c\.hidden\); \}/);
  assert.match(page, /\$\('clients'\)\.innerHTML = shownDesks\(\)\.map/, 'the desk buttons');
  assert.match(page, /'hr',\r?\n\s*\.\.\.shownDesks\(\)\.map\(\(c\) => \['desk:' \+ c\.id/, '☰ > Desks lists a group for each desk in the buttons\' order');
  assert.match(page, /Promise\.all\(shownDesks\(\)\.filter\(\(c\) => c\.id !== S\.client\)/, 'other desks\' sessions loaded at start');
  assert.match(page, /if \(!shownDesks\(\)\.some\(\(c\) => c\.id === S\.client\)\) selectClient/, 'a desk hidden while open moves to a shown one');
});

test('the Desks screen folds each desk under its name, and folding changes nothing saved', () => {
  assert.match(page, /const coOpen = new WeakSet\(\);/, 'open or closed is kept by the screen, not on the desk');
  assert.match(page, /\.co\.shut > :not\(\.co-head\):not\(\.co-check\) \{ display: none; \}/, 'a closed desk shows its header, and its Desk check when that is open');
  assert.match(page, /data-hide="\$\{i\}"/, 'the Show or Hide button is in each desk\'s header');
});
