// The Docket relay for Remote Desks (#1052): what the relay decides, shared by the Cloudflare Worker (src/index.js)
// and the stand-in on this computer (local.mjs), and tested by test/desk-relay.test.mjs from the repo root.
//
// Two Dockets that cannot reach each other (different networks, no port open on either) both connect OUT to the
// relay over HTTPS on 443. The relay pairs their WebSockets by a room id and passes the bytes through. It stores
// nothing, and it cannot read or change what passes: the two Dockets speak TLS to each other inside the pipe, and the
// guest trusts only the host's own certificate (the pairing code carries its check code). So the relay sees ciphertext.
//
//   host, always:  wss://<relay>/v1/rooms/<ROOM>/host?key=<KEY>             its control line: the relay says "open <chan>"
//   guest:         wss://<relay>/v1/rooms/<ROOM>/guest                        held until the host answers with:
//   host, per guest: wss://<relay>/v1/rooms/<ROOM>/host?key=<KEY>&chan=<CHAN> paired with that guest, bytes both ways
//
// ROOM is worked out from KEY (roomOfKey), which only the host knows: anyone may knock on a room as a guest, but only
// the host can answer in it. A guest still needs the host's certificate and a code from its authenticator app.

export const LIMITS = Object.freeze({
  waitMs: 15000, // how long a guest waits for the host to answer
  channels: 16, // guests connected to one room at once
  opensPerMinute: 30, // guest connections to one room in a minute
  channelBytes: 512 * 1024 * 1024, // bytes one guest connection may pass, either way together, before it is closed
});

const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
function base32(bytes) {
  let bits = 0, val = 0, out = '';
  for (const b of bytes) { val = (val << 8) | b; bits += 8; while (bits >= 5) { out += B32[(val >>> (bits - 5)) & 31]; bits -= 5; } }
  return out;
}
export const isKey = (k) => /^[0-9a-f]{64}$/.test(String(k || ''));
export const isRoom = (r) => /^[A-Z2-7]{16}$/.test(String(r || ''));
export const isChan = (c) => /^[0-9a-f]{24}$/.test(String(c || ''));

// The room a host key owns: the first 16 base32 letters of its SHA-256 (80 bits). remote.mjs works it out the same way.
export async function roomOfKey(key) {
  const digest = await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(String(key)));
  return base32(new Uint8Array(digest)).slice(0, 16);
}

// A request's path and query -> { room, role: 'host' | 'guest', key, chan } or null (refused).
export function routeOf(url) {
  const u = new URL(url, 'https://relay');
  const m = u.pathname.match(/^\/v1\/rooms\/([A-Z2-7]{16})\/(host|guest)$/);
  if (!m) return null;
  const key = u.searchParams.get('key') || '', chan = u.searchParams.get('chan') || '';
  if (m[2] === 'guest') return key || chan ? null : { room: m[1], role: 'guest' };
  if (!isKey(key) || (chan && !isChan(chan))) return null;
  return { room: m[1], role: 'host', key, chan };
}

// Whether a host may use that room: its key must be the room's own.
export const hostOwns = async (route) => route?.role === 'host' && (await roomOfKey(route.key)) === route.room;

// Whether one more guest may connect to a room now. opens: the times of recent guest connections (kept to the last
// minute here, in place); channels: guests connected now. Returns '' or the reason it is refused.
export function guestRefusal({ hostThere, opens, channels, now = Date.now() }) {
  if (!hostThere) return 'no-host';
  while (opens.length && opens[0] <= now - 60e3) opens.shift();
  if (opens.length >= LIMITS.opensPerMinute || channels >= LIMITS.channels) return 'busy';
  opens.push(now);
  return '';
}
// The HTTP status each refusal answers with. Docket reads it (remote.mjs relayError).
export const REFUSAL_STATUS = { 'no-host': 409, busy: 429, timeout: 504, bad: 400, 'not-yours': 403 };

// A new guest connection's id, which the relay tells the host on its control line.
export function newChan() {
  const b = new Uint8Array(12); globalThis.crypto.getRandomValues(b);
  return [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
}
