// How long steps usually take (#847). Every finished command step (a foreground Bash or PowerShell call, or one sent
// to the background) is kept per repo and command, so when the same step runs again in the same repo the chat row,
// the Tasks running list and the session itself can say how long it usually takes.
//
// A step's key is its repo and its command. The repo is the origin remote's URL, so every worktree and clone of one
// repo share their history, and `npm test` in one repo is never compared with `npm test` in another; a repo with no
// remote falls back to its main folder, and a command run outside a git repo has no key and is not kept. The command
// loses a leading `cd <dir> &&`, and paths inside the repo become relative, so the same step in two worktrees matches;
// arguments stay (`npm test` and `npm test -- one.test.js` are two steps).
//
// The typical time is the median of the last RUNS_KEPT successful runs; failed and stopped runs are kept apart and
// never mixed in. The history lives per computer in <data>/step-times.json, seeded once from past session transcripts.
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';

export const RUNS_KEPT = 20, FAILS_KEPT = 10;
export const SHOW_OVER_MS = 15000; // a step that usually takes less is not worth an estimate
export const STEP_TOOLS = new Set(['Bash', 'PowerShell']);

// ---------- the key ----------
// An origin URL in one spelling for every way of writing it: git@github.com:a/b.git, https://github.com/a/b and
// ssh://git@github.com/a/b.git all become github.com/a/b.
export function normalizeRemote(url) {
  let u = String(url || '').trim();
  if (!u) return '';
  u = u.replace(/^[a-z+]+:\/\//i, '').replace(/^[^@/]+@/, ''); // scheme, then user@
  u = u.replace(/^([^/:]+):(?!\d+\/)/, '$1/'); // scp form host:owner/repo
  u = u.replace(/^([^/:]+):\d+\//, '$1/'); // a port
  return u.replace(/\.git\/?$/i, '').replace(/\/+$/, '').toLowerCase();
}

const slash = (p) => String(p || '').replace(/\\/g, '/');
// A Git Bash path (/c/Projects/x) in Windows form (C:/Projects/x), so both spellings of a folder match.
const fromBash = (p) => slash(p).replace(/^\/([a-z])(?=\/|$)/i, (_, d) => `${d.toUpperCase()}:`);
const reEsc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// The folder a command runs in: a leading `cd <dir>` (absolute, or relative to cwd), else cwd.
export function commandDir(command, cwd) {
  const m = String(command || '').match(/^\s*(?:cd|Set-Location|pushd)\s+("[^"]+"|'[^']+'|[^\s;&|]+)\s*(?:&&|;|\|\|)/i);
  if (!m) return cwd || '';
  const d = fromBash(m[1].replace(/^["']|["']$/g, ''));
  if (/^([a-z]:)?\//i.test(d)) return d;
  return cwd ? path.join(cwd, d) : '';
}

// The command as a step: no leading cd, the repo's own folder (any worktree's root, in any spelling) written as ".",
// temp folders as <tmp>, and spaces collapsed. roots: the folders to make relative, longest first.
export function normalizeCommand(command, roots = []) {
  let c = String(command || '').trim();
  for (let i = 0; i < 3; i++) {
    const next = c.replace(/^\s*(?:cd|Set-Location|pushd)\s+("[^"]+"|'[^']+'|[^\s;&|]+)\s*(?:&&|;|\|\|)\s*/i, '');
    if (next === c) break;
    c = next;
  }
  for (const r of [...roots].filter(Boolean).map(slash).sort((a, b) => b.length - a.length)) {
    const bash = r.replace(/^([a-z]):/i, (_, d) => `/${d.toLowerCase()}`);
    for (const form of new Set([r, r.replace(/\//g, '\\'), bash])) {
      c = c.replace(new RegExp(`(["']?)${reEsc(form)}(?=[\\\\/"'\\s;&|)]|$)`, 'gi'), '$1.');
    }
  }
  c = c.replace(/(?:[a-z]:)?[\\/][^\s"']*?[\\/](?:AppData[\\/]Local[\\/]Temp|tmp|Temp)[\\/][^\s"';&|]*/gi, '<tmp>')
    .replace(/(^|[\s"'=])\/tmp\/[^\s"';&|]*/g, '$1<tmp>');
  return dropOutputFilters(c.replace(/\s+/g, ' ').trim());
}

// What the step prints through (`| grep …`, `| head`, `2>&1`) changes what is shown, not how long it takes, so
// `npm test 2>&1 | tail -5` is the same step as `npm test`.
const FILTERS = /^(?:head|tail|grep|egrep|rg|sed|cut|wc|sort|uniq|tr|cat|less|more|jq|Select-Object|Select-String|Out-String|Out-Null|Format-\w+|findstr)$/i;
function dropOutputFilters(c) {
  const parts = [];
  let cur = '', q = '';
  for (let i = 0; i < c.length; i++) { // split on pipes outside quotes; || is not a pipe
    const ch = c[i];
    if (q) { if (ch === q) q = ''; cur += ch; continue; }
    if (ch === '"' || ch === "'") { q = ch; cur += ch; continue; }
    if (ch === '|' && c[i + 1] !== '|' && c[i - 1] !== '|') { parts.push(cur); cur = ''; continue; }
    cur += ch;
  }
  parts.push(cur);
  while (parts.length > 1 && FILTERS.test(parts[parts.length - 1].trim().split(/\s+/)[0])) parts.pop();
  return parts.join('|').replace(/\s*\d?>&\d\s*$/, '').replace(/\s+2>&1(?=\s|$)/g, '').replace(/\s+/g, ' ').trim();
}

// The repo a folder belongs to, read from the files (no git process): { root, repo } where root is the folder holding
// .git (a worktree's own folder) and repo the normalised origin URL, or "dir:<main folder>" with no origin. null
// outside a git repo. Cached per folder; a worktree's .git file names its git folder, whose commondir is the main one.
export function repoOf(dir, cache = new Map()) {
  if (!dir) return null;
  const start = path.resolve(fromBash(dir));
  if (cache.has(start)) return cache.get(start);
  let found = null;
  for (let d = start, i = 0; i < 40; i++) {
    const dotgit = path.join(d, '.git');
    let st = null;
    try { st = fs.statSync(dotgit); } catch {}
    if (st) {
      let gitDir = dotgit;
      if (st.isFile()) {
        const m = readText(dotgit).match(/gitdir:\s*(.+)/);
        if (m) gitDir = path.resolve(d, m[1].trim());
      }
      const common = readText(path.join(gitDir, 'commondir')).trim();
      const commonDir = common ? path.resolve(gitDir, common) : gitDir;
      const url = originUrl(readText(path.join(commonDir, 'config')));
      found = { root: slash(d), repo: url ? normalizeRemote(url) : 'dir:' + slash(path.dirname(commonDir)).toLowerCase() };
      break;
    }
    const up = path.dirname(d);
    if (up === d) break;
    d = up;
  }
  cache.set(start, found);
  return found;
}
const readText = (f) => { try { return fs.readFileSync(f, 'utf8'); } catch { return ''; } };
function originUrl(config) {
  const m = config.match(/\[remote "origin"\]([\s\S]*?)(?=\n\s*\[|$)/);
  return m?.[1].match(/^\s*url\s*=\s*(.+)$/m)?.[1].trim() || '';
}

// The key for a command run in cwd: "<repo>\n<normalised command>", or null outside a git repo.
export function stepKey(command, cwd, cache) {
  const r = repoOf(commandDir(command, cwd), cache) || repoOf(cwd, cache);
  if (!r) return null;
  const cmd = normalizeCommand(command, [r.root, cwd && repoOf(cwd, cache)?.root]);
  return cmd ? `${r.repo}\n${cmd}` : null;
}

// ---------- the history ----------
export const emptyHistory = () => ({ v: 1, seeded: 0, steps: {} });

// One finished run. ok: it succeeded; status: 'failed' or 'stopped' when it did not.
export function addRun(hist, key, { ms, ok, at = Date.now(), status }) {
  if (!key || !(ms >= 0)) return;
  const e = hist.steps[key] ||= { ok: [], bad: [] };
  if (ok) { e.ok.push([at, Math.round(ms)]); e.ok.sort((a, b) => a[0] - b[0]); if (e.ok.length > RUNS_KEPT) e.ok.splice(0, e.ok.length - RUNS_KEPT); }
  else { e.bad.push([at, Math.round(ms), status || 'failed']); e.bad.sort((a, b) => a[0] - b[0]); if (e.bad.length > FAILS_KEPT) e.bad.splice(0, e.bad.length - FAILS_KEPT); }
}

export function median(xs) {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b), mid = s.length >> 1;
  return s.length % 2 ? s[mid] : Math.round((s[mid - 1] + s[mid]) / 2);
}

// How long a step usually takes: { ms, runs, failed } from its successful runs only, or null with none.
export function typical(hist, key) {
  const e = key && hist.steps[key];
  if (!e?.ok.length) return null;
  return { ms: median(e.ok.map(([, ms]) => ms)), runs: e.ok.length, failed: e.bad.length };
}
// The same, only when it is long enough to be worth saying.
export function usualFor(hist, key) {
  const t = typical(hist, key);
  return t && t.ms >= SHOW_OVER_MS ? t : null;
}

// "~2m 30s", "~45s", "~1h 5m": rounded so it reads as an estimate.
export function roughTime(ms) {
  const s = Math.round(ms / 1000);
  if (s < 60) return `~${s < 20 ? s : Math.round(s / 5) * 5}s`;
  if (s < 3600) { const r = Math.round(s / 10) * 10, m = Math.floor(r / 60), x = r % 60; return `~${m}m${x ? ` ${x}s` : ''}`; }
  const m = Math.round(s / 60); return `~${Math.floor(m / 60)}h${m % 60 ? ` ${m % 60}m` : ''}`;
}
// Well past its usual time: twice as long, and at least a minute over.
export const wellPast = (elapsed, usualMs) => elapsed > 2 * usualMs && elapsed - usualMs > 60000;

// What the session is told before such a step runs (a PreToolUse hook's additional context).
export function estimateNote(t) {
  return `Docket: this command usually takes about ${roughTime(t.ms).slice(1)} in this repo (median of ${t.runs} earlier successful run${t.runs === 1 ? '' : 's'}${t.failed ? `; ${t.failed} failed or stopped run${t.failed === 1 ? '' : 's'} not counted` : ''}). Pick timeouts and waits to match.`;
}

// Most steps run once (a one-off grep), so the history keeps the KEYS_KEPT steps run most recently.
export const KEYS_KEPT = 3000;
export function trimHistory(hist, keep = KEYS_KEPT) {
  const keys = Object.keys(hist.steps);
  if (keys.length <= keep) return;
  const last = (k) => { const e = hist.steps[k]; return Math.max(e.ok.at(-1)?.[0] || 0, e.bad.at(-1)?.[0] || 0); };
  for (const k of keys.sort((a, b) => last(b) - last(a)).slice(keep)) delete hist.steps[k];
}

export function loadHistory(file) {
  try { const j = JSON.parse(fs.readFileSync(file, 'utf8')); if (j?.steps) return j; } catch {}
  return emptyHistory();
}
export function saveHistory(file, hist) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = file + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(hist));
  fs.renameSync(tmp, file);
}

// ---------- seeding from past transcripts ----------
// The runs one transcript holds: a Bash/PowerShell call's assistant line (its time and cwd) and its tool_result's
// line; for a call sent to the background, the <task-notification> that names its tool-use id ends it instead.
// Calls that never answered are left out. Returns [{ command, cwd, ms, ok, status, at }].
const NOTICE = /<task-notification>[\s\S]*?<tool-use-id>([^<]+)<\/tool-use-id>[\s\S]*?<status>(\w+)<\/status>/g;
export async function transcriptRuns(file) {
  const calls = new Map(), out = [];
  const rl = readline.createInterface({ input: fs.createReadStream(file, { encoding: 'utf8' }), crlfDelay: Infinity });
  for await (const line of rl) {
    const isCall = line.includes('"tool_use"') && (line.includes('"name":"Bash"') || line.includes('"name":"PowerShell"'));
    const ids = calls.size && (line.includes('tool_result') || line.includes('<task-notification>')) ? [...line.matchAll(/toolu_\w+/g)].map((m) => m[0]).filter((id) => calls.has(id)) : [];
    if (!isCall && !ids.length) continue;
    let j; try { j = JSON.parse(line); } catch { continue; }
    if (j.isSidechain) continue;
    const at = Date.parse(j.timestamp) || 0;
    if (isCall && j.type === 'assistant') {
      for (const b of j.message?.content || []) {
        if (b.type === 'tool_use' && STEP_TOOLS.has(b.name) && b.input?.command) calls.set(b.id, { command: b.input.command, cwd: j.cwd || '', start: at, bg: b.input.run_in_background === true });
      }
    }
    if (!ids.length) continue;
    if (j.type === 'user' && Array.isArray(j.message?.content)) {
      for (const b of j.message.content) {
        const c = b.type === 'tool_result' && calls.get(b.tool_use_id);
        if (!c) continue;
        if (c.bg && !b.is_error) continue; // it only started; its notification ends it
        calls.delete(b.tool_use_id);
        out.push({ command: c.command, cwd: c.cwd, ms: at - c.start, ok: !b.is_error, status: b.is_error ? 'failed' : 'completed', at });
      }
    }
    const text = typeof j.content === 'string' ? j.content : typeof j.message?.content === 'string' ? j.message.content
      : (j.message?.content || []).map((b) => (typeof b.text === 'string' ? b.text : typeof b.content === 'string' ? b.content : '')).join('\n');
    for (const [, id, status] of String(text).matchAll(NOTICE)) {
      const c = calls.get(id);
      if (!c?.bg) continue;
      calls.delete(id);
      out.push({ command: c.command, cwd: c.cwd, ms: at - c.start, ok: status === 'completed', status: status === 'killed' ? 'stopped' : status, at });
    }
  }
  return out;
}

// Seed hist from the transcripts under each Claude home's projects folder, changed in the last maxDays and before
// `before` (runs after it are recorded live). Reads one file at a time so it never holds the app up for long.
export async function seedHistory(hist, homes, { before = Date.now(), maxDays = 90, cache = new Map(), log = () => {} } = {}) {
  const files = [];
  for (const home of new Set(homes.filter(Boolean))) {
    const projects = path.join(home, 'projects');
    let dirs = [];
    try { dirs = fs.readdirSync(projects, { withFileTypes: true }).filter((d) => d.isDirectory()); } catch { continue; }
    for (const d of dirs) {
      let names = [];
      try { names = fs.readdirSync(path.join(projects, d.name)).filter((n) => n.endsWith('.jsonl')); } catch { continue; }
      for (const n of names) {
        const f = path.join(projects, d.name, n);
        try { if (fs.statSync(f).mtimeMs > before - maxDays * 86400000) files.push(f); } catch {}
      }
    }
  }
  let runs = 0;
  for (const f of files) {
    let found = [];
    try { found = await transcriptRuns(f); } catch (e) { log(`${f}: ${e.message}`); continue; }
    for (const r of found) {
      if (r.at >= before || r.ms < 0) continue;
      const key = stepKey(r.command, r.cwd, cache);
      if (key) { addRun(hist, key, r); runs++; }
    }
    await new Promise((res) => setImmediate(res));
  }
  hist.seeded = before;
  trimHistory(hist);
  return { files: files.length, runs };
}
