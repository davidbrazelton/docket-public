// Remote desks: another computer on the office network shows and drives one desk of this Docket.
// This file holds the parts that need no Docket state, so test/remote.test.mjs can try them:
// the authenticator codes, the certificate this Docket makes for itself, the pinned connection the
// other computer uses, which addresses count as the office network, and which requests a remote may make.
import crypto from 'node:crypto';
import https from 'node:https';
import tls from 'node:tls';

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
// Returns { kind, id } or null: kind 'clients' (the desk list, cut to the one desk), 'desk' (a request
// about the desk, its client must be the linked desk), or 'session' (about session id, which must be the desk's).
const SESSION_GET = /^\/api\/sessions\/([\w-]+)\/(events|timeline|skills|cost)$/;
const SESSION_POST = /^\/api\/sessions\/([\w-]+)\/(send|permission|interrupt|seen|unread|rename|group)$/;
export function remoteRoute(method, p) {
  if (method === 'GET' && p === '/api/clients') return { kind: 'clients' };
  if (method === 'GET' && p === '/api/gears') return { kind: 'open' };
  if (method === 'GET' && ['/api/sessions', '/api/groups', '/api/places', '/api/keep', '/api/schedules'].includes(p)) return { kind: 'desk' };
  if (method === 'POST' && (p === '/api/sessions' || p === '/api/keep')) return { kind: 'desk' }; // starting a session; pinning one
  // Making a group, naming it and putting sessions in it; never its start folder, which is a folder on this computer.
  if (method === 'POST' && (p === '/api/groups' || p === '/api/groups/order' || /^\/api\/groups\/[\w-]+\/rename$/.test(p))) return { kind: 'desk' };
  // Screen control (#822): a session on the other computer acting on this computer's screen (kind 'screen', answered
  // only when the linked desk has screen control turned on here), and who is in control and the Stop control.
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
// The broadcast messages a remote gets: only those about the linked desk or its sessions.
// deskOf(id): the desk a session belongs to, or undefined.
export function relayFor(msg, desk, deskOf) {
  if (!msg || typeof msg !== 'object' || String(msg.t || '').startsWith('remote')) return false;
  if (msg.t === 'auth' || msg.t === 'browser') return false; // sign-ins and the browser stay on this computer
  if (msg.client !== undefined) return msg.client === desk;
  if (msg.session?.client !== undefined) return msg.session.client === desk;
  if (typeof msg.id === 'string') return deskOf(msg.id) === desk;
  return false;
}
// Every "client" in an answer, renamed: the desk's id on this computer becomes the remote desk's id there.
export function renameClient(v, from, to) {
  if (Array.isArray(v)) return v.map((x) => renameClient(x, from, to));
  if (!v || typeof v !== 'object') return v;
  const out = {};
  for (const [k, x] of Object.entries(v)) out[k] = k === 'client' && x === from ? to : renameClient(x, from, to);
  return out;
}

// ---------- pilot keys (#827): the autopilot on another computer, without the 8-hour code ----------
// A connected computer asks for one and someone here clicks Allow. It reaches only the linked desk, and only the
// pilot's actions there: what waits on the person, answering one item under this computer's autopilot rules, giving
// the key back, and the screen tools when it was granted with them. This computer keeps a hash of it, never the key,
// lists it in ☰ > Desks > Remote Desks with Revoke, and refuses it after PILOT_KEY_DAYS. It is random: never the
// authenticator secret or anything made from it.
export const PILOT_KEY_DAYS = 30;
export const isPilotKey = (t) => /^dpk_[0-9a-f]{64}$/.test(String(t || ''));
export const pilotKeyHash = (key) => crypto.createHash('sha256').update(String(key)).digest('hex');
// { key } goes to the computer that asked, once; { record } is what this computer keeps.
export function grantPilotKey({ name, ip, desk, screen = false, days = PILOT_KEY_DAYS, now = Date.now() }) {
  const key = 'dpk_' + crypto.randomBytes(32).toString('hex');
  const d = Math.min(Math.max(Number(days) || PILOT_KEY_DAYS, 1), 90);
  return { key, record: { id: 'pk_' + crypto.randomBytes(4).toString('hex'), name: String(name || '').slice(0, 60) || 'Another computer', ip: ip || '',
    desk, screen: !!screen, at: now, expires: now + d * 86400e3, used: null, hash: pilotKeyHash(key) } };
}
// The record a key belongs to while it is good (not expired, not revoked, for this desk), or null.
export function findPilotKey(records, key, desk, now = Date.now()) {
  if (!isPilotKey(key)) return null;
  const h = Buffer.from(pilotKeyHash(key), 'hex');
  const r = (records || []).find((x) => /^[0-9a-f]{64}$/.test(x?.hash || '') && crypto.timingSafeEqual(Buffer.from(x.hash, 'hex'), h));
  return r && r.desk === desk && r.expires > now ? r : null;
}
export const livePilotKeys = (records, now = Date.now()) => (records || []).filter((r) => r.expires > now);
export const revokePilotKey = (records, id) => (records || []).filter((r) => r.id !== id);
// What the page shows of a key: everything but its hash.
export const pilotKeyView = ({ hash, ...r }) => r;
// The requests a pilot key may make, as { kind }, or null.
export function pilotKeyRoute(method, p, rec) {
  if (method === 'GET' && p === '/remote/pilot/pending') return { kind: 'pending' };
  if (method === 'POST' && p === '/remote/pilot/answer') return { kind: 'answer' };
  if (method === 'POST' && p === '/remote/pilot/revoke') return { kind: 'revoke' };
  if (rec?.screen && method === 'POST' && p === '/api/screen/act') return { kind: 'screen' };
  return null;
}
// What waits on the person that a pilot key may see: the linked desk's items, never another computer asking to come in.
export const pilotItemsFor = (items, desk) => (items || []).filter((i) => i.desk === desk && i.kind !== 'remote');

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
export function pinnedRequest(address, { pin, cert, method = 'GET', path = '/', token, body, timeout = 30000 }) {
  const u = new URL(address);
  return new Promise((resolve, reject) => {
    const data = body === undefined ? null : Buffer.from(JSON.stringify(body));
    const req = https.request({ host: u.hostname, port: Number(u.port || 443), method, path, agent: false, timeout, ...pinnedTls(pin, cert), // timeout here counts while connecting too
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
