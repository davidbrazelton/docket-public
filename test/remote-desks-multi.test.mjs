// Remote Desks with several desks added (#1044), on the office network and through the Docket relay (#1052), on a
// throwaway Docket (its own ports, state and desk list in a temp folder) whose Grok is the stand-in agent in
// test-fixtures/fake-acp-agent.mjs, with the relay's stand-in (relay/desks/local.mjs). Desks t1 and t2 are added, t3 is
// not. The saved setup links one desk the old way (remoteControl.desk) and still has away mode's settings (before
// #1052), so the first test also shows it turning into the list and those settings going.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import WebSocket from 'ws';
import { freePorts, stopTree, TEST_DOCKET_ENV } from './free-port.mjs';
import { codeAt, stepOf, peerCertificate, pinnedRequest, pinnedTls, parsePairingCode } from '../remote.mjs';
import { startRelay } from '../relay/desks/local.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.dirname(HERE);
const [PORT, RUNNER_PORT, REMOTE_PORT] = await freePorts(3);
const URL_ = `http://127.0.0.1:${PORT}`, REMOTE = `https://127.0.0.1:${REMOTE_PORT}`;
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'docket-1044-'));
const STATE = path.join(tmp, 'state.json');
const SECRET = 'JBSWY3DPEHPK3PXP';
let server, relay;

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
// This computer's own page.
const api = async (p, body) => {
  const r = await fetch(URL_ + p, { method: body ? 'POST' : 'GET', headers: { 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, json: await r.json().catch(() => null) };
};
const texts = async (id, desk) => (await api(`/api/sessions/${id}/events?client=${desk}`)).json.events.filter((e) => e.k === 'text').map((e) => e.text);
const startHere = async (desk, text) => {
  const s = (await api('/api/sessions', { client: desk, text, engine: 'grok', settings: { permissionMode: 'bypassPermissions' } })).json;
  await waitFor(`a session on ${desk} to answer`, async () => (await texts(s.id, desk)).length);
  return s.id;
};
const savedRemote = () => JSON.parse(fs.readFileSync(STATE, 'utf8')).remoteControl;
/// What a page that opens now is told about Remote Desks: on, the setup menu; live, the relay part (#1058).
const pageTold = () => new Promise((resolve, reject) => {
  const ws = new WebSocket(`ws://localhost:${PORT}/ws`, { origin: `http://localhost:${PORT}` });
  ws.on('message', (d) => { const m = JSON.parse(d); if (m.t === 'remote-features') { ws.close(); resolve(m); } });
  ws.on('error', reject);
});
// Codes are good once each: every sign-in takes the next step's code.
let codeStep = 0;
const nextCode = () => codeAt(SECRET, codeStep = Math.max(codeStep + 1, stepOf() - 1));

// Starts the throwaway Docket (again, for a restart: same state and data folder).
async function startDocket() {
  server = spawn(process.execPath, [path.join(ROOT, 'server.mjs')], {
    cwd: ROOT, stdio: 'ignore', windowsHide: true,
    env: { ...process.env, ...TEST_DOCKET_ENV, PORTAL_PORT: String(PORT), DOCKET_RUNNER_PORT: String(RUNNER_PORT), PORTAL_REMOTE_PORT: String(REMOTE_PORT),
      PORTAL_RELAY_URL: `http://127.0.0.1:${relay.port}`, PORTAL_CLIENTS: path.join(tmp, 'clients.json'),
      PORTAL_STATE: STATE, PORTAL_SCHEDULES: path.join(tmp, 'schedules.json'), PORTAL_DATA: path.join(tmp, 'data'),
      PORTAL_GROK_EXE: path.join(HERE, '..', 'test-fixtures', 'fake-acp-agent.mjs') },
  });
  await waitFor('the test Docket to start', async () => (await api('/api/clients?quick=1')).status === 200, 30000);
}

before(async () => {
  relay = await startRelay(0);
  const desks = ['t1', 't2', 't3'].map((id) => ({ id, name: id.toUpperCase(), home: path.join(tmp, id, 'claude-home'), folder: path.join(tmp, id, 'work'), grokHome: path.join(tmp, id, 'grok-home'), defaultEngine: 'grok' }));
  for (const c of desks) for (const d of [c.home, c.folder, c.grokHome]) fs.mkdirSync(d, { recursive: true });
  fs.writeFileSync(path.join(tmp, 'clients.json'), JSON.stringify(desks));
  fs.writeFileSync(STATE, JSON.stringify({ sessions: {}, updates: { minutes: 0 },
    remoteControl: { on: true, desk: 't1', secret: SECRET, away: { on: true, team: 'https://acme.cloudflareaccess.com', aud: 'a'.repeat(64), email: 'owner@example.com' } } }));
  await startDocket();
  await api('/api/remote-features', { on: true });
});

after(async () => {
  const runner = await fetch(`http://127.0.0.1:${RUNNER_PORT}/health`).then((r) => r.json()).catch(() => null);
  server?.kill();
  if (runner?.pid) stopTree(runner.pid);
  await relay?.close();
  await sleep(300);
  fs.rmSync(tmp, { recursive: true, force: true, maxRetries: 10 });
});

test('the desk linked before #1044 becomes the first on the list; desks are added and taken off here', async () => {
  assert.deepEqual((await api('/api/remote-control')).json.desks, ['t1'], 'the old setup reads as a list');
  assert.deepEqual((await api('/api/remote-control', { add: 't2' })).json.desks, ['t1', 't2']);
  assert.deepEqual((await api('/api/remote-control', { add: 't2' })).json.desks, ['t1', 't2'], 'added once');
  assert.equal((await api('/api/remote-control', { add: 'nope' })).status, 400, 'only a desk on this computer');
  await waitFor('the list to be saved', async () => JSON.stringify(savedRemote().desks) === '["t1","t2"]');
  assert.equal('desk' in savedRemote(), false, 'the old field is gone from the saved setup');
  assert.equal(savedRemote().secret, SECRET, 'the rest of the setup is kept');
  assert.equal('away' in savedRemote(), false, 'away mode\'s settings are dropped (#1052)');
});

test('a Remote Desks connection reaches both added desks, and is told when one is taken off; never a desk not added', async () => {
  const peer = await peerCertificate(REMOTE);
  const call = (method, p, body, token) => pinnedRequest(REMOTE, { pin: peer.fingerprint, cert: peer.pem, method, path: p, body, token });
  // The authenticator code, and Allow clicked here.
  const hello = call('POST', '/remote/hello', { code: nextCode(), name: 'Laptop' });
  const ask = await waitFor('the Allow card', async () => (await api('/api/remote-control')).json.asks[0]);
  assert.deepEqual(ask.desks, ['T1', 'T2'], 'the Allow card names every desk it may use');
  await api('/api/remote-control/answer', { id: ask.id, allow: true });
  const h = (await hello).json;
  assert.deepEqual(h.desks, [{ id: 't1', name: 'T1' }, { id: 't2', name: 'T2' }]);
  assert.deepEqual(h.desk, { id: 't1', name: 'T1' }, 'the first, for a Docket that knows one desk');
  const T = h.token;

  // Live updates from the start.
  const ws = new WebSocket(`wss://127.0.0.1:${REMOTE_PORT}/remote/ws`, { ...pinnedTls(peer.fingerprint, peer.pem), headers: { authorization: `Bearer ${T}` } });
  const heard = [];
  ws.on('message', (d) => heard.push(JSON.parse(d)));
  await new Promise((r, j) => { ws.on('open', r); ws.on('error', j); });

  assert.deepEqual((await call('GET', '/api/clients', undefined, T)).json.map((c) => c.id), ['t1', 't2'], 'the desk list is cut to the added desks');
  for (const d of ['t1', 't2']) assert.equal((await call('GET', `/api/sessions?client=${d}`, undefined, T)).status, 200, d);
  assert.equal((await call('GET', '/api/sessions?client=t3', undefined, T)).status, 403, 'a desk not added');
  assert.equal((await call('GET', '/api/groups?client=t3', undefined, T)).status, 403);

  // Start a session on each added desk; one on t3 can only be started here.
  const s1 = (await call('POST', '/api/sessions', { client: 't1', text: 'one', engine: 'grok', settings: { permissionMode: 'bypassPermissions' } }, T)).json.id;
  const s2 = (await call('POST', '/api/sessions', { client: 't2', text: 'two', engine: 'grok', settings: { permissionMode: 'bypassPermissions' } }, T)).json.id;
  assert.ok(s1 && s2);
  assert.equal((await call('POST', '/api/sessions', { client: 't3', text: 'three' }, T)).status, 403, 'not on a desk not added');
  const s3 = await startHere('t3', 'three');
  await waitFor('both remote sessions to answer', async () => (await texts(s1, 't1')).length && (await texts(s2, 't2')).length);
  assert.ok(Object.values((await api('/api/sessions?client=t2')).json.live || []).some((s) => s.id === s2), 'the t2 session is on t2');

  // Each session through its own desk, or with no desk named; never through the other desk, and never t3's.
  assert.equal((await call('GET', `/api/sessions/${s2}/events?client=t2`, undefined, T)).status, 200);
  assert.equal((await call('GET', `/api/sessions/${s2}/events`, undefined, T)).status, 200);
  assert.equal((await call('GET', `/api/sessions/${s2}/events?client=t1`, undefined, T)).status, 403, 'named with the wrong desk');
  assert.equal((await call('GET', `/api/sessions/${s3}/events`, undefined, T)).status, 403, 'a session on a desk not added');
  assert.equal((await call('GET', `/api/sessions/${s3}/events?client=t1`, undefined, T)).status, 403);
  assert.equal((await call('POST', `/api/sessions/${s3}/send`, { text: 'hi' }, T)).status, 403);
  assert.equal((await call('POST', `/api/sessions/${s2}/send`, { text: 'more' }, T)).status, 200, 'a message to an added desk');
  await waitFor('the message on t2 to be answered', async () => (await texts(s2, 't2')).length >= 2);

  // Live updates: both added desks, never t3.
  await api(`/api/sessions/${s3}/send?client=t3`, { text: 'quiet' });
  await waitFor('t3 to answer', async () => (await texts(s3, 't3')).length >= 2);
  await sleep(500);
  const about = (id) => heard.some((m) => m.id === id || m.session?.id === id);
  assert.ok(about(s1) && about(s2), 'updates about both added desks');
  assert.ok(!about(s3), 'nothing about a desk not added');
  assert.ok(!heard.some((m) => m.client === 't3' || m.session?.client === 't3'));

  // Taking t2 off: the connection stays, is told the new list, and t2 stops answering at once.
  heard.length = 0;
  assert.deepEqual((await api('/api/remote-control', { remove: 't2' })).json.desks, ['t1']);
  const told = await waitFor('the new list', async () => heard.find((m) => m.t === 'remote-desks'));
  assert.deepEqual(told.desks, [{ id: 't1', name: 'T1' }]);
  assert.equal((await call('GET', '/api/sessions?client=t2', undefined, T)).status, 403);
  assert.equal((await call('GET', `/api/sessions/${s2}/events`, undefined, T)).status, 403);
  assert.equal((await call('GET', '/api/sessions?client=t1', undefined, T)).status, 200);
  assert.deepEqual((await call('GET', '/api/clients', undefined, T)).json.map((c) => c.id), ['t1']);
  await api('/api/remote-control', { add: 't2' });
  ws.close();
  await call('POST', '/remote/bye', {}, T);
});

test('each desk the other computer added is its own desk tab here, all connected with one code (#1058)', async () => {
  // This same Docket plays the other computer: it adds its own remote control address as a remote desk.
  const check = (await api('/api/remote-control')).json.check;
  const rd = (await api('/api/remote-desks', { name: 'Desk PC', address: `127.0.0.1:${REMOTE_PORT}`, check })).json;
  assert.ok(rd?.id, 'the remote desk was added');
  const tabs = async () => (await api('/api/clients')).json.filter((c) => c.remote?.id === rd.id);
  const before = await tabs();
  assert.deepEqual(before.map((c) => [c.id, c.name, c.remote.connected]), [[rd.id, 'Desk PC', false]], 'before its first connection one tab stands in, named like the remote desk');
  const connect = api(`/api/remote-desks/${rd.id}/connect`, { code: nextCode() });
  const ask = await waitFor('the Allow card', async () => (await api('/api/remote-control')).json.asks[0]);
  await api('/api/remote-control/answer', { id: ask.id, allow: true });
  const v = (await connect).json;
  assert.equal(v.connected, true);
  assert.deepEqual(v.desks, [{ id: 't1', name: 'T1' }, { id: 't2', name: 'T2' }], 'it lists both added desks, not t3');
  const rows = await tabs();
  assert.deepEqual(rows.map((c) => [c.id, c.name, c.remote.desk, c.remote.name, c.remote.connected]),
    [[`${rd.id}-t1`, 'T1', 't1', 'Desk PC', true], [`${rd.id}-t2`, 'T2', 't2', 'Desk PC', true]], 'a tab per desk there, named like it');
  const shown = async (tab) => { const r = (await api(`/api/sessions?client=${tab}`)).json; return [...(r.live || []), ...(r.history || [])].map((s) => s.id).sort(); };
  const own = async (d) => { const r = (await api(`/api/sessions?client=${d}`)).json; return [...(r.live || []), ...(r.history || [])].map((s) => s.id).sort(); };
  assert.deepEqual(await shown(`${rd.id}-t1`), await own('t1'), 't1\'s sessions on its tab');
  assert.deepEqual(await shown(`${rd.id}-t2`), await own('t2'), 't2\'s sessions on its tab, at the same time');
  assert.equal((await api(`/api/sessions?client=${rd.id}-t3`)).status, 403, 'a desk that computer did not add');
  const sess = (await api(`/api/sessions?client=${rd.id}-t2`)).json.history?.[0];
  if (sess) assert.equal(sess.client, `${rd.id}-t2`, 'a session reads as on its tab');
  // A tab's questions level is set on that desk there, and each tab shows its own (#1057).
  assert.equal((await api('/api/question-level', { client: `${rd.id}-t2`, level: 'highlight' })).status, 200);
  const levels = (await api('/api/question-levels')).json;
  assert.equal(levels.t2, 'highlight', 'saved on t2 there');
  assert.equal(levels[`${rd.id}-t2`], 'highlight', 'and shown on its tab');
  assert.notEqual(levels[`${rd.id}-t1`], 'highlight', 'not on the other tab');
  // The desks there are kept, so the tabs stay while it is not connected.
  await waitFor('the desks there to be saved', async () => JSON.stringify(JSON.parse(fs.readFileSync(STATE, 'utf8')).remoteDesks.find((d) => d.id === rd.id)?.hostDesks) === JSON.stringify(v.desks));
  await api(`/api/remote-desks/${rd.id}/disconnect`, {});
  assert.deepEqual((await tabs()).map((c) => [c.id, c.remote.connected]), [[`${rd.id}-t1`, false], [`${rd.id}-t2`, false]], 'both tabs stay, not connected');
  const off = await api(`/api/sessions?client=${rd.id}-t2`);
  assert.equal(off.status, 409);
  assert.equal(off.json.remote, 'connect');
  assert.equal(off.json.client, `${rd.id}-t2`);
  await api(`/api/remote-desks/${rd.id}/remove`, {});
  assert.deepEqual(await tabs(), [], 'removing it removes its tabs');
});

test('through the Docket relay: a pairing code, then only the authenticator code; it carries on across a restart (#1052)', async () => {
  const savedConns = () => { try { return JSON.parse(fs.readFileSync(path.join(tmp, 'data', 'relay-conns.json'), 'utf8')); } catch { return []; } };
  await api('/api/remote-control', { add: 't2' });
  // The host: Reach from anywhere, and the pairing code it shows.
  assert.equal((await api('/api/remote-control/relay', { on: true })).status, 200);
  const r = await waitFor('the line to the relay', async () => { const v = (await api('/api/remote-control')).json.relay; return v.connected && v; });
  assert.equal(r.on, true);
  const pair = parsePairingCode(r.code);
  assert.ok(pair, `a pairing code: ${r.code}`);
  assert.equal(pair.check, (await api('/api/remote-control')).json.check.replace(/-/g, ''), 'it carries the check code shown here');
  assert.ok(!JSON.stringify((await api('/api/remote-control')).json).includes(JSON.parse(fs.readFileSync(STATE, 'utf8')).remoteControl.relay.key), 'the key never reaches the page');

  // The guest (this same Docket): a pairing code with the wrong check code is refused, and nothing is saved.
  const wrong = await api('/api/remote-desks', { name: 'Fake', address: `${pair.room}${'0'.repeat(16)}` });
  assert.equal(wrong.status, 400);
  assert.match(wrong.json.error, /not the one that pairing code is from/);
  const rd = (await api('/api/remote-desks', { name: 'Office PC', address: r.code.toLowerCase().replace(/-/g, ' ') })).json;
  assert.ok(rd?.id && rd.relay, 'added as a relay desk');
  assert.equal(rd.address, 'through the Docket relay');
  const saved = await waitFor('the remote desk to be saved', async () => JSON.parse(fs.readFileSync(STATE, 'utf8')).remoteDesks?.find((d) => d.id === rd.id));
  assert.equal(saved.room, pair.room);
  assert.ok(saved.pin && saved.cert && !saved.address, 'the room and the certificate; no address');

  // A wrong code is refused; the right one connects at once, with no Allow card.
  const bad = await api(`/api/remote-desks/${rd.id}/connect`, { code: '000000' });
  assert.equal(bad.status, 400);
  assert.match(bad.json.error, /code is not right/);
  const v = (await api(`/api/remote-desks/${rd.id}/connect`, { code: nextCode() })).json;
  assert.equal(v.connected, true, JSON.stringify(v));
  assert.deepEqual(v.desks.map((d) => d.id), ['t1', 't2'], 'the added desks, not t3');
  assert.deepEqual((await api('/api/remote-control')).json.asks, [], 'nobody had to click Allow');
  const here = (await api('/api/remote-control')).json.connections.find((c) => c.relay);
  assert.ok(here, 'the host lists the relay connection');
  assert.equal(here.ip, 'relay');

  // The desks work through it as on the office network, each on its own tab: sessions, a session started, a desk not added refused.
  const tab = `${rd.id}-t2`;
  const shown = async () => { const x = (await api(`/api/sessions?client=${tab}`)).json; return [...(x.live || []), ...(x.history || [])].map((s) => s.id).sort(); };
  const own = async (d) => { const x = (await api(`/api/sessions?client=${d}`)).json; return [...(x.live || []), ...(x.history || [])].map((s) => s.id).sort(); };
  assert.deepEqual(await shown(), await own('t2'), 't2\'s sessions');
  const started = (await api('/api/sessions', { client: tab, text: 'through the relay', engine: 'grok', settings: { permissionMode: 'bypassPermissions' } })).json;
  assert.ok(started?.id, 'a session started through the relay');
  assert.equal(started.client, tab, 'it is on the tab it was started from');
  assert.ok((await own('t2')).includes(started.id), 'and on t2 there');
  await waitFor('it to answer', async () => (await api(`/api/sessions/${started.id}/events`)).json?.events?.some((e) => e.k === 'text'));
  assert.equal((await api(`/api/sessions?client=${rd.id}-t3`)).status, 403);

  // Both sides keep it in the data folder: the guest its token, the host only the token's hash.
  const conn = savedConns().find((c) => c.id === rd.id);
  assert.ok(conn?.token, 'the guest side is saved');
  const hostRows = JSON.parse(fs.readFileSync(path.join(tmp, 'data', 'relay-tokens.json'), 'utf8'));
  assert.equal(hostRows.length, 1);
  assert.notEqual(hostRows[0].key, conn.token, 'the host keeps a hash, never the token');

  // Desks > Manage hides one remote desk tab on this computer only (#1106), with the desk list here sent as it was.
  const deskList = async () => (await api('/api/clients/edit')).json.map(({ id, name, home, folder, grokHome, defaultEngine }) => ({ id, name, home, folder, grokHome, defaultEngine }));
  const hiddenTabs = async () => (await api('/api/clients')).json.filter((c) => c.remote?.id === rd.id && c.hidden).map((c) => c.id);
  assert.equal((await api('/api/clients/edit', { clients: await deskList(), remoteHidden: { [`${rd.id}-t1`]: true, 'nope-t1': true } })).status, 200);
  assert.deepEqual(await hiddenTabs(), [`${rd.id}-t1`], 'that tab is hidden here');
  assert.deepEqual(JSON.parse(fs.readFileSync(STATE, 'utf8')).remoteHidden, [`${rd.id}-t1`], 'kept on this computer, an unknown tab left out');
  assert.equal((await api('/api/remote-control')).json.desks.length, 2, 'nothing changes on the other computer');

  // A restart: the setup menu is hidden again, but the relay, the connection and the remote desk tabs carry on with no new code.
  server.kill(); await new Promise((res) => server.once('exit', res));
  await startDocket();
  await waitFor('the connection to come back', async () => { const x = (await api('/api/remote-desks')).json; return Array.isArray(x) && x.find((d) => d.id === rd.id && d.connected); }, 30000);
  const told = await pageTold();
  assert.equal(told.on, false, 'the menu is hidden again, as on every start');
  assert.equal(told.live, true, 'but the relay part runs, so the page keeps its remote desk tabs');
  assert.equal((await api('/api/remote-control')).json.on, false, 'the office network part is hidden again, as on every start');
  assert.equal((await api('/api/remote-control')).json.relay.on, true, 'Reach from anywhere stays on');
  assert.deepEqual((await api('/api/clients')).json.filter((c) => c.remote?.id === rd.id).map((c) => c.id), [`${rd.id}-t1`, tab], 'the tabs are there');
  assert.deepEqual(await shown(), await own('t2'), 'its sessions, read through the relay after the restart');
  assert.deepEqual(await hiddenTabs(), [`${rd.id}-t1`], 'the hidden tab stays hidden across the restart and the desk list sent again');
  await api('/api/clients/edit', { clients: await deskList(), remoteHidden: { [`${rd.id}-t1`]: false } });
  assert.deepEqual(await hiddenTabs(), [], 'Show brings it back');
  // Disconnect on the host ends it on the guest too.
  const id = (await api('/api/remote-control')).json.connections.find((c) => c.relay).id;
  await api('/api/remote-control/disconnect', { id });
  await waitFor('the guest to hear', async () => !(await api('/api/remote-desks')).json.find((d) => d.id === rd.id).connected);
  assert.deepEqual(savedConns(), [], 'and nothing is kept of it');

  // Reach from anywhere off: the guest is told plainly.
  await api('/api/remote-control/relay', { on: false });
  const off = await api(`/api/remote-desks/${rd.id}/connect`, { code: nextCode() });
  assert.equal(off.status, 502);
  assert.match(off.json.error, /not reachable through the Docket relay/);
  await api(`/api/remote-desks/${rd.id}/remove`, {});
});
