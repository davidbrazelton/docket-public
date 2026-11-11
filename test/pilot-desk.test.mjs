// The autopilot's own desk (#875) and its runs (#881), on a throwaway Docket (its own ports, state and desk list in a
// temp folder) whose Grok is the stand-in agent in test-fixtures/fake-acp-agent.mjs, signed in, acting as a pilot when
// its brief says so. The first time the switch goes on Docket makes the Autopilot desk; the pilot's brand is Claude
// until set, always on its top model, and only a brand that desk has signed in can be; a run starts on that brand for
// what came in close together, answers it and ends, and stays in the desk's list (archived only after a week); one run
// at a time; the page hears what it is doing (state); and the autopilot's desk is first, locked and asks for screen
// control (#886). Then learning first (#917): the pilot suggests, the person accepts, "I got this" and a miss.
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
const [PORT, RUNNER_PORT, REMOTE_PORT] = await freePorts(3);
const URL_ = `http://127.0.0.1:${PORT}`;
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'docket-881-'));
const DATA = path.join(tmp, 'data'), CLIENTS = path.join(tmp, 'clients.json'), STATE = path.join(tmp, 'state.json');
let server;

const api = async (p, body) => {
  const r = await fetch(URL_ + p, { method: body ? 'POST' : 'GET', headers: { 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, json: await r.json().catch(() => null) };
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function waitFor(what, fn, ms = 30000) {
  const until = Date.now() + ms;
  for (;;) {
    const v = await fn().catch(() => null);
    if (v) return v;
    if (Date.now() > until) throw new Error('Timed out waiting for ' + what);
    await sleep(150);
  }
}
const events = async (id, desk) => (await api(`/api/sessions/${id}/events?client=${desk}`)).json.events;
// A pilot tool, called the way a session's tools reach Docket.
async function pilotTool(session, name, args = {}) {
  const r = await fetch(URL_ + '/api/tools/call', { method: 'POST', headers: { 'content-type': 'application/json', 'x-docket-token': fs.readFileSync(path.join(DATA, 'tool-token'), 'utf8').trim() },
    body: JSON.stringify({ session, name, args }) });
  const j = await r.json();
  return { error: !!j.isError || !!j.error, text: (j.content || []).map((c) => c.text).join('\n') || j.error || '' };
}
const start = async (desk, text, settings = {}) => (await api('/api/sessions', { client: desk, text, engine: 'grok', settings })).json;
// A permission prompt waiting on that desk: a session asking to use a tool, in the default permission mode.
const prompt = (desk) => start(desk, 'CALL other__thing {}', { permissionMode: 'default' });
const desks = () => JSON.parse(fs.readFileSync(CLIENTS, 'utf8'));
const view = async () => (await api('/api/pilot')).json;
const saved = (id) => JSON.parse(fs.readFileSync(STATE, 'utf8')).sessions?.[id];
const permCard = async (id, desk) => (await events(id, desk)).find((e) => e.k === 'permission');
// The run that answered this session's prompt, from the pilot's log.
const answeredBy = async (session) => (await view()).log.find((l) => l.kind === 'permission' && l.session === session && l.ok)?.run;

before(async () => {
  const c = { id: 't1', name: 'T1', home: path.join(tmp, 't1', 'claude-home'), folder: path.join(tmp, 't1', 'work'), grokHome: path.join(tmp, 't1', 'grok-home'), defaultEngine: 'grok' };
  for (const d of [c.home, c.folder, c.grokHome]) fs.mkdirSync(d, { recursive: true });
  fs.writeFileSync(CLIENTS, JSON.stringify([c]));
  fs.writeFileSync(STATE, JSON.stringify({ sessions: {}, updates: { minutes: 0 } }));
  server = spawn(process.execPath, [path.join(ROOT, 'server.mjs')], {
    cwd: ROOT, stdio: 'ignore', windowsHide: true,
    env: { ...process.env, PORTAL_PORT: String(PORT), DOCKET_RUNNER_PORT: String(RUNNER_PORT), PORTAL_REMOTE_PORT: String(REMOTE_PORT), PORTAL_CLIENTS: CLIENTS,
      PORTAL_STATE: STATE, PORTAL_SCHEDULES: path.join(tmp, 'schedules.json'), PORTAL_DATA: DATA, PORTAL_PILOT_BATCH_MS: '1500', FAKE_ACP_SIGNED_IN: '1',
      PORTAL_GROK_EXE: path.join(HERE, '..', 'test-fixtures', 'fake-acp-agent.mjs') },
  });
  await waitFor('the test Docket to start', async () => (await api('/api/clients?quick=1')).status === 200, 30000);
});

after(async () => {
  const runner = await fetch(`http://127.0.0.1:${RUNNER_PORT}/health`).then((r) => r.json()).catch(() => null);
  server?.kill();
  if (runner?.pid) stopTree(runner.pid);
  await sleep(300);
  fs.rmSync(tmp, { recursive: true, force: true, maxRetries: 10 });
});

test('the pilot is its own desk and works in short runs on the brand set for it', async () => {
  // Before the first enable there is no autopilot desk, so no brand can be set and no session be the pilot.
  let v = await view();
  assert.equal(v.on, false);
  assert.equal(v.pilotDesk, null);
  assert.deepEqual([v.brand, v.gear, v.state], ['claude', 'opus', 'off'], 'Claude on its top gear by default');
  assert.match((await api('/api/pilot', { brand: 'grok' })).json.error, /no desk yet/);

  // The first enable makes the Autopilot desk, filled in as Add a desk does, and starts nothing until something comes in.
  let r = await api('/api/pilot', { on: true });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  v = r.json;
  assert.equal(v.on, true);
  assert.equal(v.pilotDesk.name, 'Autopilot');
  const ap = desks().find((d) => d.id === v.pilotDesk.id);
  assert.deepEqual({ name: ap.name, home: ap.home, grokHome: ap.grokHome, folder: ap.folder, defaultEngine: ap.defaultEngine },
    { name: 'Autopilot', home: path.join(tmp, 'Autopilot', 'claude-home'), grokHome: path.join(tmp, 'grok_home', 'Autopilot'), folder: path.join(tmp, 'Autopilot'), defaultEngine: 'grok' });
  for (const d of [ap.home, ap.grokHome, ap.folder]) assert.ok(fs.existsSync(d), d);
  assert.ok(!fs.readdirSync(ap.home).includes('.credentials.json'), 'its Claude home is made with no sign-in');
  assert.equal(v.session, null, 'no run before anything comes in');
  assert.ok(v.flying);
  assert.equal(v.state, 'idle');
  assert.equal(v.desks, undefined, 'no desk to pick');
  assert.equal((await api('/api/pilot', { desk: 't1' })).json.pilotDesk.id, ap.id, 'the desk cannot be bound by hand');
  assert.deepEqual(fs.readdirSync(DATA).filter((f) => /rules/.test(f)), ['pilot-rules.json'], 'the rules stay one file on this computer');
  assert.equal(v.notesFile, path.join(ap.folder, 'pilot-notes.md'));

  // The autopilot's desk is special (#886): first in the list, marked as the pilot's, set up by Docket and locked.
  assert.equal(desks()[0].id, ap.id, 'first in the desk list');
  const listed = (await api('/api/clients')).json;
  assert.deepEqual([listed[0].id, listed[0].pilot, listed.filter((c) => c.pilot).length], [ap.id, true, 1]);
  assert.match((await api('/api/sessions', { client: ap.id, text: 'hi', engine: 'grok' })).json.error, /its sessions are the pilot runs/, 'no work started on it by hand');
  assert.match((await api('/api/clients/save-one', { id: ap.id, name: 'Renamed', folder: ap.folder, home: ap.home })).json.error, /autopilot's desk/);
  assert.match((await api('/api/clients/copy-plan', { source: ap.id, name: 'Copy' })).json.error, /not copied/);
  const edited = (await api('/api/clients/edit')).json;
  assert.equal(edited[0].pilot, true);
  r = await api('/api/clients/edit', { clients: edited.map(({ forced, running, hookList, connections, gatewayModels, pilot, pilotOn, ...c }) => (c.id === ap.id ? { ...c, name: 'Renamed', folder: 'C:/elsewhere' } : c)) });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.deepEqual([desks()[0].name, desks()[0].folder], ['Autopilot', ap.folder], 'its settings are kept as Docket set them');
  r = await api('/api/clients/edit', { clients: edited.filter((c) => c.id !== ap.id).map(({ forced, running, hookList, connections, gatewayModels, ...c }) => c) });
  assert.equal(r.status, 400);
  assert.match(r.json.error, /Turn the autopilot off/, 'removed only with the autopilot off');

  // Screen control stays off until the person turns it on; the panel says so, and one call turns it on for that desk.
  assert.equal(v.screen, false);
  await api('/api/screen', { client: ap.id, on: true });
  assert.equal((await view()).screen, true);
  await api('/api/screen', { client: ap.id, on: false });

  // Settings offers the desk's brands, signed in or not, and refuses one it is not signed in to.
  assert.deepEqual(v.brands.map((b) => [b.brand, b.signedIn]), [['claude', false], ['grok', true]]);
  r = await api('/api/pilot', { brand: 'claude' });
  assert.equal(r.status, 400);
  assert.match(r.json.error, /not signed in to Claude/);

  // On Claude, not signed in there, an allowed item starts no run, and Settings says why.
  const w1 = await prompt('t1');
  await waitFor('the prompt to wait', async () => (await view()).waiting.some((i) => i.kind === 'permission' && i.desk === 'T1' && i.may === 'allow'));
  v = await waitFor('Settings to say why no run started', async () => { const x = await view(); return x.problem && x; });
  assert.match(v.problem, /not signed in to Claude/);
  assert.equal(v.session, null);
  assert.deepEqual(v.runs, []);

  // Changing the brand makes the next run use it: on Grok's top model, not a Shift session, the run answers the
  // prompt and ends, and stays in the desk's list.
  r = await api('/api/pilot', { brand: 'grok' });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.deepEqual([r.json.brand, r.json.gear, r.json.problem], ['grok', 'full', '']);
  const run1 = await waitFor('the prompt to be answered by a run', () => answeredBy(w1.id));
  assert.equal((await permCard(w1.id, 't1')).by, 'pilot', 'the page shows answered by pilot');
  v = await waitFor('the run to end', async () => { const x = await view(); return x.runs[0]?.ended && x; });
  assert.deepEqual([v.runs.length, v.runs[0].id, v.runs[0].brand, v.runs[0].gear, v.runs[0].items, v.runs[0].why], [1, run1, 'grok', 'full', 1, 'its turn ended']);
  assert.equal(v.session, null);
  assert.equal(v.state, 'idle');
  await waitFor('the run to be ended', async () => saved(run1)?.running === false);
  assert.deepEqual([saved(run1).archived, saved(run1).settings.model], [undefined, 'grok-4.7'], 'kept in the list, on the top model');
  assert.deepEqual(v.log.filter((l) => l.kind === 'run' && l.run === run1).map((l) => l.answer), ['ended', 'started'], 'the log links the run');
  const brief = (await events(run1, ap.id)).find((e) => e.k === 'user')?.text || '';
  assert.match(brief, /one short run/);
  assert.ok(brief.includes(path.join(ap.folder, 'pilot-notes.md')), 'the run is told where its notes are');
  assert.doesNotMatch(brief, /low gear|shift_gear/, 'no starting low');

  // Two items close together go in one run.
  const [w2, w3] = await Promise.all([prompt('t1'), prompt('t1')]);
  const [run2, run3] = await Promise.all([waitFor('w2 answered', () => answeredBy(w2.id)), waitFor('w3 answered', () => answeredBy(w3.id))]);
  assert.equal(run2, run3, 'both in one run');
  assert.notEqual(run2, run1);
  v = await waitFor('the second run to end', async () => { const x = await view(); return x.runs[0]?.ended && x; });
  assert.deepEqual([v.runs.length, v.runs[0].items], [2, 2]);

  // One run at a time: a run kept going (its notes say so) answers its item; what comes in meanwhile waits for the
  // next run. Meanwhile it may write its notes.
  fs.writeFileSync(path.join(ap.folder, 'pilot-notes.md'), 'PILOT_SLOW 10000\n');
  const w4 = await prompt('t1');
  const run4 = await waitFor('w4 answered', () => answeredBy(w4.id));
  const w5 = await prompt('t1');
  await waitFor('w5 to wait', async () => (await view()).waiting.some((i) => i.desk === 'T1' && i.kind === 'permission' && i.may === 'allow'));
  v = await view();
  assert.equal(v.session, run4, 'the first run is still going');
  assert.equal(v.state, 'working');
  const notes = await pilotTool(run4, 'pilot_notes', { add: 'remember this' });
  assert.equal(notes.error, false, notes.text);
  assert.match(fs.readFileSync(path.join(ap.folder, 'pilot-notes.md'), 'utf8'), /^PILOT_SLOW 10000\n- remember this\n$/);
  fs.writeFileSync(path.join(ap.folder, 'pilot-notes.md'), '');
  const run5 = await waitFor('w5 answered', () => answeredBy(w5.id), 40000);
  assert.notEqual(run5, run4, 'what came in during a run went to the next');
  v = await waitFor('the last run to end', async () => { const x = await view(); return x.runs[0]?.ended && x; });
  const [r5, r4] = v.runs;
  assert.deepEqual([r5.id, r4.id], [run5, run4]);
  assert.ok(r5.at >= r4.ended, 'the next run started only after the one before it ended');
  for (const id of [run1, run2, run4, run5]) await waitFor(`run ${id} to be ended`, async () => saved(id)?.running === false && !saved(id).archived);

  // With the switch off, no run starts, and the desk and its files stay.
  await api('/api/pilot', { on: false });
  const w6 = await prompt('t1');
  await waitFor('w6 to wait', async () => (await view()).waiting.some((i) => i.session === w6.id));
  await sleep(2500);
  v = await view();
  assert.deepEqual([v.runs.length, v.state], [4, 'off'], 'no run while off');
  assert.ok(desks().some((d) => d.id === ap.id) && fs.existsSync(ap.folder), 'the desk stays');

  await api('/api/pilot', { on: false });
});

test('learning first (#917): the pilot suggests, the person accepts, and after enough matches "I got this" lets it answer; a miss sends it back', async () => {
  const rulesFile = path.join(DATA, 'pilot-rules.json');
  const rules = () => JSON.parse(fs.readFileSync(rulesFile, 'utf8'));
  // An old rules file (no version) has its judgment kinds moved to suggest when the switch goes on; permission
  // prompts on T1 are set to suggest here, so the stand-in pilot can be tried on them.
  fs.writeFileSync(rulesFile, JSON.stringify({ kinds: { permission: 'allow', question: 'allow', plan: 'ask' }, desks: { t1: { kinds: { permission: 'suggest' } } } }));
  fs.writeFileSync(path.join(desks()[0].folder, 'pilot-notes.md'), '');
  let r = await api('/api/pilot', { on: true });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.deepEqual([rules().version, rules().kinds.question, rules().kinds.plan, rules().kinds.permission], [2, 'suggest', 'suggest', 'allow'], 'upgraded once, the person\'s levels kept');

  // Ten prompts close together: one run suggests Allow on each card, and answers none.
  const ws = await Promise.all(Array.from({ length: 10 }, () => prompt('t1')));
  for (const w of ws) await waitFor(`a suggestion on ${w.id}`, async () => (await permCard(w.id, 't1'))?.suggest);
  const card = await permCard(ws[0].id, 't1');
  assert.deepEqual([card.state, card.suggest.label, card.suggest.why, card.by], ['pending', 'Allow', 'stand-in pilot', undefined], 'suggested, not answered');
  let v = await view();
  assert.ok(v.log.some((l) => l.suggest && l.answer === 'suggested Allow'), 'the suggestion is in the pilot log');
  assert.equal(v.waiting.find((i) => i.session === ws[0].id).may, 'suggest');
  const brief = (await events(v.runs[0].id, desks()[0].id)).find((e) => e.k === 'user')?.text || '';
  assert.match(brief, /pilot_suggest/);

  // Accept on each card answers it as the person, and each is logged as a match. Nothing is offered until ten.
  const learn = () => fs.readFileSync(path.join(DATA, 'pilot-learn.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
  for (const [i, w] of ws.entries()) {
    assert.equal((await view()).offers.length, 0, `nothing to take over after ${i}`);
    r = await api('/api/pilot/accept', { id: (await permCard(w.id, 't1')).suggest.id });
    assert.equal(r.status, 200, JSON.stringify(r.json));
    const answered = await permCard(w.id, 't1');
    assert.deepEqual([answered.state, answered.by], ['allowed', undefined], 'answered as the person');
  }
  const lines = learn().filter((l) => l.desk === 't1' && l.kind === 'permission');
  assert.equal(lines.length, 10);
  assert.ok(lines.every((l) => l.match === true && l.suggested.answer === 'allow' && l.user.answer === 'allow'));
  assert.equal((await api('/api/pilot/accept', { id: card.suggest.id })).status, 400, 'an answered suggestion is gone');

  // Ready: the panel offers "I got this"; taking it lets the pilot answer T1's prompts itself.
  v = await view();
  assert.deepEqual(v.offers.map((o) => [o.desk, o.kind, o.matched, o.total]), [['t1', 'permission', 10, 10]]);
  r = await api('/api/pilot/promote', { desk: 't1', kind: 'permission' });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.equal(rules().desks.t1.kinds.permission, 'allow');
  assert.equal((await view()).offers.length, 0);
  const w11 = await prompt('t1');
  await waitFor('the pilot to answer it itself', () => answeredBy(w11.id));
  const own = await permCard(w11.id, 't1');
  assert.deepEqual([own.by, own.pilotItem && own.pilotItem.endsWith(own.id)], ['pilot', true]);

  // Not my pick: a miss in the learning log, and T1's prompts go back to suggest.
  r = await api('/api/pilot/miss', { id: own.pilotItem });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.match(r.json.text, /goes back to suggesting/);
  assert.equal(rules().desks.t1.kinds.permission, 'suggest');
  assert.deepEqual(learn().at(-1).how, 'miss');
  const w12 = await prompt('t1');
  await waitFor('a suggestion again', async () => (await permCard(w12.id, 't1'))?.suggest);
  assert.equal((await permCard(w12.id, 't1')).state, 'pending');
  assert.equal((await view()).offers.length, 0, 'the miss holds it back');
  await api('/api/pilot', { on: false });
});
