// Tests for Remote Desks through the Docket relay (#1052): the relay's pairing rules (relay/desks/pairing.mjs), the
// pairing code, and the pinned TLS the two Dockets speak through the relay's stand-in (relay/desks/local.mjs), so the
// relay passes only ciphertext and cannot pass itself off as the host. Run with: npm test
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import https from 'node:https';
import WebSocket, { WebSocketServer } from 'ws';
import { makeCertificate, fingerprintOf, checkCodeOf, sameCheck, pinnedRequest, relayRoom, newRelayKey, pairingCode, parsePairingCode,
  relayGuestUrl, relayHostUrl, relayTls, relayPeerCertificate, relayAgent, relayHost, relayError } from '../remote.mjs';
import { LIMITS, roomOfKey, routeOf, hostOwns, guestRefusal, newChan, isChan } from '../relay/desks/pairing.mjs';
import { startRelay } from '../relay/desks/local.mjs';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function waitFor(what, fn, ms = 10000) {
  const until = Date.now() + ms;
  for (;;) { const v = await fn(); if (v) return v; if (Date.now() > until) throw new Error('Timed out waiting for ' + what); await sleep(50); }
}

test('the room is worked out from the host key the same way in Docket and in the relay', async () => {
  for (let i = 0; i < 20; i++) {
    const key = newRelayKey();
    assert.match(key, /^[0-9a-f]{64}$/);
    assert.equal(relayRoom(key), await roomOfKey(key));
    assert.match(relayRoom(key), /^[A-Z2-7]{16}$/);
  }
  assert.notEqual(relayRoom(newRelayKey()), relayRoom(newRelayKey()));
});

test('the pairing code is the room and the check code; it reads back however it is pasted', () => {
  const key = newRelayKey(), fp = fingerprintOf(makeCertificate().cert), room = relayRoom(key);
  const code = pairingCode(room, fp);
  assert.match(code, /^([A-Z0-9]{4}-){7}[A-Z0-9]{4}$/);
  assert.ok(!code.includes(key) && !code.toLowerCase().includes(key.slice(0, 16)), 'the key itself never shows');
  const back = parsePairingCode(code);
  assert.equal(back.room, room);
  assert.ok(sameCheck(fp, back.check), 'it carries the check code of the host certificate');
  assert.deepEqual(parsePairingCode(` ${code.toLowerCase().replace(/-/g, ' ')}\n`), back, 'lower case, spaces, a new line');
  for (const bad of ['', 'abc', code.slice(0, -1), code + 'A', code.replace(/^./, '1'), `${room}${'G'.repeat(16)}`, '192.168.1.20:4402', null])
    assert.equal(parsePairingCode(bad), null, String(bad));
  assert.equal(checkCodeOf(fp).replace(/-/g, ''), back.check);
});

test('the relay takes only its own paths: a guest names a room, a host also its key', async () => {
  const key = newRelayKey(), room = relayRoom(key), chan = newChan();
  assert.ok(isChan(chan));
  assert.deepEqual(routeOf(`/v1/rooms/${room}/guest`), { room, role: 'guest' });
  assert.deepEqual(routeOf(`/v1/rooms/${room}/host?key=${key}`), { room, role: 'host', key, chan: '' });
  assert.deepEqual(routeOf(`/v1/rooms/${room}/host?key=${key}&chan=${chan}`), { room, role: 'host', key, chan });
  assert.deepEqual(new URL(relayHostUrl('https://relay.docket.center', key, chan)).pathname, `/v1/rooms/${room}/host`);
  assert.equal(relayGuestUrl('https://relay.docket.center/', room), `wss://relay.docket.center/v1/rooms/${room}/guest`);
  assert.equal(relayGuestUrl('http://localhost:4490', room), `ws://localhost:4490/v1/rooms/${room}/guest`);
  for (const bad of [`/v1/rooms/${room.toLowerCase()}/guest`, `/v1/rooms/${room}/guest?key=${key}`, `/v1/rooms/${room}/host`, `/v1/rooms/${room}/host?key=abc`,
    `/v1/rooms/${room}/host?key=${key}&chan=zz`, `/v1/rooms/${room}/other`, '/', `/v1/rooms/${room}x/guest`])
    assert.equal(routeOf(bad), null, bad);
  assert.ok(await hostOwns(routeOf(`/v1/rooms/${room}/host?key=${key}`)));
  assert.ok(!(await hostOwns(routeOf(`/v1/rooms/${room}/host?key=${newRelayKey()}`))), 'only the key that owns the room may answer in it');
  assert.ok(!(await hostOwns(routeOf(`/v1/rooms/${room}/guest`))));
});

test('the relay limits guests per room: none without the host, a few at once, a few a minute', () => {
  const opens = [];
  assert.equal(guestRefusal({ hostThere: false, opens, channels: 0 }), 'no-host');
  assert.equal(opens.length, 0, 'a refusal is not counted');
  const now = Date.now();
  for (let i = 0; i < LIMITS.opensPerMinute; i++) assert.equal(guestRefusal({ hostThere: true, opens, channels: 0, now }), '');
  assert.equal(guestRefusal({ hostThere: true, opens, channels: 0, now }), 'busy');
  assert.equal(guestRefusal({ hostThere: true, opens, channels: 0, now: now + 61e3 }), '', 'a minute later');
  assert.equal(guestRefusal({ hostThere: true, opens: [], channels: LIMITS.channels }), 'busy');
});

test('relay failures get plain words', () => {
  assert.match(relayError(new Error('Unexpected server response: 409'), 'Office PC'), /Office PC is not reachable.*Reach from anywhere is off/);
  assert.match(relayError(new Error('Unexpected server response: 429')), /busy/);
  assert.match(relayError(Object.assign(new Error('x'), { code: 'PIN_MISMATCH' })), /not the one this remote desk was paired with/);
  assert.match(relayError(Object.assign(new Error('getaddrinfo ENOTFOUND relay.docket.center'), { code: 'ENOTFOUND' })), /Could not reach the Docket relay/);
});

// ---------- through the relay's stand-in ----------
let relay, RELAY, host, hostCert, other;
const KEY = newRelayKey(), ROOM = relayRoom(KEY);
const seen = []; // what passed through the relay, to check it is never readable
before(async () => {
  relay = await startRelay(0);
  RELAY = `http://127.0.0.1:${relay.port}`;
  hostCert = makeCertificate('Docket on host');
  other = makeCertificate('Docket on another');
  // The host: HTTPS served on each stream the relay hands it, never on a port.
  const srv = https.createServer(hostCert, (req, res) => {
    const chunks = []; req.on('data', (c) => chunks.push(c));
    req.on('end', () => { res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify({ path: req.url, method: req.method, body: Buffer.concat(chunks).toString(), secret: 'only-for-the-guest' })); });
  });
  const wss = new WebSocketServer({ noServer: true });
  srv.on('upgrade', (req, socket, head) => wss.handleUpgrade(req, socket, head, (ws) => ws.on('message', (d) => ws.send(`echo ${d}`))));
  let state = {};
  host = relayHost({ relay: RELAY, key: KEY, onStream: (s) => { s.on('data', (d) => seen.push(Buffer.from(d))); srv.emit('connection', s); }, onState: (s) => { state = s; } });
  host.state = () => state;
  await waitFor('the host to reach the relay', async () => state.connected);
});
after(async () => { host?.close(); await relay?.close(); });

test('the guest reads the host certificate through the relay, then requests go only to that certificate', async () => {
  const peer = await relayPeerCertificate(RELAY, ROOM);
  assert.equal(peer.fingerprint, fingerprintOf(hostCert.cert));
  assert.ok(sameCheck(peer.fingerprint, parsePairingCode(pairingCode(ROOM, fingerprintOf(hostCert.cert))).check), 'the pairing code checks out');
  const agent = relayAgent(RELAY, ROOM, peer.fingerprint, peer.pem);
  const call = (method, p, body) => pinnedRequest('https://docket-relay', { pin: peer.fingerprint, cert: peer.pem, method, path: p, body, agent });
  const r = await call('POST', '/api/sessions/abc/send', { text: 'hello through the relay' });
  assert.equal(r.status, 200);
  assert.deepEqual(r.json.path, '/api/sessions/abc/send');
  assert.match(r.json.body, /hello through the relay/);
  for (let i = 0; i < 5; i++) assert.equal((await call('GET', `/api/sessions?i=${i}`)).json.path, `/api/sessions?i=${i}`);
  const opens = relay.rooms.get(ROOM).opens.length;
  for (let i = 0; i < 5; i++) await call('GET', `/api/clients?i=${i}`);
  assert.equal(relay.rooms.get(ROOM).opens.length, opens, 'the kept-open connection is reused, not one per request');
  // The relay passed only ciphertext: neither the message nor the answer can be read in it.
  const passed = Buffer.concat(seen).toString('latin1');
  assert.ok(passed.length > 0);
  assert.ok(!passed.includes('hello through the relay') && !passed.includes('only-for-the-guest') && !passed.includes('/api/sessions'));
  agent.destroy();
});

test('live updates run through the relay too, inside the same pinned TLS', async () => {
  const peer = await relayPeerCertificate(RELAY, ROOM);
  const ws = new WebSocket('wss://docket-relay/remote/ws', { createConnection: () => relayTls(RELAY, ROOM, peer.fingerprint, peer.pem) });
  await new Promise((r, j) => { ws.on('open', r); ws.on('error', j); });
  const got = new Promise((r) => ws.once('message', (d) => r(String(d))));
  ws.send('ping 1');
  assert.equal(await got, 'echo ping 1');
  ws.close();
});

test('a relay (or anyone) answering with another certificate is refused before anything is sent', async () => {
  // A stand-in for a relay that tries to pass itself off as the host: it answers in the room with its own certificate.
  const KEY2 = newRelayKey(), ROOM2 = relayRoom(KEY2);
  const fake = https.createServer(other, (req, res) => { seenByFake.push(req.url); res.end('{}'); });
  const seenByFake = [];
  const h2 = relayHost({ relay: RELAY, key: KEY2, onStream: (s) => fake.emit('connection', s) });
  try {
    await waitFor('the second host', async () => relay.rooms.get(ROOM2)?.host?.readyState === 1);
    const pin = fingerprintOf(hostCert.cert); // what the pairing code promised
    const agent = relayAgent(RELAY, ROOM2, pin, hostCert.cert);
    await assert.rejects(pinnedRequest('https://docket-relay', { pin, cert: hostCert.cert, path: '/api/clients', agent }), (e) => /not the one this remote desk was paired with/.test(relayError(e)));
    assert.deepEqual(seenByFake, [], 'no request reached it');
    agent.destroy();
  } finally { h2.close(); }
});

test('a guest knocking on a room with no host, or a host with the wrong key, is refused', async () => {
  const empty = relayRoom(newRelayKey());
  await assert.rejects(relayPeerCertificate(RELAY, empty), (e) => /not reachable through the Docket relay/.test(relayError(e, 'Office PC')));
  const bad = new WebSocket(`ws://127.0.0.1:${relay.port}/v1/rooms/${ROOM}/host?key=${newRelayKey()}`);
  const err = await new Promise((r) => bad.on('error', r));
  assert.match(relayError(err), /refused this computer's key/);
  assert.equal(relay.rooms.get(ROOM).host.readyState, 1, 'the real host keeps its room');
});

test('the host line comes back by itself after the relay drops it', async () => {
  relay.rooms.get(ROOM).host.terminate();
  await waitFor('the line to drop', async () => !host.state().connected);
  await waitFor('the line to come back', async () => host.state().connected && relay.rooms.get(ROOM).host?.readyState === 1, 15000);
  const peer = await relayPeerCertificate(RELAY, ROOM);
  assert.equal(peer.fingerprint, fingerprintOf(hostCert.cert));
});
