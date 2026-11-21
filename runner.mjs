// The Docket runner: holds the live sessions and nothing else, so the Docket app can
// restart (to pick up a change) while sessions keep working. Keep this file small and stable:
// every change here means stopping the sessions it holds.
//
// The app tells it to start a session (with the options for its engine: engines/claude.mjs, the
// Claude library, unless options.engine names another, such as engines/acp.mjs for Grok or engines/codex.mjs for Codex),
// sends messages and controls, and reads each session's messages as a numbered stream. Every
// message is kept with its number, so an app that restarts reconnects and catches up from
// where it was. A permission question goes out on the stream and waits, however long, for the
// app to answer it (the app shows it to the person).
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { spawn, spawnSync } from 'node:child_process';
import * as claude from './engines/claude.mjs';
import * as acp from './engines/acp.mjs';
import * as codex from './engines/codex.mjs';
import { restartBlocked, stopForGood } from './runner-idle.mjs';

const ENGINES = { claude, acp, codex };

const PORT = Number(process.env.DOCKET_RUNNER_PORT || 4410);
const DATA_DIR = process.env.PORTAL_DATA || path.join(path.dirname(fileURLToPath(import.meta.url)), 'data');
const LOG = path.join(DATA_DIR, 'runner-events.log');
const KEEP_MESSAGES = 20000;        // per session; older ones drop off (the transcript on disk keeps everything)
const FORGET_ENDED_MS = 10 * 60000; // an ended session stays readable this long

fs.mkdirSync(DATA_DIR, { recursive: true });
const tokenFile = path.join(DATA_DIR, 'runner-token');
let TOKEN = '';
try { TOKEN = fs.readFileSync(tokenFile, 'utf8').trim(); } catch {}
if (!TOKEN) { TOKEN = randomUUID(); fs.writeFileSync(tokenFile, TOKEN); }

function log(what) { try { fs.appendFileSync(LOG, `${new Date().toISOString()}  ${what}\n`); } catch {} }
process.on('uncaughtException', (err) => { log('CRASHED ' + (err?.stack || err)); process.exit(1); });
process.on('unhandledRejection', (err) => log('error (kept running) ' + (err?.stack || err)));

class InputQueue {
  constructor() { this.items = []; this.waiters = []; this.closed = false; }
  push(item) { const w = this.waiters.shift(); if (w) w({ value: item, done: false }); else this.items.push(item); }
  close() { this.closed = true; for (const w of this.waiters) w({ value: undefined, done: true }); }
  [Symbol.asyncIterator]() {
    return { next: () => this.items.length ? Promise.resolve({ value: this.items.shift(), done: false })
      : this.closed ? Promise.resolve({ value: undefined, done: true })
      : new Promise((r) => this.waiters.push(r)) };
  }
}

let lastContact = Date.now(); // the app's last request: a test runner whose app is gone stops (stopForGood)
const sessions = new Map(); // id -> { q, input, log: [{seq, msg}], seq, listeners, asks, ended, stderr }

function emit(r, msg) {
  r.lastAt = Date.now();
  const item = { seq: ++r.seq, msg };
  r.log.push(item);
  if (r.log.length > KEEP_MESSAGES) r.log.splice(0, r.log.length - KEEP_MESSAGES);
  for (const l of r.listeners) l(item);
}

function start(id, options) {
  const r = { id, input: new InputQueue(), log: [], seq: 0, listeners: new Set(), asks: new Map(), ended: false, stderr: '' };
  sessions.set(id, r);
  const { engine = 'claude', ...rest } = options;
  r.q = (ENGINES[engine] || claude).start({
    options: rest,
    input: r.input,
    canUseTool: (toolName, input, opts) => new Promise((resolve) => {
      const reqId = randomUUID();
      const ask = { reqId, toolName, input, title: opts.title || '', suggestions: opts.suggestions };
      r.asks.set(reqId, { ...ask, resolve });
      emit(r, { type: 'docket_permission', ...ask });
      opts.signal?.addEventListener('abort', () => { if (r.asks.delete(reqId)) emit(r, { type: 'docket_permission_cancel', reqId }); });
    }),
    stderr: (d) => { r.stderr = (r.stderr + d).slice(-4000); },
  });
  (async () => {
    let error = null;
    try { for await (const m of r.q) { if (m.type === 'result') r.busy = false; emit(r, m); } }
    catch (err) { error = err.message + (r.stderr ? '\n' + r.stderr.slice(-800) : ''); }
    r.ended = true;
    emit(r, { type: 'docket_ended', error });
    log(`ended ${id}${error ? ': ' + error.split('\n')[0] : ''}`);
    setTimeout(() => { if (sessions.get(id) === r) sessions.delete(id); }, FORGET_ENDED_MS);
  })();
  log(`started ${id}`);
  return r;
}

// Programs the app wants kept running beside the sessions, such as the private browser's tool server of each desk
// (desk-browser.mjs). Each has a pipe on its standard input and has to stop when that closes, so they all stop with
// the runner, and the app starts them again for the sessions it puts back. meta is the app's, kept for it.
const helpers = new Map(); // name -> { name, pid, meta, proc }
function startHelper({ name, command, args = [], cwd, meta = {} }) {
  stopHelper(name);
  const err = fs.openSync(path.join(DATA_DIR, `helper-${name.replace(/[^\w.-]+/g, '_')}.log`), 'w');
  const proc = spawn(command, args, { cwd, stdio: ['pipe', 'ignore', err], windowsHide: true });
  fs.closeSync(err);
  const h = { name, pid: proc.pid, meta, proc };
  helpers.set(name, h);
  proc.on('error', (e) => log(`helper ${name} could not start: ${e.message}`));
  proc.stdin.on('error', () => {}); // a pipe to one that has stopped: nothing to tell
  proc.on('exit', (code) => { if (helpers.get(name) === h) helpers.delete(name); log(`helper ${name} stopped (${code})`); });
  log(`helper ${name} started, pid ${proc.pid}`);
  return h;
}
function stopHelper(name) {
  const h = helpers.get(name);
  if (!h) return;
  helpers.delete(name);
  h.proc.stdin.end(); // asks it to stop; one still there after 20 seconds is ended
  setTimeout(() => { if (h.proc.exitCode === null) h.proc.kill(); }, 20000).unref();
}
const helperInfo = ({ proc, ...h }) => h;

const json = (res, code, body) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(body)); };
const readBody = (req) => new Promise((resolve) => { let d = ''; req.on('data', (c) => d += c); req.on('end', () => { try { resolve(JSON.parse(d || '{}')); } catch { resolve({}); } }); });
const info = (r) => ({ id: r.id, seq: r.seq, ended: r.ended, busy: r.busy, asks: [...r.asks.values()].map(({ resolve, ...a }) => a) });

const server = http.createServer(async (req, res) => {
  try {
    lastContact = Date.now();
    const url = new URL(req.url, 'http://localhost');
    const p = url.pathname;
    if (p === '/health') return json(res, 200, { ok: true, pid: process.pid, sessions: sessions.size });
    if (req.headers['x-docket-token'] !== TOKEN) return json(res, 403, { error: 'Forbidden' });
    if (p === '/helpers' && req.method === 'GET') return json(res, 200, [...helpers.values()].map(helperInfo));
    if (p === '/helpers' && req.method === 'POST') return json(res, 200, helperInfo(startHelper(await readBody(req))));
    if (p === '/helpers/stop' && req.method === 'POST') { stopHelper((await readBody(req)).name); return json(res, 200, { ok: true }); }
    if (p === '/sessions' && req.method === 'GET') return json(res, 200, [...sessions.values()].map(info));
    const m = p.match(/^\/sessions\/([\w-]+)(?:\/(start|send|control|end|answer|stream|hold))?$/);
    if (!m) return json(res, 404, { error: 'Not found' });
    const [, id, action] = m;
    let r = sessions.get(id);
    if (action === 'start' && req.method === 'POST') {
      const b = await readBody(req);
      if (r && !r.ended) return json(res, 200, { ...info(r), attached: true }); // already running: the app reconnects to it
      r = start(id, b.options || {});
      return json(res, 200, info(r));
    }
    if (!r) return json(res, 404, { error: 'No such session in the runner' });
    if (action === 'stream') {
      // Newline-separated messages from number `since` on, then live ones as they come.
      const since = Number(url.searchParams.get('since') || 0);
      res.writeHead(200, { 'content-type': 'application/x-ndjson', 'cache-control': 'no-store' });
      const send = (item) => res.write(JSON.stringify(item) + '\n');
      for (const item of r.log) if (item.seq > since) send(item);
      r.listeners.add(send);
      const ping = setInterval(() => res.write('\n'), 15000);
      req.on('close', () => { r.listeners.delete(send); clearInterval(ping); });
      return;
    }
    if (req.method !== 'POST') return json(res, 405, { error: 'POST only' });
    const b = await readBody(req);
    if (action === 'send') { if (r.ended) return json(res, 409, { error: 'That session has ended' }); r.busy = true; r.input.push(b.message); return json(res, 200, { ok: true }); }
    if (action === 'hold') { r.held = !!b.hold; return json(res, 200, { ok: true }); } // the app: background commands running
    if (action === 'answer') {
      const ask = r.asks.get(b.reqId);
      if (!ask) return json(res, 404, { error: 'No such question' });
      r.asks.delete(b.reqId);
      ask.resolve(b.result);
      return json(res, 200, { ok: true });
    }
    if (action === 'control') {
      const allowed = { setModel: 1, applyFlagSettings: 1, setPermissionMode: 1, interrupt: 1, mcpServerStatus: 1 };
      if (!allowed[b.op]) return json(res, 400, { error: 'Unknown control' });
      const out = await r.q[b.op](...(b.op === 'interrupt' || b.op === 'mcpServerStatus' ? [] : [b.arg]));
      return json(res, 200, { ok: true, out: out ?? null });
    }
    if (action === 'end') {
      r.input.close(); r.q.close();
      for (const ask of r.asks.values()) ask.resolve({ behavior: 'deny', message: 'The session was ended.' });
      r.asks.clear();
      return json(res, 200, { ok: true });
    }
    return json(res, 404, { error: 'Not found' });
  } catch (e) { json(res, 500, { error: e.message }); }
});
// Taking in its own changes: when runner.mjs, an engine or the Claude library changes, stop once nothing is
// working (runner-idle.mjs: no reply in progress, no question waiting, no background commands, nothing said
// for a minute), telling the app
// first. The app starts the new runner within seconds and puts the sessions back.
const ROOT_DIR = path.dirname(fileURLToPath(import.meta.url));
const WATCHED = [fileURLToPath(import.meta.url), ...['claude.mjs', 'acp.mjs', 'codex.mjs'].map((f) => path.join(ROOT_DIR, 'engines', f)), path.join(ROOT_DIR, 'runner-idle.mjs'),
  path.join(ROOT_DIR, 'node_modules', '@anthropic-ai', 'claude-agent-sdk', 'package.json')];
let restartWanted = false;
let gone = 0; // checks in a row that found runner.mjs missing (its folder removed)
for (const f of WATCHED) fs.watchFile(f, { interval: 5000 }, (cur, prev) => {
  if (cur.mtimeMs !== prev.mtimeMs && !restartWanted) { restartWanted = true; log(`${path.basename(f)} changed; restarting once nothing is working`); }
});
setInterval(() => {
  const open = [...sessions.values()].filter((r) => !r.ended);
  gone = fs.existsSync(WATCHED[0]) ? 0 : gone + 1;
  // DOCKET_RUNNER_APP_GONE_MS: only the tests set it, to not wait minutes.
  const stop = stopForGood({ port: PORT, open: open.length, filesGone: gone >= 2, lastContact, appGoneMs: Number(process.env.DOCKET_RUNNER_APP_GONE_MS) || undefined });
  if (stop) { log(`stopping for good: ${stop}`); process.exit(0); }
  if (!restartWanted || gone) return;
  if (restartBlocked(open)) return;
  for (const f of WATCHED.filter((f) => f.endsWith('.mjs'))) {
    const check = spawnSync(process.execPath, ['--check', f], { windowsHide: true }); // the runner has no console: without it each check opens a window
    if (check.status !== 0) { log(`not restarting: ${path.basename(f)} has a mistake ` + String(check.stderr).slice(0, 500)); restartWanted = false; return; }
  }
  log(`restarting to take in changes (${open.length} idle session(s) handed back)`);
  for (const r of open) emit(r, { type: 'docket_ended', restart: true });
  setTimeout(() => { for (const r of open) { r.input.close(); r.q.close(); } process.exit(0); }, 1500);
}, 5000);

server.requestTimeout = 0;
server.listen(PORT, '127.0.0.1', () => log(`runner started on port ${PORT}, pid ${process.pid}`));
server.on('error', (e) => { log('could not start: ' + e.message); process.exit(1); });
