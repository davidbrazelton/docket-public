// The setup check (#758): what a desk's Claude sessions load before the first word, and how much of it goes unused.
// Every session starts by reading the desk's CLAUDE.md files, its memory index, one line per skill and command,
// its output style and the name of every MCP tool (plus a note for each MCP server that failed to connect).
// This measures that from the files, finds in the last 60 days of transcripts what was actually used, and prices
// it with the desk's own calls. It only reads, and it makes no model calls.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// When to offer the slimming session, and what counts as too big. One place to change them.
// tokens / monthly: the unused or oversized part, per session or per month, that is worth a session.
// changeTokens / changeShare: after Not now, how much it must grow to ask again before laterDays.
// everyDays: the full check (with the transcripts); jumpTokens / jumpShare: a rise in start size that runs it early.
export const SETUP_OFFER = {
  tokens: 3000, monthly: 10, laterDays: 30, changeTokens: 1000, changeShare: 0.25,
  everyDays: 7, jumpTokens: 2000, jumpShare: 0.2, usedDays: 60, costDays: 30,
  bigFileTokens: 3000, longDescChars: 180, newDays: 14,
};
// Tokens per character of prose, fitted on real calls (the start of a session is mostly prose).
export const PER_CHAR = 0.4;
const tok = (chars) => Math.round(chars * PER_CHAR);
// Claude Code reads only the start of MEMORY.md.
const MEMORY_LINES = 200, MEMORY_BYTES = 25000;
// The note Claude Code adds for MCP servers that failed: its fixed part, and per server.
const FAILED_NOTE = 70;

const read = (f) => { try { return fs.readFileSync(f, 'utf8'); } catch { return null; } };
const json = (f) => { const t = read(f); if (t == null) return null; try { return JSON.parse(t); } catch { return null; } };
const mtime = (f) => { try { return fs.statSync(f).mtimeMs; } catch { return 0; } };
const isDir = (d) => { try { return fs.statSync(d).isDirectory(); } catch { return false; } };
const list = (d) => { try { return fs.readdirSync(d); } catch { return []; } };
const key = (p) => path.resolve(p).toLowerCase();
// The same folder however it is written (a short 8.3 name on Windows, a link).
const real = (p) => { try { return key(fs.realpathSync.native(p)); } catch { return key(p); } };
// A folder's name under <home>/projects: every character but letters and digits becomes "-".
export const projectName = (dir) => path.resolve(dir).replace(/[^a-zA-Z0-9]/g, '-');
// An MCP server's name as it shows in its tool names (mcp__<server>__<tool>).
export const mcpName = (name) => String(name).replace(/[^a-zA-Z0-9_-]/g, '_');
// A folder and every folder above it, nearest first.
function upFrom(dir) {
  const out = [];
  for (let d = path.resolve(dir); ; d = path.dirname(d)) { out.push(d); if (path.dirname(d) === d) break; }
  return out;
}

// The frontmatter of a skill, command or rules file: its name, description (also when written over several
// lines), whether the model may run it, and the paths a rules file is limited to.
export function frontmatter(text) {
  const m = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text || '');
  const out = { name: '', description: '', modelOff: false, paths: false };
  if (!m) return out;
  const lines = m[1].split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const f = /^([A-Za-z_-]+):\s*(.*)$/.exec(lines[i]);
    if (!f) continue;
    let v = f[2].trim();
    const more = [];
    while (i + 1 < lines.length && /^(\s+\S|\s*$)/.test(lines[i + 1]) && !/^[A-Za-z_-]+:/.test(lines[i + 1])) more.push(lines[++i].trim());
    if (/^[>|][-+]?$/.test(v)) v = more.filter(Boolean).join(' ');
    else if (more.length && !/^\[/.test(v)) v = [v, ...more.filter(Boolean)].join(' ');
    v = v.replace(/^(['"])([\s\S]*)\1$/, '$2');
    const k = f[1].toLowerCase();
    if (k === 'name') out.name = v;
    else if (k === 'description') out.description = v;
    else if (k === 'disable-model-invocation') out.modelOff = v === 'true';
    else if (k === 'paths' || k === 'globs') out.paths = true;
  }
  return out;
}

// A CLAUDE.md file and the files it brings in with @path lines, as Claude Code reads them (up to 5 deep).
function withImports(file, seen, depth = 0) {
  const text = read(file);
  if (text == null || seen.has(key(file))) return [];
  seen.add(key(file));
  const out = [{ file, chars: text.length }];
  if (depth >= 5) return out;
  const plain = text.replace(/```[\s\S]*?```/g, '').replace(/`[^`]*`/g, '');
  for (const m of plain.matchAll(/(?:^|\s)@((?:~[\\/]|[A-Za-z]:[\\/]|\.{1,2}[\\/]|\/)?[^\s@)\]]+)/g)) {
    const ref = m[1].replace(/[.,;:]+$/, '');
    const home = process.env.USERPROFILE || process.env.HOME || '';
    const p = ref.startsWith('~') ? path.join(home, ref.slice(2)) : path.resolve(path.dirname(file), ref);
    if (fs.existsSync(p) && !isDir(p)) out.push(...withImports(p, seen, depth + 1).map((x) => ({ ...x, imported: true })));
  }
  return out;
}
// The rules files under a .claude/rules folder that always load (a file limited to some paths loads only there).
function rulesFiles(dir) {
  const out = [];
  const walk = (d) => { for (const n of list(d)) { const f = path.join(d, n); if (isDir(f)) walk(f); else if (n.endsWith('.md') && !frontmatter(read(f)).paths) out.push(f); } };
  walk(dir);
  return out;
}
// The skills (one folder each, with SKILL.md) and commands (.md files, a subfolder giving "sub:name") in a folder.
function skillsIn(dir) {
  const out = [];
  for (const n of list(dir)) {
    const f = path.join(dir, n, 'SKILL.md'), text = read(f);
    if (text == null) continue;
    const fm = frontmatter(text);
    if (!fm.modelOff) out.push({ name: fm.name || n, desc: fm.description, file: f });
  }
  return out;
}
function commandsIn(dir, prefix = '') {
  const out = [];
  for (const n of list(dir)) {
    const f = path.join(dir, n);
    if (isDir(f)) { out.push(...commandsIn(f, `${prefix}${n}:`)); continue; }
    if (!n.endsWith('.md')) continue;
    const fm = frontmatter(read(f));
    if (!fm.modelOff) out.push({ name: prefix + n.slice(0, -3), desc: fm.description, file: f });
  }
  return out;
}
// A listing line is "- name: description".
const listingChars = (s) => s.name.length + s.desc.length + 4;

// What loads at the start of a session, from the files. home: the desk's Claude home; config: its .claude.json
// (~/.claude.json for the standard home); folders: [{ dir, sessions, project }] the folders its sessions ran in,
// with how many sessions and the folder's name under <home>/projects. Each item says how many of those sessions
// load it.
export function measureFiles({ home, config, folders }) {
  const all = folders.length ? folders : [];
  const total = all.reduce((a, f) => a + f.sessions, 0) || 1;
  const items = new Map();
  const add = (k, item, sessions) => {
    const it = items.get(k) || { ...item, sessions: 0 };
    it.sessions += sessions; items.set(k, it);
  };
  const addFile = (kind, file, sessions, where) => {
    for (const x of withImports(file, new Set())) add(`${kind}|${key(x.file)}`, { kind, name: path.basename(x.file), path: x.file, where: x.imported ? `imported by ${path.basename(file)}` : where, chars: x.chars, tokens: tok(x.chars) }, sessions);
  };
  const addListing = (kind, s, sessions, where) => add(`${kind}|${s.name}`, { kind, name: s.name, path: s.file, where, desc: s.desc, chars: listingChars(s), tokens: tok(listingChars(s)), at: mtime(s.file) }, sessions);

  // The desk's own: in every session.
  addFile('claude-md', path.join(home, 'CLAUDE.md'), total, 'every session');
  for (const f of rulesFiles(path.join(home, 'rules'))) addFile('rules', f, total, 'every session');
  for (const s of skillsIn(path.join(home, 'skills'))) addListing('skill', s, total, 'every session');
  for (const s of commandsIn(path.join(home, 'commands'))) addListing('command', s, total, 'every session');
  const cfg = json(config) || {};
  const servers = new Map(); // mcp name -> { name, scope, sessions }
  const server = (name, scope, sessions) => { const k = mcpName(name); const s = servers.get(k) || { name, scope, sessions: 0 }; s.sessions = Math.min(total, s.sessions + sessions); servers.set(k, s); };
  for (const n of Object.keys(cfg.mcpServers || {})) server(n, 'user', total);
  const projects = Object.fromEntries(Object.entries(cfg.projects || {}).map(([k, v]) => [key(k), v]));
  const styles = new Map(); // style name -> sessions using it
  const homeStyle = json(path.join(home, 'settings.json'))?.outputStyle || '';

  // Each folder's own, for the sessions that ran there.
  const homes = new Set([real(home), real(path.join(os.homedir(), '.claude'))]);
  for (const f of all) {
    const ups = upFrom(f.dir);
    for (const d of ups) {
      for (const n of ['CLAUDE.md', 'CLAUDE.local.md', path.join('.claude', 'CLAUDE.md')]) if (fs.existsSync(path.join(d, n))) addFile('claude-md', path.join(d, n), f.sessions, d);
      for (const r of rulesFiles(path.join(d, '.claude', 'rules'))) addFile('rules', r, f.sessions, d);
      if (homes.has(real(path.join(d, '.claude')))) continue; // a Claude home (~/.claude, the desk's own) holds its skills, not a project's
      for (const s of skillsIn(path.join(d, '.claude', 'skills'))) addListing('skill', s, f.sessions, d);
      for (const s of commandsIn(path.join(d, '.claude', 'commands'))) addListing('command', s, f.sessions, d);
    }
    for (const n of Object.keys(json(path.join(f.dir, '.mcp.json'))?.mcpServers || {})) server(n, 'project', f.sessions);
    for (const n of Object.keys(projects[key(f.dir)]?.mcpServers || {})) server(n, 'local', f.sessions);
    const mem = path.join(home, 'projects', f.project || projectName(f.dir), 'memory', 'MEMORY.md'), text = read(mem);
    if (text != null) {
      const loaded = text.split('\n').slice(0, MEMORY_LINES).join('\n').slice(0, MEMORY_BYTES);
      add(`memory|${key(mem)}`, { kind: 'memory', name: 'MEMORY.md', path: mem, where: f.dir, chars: loaded.length, tokens: tok(loaded.length) }, f.sessions);
    }
    const own = (n) => json(path.join(f.dir, '.claude', n))?.outputStyle;
    const style = own('settings.local.json') || own('settings.json') || homeStyle;
    if (style && !/^default$/i.test(style)) styles.set(style, (styles.get(style) || 0) + f.sessions);
  }
  // The output style: a file of the desk's or a folder's, or one of Claude Code's own (about 300 tokens).
  for (const [style, sessions] of styles) {
    const dirs = [path.join(home, 'output-styles'), ...all.map((f) => path.join(f.dir, '.claude', 'output-styles'))];
    let file = null;
    for (const d of dirs) for (const n of list(d)) if (n.endsWith('.md') && !file) {
      const f = path.join(d, n);
      if (n.slice(0, -3).toLowerCase() === style.toLowerCase() || frontmatter(read(f)).name.toLowerCase() === style.toLowerCase()) file = f;
    }
    const chars = file ? read(file).length : 750;
    add(`output-style|${style}`, { kind: 'output-style', name: style, path: file || '', where: file ? '' : "Claude Code's own", chars, tokens: tok(chars) }, sessions);
  }
  return { total, items: [...items.values()], servers: [...servers.values()] };
}

// ---------- what the transcripts say was used ----------
// One transcript, read in steps: only what was added since the last look. Per session: its folder, its last
// entry's time, the skills and commands it ran, the MCP tools it called, the MCP tool names it was given, and
// the MCP servers that failed to connect.
const scans = new Map(); // file -> { offset, carry, ... }
const CHUNK = 4 << 20;
export async function scanFile(file) {
  let size; try { size = (await fs.promises.stat(file)).size; } catch { scans.delete(file); return null; }
  let s = scans.get(file);
  if (!s || size < s.offset) s = { offset: 0, cwd: '', last: 0, skills: new Set(), commands: new Set(), mcp: new Set(), deferred: new Set(), failed: new Map() };
  if (size > s.offset) {
    const fh = await fs.promises.open(file, 'r');
    try {
      let pos = s.offset, carry = Buffer.alloc(0);
      while (pos < size) {
        const chunk = Buffer.alloc(Math.min(CHUNK, size - pos));
        const { bytesRead } = await fh.read(chunk, 0, chunk.length, pos);
        if (!bytesRead) break;
        pos += bytesRead;
        const buf = carry.length ? Buffer.concat([carry, chunk.subarray(0, bytesRead)]) : chunk.subarray(0, bytesRead);
        const end = buf.lastIndexOf(10);
        if (end < 0) { carry = buf; continue; }
        for (const line of buf.subarray(0, end).toString('utf8').split('\n')) scanLine(s, line);
        // Up to the last whole line; a line still being written is read next time.
        carry = buf.subarray(end + 1);
        s.offset = pos - carry.length;
      }
    } finally { await fh.close(); }
  }
  scans.set(file, s);
  return s;
}
function scanLine(s, line) {
  if (!s.cwd) { const c = /"cwd":"((?:[^"\\]|\\.)*)"/.exec(line); if (c) { try { s.cwd = JSON.parse(`"${c[1]}"`); } catch {} } }
  const t = /"timestamp":"([^"]+)"/.exec(line);
  if (t) { const at = Date.parse(t[1]); if (at > s.last) s.last = at; }
  if (line.includes('"Skill"')) for (const m of line.matchAll(/"name":"Skill","input":\{"skill":"([^"]+)"/g)) s.skills.add(m[1].replace(/^\//, ''));
  if (line.includes('command-name>')) for (const m of line.matchAll(/<command-name>\/?([^<]+)<\/command-name>/g)) s.commands.add(m[1].trim());
  if (line.includes('mcp__')) for (const m of line.matchAll(/"type":"tool_use","id":"[^"]+","name":"(mcp__[^"]+)"/g)) s.mcp.add(m[1]);
  if (line.includes('"deferred_tools_delta"')) {
    let e; try { e = JSON.parse(line); } catch { return; }
    const a = e.attachment || {};
    if (a.type !== 'deferred_tools_delta') return;
    for (const n of a.addedNames || []) if (n.startsWith('mcp__')) s.deferred.add(n);
    for (const n of a.removedNames || []) s.deferred.delete(n);
    for (const f of a.failedMcpServers || []) if (f?.name) s.failed.set(mcpName(f.name), String(f.error || f.errorCode || ''));
  }
}

// What the sessions since `from` used. sessions: [{ project, scan }] (project: the folder's name under
// <home>/projects). Which MCP servers sessions are given today, their tool names and their failures come from
// the last two weeks only, and a server none of the 5 latest sessions was given is gone (taken out lately).
export function measureUse(sessions, from, now = Date.now()) {
  const recent = sessions.filter((x) => x.scan && x.scan.last >= from).sort((a, b) => a.scan.last - b.scan.last);
  const lately = recent.filter((x) => x.scan.last >= now - 14 * 864e5 && (x.scan.deferred.size || x.scan.failed.size));
  const latest = new Set(lately.slice(-5).flatMap((x) => [...[...x.scan.deferred].map((n) => n.split('__')[1]), ...x.scan.failed.keys()]));
  const count = (pick) => { const m = new Map(); for (const x of recent) for (const n of pick(x.scan)) m.set(n, (m.get(n) || 0) + 1); return m; };
  const folders = new Map();
  for (const x of recent) {
    const dir = x.scan.cwd; if (!dir) continue;
    const f = folders.get(key(dir)) || { dir, sessions: 0, project: x.project };
    f.sessions++; folders.set(key(dir), f);
  }
  const tools = new Map(), seen = new Map(), failed = new Map(); // server -> latest tool names / sessions given them / failures
  for (const x of lately) {
    const by = new Map();
    for (const n of x.scan.deferred) { const sv = n.split('__')[1]; if (!latest.has(sv)) continue; if (!by.has(sv)) by.set(sv, []); by.get(sv).push(n); }
    for (const [sv, names] of by) { tools.set(sv, names); seen.set(sv, (seen.get(sv) || 0) + 1); }
    for (const [sv, error] of x.scan.failed) {
      if (!latest.has(sv)) continue;
      const f = failed.get(sv) || { sessions: 0, error }; f.sessions++; f.error = error || f.error; failed.set(sv, f);
    }
  }
  return { sessions: recent.length, given: lately.length, folders: [...folders.values()], skills: count((s) => s.skills), commands: count((s) => s.commands), mcp: count((s) => s.mcp), tools, seen, failed };
}

// ---------- putting it together ----------
// files: measureFiles; use: measureUse; cost: { perToken } dollars a month for one token in every session's start.
// own: MCP servers that are Docket's own (not the desk's to slim). Each item gets its share of sessions, a status
// (ok, used, unused, big, long, part, failing, new, review), the part that could go, and its cost a month.
export function assess(files, use, { perToken = 0, own = [], now = Date.now(), o = SETUP_OFFER } = {}) {
  const share = (n) => Math.min(1, n / (files.total || 1));
  const ran = (name) => (use.skills.get(name) || 0) + (use.commands.get(name) || 0) + (use.skills.get(name.split(':').pop()) || 0);
  const out = [];
  for (const it of files.items) {
    const x = { ...it, share: share(it.sessions), status: it.kind === 'skill' || it.kind === 'command' ? 'used' : 'ok', slim: 0 };
    if (it.kind === 'skill' || it.kind === 'command') {
      x.uses = ran(it.name);
      if (!x.uses) { if (now - (it.at || 0) < o.newDays * 864e5) x.status = 'new'; else { x.status = 'unused'; x.slim = it.tokens; } }
      else if (it.desc.length > o.longDescChars) { x.status = 'long'; x.slim = tok(it.desc.length - o.longDescChars); }
    } else if (it.kind === 'output-style') x.status = 'review';
    else if (it.tokens > o.bigFileTokens) { x.status = 'big'; x.slim = it.tokens - o.bigFileTokens; }
    out.push(x);
  }
  // MCP servers: the ones set up for the desk, and any its sessions were given (a plugin's, a connector).
  const ownSet = new Set(own.map(mcpName));
  const names = new Map(files.servers.map((s) => [mcpName(s.name), s]));
  for (const k of [...use.tools.keys(), ...use.failed.keys()]) if (!names.has(k)) names.set(k, { name: k, scope: 'other', sessions: 0 });
  for (const [k, sv] of names) {
    if (ownSet.has(k)) continue;
    const tools = use.tools.get(k) || [];
    const called = [...use.mcp.keys()].filter((n) => n.startsWith(`mcp__${k}__`));
    const failed = use.failed.get(k);
    const given = use.seen.get(k) || 0;
    const sh = use.given ? Math.max(given, failed?.sessions || 0) / use.given : share(sv.sessions);
    const x = { kind: 'mcp', name: sv.name, scope: sv.scope, tools: tools.length, used: called.length, calls: called.reduce((a, n) => a + use.mcp.get(n), 0), share: Math.min(1, sh), status: 'used', slim: 0 };
    x.tokens = tools.reduce((a, n) => a + tok(n.length + 1), 0);
    if (failed && failed.sessions >= given) {
      x.status = 'failing'; x.error = failed.error;
      x.tokens = tok(sv.name.length + failed.error.length + 6) + Math.round(FAILED_NOTE / Math.max(1, use.failed.size));
      x.slim = x.tokens; x.share = Math.min(1, failed.sessions / (use.given || 1));
    } else if (!x.calls && tools.length) { x.status = 'unused'; x.slim = x.tokens; }
    else if (tools.length) {
      const unused = tools.filter((n) => !use.mcp.has(n));
      x.slim = unused.reduce((a, n) => a + tok(n.length + 1), 0);
      if (unused.length) { x.status = 'part'; x.unused = unused.length; }
    }
    if (x.tokens || x.status === 'failing') out.push(x);
  }
  for (const x of out) { x.monthly = x.tokens * x.share * perToken; x.slimMonthly = x.slim * x.share * perToken; }
  out.sort((a, b) => b.slimMonthly - a.slimMonthly || b.slim * b.share - a.slim * a.share || b.tokens * b.share - a.tokens * a.share);
  const sum = (f) => Math.round(out.reduce((a, x) => a + f(x), 0));
  return {
    at: now, sessions: use.sessions, start: sum((x) => x.tokens * x.share), slim: sum((x) => x.slim * x.share),
    monthly: Math.round(out.reduce((a, x) => a + x.monthly, 0) * 100) / 100, slimMonthly: Math.round(out.reduce((a, x) => a + x.slimMonthly, 0) * 100) / 100,
    items: out,
  };
}
// The start-of-session size from the files alone (no transcripts), to see a jump between full checks.
export const quickStart = (files) => Math.round(files.items.reduce((a, it) => a + it.tokens * Math.min(1, it.sessions / (files.total || 1)), 0));

// Dollars a month for one token that every session loads at its start: read again on every main call, and
// written to the cache once per session. rows: the desk's usage rows (costs.mjs) of the last `days` days;
// rates(model) gives a model's prices per million tokens.
export function costPerToken(rows, rates, days = SETUP_OFFER.costDays) {
  let calls = 0, read = 0, write = 0;
  const sessions = new Set();
  for (const r of rows) {
    if (r.Source !== 'main' || (r.Brand && r.Brand !== 'claude') || !r.Turns) continue;
    const p = rates(r.Model); if (!p) continue;
    const w1h = r.CacheCreate && r.CacheCreate1h / r.CacheCreate > 0.5;
    calls += r.Turns; sessions.add(r.SessionId);
    read += r.Turns * p.cacheRead; write += r.Turns * (w1h ? p.cacheWrite1h ?? p.cacheWrite5m : p.cacheWrite5m);
  }
  if (!calls) return { perToken: 0, calls: 0, sessions: 0 };
  const month = 30 / days;
  return { perToken: (read + (write / calls) * sessions.size) / 1e6 * month, calls: Math.round(calls * month), sessions: Math.round(sessions.size * month) };
}

// ---------- when to check, and when to offer ----------
// A full check is due weekly, or early when the start size from the files jumped since the last one.
export function checkDue({ last, quick, now = Date.now(), o = SETUP_OFFER }) {
  if (!last) return true;
  if (now - last.at >= o.everyDays * 864e5) return true;
  const base = last.quick ?? last.start;
  return quick - base >= o.jumpTokens && quick - base >= base * o.jumpShare;
}
const over = (r, o) => r.slim >= o.tokens || r.slimMonthly >= o.monthly;
const grew = (now, then, o) => now - then >= Math.max(o.changeTokens, then * o.changeShare);
// Whether to show the card: null, 'first' (never answered), 'again' (30 days after Not now or a session) or
// 'changed' (it grew noticeably since). answer: { answer: 'later'|'started', at, slim, start }.
export function setupOfferKind({ report, answer, now = Date.now(), o = SETUP_OFFER }) {
  if (!report || !over(report, o)) return null;
  if (!answer) return 'first';
  if (now - (answer.at || 0) >= o.laterDays * 864e5) return 'again';
  if (grew(report.slim, answer.slim || 0, o) || grew(report.start, answer.start || 0, o)) return 'changed';
  return null;
}

// ---------- words for the card and the session ----------
export const kTokens = (n) => (n >= 9950 ? `${Math.round(n / 1000)}k` : n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(Math.round(n)));
export const dollars = (n) => (n >= 10 ? `$${Math.round(n)}` : `$${n.toFixed(2)}`);
const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;
// The few biggest parts that could go, in a line each, for the card.
export function headlines(report, max = 3) {
  const by = (pred) => report.items.filter(pred);
  const total = (xs) => Math.round(xs.reduce((a, x) => a + x.slim * x.share, 0));
  const lines = [];
  const unusedSkills = by((x) => (x.kind === 'skill' || x.kind === 'command') && x.status === 'unused');
  if (unusedSkills.length) lines.push({ tokens: total(unusedSkills), text: `${unusedSkills.length === 1 ? '1 skill or command' : `${unusedSkills.length} skills and commands`} not used in ${SETUP_OFFER.usedDays} days` });
  for (const x of by((x) => x.status === 'big')) lines.push({ tokens: Math.round(x.slim * x.share), text: `${x.name} is ${kTokens(x.tokens)} tokens${x.where && x.where !== 'every session' ? ` (${x.where})` : ''}` });
  const mcpOff = by((x) => x.kind === 'mcp' && x.status === 'unused');
  if (mcpOff.length) lines.push({ tokens: total(mcpOff), text: `${plural(mcpOff.length, 'MCP server')} with no calls in ${SETUP_OFFER.usedDays} days (${mcpOff.map((x) => x.name).join(', ')})` });
  const part = by((x) => x.kind === 'mcp' && x.status === 'part');
  if (part.length) lines.push({ tokens: total(part), text: `${plural(part.reduce((a, x) => a + x.unused, 0), 'MCP tool')} never called` });
  const failing = by((x) => x.status === 'failing');
  if (failing.length) lines.push({ tokens: total(failing), text: `${plural(failing.length, 'MCP server')} failing to connect (${failing.map((x) => x.name).join(', ')})` });
  const long = by((x) => x.status === 'long');
  if (long.length) lines.push({ tokens: total(long), text: `${plural(long.length, 'long skill description')}` });
  return lines.filter((l) => l.tokens > 0 || /failing/.test(l.text)).sort((a, b) => b.tokens - a.tokens).slice(0, max);
}

const STATUS = { ok: 'fine', used: 'used', unused: 'not used in 60 days', big: 'over 3k tokens', long: 'long description', part: 'some tools never called',
  failing: 'fails to connect', new: 'added lately, not judged', review: 'loads every turn too' };
// The table of what was measured, for the session's first message.
export function itemTable(report, max = 60) {
  const rows = report.items.filter((x) => x.slim > 0 || (x.kind !== 'skill' && x.kind !== 'command') || x.status === 'new');
  const L = ['| What | Kind | Where | Tokens | Share of sessions | Could go | Status |', '|---|---|---|---:|---:|---:|---|'];
  for (const x of rows.slice(0, max)) {
    const what = x.kind === 'mcp' ? `${x.name} (${x.tools} tools, ${x.used} called, ${x.calls} sessions called it)` : x.path || x.name;
    const where = x.kind === 'mcp' ? x.scope : x.where || '';
    const status = x.kind === 'mcp' && x.status === 'failing' ? `fails to connect: ${x.error}` : x.status === 'part' ? `${x.unused} of ${x.tools} tools never called` : STATUS[x.status] || x.status;
    L.push(`| ${what.replace(/\|/g, '\\|')} | ${x.kind} | ${String(where).replace(/\|/g, '\\|')} | ${x.tokens} | ${Math.round(x.share * 100)}% | ${x.slim} | ${status} |`);
  }
  if (rows.length > max) L.push(`| …and ${rows.length - max} more | | | | | | |`);
  const used = report.items.filter((x) => (x.kind === 'skill' || x.kind === 'command') && x.status === 'used');
  if (used.length) L.push('', `Used in the last ${SETUP_OFFER.usedDays} days, kept: ${used.map((x) => `${x.name} (${x.uses})`).join(', ')}.`);
  return L.join('\n');
}
// The session's first message: the shipped prompt (prompts/optional/setup-slim.md) with this desk's numbers in it.
export function setupBrief(template, { desk, home, config, folder, backup, report, perToken }) {
  const h = headlines(report, 6).map((l) => `- ${l.text}: about ${kTokens(l.tokens)} tokens a session`).join('\n') || '- nothing over the threshold';
  const fill = {
    desk, home, config, folder, backup,
    start: kTokens(report.start), slim: kTokens(report.slim), monthly: dollars(report.monthly), slimMonthly: dollars(report.slimMonthly),
    sessions: String(report.sessions), days: String(SETUP_OFFER.usedDays), perChar: String(PER_CHAR),
    perThousand: dollars(perToken * 1000), headlines: h, table: itemTable(report),
  };
  return template.replace(/\{(\w+)\}/g, (m, k) => (k in fill ? fill[k] : m)).trim();
}
