// The Cause column on usage rows kept from before it, end to end on a throwaway Docket (its own ports, state, desk and
// data folder in a temp folder): a session whose log is still there is read again and gets causes; one whose log is gone
// keeps its rows as they were, with an empty Cause, in /api/usage, the Usage page's report and the CSV.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { freePorts, stopTree } from './free-port.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.dirname(HERE);
const [PORT, RUNNER_PORT] = await freePorts(2);
const URL_ = `http://127.0.0.1:${PORT}`;
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'docket-cause-'));
const DATA = path.join(tmp, 'data');
const HOME = path.join(tmp, 'd1', 'claude');
const DAY = new Date(Date.now() - 3600e3).toLocaleDateString('en-CA');
let server;

const api = async (p) => (await fetch(URL_ + p)).json();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function waitFor(what, fn, ms = 60000) {
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
// A row as Docket kept it before Cause existed.
const oldRow = (id, cost) => ({ Client: 'd1', SessionId: id, Date: DAY, Title: id, Source: 'main', Model: 'claude-opus-5-5', Turns: 2, Agents: 0, CacheExpiry: 0, Compacting: 0,
  ToolCalls: 0, FilesTouched: 0, AvgTokensPerTurn: 0, InputTokens: 10, OutputTokens: 10, CacheRead: 0, CacheCreate: 0, CacheCreate1h: 0, Cost: cost, PersonalCost: cost,
  BilledProfile: 'd1 sign-in', ProfileInferred: 1, HypotheticalCost: cost, CacheSaved: 0, Brand: 'claude', AgentSeconds: 0, WaitSeconds: 0, UserSeconds: 0, LinesAdded: 0, LinesRemoved: 0, Connection: '' });

before(async () => {
  const t = (s) => new Date(Date.now() - 3600e3 + s * 1000).toISOString();
  const lines = [
    { type: 'user', uuid: 'u1', timestamp: t(0), message: { role: 'user', content: 'please fix it' } },
    { type: 'assistant', uuid: 'a1', requestId: 'r1', timestamp: t(5), message: { id: 'm1', model: 'claude-opus-5-5', usage: { input_tokens: 1000, output_tokens: 100 }, content: [] } },
    { type: 'user', uuid: 'u2', timestamp: t(60), message: { role: 'user', content: [{ type: 'text', text: '<session-report>\n- "Child" finished.\n</session-report>' }] } },
    { type: 'assistant', uuid: 'a2', requestId: 'r2', timestamp: t(65), message: { id: 'm2', model: 'claude-opus-5-5', usage: { input_tokens: 2000, output_tokens: 50 }, content: [] } },
  ];
  put(path.join(HOME, 'projects', 'C--work', 'kept.jsonl'), lines.map((l) => JSON.stringify(l)).join('\n') + '\n');
  fs.mkdirSync(path.join(tmp, 'd1', 'work'), { recursive: true });
  fs.writeFileSync(path.join(tmp, 'clients.json'), JSON.stringify([{ id: 'd1', name: 'D1', home: HOME, folder: path.join(tmp, 'd1', 'work') }]));
  fs.writeFileSync(path.join(tmp, 'state.json'), JSON.stringify({ updates: { minutes: 0 }, sessions: {} }));
  // Both read before Cause: "kept" still has its log (its signature is from then), "gone" does not.
  put(path.join(DATA, 'usage-index.json'), JSON.stringify({
    kept: { client: 'd1', sig: '0|0|v4', title: 'kept', rows: [oldRow('kept', 9)] },
    gone: { client: 'd1', sig: '0|0|v4', title: 'gone', rows: [oldRow('gone', 1.25)] } }));
  server = spawn(process.execPath, [path.join(ROOT, 'server.mjs')], {
    cwd: ROOT, stdio: 'ignore', windowsHide: true,
    env: { ...process.env, PORTAL_PORT: String(PORT), DOCKET_RUNNER_PORT: String(RUNNER_PORT), PORTAL_CLIENTS: path.join(tmp, 'clients.json'),
      PORTAL_STATE: path.join(tmp, 'state.json'), PORTAL_SCHEDULES: path.join(tmp, 'schedules.json'), PORTAL_DATA: DATA,
      CODEX_HOME: path.join(tmp, 'shared-codex'), OPENAI_API_KEY: '', XAI_API_KEY: '' },
  });
  await waitFor('the usage sweep', async () => (await api('/api/usage')).some((r) => r.SessionId === 'kept' && r.Cause));
});

after(async () => {
  const pid = await runnerPid();
  server?.kill();
  if (pid) stopTree(pid);
  await sleep(300);
  fs.rmSync(tmp, { recursive: true, force: true, maxRetries: 10 });
});

test('a session whose log is still there is read again, with a cause on each row', async () => {
  const rows = (await api('/api/usage')).filter((r) => r.SessionId === 'kept');
  assert.deepEqual(rows.map((r) => r.Cause).sort(), ['person', 'report']);
  assert.ok(rows.every((r) => r.Cost > 0 && r.Cost < 9), 'the old row is replaced, not added to');
});

test('a session whose log is gone keeps its rows, with an empty Cause', async () => {
  for (const rows of [await api('/api/usage'), (await api('/api/usage/report')).rows]) {
    const gone = rows.filter((r) => r.SessionId === 'gone');
    assert.equal(gone.length, 1);
    assert.equal(gone[0].Cause, '');
    assert.equal(gone[0].Cost, 1.25);
  }
});

test('the CSV has a Cause column, last, filled for re-read rows and empty for kept ones', async () => {
  const file = path.join(DATA, 'ai-usage-raw.csv');
  const csv = await waitFor('the CSV with causes', async () => { const t = fs.readFileSync(file, 'utf8'); return /,report,[\d.]+,[\d.]+,[\d.]+,[\d.]+\r\n/.test(t) && t; }, 20000);
  const [head, ...lines] = csv.trim().split('\r\n');
  const cols = head.split(',');
  assert.deepEqual(cols.slice(-5), ['Cause', 'Starts', 'StartCost', 'Child', 'ShortChild'], 'the start columns (#802) come after it');
  const cell = (line, c) => line.split(',')[cols.indexOf(c)];
  const of = (id) => lines.filter((l) => cell(l, 'SessionId') === id);
  assert.deepEqual(of('kept').map((l) => cell(l, 'Cause')).sort(), ['person', 'report']);
  assert.deepEqual(of('gone').map((l) => cell(l, 'Cause')), ['']);
});
