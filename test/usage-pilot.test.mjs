// The autopilot's own cause (#976): every turn of a pilot run (state.sessions[id].pilotRun, #914) is pilot, whatever
// its messages say. Unit tests for costs.mjs, then end to end on a throwaway Docket (its own ports, state, desk and data
// folder in a temp folder): a run whose log is still there, one whose log is gone, and the answers from the pilot log.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { CAUSES, COORDINATION, pilotRows, turnCause } from '../costs.mjs';
import { freePorts, stopTree, TEST_DOCKET_ENV } from './free-port.mjs';

test('pilot is a cause, not a coordination one, and no message text gives it', () => {
  assert.ok(CAUSES.includes('pilot'));
  assert.ok(!COORDINATION.includes('pilot'));
  for (const text of ['please fix it', 'This session was started by the session "x"', '<session-report>x</session-report>', '(From Docket: autopilot run)']) assert.notEqual(turnCause(text), 'pilot');
});

test('pilotRows gives every row the cause pilot and leaves the rest, and the rows they came from, as they were', () => {
  const rows = [{ SessionId: 'r', Cause: 'brief', Cost: 1.5, Turns: 2 }, { SessionId: 'r', Cause: 'report', Cost: 0.25, Turns: 1 }, { SessionId: 'r', Cause: '', Cost: 1 }, { SessionId: 'r', Cause: 'pilot', Cost: 2 }];
  const out = pilotRows(rows);
  assert.deepEqual(out.map((r) => r.Cause), ['pilot', 'pilot', 'pilot', 'pilot']);
  assert.equal(out.reduce((a, r) => a + r.Cost, 0), 4.75, 'the totals still add up');
  assert.deepEqual(out.map((r) => r.Turns), [2, 1, undefined, undefined]);
  assert.deepEqual(rows.map((r) => r.Cause), ['brief', 'report', '', 'pilot']);
});

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.dirname(HERE);
let PORT, RUNNER_PORT, URL_, tmp, DATA, HOME, server;
const DAY = new Date(Date.now() - 3600e3).toLocaleDateString('en-CA');
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
const keptRow = (id, cost, cause) => ({ Client: 'd1', SessionId: id, Date: DAY, Title: id, Source: 'main', Model: 'claude-opus-5-5', Turns: 2, Agents: 0, CacheExpiry: 0, Compacting: 0,
  ToolCalls: 0, FilesTouched: 0, AvgTokensPerTurn: 0, InputTokens: 10, OutputTokens: 10, CacheRead: 0, CacheCreate: 0, CacheCreate1h: 0, Cost: cost, PersonalCost: cost,
  BilledProfile: 'd1 sign-in', ProfileInferred: 1, HypotheticalCost: cost, CacheSaved: 0, Brand: 'claude', AgentSeconds: 0, WaitSeconds: 0, UserSeconds: 0, LinesAdded: 0, LinesRemoved: 0, Connection: '', Cause: cause });

before(async () => {
  [PORT, RUNNER_PORT] = await freePorts(2);
  URL_ = `http://127.0.0.1:${PORT}`;
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'docket-pilot-cause-'));
  DATA = path.join(tmp, 'data');
  HOME = path.join(tmp, 'd1', 'claude');
  const t = (s) => new Date(Date.now() - 3600e3 + s * 1000).toISOString();
  const log = (first) => [
    { type: 'user', uuid: 'u1', timestamp: t(0), message: { role: 'user', content: first } },
    { type: 'assistant', uuid: 'a1', requestId: 'r1', timestamp: t(5), message: { id: 'm1', model: 'claude-opus-5-5', usage: { input_tokens: 1000, output_tokens: 100 }, content: [] } },
    { type: 'user', uuid: 'u2', timestamp: t(60), message: { role: 'user', content: [{ type: 'text', text: '<session-report>\n- "Child" finished.\n</session-report>' }] } },
    { type: 'assistant', uuid: 'a2', requestId: 'r2', timestamp: t(65), message: { id: 'm2', model: 'claude-opus-5-5', usage: { input_tokens: 2000, output_tokens: 50 }, content: [] } },
  ].map((l) => JSON.stringify(l)).join('\n') + '\n';
  // "run" is a pilot run whose log is there, "plain" an ordinary session with the same log, "oldrun" a run whose log is gone.
  put(path.join(HOME, 'projects', 'C--work', 'run.jsonl'), log('Answer what waits on the desk D1'));
  put(path.join(HOME, 'projects', 'C--work', 'plain.jsonl'), log('please fix it'));
  put(path.join(HOME, 'projects', 'C--work', 'logged.jsonl'), log('please fix it'));
  fs.mkdirSync(path.join(tmp, 'd1', 'work'), { recursive: true });
  fs.writeFileSync(path.join(tmp, 'clients.json'), JSON.stringify([{ id: 'd1', name: 'D1', home: HOME, folder: path.join(tmp, 'd1', 'work') }]));
  fs.writeFileSync(path.join(tmp, 'state.json'), JSON.stringify({ updates: { minutes: 0 }, sessions: {
    run: { client: 'd1', pilotRun: true, archived: true }, oldrun: { client: 'd1', pilotRun: true, archived: true } } }));
  put(path.join(DATA, 'usage-index.json'), JSON.stringify({ oldrun: { client: 'd1', sig: 'x', title: 'oldrun', rows: [keptRow('oldrun', 1.25, 'person')] } }));
  const at = Date.now() - 3600e3;
  put(path.join(DATA, 'pilot-log.jsonl'), [
    { at, kind: 'run', run: 'run', desk: 'd1', answer: 'started', ok: true },
    { at, id: 'question:a', kind: 'question', desk: 'd1', session: 's1', answer: 'yes', ok: true, run: 'run' },
    { at, id: 'permission:b', kind: 'permission', desk: 'd1', session: 's1', answer: 'allow', ok: true, run: 'run' },
    { at, id: 'card:c', kind: 'card', desk: 'd1', session: 's1', answer: 'suggested Start', ok: true, run: 'run', suggest: true },
    { at, id: 'permission:d', kind: 'permission', desk: 'd1', session: 's1', answer: 'allow', ok: false, run: 'run' },
    { at, id: 'question:e', kind: 'question', desk: 'd1', session: 's2', answer: 'no', ok: true, run: 'oldrun' },
    { at, kind: 'run', run: 'logged', desk: 'd1', answer: 'started', ok: true },
  ].map((l) => JSON.stringify(l)).join('\n') + '\n');
  server = spawn(process.execPath, [path.join(ROOT, 'server.mjs')], {
    cwd: ROOT, stdio: 'ignore', windowsHide: true,
    env: { ...process.env, ...TEST_DOCKET_ENV, PORTAL_PORT: String(PORT), DOCKET_RUNNER_PORT: String(RUNNER_PORT), PORTAL_CLIENTS: path.join(tmp, 'clients.json'),
      PORTAL_STATE: path.join(tmp, 'state.json'), PORTAL_SCHEDULES: path.join(tmp, 'schedules.json'), PORTAL_DATA: DATA,
      CODEX_HOME: path.join(tmp, 'shared-codex'), OPENAI_API_KEY: '', XAI_API_KEY: '' },
  });
  await waitFor('the usage sweep', async () => (await api('/api/usage')).some((r) => r.SessionId === 'run') && (await api('/api/usage')).some((r) => r.SessionId === 'plain') && (await api('/api/usage')).some((r) => r.SessionId === 'logged'));
});

after(async () => {
  const pid = await runnerPid();
  server?.kill();
  if (pid) stopTree(pid);
  await sleep(300);
  if (tmp) fs.rmSync(tmp, { recursive: true, force: true, maxRetries: 10 });
});

test('every turn of a pilot run has the cause pilot, whatever started it; other sessions keep theirs', async () => {
  const { rows } = await api('/api/usage/report');
  const of = (id) => rows.filter((r) => r.SessionId === id);
  assert.deepEqual(of('run').map((r) => r.Cause), ['pilot', 'pilot']);
  assert.deepEqual(of('plain').map((r) => r.Cause).sort(), ['person', 'report']);
  assert.equal(of('run').reduce((a, r) => a + r.Cost, 0).toFixed(4), of('plain').reduce((a, r) => a + r.Cost, 0).toFixed(4), 'the same cost, only its cause differs');
});

test('a past run whose log is gone gets the cause pilot too', async () => {
  const gone = (await api('/api/usage/report')).rows.filter((r) => r.SessionId === 'oldrun');
  assert.deepEqual(gone.map((r) => [r.Cause, r.Cost]), [['pilot', 1.25]]);
  const index = await waitFor('the record marked', async () => { const u = JSON.parse(fs.readFileSync(path.join(DATA, 'usage-index.json'), 'utf8')); return u.oldrun?.pilot && u; }, 10000);
  assert.equal(index.run.pilot, true, 'so the cause stays after the session is deleted');
});

test('the report has each run\'s answers and suggestions per day, failed ones left out', async () => {
  const { pilotAnswers } = await api('/api/usage/report');
  assert.deepEqual(pilotAnswers.run, { [DAY]: { answered: 2, suggested: 1 } });
  assert.deepEqual(pilotAnswers.oldrun, { [DAY]: { answered: 1, suggested: 0 } });
});

test('a session the pilot log names as a run counts as one without the pilotRun mark (runs from before #914)', async () => {
  const rows = (await api('/api/usage/report')).rows.filter((r) => r.SessionId === 'logged');
  assert.deepEqual(rows.map((r) => r.Cause), ['pilot', 'pilot']);
});

test('the CSV has pilot in its Cause column for the runs', async () => {
  const file = path.join(DATA, 'ai-usage-raw.csv');
  const csv = await waitFor('the CSV with the pilot cause', async () => { const t = fs.readFileSync(file, 'utf8'); return t.includes('oldrun') && /,run,/.test(t) && t; }, 20000);
  const [head, ...lines] = csv.trim().split('\r\n');
  const cols = head.split(',');
  const cell = (line, c) => line.split(',')[cols.indexOf(c)];
  for (const id of ['run', 'oldrun']) {
    const causes = lines.filter((l) => cell(l, 'SessionId') === id).map((l) => cell(l, 'Cause'));
    assert.ok(causes.length && causes.every((c) => c === 'pilot'), `${id}: ${causes}`);
  }
});
