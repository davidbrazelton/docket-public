# Docket's relay for Remote Desks

The small hosted relay behind Remote Desks from anywhere (#1052). Two Dockets that cannot reach each other (different
networks, nothing opened on either) both connect out to it over HTTPS, and it pairs their WebSockets by a room id and
passes the bytes through. What Docket does with it, and how people set it up, is in the main README under "Remote Desks
from anywhere".

- `pairing.mjs`: everything the relay decides (its paths, which room a host key owns, the limits). Tested by
  `test/desk-relay.test.mjs` from the repo root.
- `src/index.js`: the Cloudflare Worker, with one Durable Object per room (`Room`) that holds the host's control line
  and pairs each guest with a line the host opens for it.
- `local.mjs`: the same relay on this computer, with plain WebSockets, for the tests and for trying Docket test copies
  against it.

## What it can and cannot do

- **It sees only ciphertext.** The two Dockets speak TLS to each other inside the relayed connection, and the guest
  trusts only the host's own certificate (the pairing code carries its check code). The relay cannot read the traffic,
  change it, or answer in the host's place: a different certificate is refused before anything is sent.
- **Only the host answers in its room.** A room id is the first 80 bits of the SHA-256 of a key only the host knows
  (`roomOfKey`), and the relay lets a host line in only with that key. Anyone may knock on a room as a guest; the host
  still asks for a code from its authenticator app.
- **It stores nothing.** No logs of its own, nothing on disk: the Durable Object keeps the open WebSockets and a few
  counters in memory.

## Paths

```
wss://relay.docket.center/v1/rooms/<ROOM>/host?key=<KEY>              the host's control line (kept open, "ping" every 30 s)
wss://relay.docket.center/v1/rooms/<ROOM>/guest                        a guest; held until the host answers, up to 15 s
wss://relay.docket.center/v1/rooms/<ROOM>/host?key=<KEY>&chan=<CHAN>   the host answering one guest ("open <chan>" on its control line)
```

Refusals (an HTTP status in place of the WebSocket upgrade, which Docket turns into plain words in `relayError`):
400 not a relay path, 403 a host key that does not own the room, 409 no host connected to the room, 429 over a limit,
504 the host did not answer in time.

## Limits

- 60 connections a minute from one address (the `RATE` rate limit binding in `wrangler.toml`), before anything reaches a room.
- Per room: 30 guest connections a minute and 16 at once. Docket reuses its connections (a few per remote desk), so
  normal use stays far under both.
- 512 MB through one guest connection, either way together, before it is closed (Docket opens a new one).

## Set it up (once)

Needs the maintainer's Cloudflare sign-in. `docket.center` is already on that Cloudflare account, which is what lets the
Worker take `relay.docket.center` as a custom domain. Durable Objects with SQLite storage, WebSocket hibernation and the
rate limit binding all work on the Workers Free plan. If a deploy refuses the `[[ratelimits]]` block, take it out of
`wrangler.toml` and deploy again: the per-room limits below still hold, and the Worker skips the address limit when the
binding is not there.

1. From this folder, sign in: `npx wrangler login` (or set `CLOUDFLARE_API_TOKEN` to a token that can edit Workers on
   that account).
2. Deploy: `npx wrangler deploy`. Wrangler makes the `docket-relay` Worker, the `Room` Durable Object (migration `v1`)
   and the custom domain `relay.docket.center`: the DNS record and its certificate are added by themselves. The first
   deploy can take a few minutes before the address answers.
3. Check it: `curl https://relay.docket.center/` answers "Docket relay for Remote Desks". Then on a Docket that has this
   change, ☰ > Desks > Remote Desks > From anywhere > **Turn on** should say "Connected to the relay" within a few
   seconds; portal-events.log has `relay: line open`.

Deploy again the same way after any change to this folder. Copies already installed keep using `relay.docket.center`
(`DESK_RELAY_URL` in `remote.mjs`), so that address is not changed once released. A change to the paths or the pairing
must keep working with Dockets that have not updated yet.

## Watch it

`npx wrangler tail docket-relay` shows requests live (paths carry the room id and, for a host, its key: never paste a
tail into an issue). The Cloudflare dashboard shows requests, Durable Object use and errors under Workers & Pages >
docket-relay.

## Try it on this computer

```
node local.mjs 4490
```

then start each Docket test copy with `PORTAL_RELAY_URL=http://localhost:4490` (one test copy can be both host and
guest: turn on Reach from anywhere and add a remote desk with its own pairing code). `npx wrangler dev --port 8799`
runs the real Worker locally the same way (`PORTAL_RELAY_URL=http://127.0.0.1:8799`).
