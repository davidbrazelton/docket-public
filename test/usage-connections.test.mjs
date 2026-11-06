// Usage totals by billing connection, end to end on a throwaway Docket (its own ports, state, desks and AWS config
// in a temp folder). Two desks on AWS profiles naming one account add up; a session keeps the connection it recorded when
// it started; two Codex desks on different API keys are two connections; per-desk totals are as they were; no key is kept.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { freePorts } from './free-port.mjs';
import { sessionRows } from '../costs.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.dirname(HERE);
const [PORT, RUNNER_PORT] = await freePorts(2);
const URL_ = `http://127.0.0.1:${PORT}`;
const PRICING = path.join(ROOT, 'pricing.json');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'docket-457-'));
const DATA = path.join(tmp, 'data');
const SECRETS = ['sk-proj-first-key-AAAA1111', 'sk-proj-second-key-BBBB2222', 'sk-ant-api03-claude-key-CCCC3333', 'sk-proj-desk-env-key-DDDD4444'];
let server;

const api = async (p) => (await fetch(URL_ + p)).json();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function waitFor(what, fn, ms = 40000) {
  const until = Date.now() + ms;
  for (;;) {
    const v = await fn().catch(() => null);
    if (v) return v;
    if (Date.now() > until) throw new Error('Timed out waiting for ' + what);
    await sleep(300);
  }
}
const runnerPid = () => fetch(`http://127.0.0.1:${RUNNER_PORT}/health`).then((r) => r.json()).then((h) => h.pid).catch(() => null);
const put = (file, text) => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, text); };
// A Claude log with one reply on Bedrock (its message id starts msg_bdrk) or not.
function transcript(home, id, bedrock, output) {
  const at = new Date(Date.now() - 3600e3).toISOString();
  const line = { type: 'assistant', uuid: `u-${id}`, timestamp: at, requestId: `r-${id}`,
    message: { id: `${bedrock ? 'msg_bdrk' : 'msg'}_${id}`, model: 'claude-sonnet-4-5-20250929', usage: { input_tokens: 1000, output_tokens: output }, content: [] } };
  const file = path.join(home, 'projects', 'C--work', `${id}.jsonl`);
  put(file, JSON.stringify(line) + '\n');
  return file;
}
const desk = (id, extra = {}) => ({ id, name: id.toUpperCase(), home: path.join(tmp, id, 'claude'), folder: path.join(tmp, id, 'work'), ...extra });
const files = {};

before(async () => {
  put(path.join(tmp, 'aws-config'), [
    '[profile one]', 'sso_session = acme', 'sso_account_id = 111122223333', 'region = us-east-1', '',
    '[profile two]', 'sso_start_url = https://example.awsapps.com/start', 'sso_account_id = 111122223333', 'region = us-west-2', '',
    '[sso-session acme]', 'sso_region = us-east-1', ''].join('\n'));
  const desks = [desk('a1', { awsProfile: 'one' }), desk('a2', { awsProfile: 'two' }), desk('k1'),
    desk('x1', { codexHome: path.join(tmp, 'x1', 'codex'), brandsOff: ['claude'] }), desk('x2', { codexHome: path.join(tmp, 'x2', 'codex'), brandsOff: ['claude'] }),
    desk('x3', { codexHome: path.join(tmp, 'x3', 'codex'), brandsOff: ['claude'], env: { OPENAI_API_KEY: SECRETS[3] } })];
  for (const d of desks) fs.mkdirSync(d.folder, { recursive: true });
  put(path.join(desks[2].home, '.claude.json'), JSON.stringify({ primaryApiKey: SECRETS[2] }));
  put(path.join(desks[3].codexHome, 'auth.json'), JSON.stringify({ OPENAI_API_KEY: SECRETS[0] }));
  put(path.join(desks[4].codexHome, 'auth.json'), JSON.stringify({ OPENAI_API_KEY: SECRETS[1] }));
  // s1 started when desk a1 was on another AWS account, and recorded it; s2 and s3 recorded nothing (older sessions).
  files.s1 = transcript(desks[0].home, 's1', true, 400);
  files.s3 = transcript(desks[0].home, 's3', true, 300);
  files.s2 = transcript(desks[1].home, 's2', true, 200);
  files.k = transcript(desks[2].home, 'k', false, 100);
  fs.writeFileSync(path.join(tmp, 'clients.json'), JSON.stringify(desks));
  fs.writeFileSync(path.join(tmp, 'state.json'), JSON.stringify({ updates: { minutes: 0 }, sessions: {
    s1: { client: 'a1', title: 'Recorded', via: { key: 'aws:999988887777', label: 'AWS 999988887777', kind: 'bedrock', exact: true, bedrock: true } } } }));
  // Older Codex rows: one "openai (API key)" bucket for every key.
  const old = (client, id) => ({ client, brand: 'codex', sig: 'old', title: id, groupId: null, rows: [{ Client: client, SessionId: id, Date: new Date().toISOString().slice(0, 10), Title: id, Source: 'main',
    Model: 'gpt-5', Turns: 1, Cost: 1.5, PersonalCost: 1.5, BilledProfile: 'openai (API key)', ProfileInferred: 1, Brand: 'codex', InputTokens: 10, OutputTokens: 10, CacheRead: 0 }] });
  put(path.join(DATA, 'usage-index.json'), JSON.stringify({ c1: old('x1', 'c1'), c2: old('x2', 'c2') }));
  server = spawn(process.execPath, [path.join(ROOT, 'server.mjs')], {
    cwd: ROOT, stdio: 'ignore', windowsHide: true,
    env: { ...process.env, PORTAL_PORT: String(PORT), DOCKET_RUNNER_PORT: String(RUNNER_PORT), PORTAL_CLIENTS: path.join(tmp, 'clients.json'),
      PORTAL_STATE: path.join(tmp, 'state.json'), PORTAL_SCHEDULES: path.join(tmp, 'schedules.json'), PORTAL_DATA: DATA,
      AWS_CONFIG_FILE: path.join(tmp, 'aws-config'), CODEX_HOME: path.join(tmp, 'shared-codex'), OPENAI_API_KEY: '', XAI_API_KEY: '' },
  });
  // The usage sweep reads every log shortly after start-up.
  await waitFor('the usage sweep', async () => { const r = await api('/api/usage/report'); return ['s1', 's2', 's3', 'k'].every((id) => r.rows.some((x) => x.SessionId === id)) && r; }, 60000);
});

after(async () => {
  const pid = await runnerPid();
  server?.kill();
  if (pid) try { process.kill(pid); } catch {}
  await sleep(300);
  fs.rmSync(tmp, { recursive: true, force: true, maxRetries: 5 });
});

const sumBy = (rows, key) => rows.reduce((m, r) => m.set(r[key], (m.get(r[key]) || 0) + r.Cost), new Map());

test('two desks on profiles naming one AWS account are one connection, its cost the sum of both', async () => {
  const r = await api('/api/usage/report');
  const acct = r.connections.find((c) => c.key === 'aws:111122223333');
  assert.ok(acct, 'the account is a connection');
  assert.equal(acct.label, 'AWS 111122223333');
  assert.equal(acct.kind, 'bedrock');
  assert.deepEqual(acct.desks.sort(), ['a1', 'a2']);
  assert.match(acct.detail, /profile one, us-east-1/);
  assert.match(acct.detail, /profile two, us-west-2/);
  const byConn = sumBy(r.rows, 'Connection');
  const of = (id) => r.rows.filter((x) => x.SessionId === id).reduce((a, x) => a + x.Cost, 0);
  assert.ok(of('s2') > 0 && of('s3') > 0);
  assert.ok(Math.abs(byConn.get('aws:111122223333') - (of('s2') + of('s3'))) < 1e-9);
});

test('a session keeps the connection it recorded at its start; an unrecorded one is read from today and marked inferred', async () => {
  const r = await api('/api/usage/report');
  const s1 = r.rows.filter((x) => x.SessionId === 's1'), s3 = r.rows.filter((x) => x.SessionId === 's3');
  assert.deepEqual([...new Set(s1.map((x) => [x.Connection, x.BilledProfile, x.ProfileInferred].join('|')))], ['aws:999988887777|AWS 999988887777|0']);
  assert.deepEqual([...new Set(s3.map((x) => [x.Connection, x.ProfileInferred].join('|')))], ['aws:111122223333|1']);
});

test('two Codex desks on different API keys are two connections, not one "openai (API key)"', async () => {
  const r = await api('/api/usage/report');
  const keys = ['c1', 'c2'].map((id) => r.rows.find((x) => x.SessionId === id).Connection);
  assert.notEqual(keys[0], keys[1]);
  for (const k of keys) assert.match(k, /^openai-key:api\.openai\.com:[0-9a-f]{8}$/);
  assert.deepEqual(r.rows.filter((x) => x.Brand === 'codex').map((x) => x.BilledProfile).sort(), ['OpenAI API key …1111', 'OpenAI API key …2222']);
  assert.ok(r.rows.filter((x) => x.Brand === 'codex').every((x) => x.ProfileInferred === 1));
});

test('per-desk totals are what they were without connections', async () => {
  const r = await api('/api/usage/report');
  const byDesk = sumBy(r.rows, 'Client');
  const before = (file, id) => sessionRows('x', file, id, PRICING, '', {}).reduce((a, x) => a + x.Cost, 0);
  const near = (a, b) => Math.abs(a - b) < 1e-9;
  assert.ok(near(byDesk.get('a1'), before(files.s1, 's1') + before(files.s3, 's3')));
  assert.ok(near(byDesk.get('a2'), before(files.s2, 's2')));
  assert.ok(near(byDesk.get('k1'), before(files.k, 'k')));
  assert.ok(near(byDesk.get('x1'), 1.5) && near(byDesk.get('x2'), 1.5));
  const total = (m) => [...m.values()].reduce((a, b) => a + b, 0);
  assert.ok(near(total(sumBy(r.rows, 'Connection')), total(byDesk)), 'every row is on one connection');
});

test('no key, token or full fingerprint is in the usage index, the CSV, the report or the Desks list', async () => {
  const report = JSON.stringify(await api('/api/usage/report'));
  // A desk's own variables are its settings, shown to edit; everything Docket works out from them is checked.
  const desks = JSON.stringify((await api('/api/clients/edit')).map(({ env, ...c }) => c));
  await waitFor('the CSV', async () => fs.existsSync(path.join(DATA, 'ai-usage-raw.csv')));
  await sleep(2500); // the index and CSV are written 2 seconds after a change
  const kept = [fs.readFileSync(path.join(DATA, 'usage-index.json'), 'utf8'), fs.readFileSync(path.join(DATA, 'ai-usage-raw.csv'), 'utf8'), report, desks];
  for (const s of SECRETS) {
    const full = crypto.createHash('sha256').update(s).digest('hex');
    for (const text of kept) {
      assert.ok(!text.includes(s.slice(0, -4)), 'a key is kept');
      assert.ok(!text.includes(full.slice(0, 9)), 'more than 8 characters of a fingerprint are kept');
    }
  }
  const csv = kept[1].split('\r\n');
  assert.equal(csv[0].split(',').at(-2), 'Connection');
  assert.ok(csv.some((l) => l.includes('anthropic-key:api.anthropic.com:') && l.includes('Anthropic API key …3333')));
});

test('the Desks list says who each desk is billed to and which desks share it', async () => {
  const list = await api('/api/clients/edit');
  const [a1, x1, x3] = ['a1', 'x1', 'x3'].map((id) => list.find((c) => c.id === id).connections);
  assert.deepEqual(a1.map((c) => [c.brand, c.label, c.sharedWith.join()]), [['claude', 'AWS 111122223333', 'A2']]);
  assert.deepEqual(x1.map((c) => [c.brand, c.label, c.sharedWith.join()]), [['codex', 'OpenAI API key …1111', '']]);
  // A key set in the desk's own variables, as its sessions get it.
  assert.deepEqual(x3.map((c) => [c.brand, c.label]), [['codex', 'OpenAI API key …4444']]);
});
