// ☰ > Memory and disk: what Docket and its sessions hold in memory right now, and how big its folders are.
import fs from 'node:fs';
import path from 'node:path';

// The programs a session runs as, by name, and the browsers its helpers open (Chrome, Chromium, Edge, and on a
// Mac "Google Chrome for Testing Helper (Renderer)" and the like).
const SESSION_PROGRAMS = { claude: 'Claude programs', grok: 'Grok programs', codex: 'Codex programs' };
const BROWSER = /^(chrome|chromium|msedge|headless_shell|chrome-headless-shell|google chrome|chromium )/;

// The list of running programs ([{ pid, ppid, name, mem }], from platform.mjs) grouped for the window: the app
// itself, the runner, then everything the two started, below them at any depth. The runner's own children are the
// session programs; everything below those is a helper (node programs, the private browser, the rest). The runner
// is started detached, so on a Mac its parent is no longer the app, and both are walked on their own.
export function groupProcesses(list, { appPid, runnerPid }) {
  const byPid = new Map(list.map((p) => [p.pid, p]));
  const kids = new Map();
  for (const p of list) if (p.pid !== p.ppid) (kids.get(p.ppid) || kids.set(p.ppid, []).get(p.ppid)).push(p);
  const groups = new Map();
  const add = (key, label, mem) => { const g = groups.get(key) || groups.set(key, { key, label, count: 0, mem: 0 }).get(key); g.count++; g.mem += mem; };
  const seen = new Set([appPid, runnerPid]);
  const walk = (pid, top) => {
    for (const c of kids.get(pid) || []) {
      if (seen.has(c.pid)) continue;
      seen.add(c.pid);
      if (top && SESSION_PROGRAMS[c.name]) add(c.name, SESSION_PROGRAMS[c.name], c.mem);
      else if (BROWSER.test(c.name)) add('browser', 'Private browser', c.mem);
      else if (c.name === 'node') add('node', 'Helper node programs', c.mem);
      else add('other', 'Other helpers', c.mem);
      walk(c.pid, false);
    }
  };
  if (runnerPid) walk(runnerPid, true);
  walk(appPid, false);
  const one = (pid, label) => ({ label, count: byPid.has(pid) ? 1 : 0, mem: byPid.get(pid)?.mem || 0 });
  const order = ['claude', 'grok', 'codex', 'node', 'browser', 'other'];
  const rows = [one(appPid, 'Docket app'), one(runnerPid, 'Session runner'),
    ...order.map((k) => groups.get(k)).filter(Boolean)];
  // The processor time all of them have used so far, for cpuPercent.
  const cpu = [...seen].reduce((s, pid) => s + (byPid.get(pid)?.cpu || 0), 0);
  return { rows, total: rows.reduce((s, r) => s + r.mem, 0), cpu };
}

// Docket's share of the whole computer's processor between two readings of groupProcesses' cpu ({ cpu, at }), as
// Task Manager and Activity Monitor's CPU column count it over all cores. A program that ended in between takes
// its time with it, so a drop reads as 0, not less.
export function cpuPercent(before, after, cores) {
  if (!before || !after || after.at <= before.at || !cores) return null;
  const pct = ((after.cpu - before.cpu) / ((after.at - before.at) / 1000) / cores) * 100;
  return Math.min(100, Math.max(0, Math.round(pct)));
}

// The folder sizes: counting them is slow, so the app counts them in the background now and then and keeps
// the last count in a file, with the time it was taken, so it is there at once after a restart. get() is the last
// count (or null before the first); refresh() counts again and saves, and while a count is running every other
// refresh() gets that same count instead of starting another.
export function diskKeeper({ file, count, log = () => {} }) {
  let saved = null, running = null;
  try { saved = JSON.parse(fs.readFileSync(file, 'utf8')); } catch {}
  const refresh = () => running ||= (async () => {
    try {
      saved = await count();
      await fs.promises.mkdir(path.dirname(file), { recursive: true });
      await fs.promises.writeFile(file + '.tmp', JSON.stringify(saved));
      await fs.promises.rename(file + '.tmp', file);
    } catch (err) { log(err); }
    return saved;
  })().finally(() => { running = null; });
  return { get: () => saved, refresh, counting: () => !!running };
}

// The size of a folder and the number of files in it, counting every folder inside it. Links are counted as
// themselves and not followed (Windows junctions included), so nothing is counted twice. A folder that is not
// there gives null. Each folder's files are looked at together; folders one at a time, so a big one (node_modules)
// never opens thousands of files at once.
export async function folderSize(dir, { filter } = {}) {
  let top;
  try { top = await fs.promises.readdir(dir, { withFileTypes: true }); } catch { return null; }
  const total = { bytes: 0, files: 0 };
  const walk = async (d, entries) => {
    const files = [];
    for (const e of entries) {
      if (filter && d === dir && !filter(e.name)) continue;
      const p = path.join(d, e.name);
      if (e.isDirectory()) {
        let inner; try { inner = await fs.promises.readdir(p, { withFileTypes: true }); } catch { continue; }
        await walk(p, inner);
      } else files.push(p);
    }
    const sizes = await Promise.all(files.map((f) => fs.promises.lstat(f).then((s) => s.size, () => null)));
    for (const s of sizes) if (s !== null) { total.bytes += s; total.files++; }
  };
  await walk(dir, top);
  return total;
}

// ---------- the breakdown in ☰ > Memory and disk: by session, shared helpers, and test copies and leftovers ----------
// The servers a shared-mcp.json (shared-mcp.mjs) lists, as [{ pid, name, desks }]: one copy can serve several desks.
export function sharedServers(saved) {
  const out = new Map();
  for (const [key, s] of Object.entries(saved?.servers || {})) if (s?.pid) out.set(key, { pid: Number(s.pid), name: '', desks: [] });
  for (const [desk, names] of Object.entries(saved?.desks || {})) {
    for (const [name, key] of Object.entries(names || {})) { const s = out.get(key); if (s) { s.name ||= name; s.desks.push(desk); } }
  }
  return [...out.values()].map((s) => ({ ...s, name: s.name || 'MCP server' }));
}

// The session a session program belongs to, from its command line: Docket's tools carry DOCKET_SESSION in the
// config Claude is started with (also when it resumes under another id); else --session-id; else null.
export function sessionOfCommand(cmd) {
  const s = String(cmd || '');
  const m = s.match(/DOCKET_SESSION\\*"\s*:\s*\\*"([\w-]+)/) || s.match(/DOCKET_SESSION=([\w-]+)/) || s.match(/--session-id[= ]"?([\w-]+)/);
  return m ? m[1] : null;
}

// The Docket program a process runs and the folder it runs from, from its command line: { program, folder }, or
// null. program is server.mjs, runner.mjs, tools-helper.mjs or the power watch; folder is '' when the command line
// names the file without one (`node server.mjs` typed in its folder). Only node's own script counts (its first
// argument that is not an option), so a Claude command line that mentions tools-helper.mjs in its config is not one.
const DOCKET_FILE = /^(.*?)(server\.mjs|runner\.mjs|tools-helper\.mjs|power-watch\.ps1|power-watch-mac\.js)$/;
export function docketProgram(p) {
  if (!['node', 'powershell', 'pwsh', 'osascript'].includes(p.name)) return null;
  const args = (String(p.cmd || '').match(/"[^"]*"|\S+/g) || []).slice(1).map((a) => a.replace(/^"|"$/g, ''));
  const script = p.name === 'node' ? args.find((a) => !a.startsWith('-')) : args.find((a) => DOCKET_FILE.test(a));
  const m = script && script.match(DOCKET_FILE);
  if (!m || (m[1] && !/[\\/]$/.test(m[1]))) return null; // not one, or a file that only ends in the name (my-server.mjs)
  return { program: m[2], folder: m[1].replace(/[\\/]+$/, '') };
}

// Paths compare without case (Windows and a Mac ignore it by default) and with either slash.
const pathKey = (f) => String(f).replace(/[\\/]+/g, '/').replace(/\/$/, '').toLowerCase();
const LEFT_LABEL = { 'server.mjs': 'Docket app (server.mjs)', 'runner.mjs': 'Session runner (runner.mjs)', 'tools-helper.mjs': 'tools-helper.mjs', 'power-watch.ps1': 'Power watch', 'power-watch-mac.js': 'Power watch' };

// What holds the memory (and processor) behind the totals at the top, from the same list as groupProcesses, with
// command lines (parseProcessList). Each line has every program below its own at any depth, counted once, and
// the lines claim them in this order:
// - leftovers (test copies and leftovers): Docket programs (docketProgram) from another folder than root, wherever
//   they run (a test copy started by a session's command is the test copy's, not the session's), and the test
//   copies' shared MCP servers (copies: [{ folder, servers }], servers as sharedServers gives them), by folder;
// - shared (shared by sessions): the shared MCP servers (shared, from data/shared-mcp.json) and the runner's helpers,
//   such as each desk's private browser (helpers: the runner's /helpers);
// - sessions: each program the runner started that is not a helper, matched by its command line (sessionOfCommand;
//   sessions: id -> { title, desk }) and split into the program, tools-helper.mjs, its own MCP servers and the rest.
//   One that cannot be matched goes in unmatched.
// before: an earlier list's processor times ({ byPid: Map pid -> seconds, at }) and at: this list's time, for each
// line's share of the computer's processor in between, as cpuPercent counts it (null without an earlier list).
export function breakdown(list, { appPid, runnerPid, root, sessions = new Map(), helpers = [], shared = [], copies = [], before = null, at = Date.now(), cores = 1 }) {
  const byPid = new Map(list.map((p) => [p.pid, p]));
  const kids = new Map();
  for (const p of list) if (p.pid !== p.ppid) (kids.get(p.ppid) || kids.set(p.ppid, []).get(p.ppid)).push(p);
  const claimed = new Set([appPid, runnerPid].filter(Boolean));
  const seconds = before && at > before.at ? (at - before.at) / 1000 : 0;
  // A program that started since the earlier list used all its time in between.
  const cpuOf = (pids) => !seconds || !cores ? null : Math.min(100, Math.max(0, Math.round(
    pids.reduce((s, pid) => s + Math.max(0, (byPid.get(pid)?.cpu || 0) - (before.byPid.get(pid) ?? 0)), 0) / seconds / cores * 100)));
  const mem = (pids) => pids.reduce((s, pid) => s + (byPid.get(pid)?.mem || 0), 0);
  const line = (fields, pids) => ({ ...fields, count: pids.length, mem: mem(pids), cpu: cpuOf(pids) });
  // pid and everything below it not claimed yet, now claimed, but not below a program left(c) says to leave.
  const take = (pid, left = () => false) => {
    const out = [];
    const walk = (p) => { if (!p || claimed.has(p.pid)) return; claimed.add(p.pid); out.push(p.pid); for (const c of kids.get(p.pid) || []) if (!left(c)) walk(c); };
    walk(byPid.get(pid));
    return out;
  };

  // Test copies and leftovers. A Docket program whose parent is not one takes its family; each Docket program in
  // it is its own part, with what it started (a test runner's sessions). A folder its command line does not name
  // comes from one below it that does (a test app typed as `node server.mjs` starts its runner by full path).
  const foreign = new Map();
  for (const p of list) {
    if (claimed.has(p.pid)) continue;
    const d = docketProgram(p);
    if (d && !(d.folder && pathKey(d.folder) === pathKey(root))) foreign.set(p.pid, d);
  }
  const copyPids = new Map();
  for (const c of copies) for (const s of c.servers || []) if (byPid.has(s.pid) && !claimed.has(s.pid)) copyPids.set(s.pid, c.folder);
  const groups = new Map();
  const group = (folder) => groups.get(pathKey(folder)) || groups.set(pathKey(folder), { folder, parts: new Map() }).get(pathKey(folder));
  const addPart = (g, label, pids) => { if (pids.length) g.parts.set(label, [...(g.parts.get(label) || []), ...pids]); };
  const folderBelow = (pid) => {
    for (const todo = [pid]; todo.length;) {
      const p = todo.shift(), f = foreign.get(p)?.folder || copyPids.get(p);
      if (f) return f;
      todo.push(...(kids.get(p) || []).map((c) => c.pid));
    }
    return '';
  };
  const takeFamily = (g, top) => {
    const pids = take(top, (c) => foreign.has(c.pid) || copyPids.has(c.pid));
    addPart(g, LEFT_LABEL[foreign.get(top).program], pids);
    for (const p of pids) for (const c of kids.get(p) || []) {
      if (claimed.has(c.pid)) continue;
      if (foreign.has(c.pid)) takeFamily(g, c.pid);
      else if (copyPids.has(c.pid)) addPart(g, 'Shared MCP servers', take(c.pid));
    }
  };
  for (const [pid] of foreign) if (!claimed.has(pid) && !foreign.has(byPid.get(pid).ppid)) takeFamily(group(folderBelow(pid) || 'Folder not known'), pid);
  for (const [pid, folder] of copyPids) if (!claimed.has(pid)) addPart(group(folder), 'Shared MCP servers', take(pid));
  const leftovers = [...groups.values()].map((g) => ({ ...line({ folder: g.folder }, [...g.parts.values()].flat()),
    parts: [...g.parts].map(([label, pids]) => line({ label }, pids)) })).filter((g) => g.count).sort((a, b) => b.mem - a.mem);

  // Shared by sessions.
  const sharedLines = [];
  for (const s of shared) { const pids = take(s.pid); if (pids.length) sharedLines.push(line({ kind: 'mcp', name: s.name, desks: s.desks || [] }, pids)); }
  const helperPids = new Set(helpers.map((h) => h.pid));
  for (const h of helpers) {
    const pids = take(h.pid);
    if (pids.length) sharedLines.push(line({ kind: String(h.name).startsWith('playwright-') ? 'browser' : 'helper', name: h.name, desks: h.meta?.desk ? [h.meta.desk] : [] }, pids));
  }

  // Sessions: the runner's own children that are not helpers.
  const byId = new Map(), unmatchedParts = new Map();
  const split = (top, parts) => {
    const add = (label, pids) => { if (pids.length) parts.set(label, [...(parts.get(label) || []), ...pids]); };
    claimed.add(top.pid);
    add(top.name, [top.pid]);
    for (const c of kids.get(top.pid) || []) {
      if (claimed.has(c.pid)) continue;
      const cmd = String(c.cmd || '');
      add(c.name === 'node' && /tools-helper\.mjs/i.test(cmd) ? 'tools-helper.mjs' : /mcp/i.test(cmd) ? 'Its own MCP servers' : 'Other programs it started', take(c.pid));
    }
  };
  for (const c of kids.get(runnerPid) || []) {
    if (claimed.has(c.pid) || helperPids.has(c.pid)) continue;
    const id = sessionOfCommand(c.cmd);
    split(c, id ? byId.get(id) || byId.set(id, new Map()).get(id) : unmatchedParts);
  }
  const withParts = (parts) => ({ ...line({}, [...parts.values()].flat()), parts: [...parts].map(([label, pids]) => line({ label }, pids)) });
  const sessionLines = [...byId].map(([id, parts]) => ({ id, title: sessions.get(id)?.title || '', desk: sessions.get(id)?.desk || '', ...withParts(parts) }))
    .sort((a, b) => b.mem - a.mem);
  return { sessions: sessionLines, unmatched: unmatchedParts.size ? withParts(unmatchedParts) : null, shared: sharedLines.sort((a, b) => b.mem - a.mem), leftovers };
}
