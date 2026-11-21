// Remote desks: another computer shows and drives the desks of this Docket added for it (#1044), on the office network
// or from anywhere through the Docket relay (#1052). This file holds the parts that need no Docket state, so
// test/remote.test.mjs and test/desk-relay.test.mjs can try them: the authenticator codes, the certificate this Docket
// makes for itself, the pinned connection the other computer uses, which addresses count as the office network, which
// requests a remote may make, and the relay's pairing code and connections.
import crypto from 'node:crypto';
import https from 'node:https';
import tls from 'node:tls';
import WebSocket, { createWebSocketStream } from 'ws';

// How long a remote connection lasts before the other computer must enter a new code and be allowed again.
export const REMOTE_HOURS = 8;
// How long a connection waits for someone to click Allow on this computer.
export const ASK_WAIT_MS = 2 * 60e3;

// ---------- authenticator codes (TOTP, RFC 6238: Google Authenticator, Microsoft Authenticator) ----------
const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
export function base32(buf) {
  let bits = 0, val = 0, out = '';
  for (const b of buf) { val = (val << 8) | b; bits += 8; while (bits >= 5) { out += B32[(val >>> (bits - 5)) & 31]; bits -= 5; } }
  if (bits > 0) out += B32[(val << (5 - bits)) & 31];
  return out;
}
export function unbase32(s) {
  const clean = String(s).toUpperCase().replace(/[^A-Z2-7]/g, '');
  let bits = 0, val = 0; const out = [];
  for (const ch of clean) { val = (val << 5) | B32.indexOf(ch); bits += 5; if (bits >= 8) { out.push((val >>> (bits - 8)) & 255); bits -= 8; } }
  return Buffer.from(out);
}
export const newSecret = () => base32(crypto.randomBytes(20));
export function codeAt(secret, step) {
  const msg = Buffer.alloc(8); msg.writeBigUInt64BE(BigInt(step));
  const h = crypto.createHmac('sha1', unbase32(secret)).update(msg).digest();
  const o = h[h.length - 1] & 15;
  return String((h.readUInt32BE(o) & 0x7fffffff) % 1e6).padStart(6, '0');
}
export const stepOf = (ms = Date.now()) => Math.floor(ms / 30000);
// The step the code belongs to (this one, or one either side for a clock a little off), or null.
// usedSteps: steps already used, so a code seen once cannot be used again.
export function checkCode(secret, code, ms = Date.now(), usedSteps = new Set()) {
  const c = String(code || '').replace(/\s/g, '');
  if (!secret || !/^\d{6}$/.test(c)) return null;
  const now = stepOf(ms);
  for (const step of [now, now - 1, now + 1]) {
    if (usedSteps.has(step)) continue;
    const want = codeAt(secret, step);
    if (crypto.timingSafeEqual(Buffer.from(want), Buffer.from(c))) return step;
  }
  return null;
}
// What the authenticator app scans.
export const otpUri = (secret, label) =>
  `otpauth://totp/${encodeURIComponent('Docket:' + label)}?secret=${secret}&issuer=Docket&algorithm=SHA1&digits=6&period=30`;

// ---------- this Docket's own certificate, so the connection is encrypted (HTTPS) ----------
// A self-made certificate: nobody vouches for it, so the other computer checks it against the check
// code shown on this computer instead (see pinnedRequest). Made here with Node alone: an EC P-256 key
// and a minimal X.509 certificate.
const der = (tag, body) => {
  const n = body.length;
  const len = n < 128 ? Buffer.from([n]) : n < 256 ? Buffer.from([0x81, n]) : Buffer.from([0x82, n >> 8, n & 255]);
  return Buffer.concat([Buffer.from([tag]), len, body]);
};
const seq = (...parts) => der(0x30, Buffer.concat(parts));
const oid = (s) => {
  const p = s.split('.').map(Number), out = [40 * p[0] + p[1]];
  for (const n of p.slice(2)) { const b = [n & 127]; let v = n >> 7; while (v) { b.unshift((v & 127) | 128); v >>= 7; } out.push(...b); }
  return der(0x06, Buffer.from(out));
};
const utcTime = (d) => der(0x17, Buffer.from(d.toISOString().replace(/[-:T]/g, '').slice(2, 14) + 'Z'));
const ECDSA_SHA256 = '1.2.840.10045.4.3.2';
export function makeCertificate(name = 'Docket remote desk', years = 10) {
  const { privateKey, publicKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  const who = seq(der(0x31, seq(oid('2.5.4.3'), der(0x0c, Buffer.from(name)))));
  // A DER integer must be in its shortest form and positive: a first byte of 0x01 to 0x7f is both
  const serial = crypto.randomBytes(12); serial[0] = 1 + (serial[0] % 0x7f);
  const from = new Date(Date.now() - 86400e3), to = new Date(Date.now() + years * 365 * 86400e3);
  const tbs = seq(der(0xa0, der(0x02, Buffer.from([2]))), der(0x02, serial), seq(oid(ECDSA_SHA256)), who,
    seq(utcTime(from), utcTime(to)), who, publicKey.export({ type: 'spki', format: 'der' }),
    // basicConstraints CA:true, so the other computer can trust exactly this certificate and nothing it signed
    der(0xa3, seq(seq(oid('2.5.29.19'), der(0x01, Buffer.from([0xff])), der(0x04, seq(der(0x01, Buffer.from([0xff]))))))));
  const sig = crypto.sign('sha256', tbs, privateKey);
  const cert = seq(tbs, seq(oid(ECDSA_SHA256)), der(0x03, Buffer.concat([Buffer.from([0]), sig])));
  const pem = (b, label) => `-----BEGIN ${label}-----\n${b.toString('base64').match(/.{1,64}/g).join('\n')}\n-----END ${label}-----\n`;
  return { cert: pem(cert, 'CERTIFICATE'), key: privateKey.export({ type: 'pkcs8', format: 'pem' }) };
}
// The certificate's fingerprint (SHA-256, as Node writes it: AA:BB:...), and the short check code people compare.
export const fingerprintOf = (certPem) => new crypto.X509Certificate(certPem).fingerprint256;
export const checkCodeOf = (fp) => String(fp || '').replace(/:/g, '').slice(0, 16).toUpperCase().match(/.{4}/g)?.join('-') || '';
export const sameCheck = (fp, typed) => {
  const want = checkCodeOf(fp).replace(/-/g, ''), got = String(typed || '').toUpperCase().replace(/[^0-9A-F]/g, '');
  return want.length === 16 && got === want;
};

// ---------- the office network ----------
// Only private addresses may connect: the office network, never the internet. 100.64.0.0/10 (shared and
// VPN ranges) is left out on purpose. Loopback counts, so this computer can test itself.
export function isOfficeAddress(addr) {
  let a = String(addr || '').toLowerCase();
  if (a.startsWith('::ffff:')) a = a.slice(7);
  const m = a.match(/^(\d+)\.(\d+)\.(\d+)\.(\d+)$/);
  if (m) {
    const [x, y] = [Number(m[1]), Number(m[2])];
    return x === 10 || x === 127 || (x === 172 && y >= 16 && y <= 31) || (x === 192 && y === 168);
  }
  return a === '::1' || /^f[cd][0-9a-f]{2}:/.test(a) || /^fe[89ab][0-9a-f]:/.test(a);
}
// This computer's office network addresses, for the address shown on the Remote desks screen.
export function officeAddresses(interfaces) {
  const out = [];
  for (const list of Object.values(interfaces || {})) for (const i of list || []) {
    if (i.family === 'IPv4' || i.family === 4) if (!i.internal && isOfficeAddress(i.address)) out.push(i.address);
  }
  return out;
}

// ---------- what a remote may ask ----------
// Reading the desk's sessions, starting one, sending a message, answering a question. Nothing that acts
// on this computer outside a session (opening files or folders, terminals, editors, sign-ins, desk settings).
// Returns { kind, id } or null: kind 'clients' (the desk list, cut to the added desks), 'desk' (a request
// about a desk, its client must be an added desk), or 'session' (about session id, which must be on an added desk).
const SESSION_GET = /^\/api\/sessions\/([\w-]+)\/(events|timeline|skills|cost)$/;
const SESSION_POST = /^\/api\/sessions\/([\w-]+)\/(send|permission|interrupt|seen|unread|rename|group|explain)$/; // explain: Explain more and side chats run on the desk's computer (#1113)
export const PILOT_DESK_POSTS = ['/api/pilot/engage', '/api/pilot/kind', '/api/pilot/promote', '/api/pilot/accept', '/api/pilot/miss'];
export function remoteRoute(method, p) {
  if (method === 'GET' && p === '/api/clients') return { kind: 'clients' };
  if (method === 'GET' && p === '/api/gears') return { kind: 'open' };
  if (method === 'GET' && ['/api/sessions', '/api/groups', '/api/places', '/api/keep', '/api/schedules'].includes(p)) return { kind: 'desk' };
  if (method === 'POST' && (p === '/api/sessions' || p === '/api/keep')) return { kind: 'desk' }; // starting a session; pinning one
  // Numbered questions (#989, #1057): each added desk's level, and setting one.
  if ((method === 'GET' && p === '/api/question-levels') || (method === 'POST' && p === '/api/question-level')) return { kind: 'desk' };
  // The autopilot on an added desk (#975): its state and tab, engaging it, Suggest | Answer, and the cards' Accept,
  // I got this and Not my pick. The runs go and bill on this computer, under its own rules.
  if (method === 'GET' && (p === '/api/pilot/desks' || p === '/api/pilot/desk')) return { kind: 'desk' };
  if (method === 'POST' && PILOT_DESK_POSTS.includes(p)) return { kind: 'desk' };
  // Making a group, naming it and putting sessions in it; never its start folder, which is a folder on this computer.
  if (method === 'POST' && (p === '/api/groups' || p === '/api/groups/order' || /^\/api\/groups\/[\w-]+\/rename$/.test(p))) return { kind: 'desk' };
  // Screen control (#822): a session on the other computer acting on this computer's screen (kind 'screen', answered
  // only when that desk has screen control turned on here), and who is in control and the Stop control.
  if (method === 'POST' && p === '/api/screen/act') return { kind: 'screen' };
  if ((method === 'GET' && p === '/api/screen') || (method === 'POST' && p === '/api/screen/stop')) return { kind: 'desk' };
  const m = (method === 'GET' ? SESSION_GET : method === 'POST' ? SESSION_POST : null)?.exec(p);
  return m ? { kind: 'session', id: m[1] } : null;
}
// The note a desk's session gets with each message sent from another computer, so it knows the person
// is not at this computer: from, the name that computer gave when it connected; host, this computer's name.
export const remoteNote = (from, host) =>
  `(From Docket: this message was sent from another computer, "${from}", through a remote connection (Remote Desks). ` +
  `You run on ${host}, the computer with the desk, so "this computer" means ${host}. You cannot read files on "${from}" ` +
  `or run commands there: when you need to see something on it, ask the person to attach a screenshot or paste the error text.)`;
// A message body from another computer as this computer passes it on: the parts only Docket sets (its own notes,
// system messages, who sent it) are dropped, and a message with words or files in it gets the note.
export function remoteMessage(body, from, host) {
  const { context, system, from: sender, ...rest } = body || {};
  const hasMessage = String(rest.text || '').trim() || (Array.isArray(rest.attachments) && rest.attachments.length);
  return hasMessage ? { ...rest, context: remoteNote(from, host) } : rest;
}
// The desk row a remote gets: its name, colour and AI brands, but not its folder on this computer, its
// sign-ins (or who they are as), or anything else about how this computer is set up.
export function remoteDeskRow(c) {
  return { id: c.id, name: c.name, color: c.color || '', defaultEngine: c.defaultEngine, startGears: c.startGears || {},
    brands: (c.brands || []).map((b) => ({ engine: b.engine, name: b.name })) };
}
// The broadcast messages a remote gets: only those about an added desk or its sessions.
// desks: the added desk ids (or one id). deskOf(id): the desk a session belongs to, or undefined.
export function relayFor(msg, desks, deskOf) {
  if (!msg || typeof msg !== 'object' || String(msg.t || '').startsWith('remote')) return false;
  if (msg.t === 'auth' || msg.t === 'browser') return false; // sign-ins and the browser stay on this computer
  if (msg.t === 'question-levels') return true; // every desk's level: cut to the added desks with levelsFor before it goes
  if (msg.t === 'pilot') return true; // the autopilot on every desk: cut to the added desks with pilotFor before it goes
  const added = (d) => d !== undefined && d !== null && (Array.isArray(desks) ? desks.includes(d) : d === desks);
  if (msg.client !== undefined) return added(msg.client);
  if (msg.session?.client !== undefined) return added(msg.session.client);
  if (typeof msg.id === 'string') return added(deskOf(msg.id));
  return false;
}
// The question levels (desk id -> level) of the added desks only (#1057).
export function levelsFor(levels, desks) {
  const out = {};
  for (const d of Array.isArray(desks) ? desks : [desks]) if (levels && typeof levels === 'object' && Object.hasOwn(levels, d)) out[d] = levels[d];
  return out;
}
// The autopilot's state (pilotBrief, or the /api/pilot/desks answer) cut to the added desks (#975): whether it is
// enabled, the desks engaged and since when, each desk's run state, the runs going and the sessions held there, and
// with desks, each desk's line. Nothing about this computer's other desks, its offer card or its notes.
export function pilotFor(pilot, desks, deskOf) {
  const ids = Array.isArray(desks) ? desks : [desks], p = pilot && typeof pilot === 'object' ? pilot : {};
  return { on: !!p.on, engaged: levelsFor(p.engaged, ids), deskStates: levelsFor(p.deskStates, ids),
    going: (Array.isArray(p.going) ? p.going : []).filter((g) => ids.includes(g?.desk)),
    holding: (Array.isArray(p.holding) ? p.holding : []).filter((s) => ids.includes(deskOf(s))),
    ...(p.desks && typeof p.desks === 'object' ? { desks: levelsFor(p.desks, ids) } : {}) };
}
// A 'pilot' broadcast as it goes to another computer: cut with pilotFor, and what it just answered only when on an added desk.
export function pilotMessageFor(msg, desks, deskOf) {
  const ids = Array.isArray(desks) ? desks : [desks];
  return { t: 'pilot', pilot: pilotFor(msg.pilot, ids, deskOf), ...(msg.decided && ids.includes(msg.decided.desk) ? { decided: msg.decided } : {}) };
}
// The desks added for remote use (#1044), from the saved setup. A setup saved before then linked one desk
// (remoteControl.desk): it becomes the first entry, and the old field goes. Away mode's settings (remoteControl.away,
// before the relay replaced it in #1052) go too. Changes cfg in place; returns the list.
export function remoteDeskIds(cfg) {
  if (!cfg || typeof cfg !== 'object') return [];
  if (!Array.isArray(cfg.desks)) cfg.desks = cfg.desk ? [String(cfg.desk)] : [];
  if ('desk' in cfg) delete cfg.desk;
  if ('away' in cfg) delete cfg.away;
  cfg.desks = [...new Set(cfg.desks.filter((d) => typeof d === 'string' && d))];
  return cfg.desks;
}
// Which added desk a remote request is about: the one it names (refused, null, when that one was not added), or,
// naming none, the first added desk (what a remote that knew only one desk expects).
export function pickDesk(asked, ids) {
  if (asked) return ids.includes(asked) ? asked : null;
  return ids[0] || null;
}
// Every "client" in an answer, renamed: the desk's id on this computer becomes the remote desk's id there.
export function renameClient(v, from, to) {
  if (Array.isArray(v)) return v.map((x) => renameClient(x, from, to));
  if (!v || typeof v !== 'object') return v;
  const out = {};
  for (const [k, x] of Object.entries(v)) out[k] = k === 'client' && x === from ? to : renameClient(x, from, to);
  return out;
}

// ---------- the other computer's side: a connection that trusts only one certificate ----------
// address: https://host:port. pin: the fingerprint256 saved when the remote desk was added. With no pin
// (adding it), the certificate is read but nothing else is sent, so the person can compare check codes first.
// The TLS options that accept only the pinned certificate. A different one (another computer, or something
// in between that reads the traffic, such as an inspecting proxy) is refused before anything is sent.
export const pinnedTls = (pin, certPem) => ({
  ca: certPem ? [certPem] : undefined,
  rejectUnauthorized: !!certPem,
  checkServerIdentity: (host, cert) => cert.fingerprint256 === pin ? undefined
    : Object.assign(new Error('The certificate is not the one this remote desk was set up with'), { code: 'PIN_MISMATCH' }),
});
// Reads the peer certificate's PEM on first contact (to trust it exactly from then on).
export function peerCertificate(address, timeout = 8000) {
  const u = new URL(address);
  return new Promise((resolve, reject) => {
    const s = tls.connect({ host: u.hostname, port: Number(u.port || 443), rejectUnauthorized: false }, () => {
      const c = s.getPeerCertificate(true); s.end();
      if (!c?.raw) return reject(new Error('It sent no certificate'));
      resolve({ fingerprint: c.fingerprint256, pem: `-----BEGIN CERTIFICATE-----\n${c.raw.toString('base64').match(/.{1,64}/g).join('\n')}\n-----END CERTIFICATE-----\n` });
    });
    s.setTimeout(timeout, () => { s.destroy(); reject(new Error('No answer from that address')); });
    s.on('error', (e) => reject(e));
  });
}
// agent: a relayAgent, for a host reached through the Docket relay (it makes the pinned connections itself).
export function pinnedRequest(address, { pin, cert, method = 'GET', path = '/', token, body, timeout = 30000, agent }) {
  const u = new URL(address);
  return new Promise((resolve, reject) => {
    const data = body === undefined ? null : Buffer.from(JSON.stringify(body));
    const req = https.request({ host: u.hostname, port: Number(u.port || 443), method, path, agent: agent || false, timeout, ...(agent ? {} : pinnedTls(pin, cert)), // timeout here counts while connecting too; a relayAgent pins its own connections (these would keep it from reusing them)
      headers: { ...(data ? { 'content-type': 'application/json', 'content-length': data.length } : {}), ...(token ? { authorization: `Bearer ${token}` } : {}) } }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        let json = null; try { json = text ? JSON.parse(text) : {}; } catch {}
        resolve({ status: res.statusCode, json, text });
      });
    });
    req.setTimeout(timeout, () => req.destroy(new Error('No answer from the remote computer')));
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}
// Plain words for a connection that failed, so the person knows what to look at.
export function connectError(e, name = 'the other computer') {
  const code = e?.code || '';
  if (code === 'PIN_MISMATCH' || /self.signed|unable to verify|certificate/i.test(e?.message || ''))
    return `The connection to ${name} came back with a different certificate than the one it was set up with. Something between the two computers may be reading the encrypted traffic (an inspecting proxy such as Zscaler), or another computer now has that address. Nothing was sent.`;
  if (code === 'ECONNREFUSED') return `${name} is not answering. Remote control may be off there, or Docket is not running.`;
  if (code === 'ETIMEDOUT' || code === 'EHOSTUNREACH' || code === 'ENETUNREACH' || /No answer/.test(e?.message || ''))
    return `${name} could not be reached. Check that both computers are on the office network and the address is right.`;
  return `Could not reach ${name}: ${e?.message || e}`;
}


// ---------- the Docket relay (#1052): the same Remote Desks from anywhere, with nothing to set up ----------
// Both computers connect out to the relay (relay/desks/, at DESK_RELAY_URL) over HTTPS, and it pairs them in a room. Inside
// that pipe they speak TLS to each other exactly as on the office network: the host answers with its own certificate,
// and the guest trusts only that one (pinnedTls). The pairing code the host shows is its room and its check code, so
// the relay sees only ciphertext and cannot pass itself off as the host. The authenticator code then stands in for the
// Allow click: nobody may be at the host to click it.
export const DESK_RELAY_URL = 'https://relay.docket.center';
export const newRelayKey = () => crypto.randomBytes(32).toString('hex');
// The room a host key owns, worked out the same way as relay/desks/pairing.mjs roomOfKey: only the key's holder can answer in it.
export const relayRoom = (key) => base32(crypto.createHash('sha256').update(String(key)).digest()).slice(0, 16);
// What the host shows and the guest pastes: the room (16 letters and digits) then the check code (16 hex), in fours.
export const pairingCode = (room, fp) => `${room}${checkCodeOf(fp).replace(/-/g, '')}`.match(/.{4}/g).join('-');
// The code as pasted (any case, spaces or dashes) -> { room, check } or null.
export function parsePairingCode(s) {
  const c = String(s || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  const room = c.slice(0, 16), check = c.slice(16);
  return c.length === 32 && /^[A-Z2-7]{16}$/.test(room) && /^[0-9A-F]{16}$/.test(check) ? { room, check } : null;
}
const wsBase = (relay) => String(relay).replace(/^http/, 'ws').replace(/\/+$/, '');
export const relayGuestUrl = (relay, room) => `${wsBase(relay)}/v1/rooms/${room}/guest`;
export const relayHostUrl = (relay, key, chan) => `${wsBase(relay)}/v1/rooms/${relayRoom(key)}/host?key=${key}${chan ? `&chan=${chan}` : ''}`;
// A byte stream through the relay (to the host, for a guest; to one guest, for the host). Writes wait for it to open.
export function relayStream(url, timeout = 20000) {
  return createWebSocketStream(new WebSocket(url, { handshakeTimeout: timeout, perMessageDeflate: false }));
}
// The guest's TLS connection to the host through the relay, trusting only the pinned certificate (none yet: read it).
export const relayTls = (relay, room, pin, cert) =>
  tls.connect({ socket: relayStream(relayGuestUrl(relay, room)), ...(cert ? pinnedTls(pin, cert) : { rejectUnauthorized: false }) });
// Reads the host's certificate through the relay on first contact, as peerCertificate does on the office network.
export function relayPeerCertificate(relay, room, timeout = 20000) {
  return new Promise((resolve, reject) => {
    const s = relayTls(relay, room);
    const timer = setTimeout(() => { s.destroy(); reject(new Error('No answer from the remote computer')); }, timeout);
    s.on('secureConnect', () => {
      clearTimeout(timer);
      const c = s.getPeerCertificate(true); s.end();
      if (!c?.raw) return reject(new Error('It sent no certificate'));
      resolve({ fingerprint: c.fingerprint256, pem: `-----BEGIN CERTIFICATE-----\n${c.raw.toString('base64').match(/.{1,64}/g).join('\n')}\n-----END CERTIFICATE-----\n` });
    });
    s.on('error', (e) => { clearTimeout(timer); reject(e); });
  });
}
// The guest's requests to one host through the relay: connections are kept open a while and reused, so each request
// does not wait for a new pairing and TLS handshake.
export function relayAgent(relay, room, pin, cert) {
  const agent = new https.Agent({ keepAlive: true, maxSockets: 6, timeout: 30000 });
  agent.createConnection = () => relayTls(relay, room, pin, cert);
  return agent;
}
// The host's line to the relay: kept open (and opened again when it drops), and on each guest that knocks, a stream
// to it, handed to onStream (Docket serves HTTPS on it). onState({ connected, error }) as it changes. close() ends it.
export function relayHost({ relay, key, onStream, onState = () => {} }) {
  let ws = null, stopped = false, wait = 2000, retry = null, ping = null;
  const open = () => {
    if (stopped) return;
    ws = new WebSocket(relayHostUrl(relay, key), { handshakeTimeout: 20000, perMessageDeflate: false });
    let error = '';
    ws.on('open', () => {
      wait = 2000; onState({ connected: true, error: '' });
      ping = setInterval(() => { if (ws.readyState === 1) ws.send('ping'); }, 30000); ping.unref?.(); // keeps the line from going idle
    });
    ws.on('message', (d) => {
      let m; try { m = JSON.parse(d); } catch { return; } // 'pong'
      if (m?.t === 'open' && /^[0-9a-f]{24}$/.test(m.chan || '')) onStream(relayStream(relayHostUrl(relay, key, m.chan)));
    });
    ws.on('error', (e) => { error = relayError(e, 'This computer'); });
    ws.on('close', () => {
      clearInterval(ping);
      if (stopped) return;
      onState({ connected: false, error: error || 'The line to the Docket relay closed; connecting again.' });
      retry = setTimeout(open, wait); retry.unref?.(); wait = Math.min(wait * 2, 60000);
    });
  };
  open();
  return { close() { stopped = true; clearTimeout(retry); clearInterval(ping); try { ws?.terminate(); } catch {} } };
}
// Plain words for a relay connection that failed.
export function relayError(e, name = 'the other computer') {
  const msg = e?.message || String(e || ''), status = Number(msg.match(/Unexpected server response: (\d+)/)?.[1] || 0);
  if (status === 409) return `${name} is not reachable through the Docket relay: Docket is not running there, or Reach from anywhere is off (☰ > Desks > Remote Desks there).`;
  if (status === 504) return `${name} did not answer through the Docket relay. Try again in a minute.`;
  if (status === 429) return 'The Docket relay is busy for that computer. Try again in a minute.';
  if (status === 403) return 'The Docket relay refused this computer\'s key.';
  if (status) return `The Docket relay answered ${status}.`;
  if (e?.code === 'PIN_MISMATCH' || /self.signed|unable to verify|certificate/i.test(msg))
    return `The computer that answered through the Docket relay is not the one this remote desk was paired with (its certificate is different). Nothing was sent. If ${name} set up Remote Desks again, pair again with its new pairing code.`;
  if (/ENOTFOUND|EAI_AGAIN|ECONNREFUSED|ECONNRESET|ETIMEDOUT|ENETUNREACH|timed out|Opening handshake/i.test(`${e?.code} ${msg}`))
    return 'Could not reach the Docket relay (relay.docket.center). Check this computer\'s internet connection; a company network that blocks it needs relay.docket.center allowed.';
  return `Could not connect through the Docket relay: ${msg}`;
}
