// The relay on this computer, for trying Docket's Suggest a feature button against it before (or instead of) the
// hosted one. Counts are kept in memory, so they start again when it stops. Run from this folder:
//   FEEDBACK_GITHUB_TOKEN=... FEEDBACK_REPO=owner/name node local.mjs [port]
// then start the test copy with PORTAL_FEEDBACK_URL=http://localhost:<port>/v1/suggest.
// FEEDBACK_IP=1.2.3.4 makes every request look as if it came from that address (to try the per-address limit).
// FEEDBACK_DRY=1 answers as GitHub would without filing anything, so the limits can be tried without making Issues.
import http from 'node:http';
import { handle } from './relay.mjs';

const port = Number(process.argv[2]) || 4490;
const counts = new Map();
let filed = 0;
const dry = async () => ({ status: 201, json: async () => ({ number: ++filed }) });
const store = { get: async (k) => counts.get(k) ?? null, set: async (k, n) => { counts.set(k, n); } };
http.createServer(async (req, res) => {
  if (req.url !== '/v1/suggest') { res.writeHead(404).end(); return; }
  let raw = ''; for await (const c of req) raw += c;
  let body = null; try { body = JSON.parse(raw); } catch {}
  const r = await handle({ method: req.method, body, ip: process.env.FEEDBACK_IP || req.socket.remoteAddress, store, token: process.env.FEEDBACK_GITHUB_TOKEN, repo: process.env.FEEDBACK_REPO,
    ...(process.env.FEEDBACK_DRY ? { fetch: dry } : {}) });
  console.log(new Date().toISOString(), r.status, r.body.kind || `#${r.body.number}`);
  res.writeHead(r.status, { 'content-type': 'application/json' }).end(JSON.stringify(r.body));
}).listen(port, () => console.log(`feedback relay on http://localhost:${port}/v1/suggest`));
