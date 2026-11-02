// Copying a desk as a new desk: its setup, connections and groups, never its sessions. Kept apart from
// server.mjs so the tests can try it on made-up homes.
//
// copyPlan reads the source and says what the copy would do, changing nothing: copy[] (each brand's files and folders
// that are copied, from -> to, some with their new text already worked out), rewrite[] (the copied text files whose
// paths into the source home are changed to the new home), warnings[], outside[] (paths outside the home that the
// copy keeps pointing at, live), mcp[] (the MCP servers copied) and stripped[] (connection lines taken out of
// settings.json). runCopy carries it out: each brand's home is built in a temporary folder beside it and renamed
// into place, so a failure leaves nothing half made, and a last look reports any copied file that still names the
// source home.
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

// The checklist, in the order the wizard shows it. on: ticked to start with.
export const COPY_ITEMS = [
  { key: 'rules', on: true, label: 'Rules', detail: 'CLAUDE.md, and Grok and Codex AGENTS.md and rules' },
  { key: 'skills', on: true, label: 'Skills, commands, agents, output styles', detail: 'and Codex prompts' },
  { key: 'settings', on: true, label: 'Settings', detail: 'settings.json and settings.local.json (permissions, model, effort, env), Grok and Codex config.toml' },
  { key: 'hooks', on: true, label: 'Hooks', detail: 'The hooks in settings.json, and Grok hook files (not Docket\'s own). Untick for a clean slate' },
  { key: 'plugins', on: true, label: 'Plugins', detail: 'Marketplaces, installed plugins and their cache' },
  { key: 'mcp', on: true, label: 'MCP servers', detail: 'Copied and turned on' },
  { key: 'env', on: true, label: 'Desk environment variables', detail: 'Edited below before the copy is made' },
  { key: 'docket', on: true, label: 'Docket desk settings', detail: 'Links, Docket hooks, default brand, start gears, save before compact, prompt cache, handoff pattern, budget, color' },
  { key: 'groups', on: true, label: 'Groups', detail: 'Names, colors, start folders and order; archived groups and all sessions stay behind' },
  { key: 'memory', on: false, label: 'Memory', detail: 'A one-time copy; from then on each desk keeps its own' },
];
export const defaultChoices = () => Object.fromEntries(COPY_ITEMS.map((i) => [i.key, i.on]));

// What each brand's home holds, by checklist item: names at the top of the home. Anything not named here (sessions,
// projects/, history, file history, caches, backups, markers, sign-in files, gh-config/) is never copied.
export const HOME_ITEMS = {
  claude: { rules: ['CLAUDE.md'], skills: ['skills', 'commands', 'agents', 'output-styles'], settings: ['settings.json', 'settings.local.json'], hooks: ['hooks'], plugins: ['plugins'], memory: ['memory'] },
  grok: { rules: ['AGENTS.md', 'rules'], skills: ['skills', 'commands', 'agents', 'prompts'], settings: ['config.toml'], hooks: ['hooks'], memory: ['memory', 'memories'] },
  codex: { rules: ['AGENTS.md', 'AGENTS.override.md'], skills: ['prompts', 'skills'], settings: ['config.toml', 'rules'], memory: ['memory', 'memories'] },
};
// Never copied, whatever is ticked: the sign-in files, whose refresh tokens rotate, so two homes holding one copy
// sign each other out.
export const TOKEN_FILES = ['.credentials.json', 'auth.json'];
// The Docket hook file Docket writes in a Grok home itself before each session.
const GROK_DOCKET_HOOKS = 'docket.json';

// The settings.json env lines that carry the Claude connection. Inside Claude Code these win over what Docket sets,
// so they come out when the copy's Claude connection changes, or the old connection would still be used.
export const CONNECTION_ENV = /^(CLAUDE_CODE_USE_(BEDROCK|VERTEX|FOUNDRY)|CLAUDE_CODE_SKIP_\w+_AUTH|AWS_\w+|ANTHROPIC_\w+)$/;
export const CONNECTION_KEYS = ['apiKeyHelper', 'awsAuthRefresh', 'awsCredentialExport'];

const reEsc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const isWin = (p) => /^[A-Za-z]:[\\/]/.test(p) || p.includes('\\');

// The forms a home path can take in a text file, each with what it becomes: as written, with forward slashes, and
// JSON-escaped (doubled backslashes). For the standard home (~/.claude) also ~/.claude, $HOME/.claude and
// %USERPROFILE%\.claude, which hooks and scripts use.
function pathForms(from, to, userHome) {
  const fwd = (p) => p.replace(/\\/g, '/');
  const forms = [[from, to], [fwd(from), fwd(to)], [from.replace(/\\/g, '\\\\'), to.replace(/\\/g, '\\\\')]];
  if (userHome && path.resolve(from).toLowerCase() === path.join(userHome, '.claude').toLowerCase()) {
    const t = fwd(to);
    forms.push(['~/.claude', t], ['$HOME/.claude', t], ['${HOME}/.claude', t], ['%USERPROFILE%\\.claude', to], ['$env:USERPROFILE\\.claude', to],
      ['%USERPROFILE%\\\\.claude', to.replace(/\\/g, '\\\\')], ['$env:USERPROFILE\\\\.claude', to.replace(/\\/g, '\\\\')]);
  }
  const seen = new Set();
  return forms.filter(([f]) => f && !seen.has(f) && seen.add(f)).sort((a, b) => b[0].length - a[0].length);
}
// A path form followed by the end of the path: C:\x\home matches in C:\x\home\a and "C:\x\home", never in C:\x\home2
// or C:\x\home.json.
const formRe = (form, win) => new RegExp(reEsc(form) + '(?![\\w.-])', win ? 'gi' : 'g');

// text with every path into the home `from` changed to `to`. win: letter case is ignored (Windows and macOS paths).
export function rewritePaths(text, from, to, { userHome, win = isWin(from) } = {}) {
  let out = String(text);
  for (const [f, t] of pathForms(from, to, userHome)) out = out.replace(formRe(f, win), () => t);
  return out;
}
// text with the paths into each source home of pairs ([[from, to]]) pointed at its copy: a Grok MCP server run from
// the Claude home follows it too.
export function rewriteAll(text, pairs, opts = {}) {
  let out = String(text);
  for (const [from, to] of pairs) out = rewritePaths(out, from, to, { ...opts, win: opts.win ?? isWin(from) });
  return out;
}
// Whether text still names the home `from`, in any of its forms.
export function namesHome(text, from, { userHome, win = isWin(from) } = {}) {
  return pathForms(from, from, userHome).some(([f]) => formRe(f, win).test(String(text)));
}

// Full paths named in a value (a command line, an argument list, a whole settings file), outside every folder in
// `inside`: the hooks, scripts and folder marketplaces a copy keeps using where they are.
export function outsidePaths(value, inside = [], win = process.platform === 'win32') {
  const found = new Set();
  const walk = (v) => {
    if (typeof v === 'string') {
      for (const m of v.matchAll(/(?:[A-Za-z]:[\\/]|\\\\[\w.$-]+\\)[^\s"'<>|*?;,]+|(?<![\w.~}$])\/(?:[\w.@+~-]+\/)+[\w.@+~-]*/g)) {
        const p = m[0].replace(/[\\/.]+$/, '');
        if (p.split(/[\\/]/).filter(Boolean).length < 2) continue;
        if (inside.some((h) => h && underPath(p, h, win))) continue;
        found.add(p);
      }
    } else if (Array.isArray(v)) v.forEach(walk);
    else if (v && typeof v === 'object') Object.values(v).forEach(walk);
  };
  walk(value);
  return [...found];
}
function underPath(p, dir, win) {
  const n = (x) => { const s = String(x).replace(/\\/g, '/').replace(/\/+$/, ''); return win ? s.toLowerCase() : s; };
  return n(p) === n(dir) || n(p).startsWith(n(dir) + '/');
}

// A server's settings that look like they hold a secret (a token, key or password in its env or headers).
const SECRET = /token|secret|password|passwd|api[_-]?key|auth/i;
const holdsSecret = (server) => [server?.env, server?.headers].some((o) => o && Object.entries(o).some(([k, v]) => SECRET.test(k) && v));

// A TOML file without the tables named by drop(header): `[mcp_servers.x]` and its lines, say. Lines before the first
// table are kept unless keepTop is false.
export function tomlWithout(text, drop, keepTop = true) {
  const out = []; let keep = keepTop;
  for (const line of String(text).split(/\r?\n/)) {
    const h = line.match(/^\s*\[\[?\s*([^\]]+?)\s*\]\]?\s*(#.*)?$/);
    if (h) keep = !drop(h[1]);
    if (keep) out.push(line);
  }
  return out.join('\n');
}
const isMcpTable = (h) => /^mcp_servers?\b|^mcp\b/i.test(h);
// The MCP server names in a TOML file: [mcp_servers.<name>].
const tomlMcpNames = (text) => [...new Set([...String(text).matchAll(/^\s*\[\s*mcp_servers?\.("?)([^\]".]+)\1/gim)].map((m) => m[2]))];

// The plan. source and target: { claude, grok, codex } home folders (a brand left out or empty is not copied).
// choices: the checklist (defaultChoices), plus connectionChanged: true when the copy's Claude connection is a new one.
// userHome: where ~/.claude and ~/.claude.json are; sourceDefault: the source's Claude home is the standard one, so
// its MCP servers come from ~/.claude.json. fsLike: fs, or a stand-in with the same calls.
export function copyPlan({ source, target, choices = defaultChoices(), userHome, sourceDefault = false, win = process.platform === 'win32' }, fsLike = fs) {
  const homes = ['claude', 'grok', 'codex'].filter((b) => source[b] && target[b]).map((b) => [source[b], target[b]]);
  const plan = { homes, copy: [], rewrite: [], warnings: [], outside: [], mcp: [], stripped: [], memory: [], sources: Object.values(source).filter(Boolean) };
  const exists = (p) => { try { fsLike.statSync(p); return true; } catch { return false; } };
  const isDir = (p) => { try { return fsLike.statSync(p).isDirectory(); } catch { return false; } };
  const read = (p) => { try { return fsLike.readFileSync(p, 'utf8'); } catch { return null; } };
  const list = (p) => { try { return fsLike.readdirSync(p); } catch { return []; } };
  const sourceHomes = Object.values(source).filter(Boolean);
  const insideAny = [...sourceHomes, ...Object.values(target).filter(Boolean)];
  const outside = new Set();
  const noteOutside = (v) => { for (const p of outsidePaths(v, insideAny, win)) outside.add(p); };
  const textFiles = (dir, rel, brand, from, to, skip = () => false) => { // every text file under a copied folder, for rewrite[]
    for (const n of list(dir)) {
      const p = path.join(dir, n);
      if (skip(n)) continue;
      if (isDir(p)) { if (n !== 'node_modules' && n !== '.git') textFiles(p, path.join(rel, n), brand, from, to); }
      else if (/\.(json|jsonc|toml|ya?ml|md|txt|ps1|psm1|sh|cmd|bat|mjs|cjs|js|py|ini|cfg|conf|env)$/i.test(n)) plan.rewrite.push({ brand, file: path.join(to, rel, n), from, to: target[brand] });
    }
  };
  const add = (entry) => { plan.copy.push(entry); return entry; };

  for (const brand of ['claude', 'grok', 'codex']) {
    const from = source[brand], to = target[brand];
    if (!from || !to || !isDir(from)) continue;
    const items = HOME_ITEMS[brand];
    for (const [item, names] of Object.entries(items)) {
      if (item === 'memory') continue;
      const mcpOnly = brand !== 'claude' && item === 'settings' && !choices.settings && choices.mcp; // config.toml for its MCP tables
      if (!choices[item] && !mcpOnly) continue;
      for (const name of names) {
        if (mcpOnly && name !== 'config.toml') continue;
        const src = path.join(from, name);
        if (!exists(src) || TOKEN_FILES.includes(name)) continue;
        const dst = path.join(to, name);
        if (brand === 'claude' && /^settings(\.local)?\.json$/.test(name)) {
          add(claudeSettings({ src, dst, text: read(src), choices, from, to, userHome, win, plan, noteOutside }));
          continue;
        }
        if (brand !== 'claude' && name === 'config.toml') {
          let text = read(src) ?? '';
          for (const n of tomlMcpNames(text)) if (choices.mcp) plan.mcp.push({ brand, name: n, secret: false });
          if (!choices.mcp) text = tomlWithout(text, isMcpTable);
          // Grok's [compat.claude] stays: it keeps Claude's rules and hooks out of Grok sessions (grok-home.mjs).
          if (!choices.settings) text = tomlWithout(text, (h) => !isMcpTable(h) && !/^compat\b/.test(h), false);
          noteOutside(text);
          add({ item: choices.settings ? 'settings' : 'mcp', brand, from: src, to: dst, text: rewriteAll(text, homes, { userHome, win }) });
          continue;
        }
        const dir = isDir(src);
        const skip = brand === 'grok' && name === 'hooks' ? (n) => n === GROK_DOCKET_HOOKS : () => false;
        add({ item, brand, from: src, to: dst, dir, ...(brand === 'grok' && name === 'hooks' ? { skip: [GROK_DOCKET_HOOKS] } : {}) });
        if (dir) textFiles(src, name, brand, from, to, skip);
        else if (/\.(json|toml|md|ya?ml)$/i.test(name)) plan.rewrite.push({ brand, file: dst, from, to });
        if (brand === 'claude' && name === 'plugins') {
          for (const f of ['known_marketplaces.json', 'installed_plugins.json']) { const t = read(path.join(src, f)); if (t) { try { noteOutside(JSON.parse(t)); } catch {} } }
        }
        if (brand === 'grok' && name === 'hooks') for (const n of list(src)) if (n !== GROK_DOCKET_HOOKS && n.endsWith('.json')) { const t = read(path.join(src, n)) || ''; try { noteOutside(JSON.parse(t)); } catch { noteOutside(t); } }
      }
    }
    // MCP servers: Claude keeps them in .claude.json, beside the home for a set home and in the user folder for the
    // standard one. Only the servers are copied (none of the account, folder trust or history kept there), turned on.
    if (brand === 'claude' && choices.mcp) {
      const file = sourceDefault ? path.join(userHome, '.claude.json') : path.join(from, '.claude.json');
      let j = null; try { j = JSON.parse(read(file) || 'null'); } catch { plan.warnings.push(`Could not read the MCP servers in ${file}; none are copied.`); }
      const servers = j?.mcpServers && typeof j.mcpServers === 'object' ? j.mcpServers : {};
      if (Object.keys(servers).length) {
        for (const [n, s] of Object.entries(servers)) {
          plan.mcp.push({ brand, name: n, secret: holdsSecret(s) });
          noteOutside(s);
        }
        const secret = plan.mcp.filter((m) => m.brand === 'claude' && m.secret).map((m) => m.name);
        if (secret.length) plan.warnings.push(`${secret.join(', ')} hold${secret.length === 1 ? 's' : ''} a token: the copy reaches the same real service with it.`);
        const out = { mcpServers: JSON.parse(rewriteAll(JSON.stringify(servers), homes, { userHome, win })), ...(j.hasCompletedOnboarding ? { hasCompletedOnboarding: true } : {}) };
        add({ item: 'mcp', brand, from: file, to: path.join(to, '.claude.json'), text: JSON.stringify(out, null, 2) + '\n', only: 'mcpServers' });
      }
    }
    // Memory, when ticked: a one-time copy. Claude's is memory/ and each folder's auto memory (projects/<folder>/memory),
    // without the session files beside it.
    if (choices.memory) {
      for (const name of items.memory || []) {
        const src = path.join(from, name);
        if (isDir(src)) { add({ item: 'memory', brand, from: src, to: path.join(to, name), dir: true }); plan.memory.push(path.join(to, name)); }
      }
      if (brand === 'claude') for (const p of list(path.join(from, 'projects'))) {
        const src = path.join(from, 'projects', p, 'memory');
        if (isDir(src)) { const dst = path.join(to, 'projects', p, 'memory'); add({ item: 'memory', brand, from: src, to: dst, dir: true }); plan.memory.push(dst); }
      }
    }
  }
  plan.outside = [...outside].sort();
  if (plan.outside.length) plan.warnings.push(`${plan.outside.length} path${plan.outside.length === 1 ? '' : 's'} outside the home stay${plan.outside.length === 1 ? 's' : ''} shared with the original (hooks, scripts, marketplaces): a change there reaches both desks.`);
  return plan;
}

// One Claude settings file, worked out: hooks out when unticked, plugins out when unticked, the connection lines out
// when the connection changes, and paths into the old home pointed at the new one.
function claudeSettings({ src, dst, text, choices, from, to, userHome, win, plan, noteOutside }) {
  let j; try { j = JSON.parse(text); } catch { j = null; }
  if (!j || typeof j !== 'object') {
    plan.warnings.push(`${src} is not valid JSON, so it is copied as it is, with its paths changed, and nothing taken out of it.`);
    return { item: 'settings', brand: 'claude', from: src, to: dst, text: rewriteAll(text ?? '', plan.homes, { userHome, win }) };
  }
  if (!choices.hooks) delete j.hooks;
  if (!choices.plugins) { delete j.enabledPlugins; delete j.extraKnownMarketplaces; }
  if (choices.connectionChanged) {
    for (const k of Object.keys(j.env || {})) if (CONNECTION_ENV.test(k)) { plan.stripped.push({ file: dst, name: k, value: String(j.env[k]) }); delete j.env[k]; }
    if (j.env && !Object.keys(j.env).length) delete j.env;
    for (const k of CONNECTION_KEYS) if (k in j) { plan.stripped.push({ file: dst, name: k, value: String(j[k]) }); delete j[k]; }
  }
  noteOutside(j);
  return { item: 'settings', brand: 'claude', from: src, to: dst, text: rewriteAll(JSON.stringify(j, null, 2) + '\n', plan.homes, { userHome, win }) };
}

// Carry the plan out. Each brand's home is made in a temporary folder beside it (<home>.copy-<random>) and renamed
// into place once complete; on a failure the temporary folders are handed to trash (the Recycle Bin) and the error
// thrown. Returns { left }: the copied files that still name a source home (the last check).
export async function runCopy(plan, { target, trash = async () => {}, fsLike = fs, userHome } = {}) {
  const temp = {};
  for (const [brand, home] of Object.entries(target)) {
    if (!home) continue;
    if (fsLike.existsSync(home) && fsLike.readdirSync(home).length) throw new Error(`${home} already exists and is not empty`);
    temp[brand] = `${home}.copy-${randomUUID().slice(0, 8)}`;
  }
  const inTemp = (brand, p) => path.join(temp[brand], path.relative(target[brand], p));
  try {
    for (const t of Object.values(temp)) fsLike.mkdirSync(t, { recursive: true });
    for (const c of plan.copy) {
      if (!temp[c.brand]) continue;
      const dst = inTemp(c.brand, c.to);
      fsLike.mkdirSync(path.dirname(dst), { recursive: true });
      if (c.text !== undefined) fsLike.writeFileSync(dst, c.text);
      else if (c.dir) fsLike.cpSync(c.from, dst, { recursive: true, filter: (s) => !(c.skip || []).includes(path.basename(s)) || path.resolve(s) === path.resolve(c.from) });
      else fsLike.copyFileSync(c.from, dst);
    }
    for (const r of plan.rewrite) {
      if (!temp[r.brand]) continue;
      const f = inTemp(r.brand, r.file);
      let st; try { st = fsLike.statSync(f); } catch { continue; }
      if (!st.isFile() || st.size > 5e6) continue;
      const text = fsLike.readFileSync(f, 'utf8');
      const next = rewriteAll(text, plan.homes || [[r.from, target[r.brand]]], { userHome });
      if (next !== text) fsLike.writeFileSync(f, next);
    }
    // The last check, before anything is in place: a copied text file still naming a source home.
    const left = [];
    const sources = plan.sources || [];
    for (const c of plan.copy) {
      if (!temp[c.brand]) continue;
      const files = c.dir ? walkFiles(fsLike, inTemp(c.brand, c.to)) : [inTemp(c.brand, c.to)];
      for (const f of files) {
        if (!/\.(json|jsonc|toml|ya?ml)$/i.test(f)) continue;
        let text; try { if (fsLike.statSync(f).size > 5e6) continue; text = fsLike.readFileSync(f, 'utf8'); } catch { continue; }
        if (sources.some((s) => namesHome(text, s, { userHome }))) left.push(path.join(target[c.brand], path.relative(temp[c.brand], f)));
      }
    }
    for (const [brand, t] of Object.entries(temp)) {
      const home = target[brand];
      fsLike.mkdirSync(path.dirname(home), { recursive: true });
      if (fsLike.existsSync(home)) fsLike.rmdirSync(home); // empty, checked above
      fsLike.renameSync(t, home);
      delete temp[brand];
    }
    return { left: [...new Set(left)] };
  } catch (err) {
    const leftover = Object.values(temp).filter((t) => fsLike.existsSync(t));
    if (leftover.length) await trash(leftover).catch(() => {});
    throw err;
  }
}
function walkFiles(fsLike, dir) {
  const out = [];
  let names = []; try { names = fsLike.readdirSync(dir, { withFileTypes: true }); } catch { return out; }
  for (const d of names) {
    const p = path.join(dir, d.name);
    if (d.isDirectory()) { if (d.name !== 'node_modules' && d.name !== '.git') out.push(...walkFiles(fsLike, p)); }
    else out.push(p);
  }
  return out;
}

// The copy's groups: names, colors, start folders and order, with new ids; archived ones are left behind, and no
// session comes along (sessions point at groups, not the other way round).
export function copyGroups(groups = [], newId = () => 'g' + randomUUID().slice(0, 8), now = Date.now()) {
  return groups.filter((g) => !g.archived).map((g) => ({ id: newId(), name: g.name, ...(g.color ? { color: g.color } : {}), ...(g.folder ? { folder: g.folder } : {}), createdAt: now }));
}

// The Docket desk settings a copy takes from its source (the "Docket desk settings" item).
export const DOCKET_KEYS = ['links', 'docketHooks', 'defaultEngine', 'startGear', 'saveBeforeCompact', 'promptCacheTtl', 'handoffPattern', 'budget', 'color', 'splitWork'];

// The new desk's entry, before cleanCompany checks it. conn: per brand { mode: 'same' | 'new' | 'off' }, Claude's
// with kind ('claude' account or 'bedrock'), email, awsProfile and awsRegion for a new connection. A same connection
// copies the reference (the Bedrock profile and region, the email to fill in); a sign-in itself is never copied.
export function copyEntry(source, { name, home, grokHome, codexHome, folder, conn = {}, env, choices = defaultChoices(), at = new Date().toISOString() }) {
  const mode = (e) => conn[e]?.mode || 'same';
  const c = { name, home, folder: folder || source.folder || home };
  if (mode('grok') !== 'off' && grokHome) c.grokHome = grokHome;
  if (mode('codex') !== 'off' && codexHome) c.codexHome = codexHome;
  const off = ['claude', 'grok', 'codex'].filter((e) => mode(e) === 'off' || (e !== 'claude' && !c[e + 'Home']));
  if (off.includes('claude')) c.brandsOff = ['claude'];
  if (mode('claude') === 'same') {
    if (source.email) c.email = source.email;
    if (source.awsProfile) { c.awsProfile = source.awsProfile; if (source.awsRegion) c.awsRegion = source.awsRegion; }
  } else if (mode('claude') === 'new') {
    const n = conn.claude || {};
    if (n.kind === 'bedrock') { c.awsProfile = String(n.awsProfile || '').trim(); c.awsRegion = String(n.awsRegion || '').trim() || 'us-east-1'; }
    else if (n.email) c.email = String(n.email).trim();
  }
  if (choices.docket) for (const k of DOCKET_KEYS) if (source[k] !== undefined) c[k] = structuredClone(source[k]);
  if (c.defaultEngine && off.includes(c.defaultEngine)) delete c.defaultEngine;
  if (choices.env) c.env = env !== undefined ? env : structuredClone(source.env || {});
  c.copiedFrom = { id: source.id, name: source.name, at };
  return c;
}

// The brands whose sign-in the copy needs: an account brand always signs in again in its new home (the email filled
// in for the same Claude account), and a new connection signs in; a same Bedrock connection works at once.
export function needsSignIn(source, conn = {}) {
  return ['claude', 'grok', 'codex'].filter((e) => {
    const m = conn[e]?.mode || 'same';
    if (m === 'off') return false;
    if (e === 'claude') return m === 'new' ? true : !source.awsProfile;
    return true;
  });
}

// What a target home folder may not be: inside Docket's own folder (it is pulled and pushed, and a home holds a
// sign-in), inside or holding the source's home, or already holding something. '' when it is fine.
export function targetProblem(dir, { docket, sources = [], exists = fs.existsSync, readdir = fs.readdirSync, win = process.platform === 'win32' }) {
  if (!dir || !path.isAbsolute(dir)) return 'must be a full path';
  if (docket && underPath(dir, docket, win)) return `is inside Docket's own folder (${docket})`;
  for (const s of sources.filter(Boolean)) if (underPath(dir, s, win) || underPath(s, dir, win)) return `is inside, or holds, the original's home (${s})`;
  if (exists(dir)) { let n = []; try { n = readdir(dir); } catch {} if (n.length) return 'already exists and is not empty'; }
  return '';
}
