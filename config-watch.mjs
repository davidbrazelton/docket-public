// Reloading a session when its Claude config changes (#564). A Claude Code process reads its plugins, hooks, connected
// services and settings once, when it starts, so a change to them reaches a running session only when Docket starts its
// process again with resume (same conversation). Rules (CLAUDE.md) are different: the model reads them again when told.
// The rules are here, apart from the server, so they can be tested; server.mjs watches, marks and reloads.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { workingNow } from './pause.mjs';

// The files a Claude session started in cwd reads at start, for the settings layers it loads (sources: the desk's
// settingSources, undefined for all three). kind says how a change to it is described.
export function configFiles({ home, cwd, sources }) {
  const on = (l) => !sources || sources.includes(l);
  const out = [];
  const add = (kind, file, label = '') => out.push({ kind, file: path.resolve(file), label });
  if (home && on('user')) {
    add('settings', path.join(home, 'settings.json'), "the desk's settings.json");
    add('settings', path.join(home, 'settings.local.json'), "the desk's settings.local.json");
    add('installed', path.join(home, 'plugins', 'installed_plugins.json'), 'installed plugins');
    add('marketplaces', path.join(home, 'plugins', 'known_marketplaces.json'), 'plugin marketplaces');
    add('hooks', path.join(home, 'hooks'), "the desk's hooks folder");
    add('rules', path.join(home, 'CLAUDE.md'));
    add('rulesDir', path.join(home, 'rules'));
  }
  if (cwd && on('project')) {
    add('settings', path.join(cwd, '.claude', 'settings.json'), "the folder's .claude/settings.json");
    add('mcp', path.join(cwd, '.mcp.json'), "the folder's .mcp.json");
    for (let d = path.resolve(cwd), up; ; d = up) { // CLAUDE.md in the folder and every folder above it
      add('rules', path.join(d, 'CLAUDE.md'));
      if ((up = path.dirname(d)) === d) break;
    }
    add('rules', path.join(cwd, '.claude', 'CLAUDE.md'));
    add('rulesDir', path.join(cwd, '.claude', 'rules'));
  }
  if (cwd && on('local')) {
    add('settings', path.join(cwd, '.claude', 'settings.local.json'), "the folder's .claude/settings.local.json");
    add('rules', path.join(cwd, 'CLAUDE.local.md'));
  }
  return out;
}

const JSON_KINDS = new Set(['settings', 'mcp', 'installed', 'marketplaces']);
// Claude Code takes permission changes in while it runs (and writes them itself when the person says "always allow"),
// so they are no reason to restart a session; nor are the terminal's own preferences, which the CLI writes as it is
// used and a session in Docket never reads.
const LIVE_KEYS = new Set(['permissions', '$schema', 'tui', 'theme', 'editorMode', 'feedbackSurveyState', 'autoUpdates', 'autoUpdatesChannel',
  'preferredNotifChannel', 'spinnerTipsEnabled', 'skipDangerousModePermissionPrompt', 'skipWorkflowUsageWarning']);

// One file's hash (and its JSON), read again only when its size or time changed. cache: a Map kept by the caller.
function readFile(file, cache) {
  let st; try { st = fs.statSync(file); } catch { return null; }
  if (!st.isFile()) return null;
  const sig = `${st.size}:${st.mtimeMs}`, had = cache?.get(file);
  if (had?.sig === sig) return had;
  let text = ''; try { text = fs.readFileSync(file, 'utf8'); } catch { return null; }
  const got = { sig, h: crypto.createHash('sha1').update(text).digest('hex').slice(0, 16), text };
  cache?.set(file, got);
  return got;
}
function walk(dir, max = 300) {
  const out = [];
  const go = (d) => {
    let list; try { list = fs.readdirSync(d, { withFileTypes: true }); } catch { return; }
    for (const e of list) {
      if (out.length >= max) return;
      const f = path.join(d, e.name);
      if (e.isDirectory()) { if (e.name !== 'node_modules' && e.name !== '.git') go(f); } else if (e.isFile()) out.push(f);
    }
  };
  go(dir);
  return out.sort();
}
const parse = (text) => { try { const j = JSON.parse(text.replace(/^\uFEFF/, '')); return j && typeof j === 'object' && !Array.isArray(j) ? j : undefined; } catch { return undefined; } };
const withoutLive = (j) => j && Object.fromEntries(Object.entries(j).filter(([k]) => !LIVE_KEYS.has(k)));

// What the files hold now: { [file]: { kind, label, h, json?, list? } }. A missing file is left out.
export function readPrint(files, cache) {
  const print = {};
  for (const f of files) {
    if (f.kind === 'hooks') {
      const list = {};
      for (const x of walk(f.file)) { const r = readFile(x, cache); if (r) list[path.relative(f.file, x)] = r.h; }
      if (Object.keys(list).length) print[f.file] = { kind: f.kind, label: f.label, h: hashOf(list), list };
    } else if (f.kind === 'rulesDir') {
      for (const x of walk(f.file).filter((x) => /\.md$/i.test(x))) { const r = readFile(x, cache); if (r) print[x] = { kind: 'rules', h: r.h }; }
    } else {
      const r = readFile(f.file, cache);
      if (!r) continue;
      const json = JSON_KINDS.has(f.kind) ? parse(r.text) : undefined;
      print[f.file] = { kind: f.kind, label: f.label, h: r.h, ...(json ? { json: f.kind === 'settings' ? withoutLive(json) : json } : {}) };
    }
  }
  return print;
}
const hashOf = (v) => crypto.createHash('sha1').update(JSON.stringify(v)).digest('hex').slice(0, 16);
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

function settingsChanges(a = {}, b = {}) {
  const out = [];
  for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) {
    if (LIVE_KEYS.has(k) || same(a[k], b[k])) continue;
    if (k === 'enabledPlugins') {
      const pa = a[k] || {}, pb = b[k] || {};
      for (const p of new Set([...Object.keys(pa), ...Object.keys(pb)])) if (!!pa[p] !== !!pb[p]) out.push(`plugin ${p} turned ${pb[p] ? 'on' : 'off'}`);
    } else if (k === 'hooks') {
      const ha = a[k] || {}, hb = b[k] || {};
      for (const e of new Set([...Object.keys(ha), ...Object.keys(hb)])) if (!same(ha[e], hb[e])) out.push(`${e} hooks ${!ha[e] ? 'added' : !hb[e] ? 'removed' : 'edited'}`);
    } else if (k === 'mcpServers') out.push('connected services (mcpServers) changed');
    else out.push(`${k} changed`);
  }
  return out;
}
const keysChanged = (a = {}, b = {}, what, added, removed, edited) => [...new Set([...Object.keys(a), ...Object.keys(b)])]
  .filter((k) => !same(a[k], b[k])).map((k) => `${what} ${k} ${!(k in a) ? added : !(k in b) ? removed : edited}`);

function describe(kind, a, b) {
  const label = (a || b).label;
  const unreadable = (a && !a.json && kind !== 'hooks') || (b && !b.json && kind !== 'hooks');
  if (unreadable && JSON_KINDS.has(kind)) return [`${label} edited`];
  if (kind === 'settings') return settingsChanges(a?.json, b?.json).map((x) => `${x} (${label})`);
  if (kind === 'mcp') return keysChanged(a?.json?.mcpServers, b?.json?.mcpServers, 'connected service', 'added', 'removed', 'changed').map((x) => `${x} (${label})`);
  if (kind === 'installed') return keysChanged(a?.json?.plugins, b?.json?.plugins, 'plugin', 'installed', 'uninstalled', 'updated');
  if (kind === 'hooks') return keysChanged(a?.list, b?.list, 'hook file', 'added', 'removed', 'edited').map((x) => `${x} (${label})`);
  return [`${label} changed`];
}

// What changed between the config a session started with and now: reload, the changes only a restart takes in, as
// lines to show; rules, the rules files whose text changed (the session is told to read them again).
export function configChanges(before = {}, after = {}) {
  const reload = [], rules = [];
  for (const file of new Set([...Object.keys(before), ...Object.keys(after)])) {
    const a = before[file], b = after[file];
    if (a?.h === b?.h) continue;
    const kind = (a || b).kind;
    if (kind === 'rules') rules.push(file);
    else reload.push(...describe(kind, a, b));
  }
  return { reload, rules };
}

// The line added to a session's next turn when its rules files changed.
export const rulesNote = (files) => `(From Docket: your rules file changed since this session started; re-read ${files.join(', ')}.)`;
// The line added to the first turn after a reload.
export const reloadNote = (changes) => `(From Docket: Docket restarted this session while it was idle, with the same conversation, to load changed config: ${changes.join('; ')}.)`;

// What to do about a session now. 'reload': restart its process now. 'wait': it is working, so not yet. 'ask': it is
// idle, but its desk is set to Ask and nobody pressed Reload. 'none': nothing to take in, or it is not a Claude session.
// mode: the desk's setting ('auto' unless 'ask'); wanted: the person pressed Reload or Reload all.
export function reloadDecision({ engine = 'claude', changes = [], mode = 'auto', wanted = false, status, runningJobs = 0, heldTurn = false, asks = 0, reloading = false }) {
  if (engine !== 'claude' || reloading || !changes.length || status === 'ended') return 'none';
  if (status !== 'idle' || asks > 0 || workingNow({ status, heldTurn }, runningJobs)) return 'wait';
  return mode === 'ask' && !wanted ? 'ask' : 'reload';
}
