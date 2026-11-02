// The setup wizard picks the AI brands, on a throwaway Docket (its own ports, state and an empty company list in
// a temp folder) whose Codex is fixtures/fake-codex.mjs, whose Grok is fixtures/fake-acp-agent.mjs, and whose Claude
// is a program that does not exist. Covers the computer check for each brand, and saving a Grok-only, a Codex-only
// and a Claude-only company the way the wizard sends them, including going back and changing the brands.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.dirname(HERE);
const PORT = 4487, RUNNER_PORT = 4497;
const URL_ = `http://127.0.0.1:${PORT}`;
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'docket-283-'));
let server;

const api = async (p, body) => {
  const r = await fetch(URL_ + p, { method: body ? 'POST' : 'GET', headers: { 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, ...(await r.json()) };
};
const list = async () => Object.values(await api('/api/clients?quick=1')).filter((x) => x && typeof x === 'object');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const runnerPid = () => fetch(`http://127.0.0.1:${RUNNER_PORT}/health`).then((r) => r.json()).then((h) => h.pid).catch(() => null);
const saved = () => JSON.parse(fs.readFileSync(path.join(tmp, 'clients.json'), 'utf8'));
// What the wizard sends for a company (save in companyWizard): every home folder, the brands left out, the default.
const wizard = (name, { claude = false, grok = false, codex = false, def = '', id } = {}) => ({
  id, name, home: path.join(tmp, name, 'claude-home'), folder: path.join(tmp, 'work', name), email: '',
  grokHome: grok ? path.join(tmp, 'grok_home', name) : '', codexHome: codex ? path.join(tmp, 'codex_home', name) : '',
  brandsOff: claude ? [] : ['claude'], defaultEngine: def,
});

before(async () => {
  fs.writeFileSync(path.join(tmp, 'clients.json'), '[]');
  fs.writeFileSync(path.join(tmp, 'state.json'), JSON.stringify({ sessions: {}, updates: { minutes: 0 } }));
  server = spawn(process.execPath, [path.join(ROOT, 'server.mjs')], {
    cwd: ROOT, stdio: 'ignore', windowsHide: true,
    env: { ...process.env, PORTAL_PORT: String(PORT), DOCKET_RUNNER_PORT: String(RUNNER_PORT), PORTAL_CLIENTS: path.join(tmp, 'clients.json'),
      PORTAL_STATE: path.join(tmp, 'state.json'), PORTAL_SCHEDULES: path.join(tmp, 'schedules.json'), PORTAL_DATA: path.join(tmp, 'data'),
      PORTAL_CLAUDE_EXE: path.join(tmp, 'no-such-claude.exe'),
      PORTAL_CODEX_EXE: path.join(HERE, 'fixtures', 'fake-codex.mjs'), PORTAL_GROK_EXE: path.join(HERE, 'fixtures', 'fake-acp-agent.mjs') },
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

test('the computer check says which brands are installed, and where their home folders go', async () => {
  const c = await api('/api/setup/check');
  assert.equal(c.claude, null, 'Claude Code is not installed here');
  assert.equal(c.grok, '1.0.70');
  assert.equal(c.codex, '0.163.0');
  assert.ok(c.roots.grok && c.roots.codex, 'the Grok and Codex default folders come with the check');
});

test('a Grok-only company: Grok its only brand and its default, with no Claude', async () => {
  const r = await api('/api/clients/save-one', wizard('GrokCo', { grok: true, def: 'grok' }));
  assert.equal(r.status, 200, r.error);
  const c = saved().find((x) => x.id === r.id);
  assert.equal(c.grokHome, path.join(tmp, 'grok_home', 'GrokCo'));
  assert.deepEqual(c.brandsOff, ['claude']);
  assert.equal(c.defaultEngine, 'grok');
  assert.equal(c.codexHome, undefined);
  assert.ok(fs.existsSync(c.grokHome), 'its Grok home is made');
  const row = (await list()).find((x) => x.id === r.id);
  assert.deepEqual(row.brands.map((b) => b.engine), ['grok']);
  assert.equal(row.defaultEngine, 'grok');
  // A home folder of any brand counts as taken for the next company.
  assert.ok((await api('/api/setup/check')).taken.includes(c.grokHome.toLowerCase()));
});

test('a Codex-only company, then Back to add Claude beside it, then Back to take Codex away', async () => {
  const r = await api('/api/clients/save-one', wizard('CodexCo', { codex: true, def: 'codex' }));
  assert.equal(r.status, 200, r.error);
  let c = saved().find((x) => x.id === r.id);
  assert.equal(c.codexHome, path.join(tmp, 'codex_home', 'CodexCo'));
  assert.deepEqual(c.brandsOff, ['claude']);
  assert.equal(c.defaultEngine, 'codex');
  // Codex signs in in its own home: not yet.
  assert.equal((await api(`/api/clients/${r.id}/auth-check?engine=codex`, {})).signedIn, false);

  await api('/api/clients/save-one', wizard('CodexCo', { id: r.id, claude: true, codex: true, def: 'codex' }));
  c = saved().find((x) => x.id === r.id);
  assert.equal(c.brandsOff, undefined, 'Claude is in use again');
  assert.equal(c.defaultEngine, 'codex');

  await api('/api/clients/save-one', wizard('CodexCo', { id: r.id, claude: true, def: '' }));
  c = saved().find((x) => x.id === r.id);
  assert.equal(c.codexHome, undefined, 'Codex is gone');
  assert.equal(c.defaultEngine, undefined, 'Claude is the default');
  assert.equal(saved().filter((x) => x.name === 'CodexCo').length, 1, 'still one company');
});

test('a Claude-only company is saved as before: no other brand, nothing left out', async () => {
  const r = await api('/api/clients/save-one', { ...wizard('ClaudeCo', { claude: true }), email: 'me@example.com' });
  assert.equal(r.status, 200, r.error);
  const c = saved().find((x) => x.id === r.id);
  assert.deepEqual(Object.keys(c).sort(), ['email', 'folder', 'home', 'id', 'madeFolders', 'name']);
  assert.deepEqual(c.madeFolders, [c.home], 'the home it made, for Remove to offer the Recycle Bin');
});

test('the sign-in step\'s one button signs in Claude first, then each other brand in turn, and waits while one finishes', () => {
  const page = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  const fn = page.slice(page.indexOf('    function signinAction() {'), page.indexOf('    function buttons() {'));
  // signed: the brands signed in; signin: the sign-in under way (S.signin), as the page keeps them.
  const actionOf = (w, signed = [], signin = null) => new Function('w', 'otherSigned', 'S', 'BRAND_NAMES', fn + '\nreturn signinAction();')(
    { code: '', si: null, id: 'co', ...w }, (e) => signed.includes(e), { signin }, { claude: 'Claude', grok: 'Grok', codex: 'Codex' });
  assert.deepEqual(actionOf({ kind: '', brands: ['grok'] }), ['brand', 'Sign in', 'w-brand-login', true, 'grok']);
  assert.deepEqual(actionOf({ kind: 'claude', brands: ['codex'] }).slice(0, 2), ['login', 'Sign in to Claude']);
  assert.deepEqual(actionOf({ kind: 'claude', signedIn: true, brands: ['grok', 'codex'] }).slice(0, 2), ['brand', 'Sign in to Grok']);
  assert.deepEqual(actionOf({ kind: 'claude', signedIn: true, brands: ['grok', 'codex'] }, ['grok']).slice(0, 2), ['brand', 'Sign in to Codex']);
  assert.equal(actionOf({ kind: '', brands: ['codex'] }, [], { client: 'co', engine: 'codex', step: 'aws' }), null, 'Codex is finishing on its own');
  assert.equal(actionOf({ kind: 'claude', signedIn: true, brands: ['grok'] }, ['grok']), null, 'all signed in: a plain Next');
  assert.deepEqual(actionOf({ kind: 'claude', forced: 'no', brands: ['grok'] }).slice(0, 2), ['brand', 'Sign in to Grok'], 'Claude can\'t sign in here, Grok still can');
});

test('the wizard offers every brand the Companies screen does, each with its words and install line', () => {
  const page = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  const brands = new Function(`${page.match(/^const CO_BRANDS = .*$/m)[0]}; return CO_BRANDS;`)();
  const platform = page.slice(page.indexOf('// ---------- platform'), page.indexOf('// end of platform')); // install lines
  const wiz = new Function(`${platform}\n${page.match(/^const WIZ_BRANDS = \{[\s\S]*?^\};$/m)[0]}; return WIZ_BRANDS;`)();
  assert.deepEqual(Object.keys(wiz).sort(), brands.map(([e]) => e).filter((e) => e !== 'claude').sort());
  for (const b of Object.values(wiz)) assert.ok(b.about && b.install && (b.link || b.where), 'words, an install line, and a link or where it goes');
});
