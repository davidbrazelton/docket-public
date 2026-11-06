// One shared copy of each mcp-atlassian server for the desks (#756). Every Claude session starts its own copy of each
// stdio MCP server in the desk's Claude config, and mcp-atlassian (Jira, Confluence) is a Python program of about
// 120 MB that takes 8 to 9 seconds to start: with a dozen sessions open that was 48 processes and 2 GB. It can serve
// over HTTP instead, so Docket starts one copy of each such entry, with its own command, args and env (desks with
// the same entry share it), and gives each session an http entry of the same name in place of the stdio one. The desk's
// Claude config is left as it is, so sessions outside Docket keep their stdio copies, and a session gets the stdio
// one too whenever the shared copy is not answering.
// The copies are started detached and written down (pid, port, a hash of the entry) in data/shared-mcp.json, so an
// app restart finds and keeps them; a copy that died, or whose entry changed, is started again.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import net from 'node:net';
import { spawn, execFileSync } from 'node:child_process';

const SHAREABLE = /^mcp-atlassian(\.exe)?$/i;
const MCP_PATH = '/mcp';
// How long a running copy may go without answering before it is started again. A cold start takes 8 to 9 seconds
// on a quiet computer and over a minute on a busy one, and a copy stopped before it answers never does.
const RESTART_MS = 5 * 60000;

// The user-level entries of a desk's .claude.json that can be shared: stdio mcp-atlassian ones. { name: entry }.
export function shareableServers(claudeJson) {
  const out = {};
  for (const [name, e] of Object.entries(claudeJson?.mcpServers || {})) {
    if (!e || typeof e.command !== 'string' || (e.type && e.type !== 'stdio')) continue;
    if (SHAREABLE.test(path.basename(e.command.replace(/\\/g, '/')))) out[name] = e;
  }
  return out;
}

// The entry's args with its transport swapped for stateless HTTP on localhost: stateless, so a copy started again
// serves the sessions that used the old one without them having to start over.
export function httpArgs(args = [], port) {
  const out = [];
  for (let i = 0; i < args.length; i++) {
    const a = String(args[i]);
    if (/^--(transport|port|host|path)$/.test(a)) { i++; continue; }
    if (/^--(transport|port|host|path)=/.test(a) || a === '--stateless') continue;
    out.push(a);
  }
  return [...out, '--transport', 'streamable-http', '--stateless', '--host', '127.0.0.1', '--port', String(port), '--path', MCP_PATH];
}

// Stands for an entry's command, args and env, so a changed entry is noticed without its secrets being written down.
export const entryKey = (e) => crypto.createHash('sha256').update(JSON.stringify([e.command, e.args || [], e.env || {}])).digest('hex').slice(0, 16);

// The servers a session's own MCP config gets: an http entry for each shared copy that answers, except a name the
// session's folder has its own entry for in .claude.json (that one has to win, as it does today). urls: { name: url }.
export function sessionServers(urls, claudeJson, cwd) {
  const norm = (p) => String(p || '').replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();
  const own = Object.entries(claudeJson?.projects || {}).filter(([p]) => norm(p) === norm(cwd)).flatMap(([, v]) => Object.keys(v?.mcpServers || {}));
  return Object.fromEntries(Object.entries(urls).filter(([name]) => !own.includes(name)).map(([name, url]) => [name, { type: 'http', url }]));
}

const alive = (pid) => { try { process.kill(pid, 0); return true; } catch (e) { return e.code === 'EPERM'; } };
// mcp-atlassian.exe is a launcher with the Python program as its child, so on Windows the whole tree goes.
function stop(pid) {
  if (!pid || !alive(pid)) return;
  try { if (process.platform === 'win32') execFileSync('taskkill', ['/T', '/F', '/PID', String(pid)], { stdio: 'ignore', windowsHide: true }); else process.kill(-pid); }
  catch { try { process.kill(pid); } catch {} }
}
const freePort = () => new Promise((resolve, reject) => {
  const srv = net.createServer().once('error', reject);
  srv.listen(0, '127.0.0.1', () => { const { port } = srv.address(); srv.close(() => resolve(port)); });
});
// Any HTTP answer on the port means the copy is up.
async function answers(port) {
  try { await fetch(`http://127.0.0.1:${port}${MCP_PATH}`, { signal: AbortSignal.timeout(2000) }); return true; } catch { return false; }
}

// dataDir: where shared-mcp.json and the copies' logs go. readClaudeJson(client): the desk's .claude.json, or null.
export function createSharedMcp({ dataDir, readClaudeJson, log = () => {} }) {
  const file = path.join(dataDir, 'shared-mcp.json');
  // servers: entry key -> { pid, port, at }, one copy per entry, so desks with the same entry (same sign-in) share it.
  // desks: desk id -> { name: entry key }, what each desk asked for at the last check that could read its config.
  let saved = {}; try { saved = JSON.parse(fs.readFileSync(file, 'utf8')) || {}; } catch {}
  if (!saved.servers || !saved.desks) saved = { servers: {}, desks: {} };
  const save = () => { try { fs.mkdirSync(dataDir, { recursive: true }); fs.writeFileSync(file, JSON.stringify(saved, null, 2)); } catch {} };
  const up = new Map(); // entry key -> url, for the copies that answered at the last check
  const answeredAt = new Map(); // entry key -> when it last answered
  let checking = false;

  async function start(key, name, e) {
    const port = await freePort();
    const out = fs.openSync(path.join(dataDir, `shared-mcp-${name}-${key}.log`.replace(/[^\w.-]/g, '_')), 'a');
    const proc = spawn(e.command, httpArgs(e.args, port), { env: { ...process.env, ...(e.env || {}) }, detached: true, windowsHide: true, stdio: ['ignore', out, out] });
    proc.on('error', (err) => log(`[shared mcp] ${name}: ${err.message}`));
    proc.unref(); fs.closeSync(out);
    log(`[shared mcp] started ${name} on port ${port}`);
    return { pid: proc.pid, port, at: Date.now() };
  }

  // Brings the copies in line with the desks' configs: keeps the ones that answer and the ones still starting,
  // starts the missing ones and the ones that died or stopped answering for RESTART_MS (they answer at a later
  // check), and stops the ones no desk asks for any more.
  async function check(clients) {
    if (checking) return;
    checking = true;
    try {
      const entries = new Map(); // entry key -> { name, e }
      const desks = {};
      for (const client of clients) {
        const j = readClaudeJson(client);
        // A config that cannot be read now (being written, say) keeps what it asked for last time.
        if (!j) { if (saved.desks[client.id]) desks[client.id] = saved.desks[client.id]; continue; }
        desks[client.id] = {};
        for (const [name, e] of Object.entries(shareableServers(j))) {
          const key = entryKey(e);
          desks[client.id][name] = key;
          if (!entries.has(key)) entries.set(key, { name, e });
        }
      }
      const wanted = new Set(Object.values(desks).flatMap((m) => Object.values(m)));
      saved.desks = desks;
      for (const key of wanted) {
        const rec = saved.servers[key], now = Date.now();
        if (rec && alive(rec.pid)) {
          if (await answers(rec.port)) { up.set(key, `http://127.0.0.1:${rec.port}${MCP_PATH}`); answeredAt.set(key, now); continue; }
          up.delete(key);
          if (now - Math.max(rec.at, answeredAt.get(key) || 0) < RESTART_MS) continue;
        }
        up.delete(key);
        const want = entries.get(key);
        if (!want) continue; // only a desk whose config cannot be read now asks for it: wait for that config
        try { if (rec) stop(rec.pid); saved.servers[key] = await start(key, want.name, want.e); }
        catch (err) { log(`[shared mcp] ${want.name}: ${err.message}`); }
      }
      for (const [key, rec] of Object.entries(saved.servers)) {
        if (wanted.has(key)) continue;
        stop(rec.pid); delete saved.servers[key]; up.delete(key); answeredAt.delete(key);
      }
      save();
    } finally { checking = false; }
  }

  // The http entries for a session of this desk in this folder ({} when none is up).
  function forSession(client, cwd) {
    const urls = {};
    for (const [name, key] of Object.entries(saved.desks[client.id] || {})) if (up.has(key)) urls[name] = up.get(key);
    return Object.keys(urls).length ? sessionServers(urls, readClaudeJson(client), cwd) : {};
  }

  return { check, forSession };
}
