// The setup wizard's working folder: where this person already works, from their own AI history on this computer
// (nothing is sent anywhere). Kept apart from server.mjs so the tests can try it on made-up history files.
import fs from 'node:fs';
import path from 'node:path';

// Up to this many bytes of a session log are read to find its folder: the folder is near the top.
const HEAD = 64 * 1024;
export function head(file, bytes = HEAD) {
  let fd; try { fd = fs.openSync(file, 'r'); const b = Buffer.alloc(bytes); return b.toString('utf8', 0, fs.readSync(fd, b, 0, bytes, 0)); }
  catch { return ''; } finally { if (fd !== undefined) fs.closeSync(fd); }
}
const dirs = (p) => { try { return fs.readdirSync(p, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name); } catch { return []; } };
const files = (p, re) => { try { return fs.readdirSync(p).filter((n) => re.test(n)); } catch { return []; } };
export const cwdIn = (text) => { const m = text.match(/"cwd"\s*:\s*("(?:[^"\\]|\\.)*")/); try { return m ? JSON.parse(m[1]) : null; } catch { return null; } };

// Every folder the history names, with what named it: { path, claude, codex, grok (sessions), claudeJson, vscode, usual }.
// Paths come as written (c:/Projects, C:\Projects); tidy() below merges the spellings and drops the ones to leave out.
// claudeHomes: the Claude home folders whose saved sessions count (~/.claude, and each company's when adding another).
// read: how the top of a Claude session log is read (the tests count the reads).
export function readHistory({ userHome, appData, claudeHomes = [path.join(userHome, '.claude')], codexHome = path.join(userHome, '.codex'), grokHome = path.join(userHome, '.grok'), read = head }) {
  const out = [];
  const add = (p, what, n = 1) => { if (p && typeof p === 'string') out.push({ path: p, [what]: n }); };
  // Claude Code: every folder it was opened in (~/.claude.json), and its saved sessions, one folder of logs per working folder.
  try { for (const p of Object.keys(JSON.parse(fs.readFileSync(path.join(userHome, '.claude.json'), 'utf8')).projects || {})) add(p, 'claudeJson'); } catch {}
  for (const projects of claudeHomes.map((h) => path.join(h, 'projects'))) for (const d of dirs(projects)) {
    const logs = files(path.join(projects, d), /\.jsonl$/i);
    // The folder name is the working folder with every \ : and . turned into -, which cannot be turned back; a log says it.
    // Only until one says it: a company home can hold a thousand logs, and each read is up to 64 KB.
    let cwd = null;
    for (const n of logs) if ((cwd = cwdIn(read(path.join(projects, d, n))))) break;
    if (cwd) add(cwd, 'claude', logs.length);
  }
  // Codex: sessions\<year>\<month>\<day>\rollout-*.jsonl, each starting with its working folder. The newest 2000 are enough.
  const rollouts = [];
  const cs = path.join(codexHome, 'sessions');
  for (const y of dirs(cs)) for (const m of dirs(path.join(cs, y))) for (const d of dirs(path.join(cs, y, m)))
    for (const n of files(path.join(cs, y, m, d), /\.jsonl$/i)) rollouts.push(path.join(cs, y, m, d, n));
  for (const f of rollouts.sort().reverse().slice(0, 2000)) add(cwdIn(head(f, 8192)), 'codex');
  // Grok: sessions\<working folder, URL-encoded>\<session id>.
  for (const d of dirs(path.join(grokHome, 'sessions'))) {
    let p = null; try { p = decodeURIComponent(d); } catch {}
    add(p, 'grok', dirs(path.join(grokHome, 'sessions', d)).length);
  }
  // VS Code: the folders in its window list and recent workspaces (file:///c%3A/Projects/x).
  if (appData) {
    let text = ''; try { text = fs.readFileSync(path.join(appData, 'Code', 'User', 'globalStorage', 'storage.json'), 'utf8'); } catch {}
    const seen = new Set();
    for (const [u] of text.matchAll(/file:\/\/\/[^"\s]+/g)) {
      let p; try { p = decodeURIComponent(u.slice('file:///'.length)); } catch { continue; }
      if (process.platform !== 'win32' || !/^[A-Za-z]:/.test(p)) p = '/' + p;
      if (!/\.code-workspace$/i.test(p) && !seen.has(p.toLowerCase())) { seen.add(p.toLowerCase()); add(p, 'vscode'); }
    }
  }
  // The usual code folders: each project in them.
  for (const u of [path.join(userHome, 'source', 'repos'), path.join(userHome, 'Documents', 'GitHub')])
    for (const d of dirs(u)) if (!d.startsWith('.')) add(path.join(u, d), 'usual');
  return out;
}

// Merges the spellings of one folder (c:/Projects and C:\Projects are one folder on Windows), with the spelling the disk
// uses, and leaves out folders that no longer exist, git worktrees (a .git file, not a folder, as in .claude\worktrees\x),
// folders inside a hidden folder (.claude, .codex) or AppData, and the user folder itself.
export function tidy(entries, { userHome, win = process.platform === 'win32' }) {
  const key = (p) => win ? p.toLowerCase() : p;
  const home = key(path.resolve(userHome)), appData = key(path.join(path.resolve(userHome), 'AppData'));
  const byKey = new Map(), real = new Map();
  for (const e of entries) {
    const asked = path.resolve(e.path);
    if (!real.has(key(asked))) {
      let r = null;
      try { r = fs.realpathSync.native(asked); if (!fs.statSync(r).isDirectory()) r = null; } catch {}
      if (r && (fs.existsSync(path.join(r, '.git')) && !fs.statSync(path.join(r, '.git')).isDirectory())) r = null;
      if (r && path.relative(path.parse(r).root, r).split(path.sep).some((s) => s.startsWith('.'))) r = null;
      if (r && (key(r) === home || key(r) === appData || key(r).startsWith(appData + path.sep))) r = null;
      real.set(key(asked), r);
    }
    const r = real.get(key(asked)); if (!r) continue;
    const f = byKey.get(key(r)) || { path: r, claude: 0, codex: 0, grok: 0, claudeJson: false, vscode: false, usual: false };
    for (const k of ['claude', 'codex', 'grok']) f[k] += e[k] || 0;
    for (const k of ['claudeJson', 'vscode', 'usual']) f[k] ||= !!e[k];
    byKey.set(key(r), f);
  }
  return [...byKey.values()];
}

// The folder most of the work sits under: on a computer whose projects are C:\Projects\a, C:\Projects\b, that is
// C:\Projects; on one with V:\a and V:\b, it is V:\. It walks down from the drive holding the most folders, into the
// part holding most of them (60%), and stops above a folder that is itself a project (one with nothing worked in below
// it). Never the user folder or a folder above it (C:\Users, C:\): from those it goes on into the biggest part, and
// gives nothing when there is none.
export function pickRoot(folders, { userHome, win = process.platform === 'win32' }) {
  const key = (p) => win ? p.toLowerCase() : p;
  const nodes = new Map();
  const node = (p) => { const k = key(p); if (!nodes.has(k)) nodes.set(k, { path: p, count: 0, kids: new Set() }); return nodes.get(k); };
  const tops = new Set();
  for (const f of folders) {
    const chain = [];
    for (let p = f.path; ; p = path.dirname(p)) { chain.unshift(p); if (path.dirname(p) === p) break; }
    tops.add(key(chain[0]));
    chain.forEach((p, i) => { const n = node(p); n.count++; if (chain[i + 1]) n.kids.add(key(chain[i + 1])); });
  }
  const above = new Set();
  for (let p = path.resolve(userHome); ; p = path.dirname(p)) { above.add(key(p)); if (path.dirname(p) === p) break; }
  let at = [...tops].map((k) => nodes.get(k)).sort((a, b) => b.count - a.count)[0];
  while (at) {
    const best = [...at.kids].map((k) => nodes.get(k)).sort((a, b) => b.count - a.count)[0];
    if (!best) break;
    if (above.has(key(at.path))) { at = best; continue; }
    if (!best.kids.size || best.count < at.count * 0.6) break;
    at = best;
  }
  return at && !above.has(key(at.path)) ? at.path : null;
}

// The setups this person already has, which the wizard offers to reuse: ~/.claude, ~/.codex and ~/.grok, each when its
// program is installed, the folder exists, and no company uses it already (taken: lower-cased full paths). Whether it is
// signed in is asked of the program afterwards; only a signed-in one is offered.
export function existingHomes({ userHome, installed = {}, taken = [] }) {
  const out = {};
  for (const [e, dir] of [['claude', '.claude'], ['codex', '.codex'], ['grok', '.grok']]) {
    const home = path.join(path.resolve(userHome), dir);
    if (installed[e] && fs.existsSync(home) && !taken.includes(home.toLowerCase())) out[e] = home;
  }
  return out;
}

const plural = (n, one) => `${n} ${one}${n === 1 ? '' : 's'}`;
// Where a folder came from, in words: "used in 40 Claude Code sessions and 3 Codex sessions, opened in VS Code".
export function sourceText(f) {
  const used = [f.claude && plural(f.claude, 'Claude Code session'), f.codex && plural(f.codex, 'Codex session'), f.grok && plural(f.grok, 'Grok session')].filter(Boolean);
  const opened = [!f.claude && f.claudeJson && 'Claude Code', f.vscode && 'VS Code'].filter(Boolean);
  const parts = [used.length && 'used in ' + used.join(' and '), opened.length && 'opened in ' + opened.join(' and '), !used.length && !opened.length && f.usual && 'in your usual code folder'].filter(Boolean);
  return parts.join(', ');
}

// What the wizard shows: the suggested working folder (or null: nothing found, so the wizard keeps its own suggestion),
// why, and up to `limit` other folders found, the most used first, each with where it came from.
export function workFolders(opts, limit = 8) {
  const win = opts.win ?? process.platform === 'win32';
  const found = tidy(readHistory(opts), { userHome: opts.userHome, win });
  const suggested = pickRoot(found, { userHome: opts.userHome, win });
  const key = (p) => win ? p.toLowerCase() : p;
  const score = (f) => f.claude + f.codex + f.grok + (f.claudeJson ? 1 : 0) + (f.vscode ? 1 : 0);
  const same = (p) => !!suggested && key(p) === key(suggested);
  const under = (p, dir) => key(p).startsWith(key(dir).replace(/[\\/]$/, '') + path.sep);
  // First the folders holding three or more of them (C:\Work\apps), then single folders not inside one of those.
  const parents = new Map();
  for (const f of found) { const d = path.dirname(f.path); if (d !== f.path) parents.set(key(d), { path: d, n: (parents.get(key(d))?.n || 0) + 1 }); }
  const groups = [...parents.values()].filter((g) => g.n >= 3 && !same(g.path) && !(suggested && under(suggested, g.path)))
    .sort((a, b) => b.n - a.n || a.path.localeCompare(b.path)).slice(0, 3);
  const singles = found.filter((f) => !same(f.path) && !groups.some((g) => key(g.path) === key(f.path) || under(f.path, g.path)))
    .sort((a, b) => score(b) - score(a) || a.path.localeCompare(b.path));
  const others = [...groups.map((g) => ({ path: g.path, from: `holds ${g.n} folders you worked in` })),
    ...singles.map((f) => ({ path: f.path, from: sourceText(f) }))].slice(0, limit);
  const inside = suggested ? found.filter((f) => same(f.path) || under(f.path, suggested)).length : 0;
  return { suggested, why: suggested ? `${plural(inside, 'folder')} you worked in ${inside === 1 ? 'is' : 'are'} in it, of ${found.length} found on this computer.` : '', others, total: found.length };
}
