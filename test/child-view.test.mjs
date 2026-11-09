// A coordinator's view of the sessions under it matches the session list (#717): list_sessions lists stopped
// children, ones moved in with set_parent, and grandchildren whose own parent is archived; close_session's
// "last open session" note counts those same sessions; and a session closed, then sent more work, can be closed
// again. Runs a throwaway Docket (its own ports, state and company list in a temp folder) whose Grok is the
// stand-in agent in test-fixtures/fake-acp-agent.mjs, driving Grok sessions that call Docket's tools the way Grok does.
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
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'docket-717-'));
let server;

const api = async (p, body) => {
  const r = await fetch(URL_ + p, { method: body ? 'POST' : 'GET', headers: { 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
  return r.json();
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function waitFor(what, fn, ms = 20000) {
  const until = Date.now() + ms;
  for (;;) {
    const v = await fn().catch(() => null);
    if (v) return v;
    if (Date.now() > until) throw new Error('Timed out waiting for ' + what);
    await sleep(150);
  }
}
const events = (id) => api(`/api/sessions/${id}/events?client=t1`);
const texts = async (id) => (await events(id)).events.filter((e) => e.k === 'text').map((e) => e.text);
const answered = (id, start) => waitFor(`${id} to answer`, async () => (await texts(id)).some((t) => t.startsWith('got: ' + start)));
const start = async (text, parentId) => {
  const id = (await api('/api/sessions', { client: 't1', text, engine: 'grok', ...(parentId ? { parentId, title: text } : {}), settings: { permissionMode: 'bypassPermissions' } })).id;
  await answered(id, text);
  return id;
};
// One turn of a session calling a portal tool; returns the tool's answer.
async function call(id, tool, args) {
  const before = (await texts(id)).length;
  await api(`/api/sessions/${id}/send?client=t1`, { text: `CALL portal__${tool} ${JSON.stringify(args)}` });
  const said = await waitFor(`${tool} from ${id}`, async () => (await texts(id)).slice(before).find((t) => t.startsWith(`called portal__${tool}:`)));
  return said.slice(`called portal__${tool}: `.length).replace(/ \[end of reply\]$/, '');
}
const end = (id) => api(`/api/sessions/${id}/end?client=t1`, {});
const idle = (id) => waitFor(`${id} to be idle`, async () => { const s = (await events(id)).session; return s && !['starting', 'running'].includes(s.status); });

before(async () => {
  const c = { id: 't1', name: 'T1', home: path.join(tmp, 'claude-home'), folder: path.join(tmp, 'work'), grokHome: path.join(tmp, 'grok-home'), defaultEngine: 'grok' };
  for (const d of [c.home, c.folder, c.grokHome]) fs.mkdirSync(d, { recursive: true });
  fs.writeFileSync(path.join(tmp, 'clients.json'), JSON.stringify([c]));
  fs.writeFileSync(path.join(tmp, 'state.json'), JSON.stringify({ sessions: {}, updates: { minutes: 0 } }));
  server = spawn(process.execPath, [path.join(ROOT, 'server.mjs')], {
    cwd: ROOT, stdio: 'ignore', windowsHide: true,
    env: { ...process.env, PORTAL_PORT: String(PORT), DOCKET_RUNNER_PORT: String(RUNNER_PORT), PORTAL_CLIENTS: path.join(tmp, 'clients.json'),
      PORTAL_STATE: path.join(tmp, 'state.json'), PORTAL_SCHEDULES: path.join(tmp, 'schedules.json'), PORTAL_DATA: path.join(tmp, 'data'),
      PORTAL_GROK_EXE: path.join(HERE, '..', 'test-fixtures', 'fake-acp-agent.mjs') },
  });
  await waitFor('the test Docket to start', () => api('/api/clients?quick=1'), 30000);
});

after(async () => {
  const runner = await fetch(`http://127.0.0.1:${RUNNER_PORT}/health`).then((r) => r.json()).catch(() => null);
  server?.kill();
  if (runner?.pid) stopTree(runner.pid);
  await sleep(300);
  fs.rmSync(tmp, { recursive: true, force: true, maxRetries: 10 });
});

let coord, kid, grandkid, small, moved;
test('a coordinator with a child, a grandchild, a small child and a stopped child moved in with set_parent', async () => {
  coord = await start('coordinator');
  kid = await start('kid', coord); // started under the coordinator
  grandkid = await start('grandkid', kid); // under kid, which is closed below
  small = await start('small', coord); // closed, then sent more work
  moved = await start('moved'); // top level, moved under the coordinator with set_parent
  assert.match(await call(coord, 'set_parent', { id: moved, parent_id: coord }), /now reports to/);
  await idle(moved);
  await end(moved); // stopped, still open in the list
});

test('step 2: list_sessions lists a stopped child moved in with set_parent', async () => {
  // Step 2: a stopped child moved in with set_parent is listed, under its current parent.
  const list = await call(coord, 'list_sessions', {});
  assert.match(list, new RegExp(`${moved}  \\[not running\\]  moved  \\(under you\\)`), 'a stopped set_parent child is listed');

});

test('step 3: closing a child is not called the last one while others are open under the coordinator, and its child moves up', async () => {
  // Closing kid leaves moved and grandkid open under the coordinator, so it was not the last one.
  await idle(kid);
  const closed = await call(coord, 'close_session', { id: kid, summary: 'done' });
  assert.match(closed, /^Closed and archived "kid"/);
  assert.doesNotMatch(closed, /last open session/, 'moved and grandkid are still open under the coordinator');
  for (const id of [moved, grandkid, small]) assert.ok(closed.includes(id), `the note names ${id} as still open`);

  // Step 2: the grandchild whose own parent is archived is listed under the nearest open session above it.
  const list = await call(coord, 'list_sessions', {});
  assert.match(list, new RegExp(`${grandkid}  \\[\\w+\\]  grandkid  \\(under you; its own parent ${kid} is archived\\)`));
  assert.doesNotMatch(list, new RegExp(kid + '  '), 'the archived kid is left out');
  const mine = await call(coord, 'list_sessions', { mine: true });
  assert.match(mine, /^3 open sessions under you:/);
  for (const id of [moved, grandkid, small]) assert.ok(mine.includes(id), `mine lists ${id}`);

});

// What the page has for a session: live (running, so shown open) or not, and whether its saved record says
// archived (a stopped Grok session has no saved-list row of its own, so the record is read; a row must agree).
const listed = async (id) => {
  await sleep(400); // the record is written 200 ms after a change
  const r = await api('/api/sessions?client=t1&refresh=1');
  const archived = !!JSON.parse(fs.readFileSync(path.join(tmp, 'state.json'), 'utf8')).sessions[id]?.archived;
  const h = r.history.find((s) => s.id === id);
  if (h) assert.equal(!!h.archived, archived, 'the saved list agrees with the record');
  return { live: r.live.some((s) => s.id === id), archived };
};

test('a closed child stays closed: its own child\'s report goes to the session above, not back to it', async () => {
  // As with b477cc02: closed with a child of its own still open, it was woken by that child's next report and ran
  // again, open in the list while its record said archived, and a second close_session said it was already archived.
  assert.deepEqual(await listed(kid), { live: false, archived: true }, 'closed by step 3');
  const before = (await events(coord)).events.length;
  await api(`/api/sessions/${grandkid}/send?client=t1`, { text: 'one more thing' });
  await answered(grandkid, 'one more thing');
  await idle(grandkid);
  await waitFor('the report to reach the coordinator', async () => (await events(coord)).events.slice(before).some((e) => e.k === 'child-report' && e.childId === grandkid));
  await sleep(500);
  assert.deepEqual(await listed(kid), { live: false, archived: true }, 'the closed kid was not woken');
  await idle(coord);

  // The person types in the closed session: it runs again, so it is open, and can be closed again.
  await api(`/api/sessions/${kid}/send?client=t1`, { text: 'are you there' });
  await answered(kid, 'are you there');
  await idle(kid);
  assert.deepEqual(await listed(kid), { live: true, archived: false }, 'open again, and not archived');
  assert.match(await call(coord, 'close_session', { id: kid, summary: 'done' }), /^Closed and archived "kid"/);
  assert.deepEqual(await listed(kid), { live: false, archived: true });
});

test('step 5: a child closed, then sent work, can be closed again', async () => {
  // Close, send more work (it resumes and runs a turn calling mark_turn), close again.
  await idle(small);
  assert.match(await call(coord, 'close_session', { id: small, summary: 'done' }), /^Closed and archived "small"/);
  const sent = await call(coord, 'send_to_session', { id: small, message: 'CALL portal__mark_turn {"label":"done"}' });
  assert.match(sent, /^Sent\./);
  await waitFor('small to call mark_turn', async () => (await texts(small)).some((t) => t.startsWith('called portal__mark_turn:')));
  await idle(small);
  assert.match(await call(coord, 'close_session', { id: small, summary: 'done again' }), /^Closed and archived "small"/);

});

test('the grandchild is closed by the coordinator, and the last open one is called the last', async () => {
  // The grandchild, under the coordinator now that kid is archived, can be closed by it; with moved stopped and
  // done, none is left working or waiting, but moved is still open, so this is not called the last one either.
  await idle(grandkid);
  const gk = await call(coord, 'close_session', { id: grandkid, summary: 'done' });
  assert.match(gk, /^Closed and archived "grandkid"/);
  assert.match(gk, /None of your sessions is still working or waiting on the user, but 1 under you is still open/);
  assert.match(await call(coord, 'send_to_session', { id: moved, message: 'wrap up' }), /^Sent\./); // picked up again, then closed: now the last one
  await answered(moved, 'wrap up');
  await idle(moved);
  assert.match(await call(coord, 'close_session', { id: moved, summary: 'done' }), /That was your last open session/);
});
