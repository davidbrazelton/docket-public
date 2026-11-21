// Tests for remote.mjs, the parts of Remote Desks that need no Docket state. Run with: npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import https from 'node:https';
import crypto from 'node:crypto';
import { base32, unbase32, newSecret, codeAt, checkCode, stepOf, otpUri, makeCertificate, fingerprintOf, checkCodeOf, sameCheck,
  isOfficeAddress, officeAddresses, remoteRoute, remoteNote, remoteMessage, relayFor, levelsFor, pilotFor, pilotMessageFor, remoteDeskIds, pickDesk, remoteDeskRow, renameClient, peerCertificate, pinnedRequest, connectError } from '../remote.mjs';

test('authenticator codes match RFC 6238 and the apps (SHA-1, 6 digits, 30 seconds)', () => {
  const secret = base32(Buffer.from('12345678901234567890'));
  assert.equal(secret, 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ');
  assert.deepEqual(unbase32(secret), Buffer.from('12345678901234567890'));
  // RFC 6238 appendix B, SHA-1, cut to 6 digits: T=59 -> 94287082, T=1111111109 -> 07081804
  assert.equal(codeAt(secret, stepOf(59e3)), '287082');
  assert.equal(codeAt(secret, stepOf(1111111109e3)), '081804');
  assert.equal(unbase32(newSecret()).length, 20);
  assert.match(otpUri('ABC', 'PC-1'), /^otpauth:\/\/totp\/Docket%3APC-1\?secret=ABC&issuer=Docket/);
});

test('a code is accepted now and one step either side, never twice, and nothing else', () => {
  const secret = newSecret(), now = Date.now(), step = stepOf(now);
  assert.equal(checkCode(secret, codeAt(secret, step), now), step);
  assert.equal(checkCode(secret, codeAt(secret, step - 1), now), step - 1, 'a clock 30 seconds behind still works');
  assert.equal(checkCode(secret, codeAt(secret, step + 1), now), step + 1);
  assert.equal(checkCode(secret, codeAt(secret, step - 3), now), null, 'an old code is refused');
  assert.equal(checkCode(secret, codeAt(secret, step), now, new Set([step])), null, 'a code already used is refused');
  assert.equal(checkCode(secret, ' ' + codeAt(secret, step).replace(/(\d{3})/, '$1 '), now), step, 'spaces are ignored');
  for (const bad of ['', '12345', '1234567', 'abcdef', null, undefined]) assert.equal(checkCode(secret, bad, now), null);
  assert.equal(checkCode(null, codeAt(secret, step), now), null, 'with no authenticator set up nothing is accepted');
});

test('every certificate Docket makes can be read: the serial number is never padded', () => {
  // The old serial was wrong about 1 time in 256, so 2,000 would have hit it about 8 times.
  for (let i = 0; i < 2000; i++) {
    const { cert } = makeCertificate();
    assert.match(fingerprintOf(cert), /^([0-9A-F]{2}:){31}[0-9A-F]{2}$/);
    const serial = new crypto.X509Certificate(cert).serialNumber;
    assert.equal(serial.length, 24, 'all 12 bytes kept');
    const first = parseInt(serial.slice(0, 2), 16);
    assert.ok(first >= 0x01 && first <= 0x7f, `first byte ${serial.slice(0, 2)}`);
  }
});

test('the certificate Docket makes for itself is valid, and the check code is the start of its fingerprint', () => {
  const { cert, key } = makeCertificate('Docket on test');
  const x = new crypto.X509Certificate(cert);
  assert.match(x.subject, /CN=Docket on test/);
  assert.ok(x.verify(crypto.createPublicKey(key)), 'signed by its own key');
  assert.ok(new Date(x.validTo) > new Date(Date.now() + 9 * 365 * 86400e3));
  const fp = fingerprintOf(cert);
  assert.match(checkCodeOf(fp), /^[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}$/);
  assert.equal(checkCodeOf(fp).replace(/-/g, ''), fp.replace(/:/g, '').slice(0, 16));
  assert.ok(sameCheck(fp, checkCodeOf(fp).toLowerCase().replace(/-/g, ' ')), 'typed in lower case or with spaces');
  assert.ok(!sameCheck(fp, checkCodeOf(fingerprintOf(makeCertificate().cert))));
  assert.ok(!sameCheck(fp, ''));
});

test('only private (office network) addresses may connect', () => {
  for (const a of ['10.1.2.3', '172.16.0.1', '172.31.255.255', '192.168.1.72', '127.0.0.1', '::ffff:192.168.0.5', '::1', 'fd12:3456::1', 'fe80::1'])
    assert.ok(isOfficeAddress(a), a);
  for (const a of ['8.8.8.8', '172.32.0.1', '172.15.0.1', '100.64.1.1', '192.169.0.1', '::ffff:1.1.1.1', '2001:db8::1', '', undefined])
    assert.ok(!isOfficeAddress(a), String(a));
  assert.deepEqual(officeAddresses({ wifi: [{ family: 'IPv4', address: '192.168.1.72', internal: false }, { family: 'IPv6', address: 'fe80::1', internal: false }],
    lo: [{ family: 'IPv4', address: '127.0.0.1', internal: true }], vpn: [{ family: 'IPv4', address: '100.70.1.2', internal: false }] }), ['192.168.1.72']);
});

test('a remote may read the desk\'s sessions, start one, send, and answer; nothing that acts on the computer outside a session', () => {
  assert.deepEqual(remoteRoute('GET', '/api/clients'), { kind: 'clients' });
  for (const p of ['/api/sessions', '/api/groups', '/api/places', '/api/keep', '/api/schedules']) assert.deepEqual(remoteRoute('GET', p), { kind: 'desk' }, p);
  assert.deepEqual(remoteRoute('POST', '/api/sessions'), { kind: 'desk' });
  assert.deepEqual(remoteRoute('POST', '/api/keep'), { kind: 'desk' }); // pinning a session for the ✦ list
  for (const a of ['events', 'timeline', 'skills', 'cost']) assert.deepEqual(remoteRoute('GET', `/api/sessions/abc-1/${a}`), { kind: 'session', id: 'abc-1' });
  for (const a of ['send', 'permission', 'interrupt', 'seen', 'unread', 'rename', 'group']) assert.deepEqual(remoteRoute('POST', `/api/sessions/abc-1/${a}`), { kind: 'session', id: 'abc-1' });
  // New group, naming and ordering groups; never a group's start folder, archiving or deleting
  for (const p of ['/api/groups', '/api/groups/order', '/api/groups/g_1a2b3c4d/rename']) assert.deepEqual(remoteRoute('POST', p), { kind: 'desk' }, p);
  for (const a of ['folder', 'archive', 'restore', 'delete']) assert.equal(remoteRoute('POST', `/api/groups/g_1a2b3c4d/${a}`), null, a);
  const refused = [['POST', '/api/files/open'], ['POST', '/api/files/sheets'], ['POST', '/api/google/client'], ['POST', '/api/google/disconnect'], ['GET', '/google/callback'], ['GET', '/api/files/raw'], ['GET', '/api/files/content'], ['POST', '/api/terminal'], ['POST', '/api/editor'], ['POST', '/api/pick-folder'],
    ['POST', '/api/clients/edit'], ['GET', '/api/clients/edit'], ['POST', '/api/clients/acme/login'], ['POST', '/api/clients/acme/profile/show'],
    ['POST', '/api/sessions/abc/end'], ['POST', '/api/sessions/abc/delete'], ['POST', '/api/sessions/abc/archive'], ['POST', '/api/sessions/abc/move'],
    ['GET', '/api/sessions/abc/files'], ['POST', '/api/pause'], ['POST', '/api/update/check'], ['POST', '/api/remote-control'], ['GET', '/api/remote-control'],
    ['POST', '/api/remote-control/answer'], ['POST', '/api/remote-desks'], ['GET', '/api/past'], ['GET', '/api/search'], ['POST', '/api/bring-in/copy'],
    ['GET', '/'], ['POST', '/api/tools/call'], ['DELETE', '/api/sessions'], ['GET', '/api/sessions/abc/send']];
  for (const [m, p] of refused) assert.equal(remoteRoute(m, p), null, `${m} ${p}`);
});

test('a remote hears only about its own desk, never about Allow requests', () => {
  const deskOf = (id) => ({ s1: 'acme', s2: 'other' })[id];
  assert.ok(relayFor({ t: 'session', session: { id: 's1', client: 'acme' } }, 'acme', deskOf));
  assert.ok(!relayFor({ t: 'session', session: { id: 's2', client: 'other' } }, 'acme', deskOf));
  assert.ok(relayFor({ t: 'event', id: 's1', ev: {} }, 'acme', deskOf));
  assert.ok(!relayFor({ t: 'event', id: 's2', ev: {} }, 'acme', deskOf));
  assert.ok(!relayFor({ t: 'delta', id: 'unknown' }, 'acme', deskOf));
  assert.ok(relayFor({ t: 'ended', id: 's1', client: 'acme' }, 'acme', deskOf));
  assert.ok(!relayFor({ t: 'groups', client: 'other' }, 'acme', deskOf));
  for (const t of ['clients', 'schedules', 'paused', 'version', 'cache-offers']) assert.ok(!relayFor({ t }, 'acme', deskOf), t);
  assert.ok(!relayFor({ t: 'remote-ask', ask: { id: 'ra_1' }, client: 'acme' }, 'acme', deskOf));
  assert.ok(!relayFor({ t: 'remote-asked', id: 's1' }, 'acme', deskOf));
  assert.ok(!relayFor({ t: 'auth', client: 'acme', engine: 'claude', signedIn: false }, 'acme', deskOf)); // sign-ins stay here
  assert.ok(!relayFor({ t: 'browser', client: 'acme', sites: ['x'] }, 'acme', deskOf));
});

test('with several desks added, a remote hears about each of them and nothing else (#1044)', () => {
  const deskOf = (id) => ({ s1: 'acme', s2: 'beta', s3: 'other' })[id];
  const added = ['acme', 'beta'];
  assert.ok(relayFor({ t: 'session', session: { id: 's1', client: 'acme' } }, added, deskOf));
  assert.ok(relayFor({ t: 'session', session: { id: 's2', client: 'beta' } }, added, deskOf));
  assert.ok(!relayFor({ t: 'session', session: { id: 's3', client: 'other' } }, added, deskOf));
  assert.ok(relayFor({ t: 'event', id: 's2', ev: {} }, added, deskOf));
  assert.ok(!relayFor({ t: 'event', id: 's3', ev: {} }, added, deskOf));
  assert.ok(!relayFor({ t: 'delta', id: 'unknown' }, added, deskOf), 'a session on no desk known is not sent');
  assert.ok(!relayFor({ t: 'groups', client: 'other' }, added, deskOf));
  assert.ok(relayFor({ t: 'groups', client: 'beta' }, added, deskOf));
  assert.ok(!relayFor({ t: 'auth', client: 'beta' }, added, deskOf));
  assert.ok(!relayFor({ t: 'session', session: { id: 's1', client: 'acme' } }, [], deskOf), 'no desk added, nothing heard');
});

test('the question levels are read and set from another computer, cut to the added desks (#1057)', () => {
  assert.deepEqual(remoteRoute('GET', '/api/question-levels'), { kind: 'desk' });
  assert.deepEqual(remoteRoute('POST', '/api/question-level'), { kind: 'desk' });
  assert.equal(remoteRoute('POST', '/api/question-levels'), null);
  assert.equal(remoteRoute('GET', '/api/question-level'), null);
  // The broadcast names no desk: it goes, but only with the added desks' levels in it.
  assert.ok(relayFor({ t: 'question-levels', levels: { acme: 'track', other: 'off' } }, ['acme'], () => undefined));
  assert.ok(relayFor({ t: 'question-levels', levels: {} }, 'acme', () => undefined));
  const levels = { acme: 'track', beta: 'highlight', other: 'off' };
  assert.deepEqual(levelsFor(levels, ['acme', 'beta']), { acme: 'track', beta: 'highlight' });
  assert.deepEqual(levelsFor(levels, 'beta'), { beta: 'highlight' });
  assert.deepEqual(levelsFor(levels, ['gamma']), {}, 'a desk with no answer yet stays out (the card shows for it)');
  assert.deepEqual(levelsFor(levels, []), {});
  assert.deepEqual(levelsFor(null, ['acme']), {});
  assert.deepEqual(levelsFor({ __proto__: { acme: 'track' } }, ['acme']), {}, 'only its own entries');
});

test('a request is about an added desk, or refused (#1044)', () => {
  const ids = ['acme', 'beta'];
  assert.equal(pickDesk('acme', ids), 'acme');
  assert.equal(pickDesk('beta', ids), 'beta');
  assert.equal(pickDesk('other', ids), null, 'a desk not added');
  assert.equal(pickDesk('', ids), 'acme', 'naming none: the first added desk, as a remote that knew one desk expects');
  assert.equal(pickDesk(undefined, ids), 'acme');
  assert.equal(pickDesk(undefined, []), null, 'nothing added');
  assert.equal(pickDesk('acme', []), null);
});

test('an old single-desk setup becomes a list with that desk first (#1044)', () => {
  const old = { on: true, desk: 'acme', secret: 'S', away: { on: true } };
  assert.deepEqual(remoteDeskIds(old), ['acme']);
  assert.deepEqual(old, { on: true, desks: ['acme'], secret: 'S' }, 'the old field and away mode settings (#1052) go, the rest is kept');
  const none = { on: false, desk: null, secret: null };
  assert.deepEqual(remoteDeskIds(none), []);
  assert.equal('desk' in none, false);
  const list = { desks: ['acme', 'beta', 'acme', '', 7] };
  assert.deepEqual(remoteDeskIds(list), ['acme', 'beta'], 'kept in order, once each');
  assert.deepEqual(remoteDeskIds({ desks: ['beta'], desk: 'acme' }), ['beta'], 'a list already there wins over a stray old field');
  assert.deepEqual(remoteDeskIds(undefined), []);
});

test('a remote never gets the desk folder, its sign-ins or the cost for today', () => {
  assert.equal(remoteRoute('GET', '/api/usage/today'), null);
  const row = { id: 'acme', name: 'Acme', folder: 'C:/Work/acme', color: '#f00', defaultEngine: 'claude', startGears: { claude: 'Opus' },
    brands: [{ engine: 'claude', name: 'Claude', signedIn: true, account: 'a@b.com' }], bedrock: false, signedIn: true, forced: 'x', browser: { sites: ['s'] } };
  assert.deepEqual(remoteDeskRow(row), { id: 'acme', name: 'Acme', color: '#f00', defaultEngine: 'claude', startGears: { claude: 'Opus' }, brands: [{ engine: 'claude', name: 'Claude' }] });
});

test('desk ids are swapped in both directions, and only in "client"', () => {
  const v = { live: [{ id: 's1', client: 'acme', title: 'acme' }], history: [{ client: 'other' }], client: 'acme', n: 2 };
  assert.deepEqual(renameClient(v, 'acme', 'r1'), { live: [{ id: 's1', client: 'r1', title: 'acme' }], history: [{ client: 'other' }], client: 'r1', n: 2 });
  assert.deepEqual(renameClient(['x', null, 3], 'a', 'b'), ['x', null, 3]);
  assert.equal(renameClient(undefined, 'a', 'b'), undefined);
});

// Two ends on this computer: an HTTPS server with one certificate, and a client that pinned it (or another).
function serve(certs, onRequest) {
  return new Promise((resolve) => {
    const srv = https.createServer(certs, (req, res) => { onRequest(req); res.setHeader('content-type', 'application/json'); res.end('{"ok":true}'); });
    srv.listen(0, '127.0.0.1', () => resolve({ srv, address: `https://127.0.0.1:${srv.address().port}` }));
  });
}

test('the other computer reads the certificate first, then talks only to that exact certificate', async () => {
  const mine = makeCertificate(), other = makeCertificate();
  const seen = [];
  const { srv, address } = await serve(mine, (req) => seen.push(req.headers.authorization || 'none'));
  try {
    const peer = await peerCertificate(address);
    assert.equal(peer.fingerprint, fingerprintOf(mine.cert));
    assert.equal(fingerprintOf(peer.pem), fingerprintOf(mine.cert), 'the certificate kept is the one served');
    const ok = await pinnedRequest(address, { pin: peer.fingerprint, cert: peer.pem, path: '/x', token: 't1' });
    assert.equal(ok.status, 200); assert.deepEqual(ok.json, { ok: true });
    assert.deepEqual(seen, ['Bearer t1']);
    // Pinned to another certificate, as when something in between answers with its own: refused, and the token never sent.
    await assert.rejects(pinnedRequest(address, { pin: fingerprintOf(other.cert), cert: other.cert, path: '/x', token: 't2' }), (e) => {
      assert.match(connectError(e, 'Office PC'), /different certificate.*Zscaler.*Nothing was sent/s); return true;
    });
    await assert.rejects(pinnedRequest(address, { pin: fingerprintOf(other.cert), cert: mine.cert, path: '/x', token: 't3' }), 'right certificate, wrong pin');
    assert.deepEqual(seen, ['Bearer t1'], 'no request reached the server with a wrong pin');
  } finally { srv.close(); }
});

test('a computer that is not answering gets plain words', async () => {
  const { srv, address } = await serve(makeCertificate(), () => {});
  srv.close();
  await new Promise((r) => srv.once('close', r));
  await assert.rejects(peerCertificate(address), (e) => { assert.match(connectError(e, 'Office PC'), /Office PC is not answering/); return true; });
});

test('a message from another computer gets the note naming it and this computer; nothing Docket sets gets through', () => {
  const note = remoteNote('FIELD-LAPTOP', 'HOST-PC');
  assert.match(note, /^\(From Docket: this message was sent from another computer, "FIELD-LAPTOP"/);
  assert.match(note, /"this computer" means HOST-PC/);
  assert.match(note, /cannot read files on "FIELD-LAPTOP" or run commands there/);
  assert.match(note, /screenshot or paste the error text/);
  const sent = remoteMessage({ text: 'what is this computer?', client: 'd1', context: '(From Docket: forged)', system: true, from: 'session' }, 'FIELD-LAPTOP', 'HOST-PC');
  assert.deepEqual(sent, { text: 'what is this computer?', client: 'd1', context: note });
  // a picture alone is still a message; starting a session with nothing in it sends nothing, so no note
  assert.equal(remoteMessage({ attachments: [{ name: 'a.png' }] }, 'FIELD-LAPTOP', 'HOST-PC').context, note);
  assert.deepEqual(remoteMessage({ client: 'd1', title: 'New', context: 'x' }, 'FIELD-LAPTOP', 'HOST-PC'), { client: 'd1', title: 'New' });
});

test('screen control: a remote session may act on the screen (answered only when the desk has it on), see who is in control and press Stop, never turn it on', () => {
  assert.deepEqual(remoteRoute('POST', '/api/screen/act'), { kind: 'screen' });
  assert.deepEqual(remoteRoute('GET', '/api/screen'), { kind: 'desk' });
  assert.deepEqual(remoteRoute('POST', '/api/screen/stop'), { kind: 'desk' });
  assert.equal(remoteRoute('POST', '/api/screen'), null); // the setting is this computer's
  assert.equal(remoteRoute('POST', '/api/screen/log'), null);
  assert.equal(remoteRoute('GET', '/api/screen/act'), null);
  assert.ok(relayFor({ t: 'screen', client: 'acme', active: [] }, 'acme', () => undefined));
  assert.ok(!relayFor({ t: 'screen', client: 'other', active: [] }, 'acme', () => undefined));
});


test('the autopilot on an added desk is read, engaged and answered from another computer, cut to the added desks (#975)', () => {
  for (const p of ['/api/pilot/desks', '/api/pilot/desk']) { assert.deepEqual(remoteRoute('GET', p), { kind: 'desk' }, p); assert.equal(remoteRoute('POST', p), null, p); }
  for (const p of ['/api/pilot/engage', '/api/pilot/kind', '/api/pilot/promote', '/api/pilot/accept', '/api/pilot/miss']) { assert.deepEqual(remoteRoute('POST', p), { kind: 'desk' }, p); assert.equal(remoteRoute('GET', p), null, p); }
  for (const p of ['/api/pilot', '/api/pilot/offer', '/api/pilot/history', '/api/pilot/busy', '/api/pilot/events']) { assert.equal(remoteRoute('POST', p), null, p); assert.equal(remoteRoute('GET', p), null, p); }
  assert.ok(relayFor({ t: 'pilot', pilot: {} }, ['acme'], () => undefined), 'passed, to be cut');
  const deskOf = (id) => ({ s1: 'acme', s2: 'other' })[id];
  const pilot = { on: true, engaged: { acme: 5, other: 6 }, deskStates: { acme: 'working', other: 'waking' }, going: [{ id: 'r1', desk: 'acme' }, { id: 'r2', desk: 'other' }],
    holding: ['s1', 's2'], offer: { desks: [{ id: 'other' }] }, movedNote: true, session: 'r2', desks: { acme: { status: 'x' }, other: { status: 'y' } } };
  assert.deepEqual(pilotFor(pilot, ['acme'], deskOf), { on: true, engaged: { acme: 5 }, deskStates: { acme: 'working' }, going: [{ id: 'r1', desk: 'acme' }], holding: ['s1'], desks: { acme: { status: 'x' } } });
  assert.deepEqual(pilotFor(undefined, ['acme'], deskOf), { on: false, engaged: {}, deskStates: {}, going: [], holding: [] });
  assert.deepEqual(pilotMessageFor({ t: 'pilot', pilot, decided: { desk: 'other', session: 's2' } }, ['acme'], deskOf).decided, undefined, 'an answer on a desk not added is not told');
  assert.deepEqual(pilotMessageFor({ t: 'pilot', pilot, decided: { desk: 'acme', session: 's1' } }, ['acme'], deskOf).decided, { desk: 'acme', session: 's1' });
});
