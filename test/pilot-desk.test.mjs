// The autopilot per desk (#973) and its runs (#881), on a throwaway Docket (its own ports, state and desk list in a temp
// folder) whose Grok is the stand-in agent in test-fixtures/fake-acp-agent.mjs, signed in, acting as a pilot when its
// brief says so. It starts from a state of the old shape (#875: the autopilot on, with its own Autopilot desk), which
// moves to per desk once; then it is enabled in Settings and engaged desk by desk; a run starts on the engaged desk
// itself, on its own brand and top model, for what came in close together, answers it and ends; one run at a time per
// desk; a desk not engaged, or with no brand signed in, gets none; the pilot holds back in a session the person is
// using. Then learning first (#917): the pilot suggests, the person accepts, "I got this" and a miss.
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
const [PORT, RUNNER_PORT, REMOTE_PORT] = await freePorts(3);
const URL_ = `http://127.0.0.1:${PORT}`;
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'docket-973-'));
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
const engage = (desk, on = true) => api('/api/pilot', { engage: { desk, on } });
const AP = path.join(tmp, 'Autopilot');

before(async () => {
  const c = { id: 't1', name: 'T1', home: path.join(tmp, 't1', 'claude-home'), folder: path.join(tmp, 't1', 'work'), grokHome: path.join(tmp, 't1', 'grok-home'), defaultEngine: 'grok' };
  // Two more desks for keeping clients apart (#914): T2 signed in to Grok, and T3 signed in to nothing (its Grok home
  // marked signed out for the stand-in agent), which can't be engaged (#973).
  const c2 = { id: 't2', name: 'T2', home: path.join(tmp, 't2', 'claude-home'), folder: path.join(tmp, 't2', 'work'), grokHome: path.join(tmp, 't2', 'grok-home'), defaultEngine: 'grok' };
  const c3 = { id: 't3c', name: 'T3', home: path.join(tmp, 't3', 'claude-home'), folder: path.join(tmp, 't3', 'work'), grokHome: path.join(tmp, 't3', 'grok-home'), defaultEngine: 'grok' };
  // The old Autopilot desk (#875), first in the list, with a run of its own and one finished run on T1 (#914).
  const ap = { id: 'apd', name: 'Autopilot', home: path.join(AP, 'claude-home'), folder: AP, grokHome: path.join(tmp, 'grok_home', 'Autopilot'), defaultEngine: 'grok' };
  for (const x of [c, c2, c3, ap]) for (const d of [x.home, x.folder, x.grokHome]) fs.mkdirSync(d, { recursive: true });
  fs.writeFileSync(path.join(AP, 'keep.txt'), 'kept');
  fs.writeFileSync(path.join(c3.grokHome, 'signed-out'), '');
  fs.writeFileSync(CLIENTS, JSON.stringify([ap, c, c2, c3]));
  const now = Date.now();
  fs.writeFileSync(STATE, JSON.stringify({ updates: { minutes: 0 },
    sessions: { old1: { client: 'apd', title: 'Autopilot run 09:00', createdAt: now - 3600e3, pilotRun: 't1' }, old2: { client: 'apd', title: 'Autopilot run 09:30', createdAt: now - 1800e3 },
      run0: { client: 't1', title: 'Autopilot run 10:00', createdAt: now - 600e3, pilotRun: 't1' } },
    pilot: { on: true, desk: 'apd', brand: 'grok', runs: [{ id: 'run0', at: now - 600e3, desk: 't1', host: 't1', brand: 'grok', gear: 'full', items: 1, ended: now - 590e3 }] },
    remoteControl: { on: false, desk: null, secret: null, pilotKeys: [{ id: 'pk_1', name: 'OFFICE', desk: 't1', expires: now + 86400e3, hash: '0'.repeat(64) }] } }));
  server = spawn(process.execPath, [path.join(ROOT, 'server.mjs')], {
    cwd: ROOT, stdio: 'ignore', windowsHide: true,
    env: { ...process.env, ...TEST_DOCKET_ENV, PORTAL_PORT: String(PORT), DOCKET_RUNNER_PORT: String(RUNNER_PORT), PORTAL_REMOTE_PORT: String(REMOTE_PORT), PORTAL_CLIENTS: CLIENTS,
      PORTAL_STATE: STATE, PORTAL_SCHEDULES: path.join(tmp, 'schedules.json'), PORTAL_DATA: DATA, PORTAL_PILOT_BATCH_MS: '1500', PORTAL_PILOT_OFFER_MS: '2000', FAKE_ACP_SIGNED_IN: '1',
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

test('the move to per desk (#973): still enabled, engaged nowhere, the Autopilot desk archived and gone, its folders kept', async () => {
  const v = await waitFor('the move', async () => { const x = await view(); return x.movedNote && x; });
  assert.deepEqual([v.on, v.engaged, v.flying, v.state, v.movedNote], [true, {}, false, 'off', true], 'enabled, no desk engaged, a note to show once');
  assert.deepEqual(desks().map((d) => d.id), ['t1', 't2', 't3c'], 'the Autopilot desk left the desk list');
  assert.ok(fs.existsSync(path.join(AP, 'keep.txt')) && fs.existsSync(path.join(AP, 'claude-home')), 'its folders stay on disk');
  assert.deepEqual([saved('old1').archived, saved('old2').archived], [true, true], 'its sessions archived');
  assert.deepEqual([saved('run0').archived, saved('run0').client], [undefined, 't1'], 'a run on a desk is left as it is');
  const st = JSON.parse(fs.readFileSync(STATE, 'utf8'));
  assert.deepEqual([st.pilot.desk, st.pilot.brand, st.remoteControl.pilotKeys], [undefined, undefined, undefined], 'the brand and the pilot keys are gone');
  assert.equal(v.runs[0].id, 'run0', 'the runs are kept');
  assert.ok(!(await api('/api/clients')).json.some((c) => c.pilot || c.name === 'Autopilot'), 'no Autopilot desk tab');
  // The note goes once dismissed.
  const r = await api('/api/pilot', { movedNote: false });
  assert.equal(r.json.movedNote, false);
});

test('enabled in Settings, engaged desk by desk: a run on the desk itself, on its own brand, billed there', async () => {
  // Disabled: nothing can be engaged, and no run starts.
  let r = await api('/api/pilot', { on: false });
  assert.deepEqual([r.json.on, r.json.desks, r.json.state], [false, [], 'off']);
  r = await engage('t1');
  assert.equal(r.status, 400);
  assert.match(r.json.error, /Enable the autopilot first/);
  assert.match((await api('/api/pilot', { brand: 'grok' })).json.error, /each on its own desk and brand/, 'no brand setting any more');

  // Enabled: every desk listed with its switch, engaged nowhere yet; a desk with no brand signed in can't be.
  r = await api('/api/pilot', { on: true });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  let v = r.json;
  assert.deepEqual(v.desks.map((d) => [d.id, d.signedIn, d.engaged]), [['t1', true, false], ['t2', true, false], ['t3c', false, false]]);
  assert.equal(v.desks[0].status, 'answers prompts, suggests for forms, plans, offers, cards, handoffs');
  assert.deepEqual(fs.readdirSync(DATA).filter((f) => /rules/.test(f)), ['pilot-rules.json'], 'the rules stay one file on this computer');
  assert.equal(v.notesFile, path.join(DATA, 'pilot-notes'), 'notes kept per desk (#914)');
  r = await engage('t3c');
  assert.equal(r.status, 400);
  assert.match(r.json.error, /T3 has no brand signed in\. Sign in to a brand first/);

  // A prompt on T1 while it is not engaged waits for the person.
  const w1 = await prompt('t1');
  await waitFor('w1 to wait', async () => (await view()).waiting.some((i) => i.session === w1.id && i.may === 'allow'));
  await sleep(2500);
  assert.equal((await view()).runs.length, 1, 'no run on a desk not engaged');

  // Engaged on T1: the prompt is judged by a run on T1 itself, on its own brand (Grok) and top model, not a Shift
  // session; the run answers it, ends, and is quiet in T1's list (its cost is T1's).
  r = await engage('t1');
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.deepEqual(Object.keys(r.json.engaged), ['t1']);
  assert.equal(r.json.flying, true);
  const t1Notes = path.join(DATA, 'pilot-notes', 't1.md');
  const run1 = await waitFor('the prompt to be answered by a run', () => answeredBy(w1.id));
  assert.equal((await permCard(w1.id, 't1')).by, 'pilot', 'the page shows answered by pilot');
  v = await waitFor('the run to end', async () => { const x = await view(); return x.runs[0]?.id === run1 && x.runs[0].ended && x; });
  assert.deepEqual([v.runs[0].desk, v.runs[0].host, v.runs[0].brand, v.runs[0].gear, v.runs[0].items, v.runs[0].why], ['t1', undefined, 'grok', 'full', 1, 'its turn ended']);
  assert.equal(v.state, 'idle');
  await waitFor('the run to be ended', async () => saved(run1)?.running === false);
  assert.deepEqual([saved(run1).client, saved(run1).pilotRun, saved(run1).archived, saved(run1).settings.model, saved(run1).waiting], ['t1', 't1', undefined, 'grok-4.7', undefined], 'a session of T1, on the top model, quiet');
  assert.deepEqual(v.log.filter((l) => l.kind === 'run' && l.run === run1).map((l) => [l.answer, l.desk]), [['ended', 't1'], ['started', 't1']], 'the log links the run, tagged with its desk');
  const brief = (await events(run1, 't1')).find((e) => e.k === 'user')?.text || '';
  assert.match(brief, /one short run for the desk T1\. This run is a session of T1, on its own sign-in/);
  assert.ok(brief.includes(t1Notes), 'the run is told where its desk\'s notes are');
  assert.doesNotMatch(brief, /low gear|shift_gear/, 'no starting low');

  // Two items close together go in one run.
  const [w2, w3] = await Promise.all([prompt('t1'), prompt('t1')]);
  const [run2, run3] = await Promise.all([waitFor('w2 answered', () => answeredBy(w2.id)), waitFor('w3 answered', () => answeredBy(w3.id))]);
  assert.equal(run2, run3, 'both in one run');
  assert.notEqual(run2, run1);
  v = await waitFor('the second run to end', async () => { const x = await view(); return x.runs[0]?.id === run2 && x.runs[0].ended && x; });
  assert.equal(v.runs[0].items, 2);

  // One run at a time on a desk: a run kept going (its notes say so) answers its item; what comes in meanwhile waits
  // for the next run. Meanwhile it may write its notes, and its desk's 🤖 shows it working.
  fs.mkdirSync(path.dirname(t1Notes), { recursive: true });
  fs.writeFileSync(t1Notes, 'PILOT_SLOW 10000\n');
  const w4 = await prompt('t1');
  const run4 = await waitFor('w4 answered', () => answeredBy(w4.id));
  const w5 = await prompt('t1');
  await waitFor('w5 to wait', async () => (await view()).waiting.some((i) => i.session === w5.id && i.may === 'allow'));
  v = await view();
  assert.deepEqual([v.session, v.going.map((g) => [g.id, g.desk])], [run4, [[run4, 't1']]], 'the first run is still going');
  assert.deepEqual([v.state, v.deskStates.t1], ['working', 'working']);
  const notes = await pilotTool(run4, 'pilot_notes', { add: 'remember this' });
  assert.equal(notes.error, false, notes.text);
  assert.match(fs.readFileSync(t1Notes, 'utf8'), /^PILOT_SLOW 10000\n- remember this\n$/);
  fs.writeFileSync(t1Notes, '');
  const run5 = await waitFor('w5 answered', () => answeredBy(w5.id), 40000);
  assert.notEqual(run5, run4, 'what came in during a run went to the next');
  v = await waitFor('the last run to end', async () => { const x = await view(); return x.runs[0]?.id === run5 && x.runs[0].ended && x; });
  assert.ok(v.runs[0].at >= v.runs[1].ended, 'the next run started only after the one before it ended');

  // The person using a session: the pilot holds back there (#942, #965, #973), suggesting at most.
  const w6 = await prompt('t1');
  assert.equal((await api('/api/pilot/busy', { id: `active:${w6.id}` })).status, 200);
  const held = await waitFor('w6 to wait, held back', async () => (await view()).waiting.find((i) => i.session === w6.id));
  assert.deepEqual([held.may, held.why], ['suggest', 'the person is using that session right now']);
  await waitFor('a suggestion on w6', async () => (await permCard(w6.id, 't1'))?.suggest);
  assert.equal((await permCard(w6.id, 't1')).state, 'pending', 'suggested, not answered');

  // A desk not engaged gets no run while another is: T2's prompt waits.
  const b1 = await prompt('t2');
  await waitFor('b1 to wait', async () => (await view()).waiting.some((i) => i.session === b1.id && i.may === 'allow'));
  await sleep(2500);
  assert.ok(!(await view()).runs.some((x) => x.desk === 't2'), 'no run on T2');

  // All but this desk (T1 open on the page): T2 is engaged and T1 is not; T3 has no brand signed in, and the note says so.
  r = await api('/api/pilot', { quick: 'others', here: 't1' });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.deepEqual(Object.keys(r.json.engaged), ['t2']);
  assert.match(r.json.note, /T3 has no brand signed in/);
  const runB = await waitFor("T2's prompt answered by a run on T2", () => answeredBy(b1.id));
  await waitFor('the run saved', async () => saved(runB));
  assert.deepEqual([saved(runB).client, saved(runB).pilotRun], ['t2', 't2']);
  r = await api('/api/pilot', { quick: 'all', here: 't1' });
  assert.deepEqual(Object.keys(r.json.engaged).sort(), ['t1', 't2'], 'all desks signed in');
  r = await api('/api/pilot', { quick: 'none' });
  assert.deepEqual([r.json.engaged, r.json.flying, r.json.state], [{}, false, 'off'], 'off everywhere');

  // Disabled, with T1 engaged: engaged nowhere, and no run starts.
  await engage('t1');
  await waitFor('the runs to end', async () => (await view()).going.length === 0);
  r = await api('/api/pilot', { on: false });
  assert.deepEqual([r.json.on, r.json.engaged], [false, {}]);
  const runs = (await view()).runs.length;
  const w7 = await prompt('t1');
  await waitFor('w7 to wait', async () => (await view()).waiting.some((i) => i.session === w7.id));
  await sleep(2500);
  assert.equal((await view()).runs.length, runs, 'no run while disabled');
});

test('keeping clients apart (#914): a run on each desk sees, answers and remembers only that desk', async () => {
  const notesOf = (d) => path.join(DATA, 'pilot-notes', `${d}.md`);
  fs.mkdirSync(path.join(DATA, 'pilot-notes'), { recursive: true });
  // Both runs stay going until the checks below are done (PILOT_HOLD), not for a set time: T1's run may start well
  // before T2's (on an item the test before left waiting), so a fixed time could end it before T2's is going.
  const release = path.join(tmp, 'release-runs').replace(/\\/g, '/');
  fs.writeFileSync(notesOf('t1'), `PILOT_HOLD ${release}\n- T1_SECRET_NOTE\n`);
  fs.writeFileSync(notesOf('t2'), `PILOT_HOLD ${release}\n- T2_SECRET_NOTE\n`);
  let r = await api('/api/pilot', { on: true });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  r = await api('/api/pilot', { quick: 'all', here: 't1' });
  assert.deepEqual(Object.keys(r.json.engaged).sort(), ['t1', 't2']);

  // A prompt on each of two desks at once: one run per desk, each a session of its own desk.
  const [a1, b1] = await Promise.all([prompt('t1'), prompt('t2')]);
  const [runA, runB] = await Promise.all([waitFor('T1 answered', () => answeredBy(a1.id)), waitFor('T2 answered', () => answeredBy(b1.id))]);
  assert.notEqual(runA, runB, 'one run per desk');
  for (const id of [runA, runB]) await waitFor('the run saved', async () => saved(id));
  assert.deepEqual([saved(runA).client, saved(runA).pilotRun, saved(runB).client, saved(runB).pilotRun], ['t1', 't1', 't2', 't2'], 'each on its own desk, billed there');
  let v = await view();
  assert.deepEqual(v.going.map((g) => g.desk).sort(), ['t1', 't2'], 'both going at once');
  assert.deepEqual([v.deskStates.t1, v.deskStates.t2], ['working', 'working']);

  // Each brief holds its own desk's items and notes, and nothing of the other's.
  const briefA = (await events(runA, 't1')).find((e) => e.k === 'user')?.text || '';
  const briefB = (await events(runB, 't2')).find((e) => e.k === 'user')?.text || '';
  assert.ok(briefA.includes('T1_SECRET_NOTE'));
  assert.doesNotMatch(briefA, /T2_SECRET_NOTE|T2\b|t2\.md/);
  assert.doesNotMatch(briefB, /T1_SECRET_NOTE|T1\b|t1\.md/);
  assert.ok(briefB.includes('T2_SECRET_NOTE'));

  // While both run, a new prompt on T2 waits for T2's next run; T1's run neither sees nor answers it.
  const b2 = await prompt('t2');
  const b2Item = await waitFor('the T2 item to wait', async () => (await view()).waiting.find((i) => i.session === b2.id && i.may === 'allow'));
  const listed = await pilotTool(runA, 'pilot_pending', { all: true });
  assert.equal(listed.error, false, listed.text);
  assert.ok(!listed.text.includes(b2Item.id) && !/"desk": "t2"|T2/.test(listed.text), 'pilot_pending lists only its own desk');
  const tried = await pilotTool(runA, 'pilot_answer', { id: b2Item.id, answer: 'allow' });
  assert.equal(tried.error, true);
  assert.match(tried.text, /Not answered: Nothing on T1 with that id is waiting now \(answered meanwhile, gone, or on another desk\)/);
  const sug = await pilotTool(runA, 'pilot_suggest', { id: b2Item.id, answer: 'allow' });
  assert.equal(sug.error, true);
  assert.match(sug.text, /Not suggested: Nothing on T1/);
  assert.equal((await permCard(b2.id, 't2')).state, 'pending', 'still waiting on T2');
  // Its notes go to its own desk's file only.
  assert.equal((await pilotTool(runA, 'pilot_notes', { add: 'about T1 only' })).error, false);
  assert.match(fs.readFileSync(notesOf('t1'), 'utf8'), /about T1 only/);
  assert.doesNotMatch(fs.readFileSync(notesOf('t2'), 'utf8'), /about T1 only/);
  // A session that is no run gets nothing from the pilot tools.
  assert.match((await pilotTool(a1.id, 'pilot_pending')).text, /No tool named pilot_pending/);

  // Disengaging T1 ends its run going, and its tools refuse from then on; T2's keeps going.
  r = await engage('t1', false);
  assert.deepEqual(Object.keys(r.json.engaged), ['t2']);
  assert.deepEqual(r.json.going.map((g) => g.desk), ['t2']);
  assert.match((await pilotTool(runA, 'pilot_pending')).text, /not a pilot run going now|not running in Docket/, 'its session ended');

  // T2's next run picks up its own item.
  fs.writeFileSync(notesOf('t1'), ''); fs.writeFileSync(notesOf('t2'), ''); fs.writeFileSync(release, '');
  const runB2 = await waitFor('T2 answered by its next run', () => answeredBy(b2.id), 40000);
  await waitFor('the run saved', async () => saved(runB2));
  assert.deepEqual([saved(runB2).client, saved(runB2).pilotRun], ['t2', 't2']);
  // Every answer and run line in the log is tagged with its desk.
  v = await view();
  for (const l of v.log.filter((x) => [runA, runB, runB2].includes(x.run))) assert.equal(l.desk, saved(l.run).pilotRun, JSON.stringify(l));
  await waitFor('every run to end', async () => (await view()).going.length === 0);
  await api('/api/pilot', { on: false });
});

test('learning first (#917): the pilot suggests, the person accepts, and after enough matches "I got this" lets it answer; a miss sends it back', async () => {
  const rulesFile = path.join(DATA, 'pilot-rules.json');
  const rules = () => JSON.parse(fs.readFileSync(rulesFile, 'utf8'));
  // An old rules file (no version) has its judgment kinds moved to suggest when the switch goes on; permission
  // prompts on T1 are set to suggest here, so the stand-in pilot can be tried on them.
  fs.writeFileSync(rulesFile, JSON.stringify({ kinds: { permission: 'allow', question: 'allow', plan: 'ask' }, desks: { t1: { kinds: { permission: 'suggest' } } } }));
  fs.writeFileSync(path.join(DATA, 'pilot-notes', 't1.md'), '');
  let r = await api('/api/pilot', { on: true });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.equal((await engage('t1')).status, 200);
  assert.deepEqual([rules().version, rules().kinds.question, rules().kinds.plan, rules().kinds.permission], [2, 'suggest', 'suggest', 'allow'], 'upgraded once, the person\'s levels kept');

  // Ten prompts close together: one run suggests Allow on each card, and answers none.
  const ws = await Promise.all(Array.from({ length: 10 }, () => prompt('t1')));
  // Ten sessions starting at once can take 20 s on a busy computer before the run even begins.
  for (const w of ws) await waitFor(`a suggestion on ${w.id}`, async () => (await permCard(w.id, 't1'))?.suggest, 60000);
  const card = await permCard(ws[0].id, 't1');
  assert.deepEqual([card.state, card.suggest.label, card.suggest.why, card.by], ['pending', 'Allow', 'stand-in pilot', undefined], 'suggested, not answered');
  let v = await view();
  assert.ok(v.log.some((l) => l.suggest && l.answer === 'suggested Allow'), 'the suggestion is in the pilot log');
  assert.equal(v.waiting.find((i) => i.session === ws[0].id).may, 'suggest');
  const brief = (await events(v.runs[0].id, v.runs[0].desk)).find((e) => e.k === 'user')?.text || '';
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

test("a desk's Autopilot tab (#974): runs by day with cost, out of the Sessions list; Suggest or Answer per kind; the offer to engage", async () => {
  const rulesFile = path.join(DATA, 'pilot-rules.json'), rules = () => JSON.parse(fs.readFileSync(rulesFile, 'utf8'));
  const learn = () => fs.readFileSync(path.join(DATA, 'pilot-learn.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
  await api('/api/pilot', { on: true });
  await engage('t1');
  const desk = async (id = 't1') => (await api(`/api/pilot/desk?client=${id}`)).json;

  // The tab: engaged since, what it answered, the kinds, and T1's runs (not archived) by day, each with its cost and answers.
  let v = await desk();
  assert.deepEqual([v.desk.name, v.on, v.signedIn, v.engaged, typeof v.since], ['T1', true, true, true, 'number']);
  assert.deepEqual(v.kinds.map((k) => k.kind), ['permission', 'question', 'plan', 'offer', 'card', 'handoff']);
  assert.equal(v.kinds[0].level, 'suggest', 'permission prompts went back to suggest after the miss');
  const runs = v.days.flatMap((d) => d.runs);
  assert.ok(runs.length >= 5, 'the runs of the tests before');
  assert.ok(runs.every((r) => typeof r.cost === 'number' && Array.isArray(r.answers) && Array.isArray(r.left)));
  assert.ok(runs.some((r) => r.answers.some((a) => a.kind === 'permission' && a.answer === 'allow' && a.session)), 'each run lists what it answered');
  assert.equal(v.cost, Math.round(v.days.reduce((n, d) => n + d.cost, 0) * 1e4) / 1e4);
  assert.ok(!runs.some((r) => r.id === 'run0' && saved('run0').client !== 't1'));
  // Runs are marked in the session list, which the Sessions tab leaves them out by.
  const list = (await api('/api/sessions?client=t1')).json;
  const rows = [...(list.live || []), ...(list.history || [])];
  const marked = rows.filter((r) => r.pilotRun === 't1').map((r) => r.id);
  assert.ok(runs.every((r) => marked.includes(r.id) || !rows.some((x) => x.id === r.id)), 'every run row is marked');
  assert.ok(rows.some((r) => !r.pilotRun), "the desk's own work is not");

  // Answer is refused until earned. Suggest on a kind that answers only pauses it on that desk, its count kept, so
  // Answer can be picked again; Train puts it back to learning, its count over (#1004).
  let r = await api('/api/pilot/kind', { desk: 't1', kind: 'question', level: 'allow' });
  assert.equal(r.status, 400);
  assert.match(r.json.error, /not earned that yet/);
  const raw = rules(); raw.desks.t1.kinds.card = 'allow'; fs.writeFileSync(rulesFile, JSON.stringify(raw));
  assert.equal((await desk()).kinds.find((k) => k.kind === 'card').level, 'allow');
  r = await api('/api/pilot/kind', { desk: 't1', kind: 'card', level: 'suggest' });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.match(r.json.text, /suggests card items on T1 on the card again, and keeps what it learned/);
  assert.deepEqual([rules().desks.t1.kinds.card, rules().desks.t2?.kinds?.card], ['suggest', undefined]);
  assert.deepEqual(learn().at(-1), { at: learn().at(-1).at, desk: 't1', kind: 'card', how: 'hold', match: null });
  assert.equal((await desk()).kinds.find((k) => k.kind === 'card').held, true);
  r = await api('/api/pilot/kind', { desk: 't1', kind: 'card', level: 'allow' });
  assert.equal(r.status, 200, 'Answer again straight away');
  assert.equal(rules().desks.t1.kinds.card, 'allow');
  r = await api('/api/pilot/kind', { desk: 't1', kind: 'card', level: 'train' });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.match(r.json.text, /suggests card items on T1 again and learns them from the start: its count is back to 0 of 10/);
  assert.equal(rules().desks.t1.kinds.card, 'suggest');
  assert.deepEqual(learn().at(-1), { at: learn().at(-1).at, desk: 't1', kind: 'card', how: 'reset', match: null });
  r = await api('/api/pilot/kind', { desk: 't1', kind: 'card', level: 'allow' });
  assert.equal(r.status, 400, 'and has to earn Answer again');

  // The offer: what waits on a desk not engaged, long enough, is offered once; Not now holds it for this stretch.
  await api('/api/pilot', { quick: 'none' });
  const b = await prompt('t2');
  const offer = await waitFor('the offer for T2', async () => { const o = (await view()).offer; return o?.desks.some((d) => d.id === 't2') && o; });
  assert.ok(offer.desks.some((d) => d.id === 't2' && d.name === 'T2' && d.count >= 1), JSON.stringify(offer));
  assert.equal((await api('/api/pilot/offer', { act: 'later' })).status, 200);
  assert.equal((await view()).offer, null, 'Not now');
  assert.deepEqual((await view()).engaged, {}, 'it never engages on its own');
  // Engage from the card: T2 is engaged, and its run answers what waited.
  r = await api('/api/pilot', { engage: { desks: ['t2', 't3c'] } });
  assert.deepEqual(Object.keys(r.json.engaged), ['t2'], 'a desk with no brand signed in is left out');
  await waitFor('the waiting prompt answered', () => answeredBy(b.id));
  // Not today: no offer for the rest of the day.
  await api('/api/pilot/offer', { act: 'today' });
  await api('/api/pilot', { quick: 'none' });
  const b2 = await prompt('t2');
  await waitFor('b2 to wait', async () => (await view()).waiting.some((i) => i.session === b2.id));
  await sleep(4000);
  assert.equal((await view()).offer, null, 'Not today');
  assert.equal(JSON.parse(fs.readFileSync(STATE, 'utf8')).pilot.offerOff, new Date().toLocaleDateString('en-CA'));
  await api('/api/pilot', { on: false });
});
