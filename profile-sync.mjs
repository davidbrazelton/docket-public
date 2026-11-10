// Docket's profile (#837): one computer's desks, schedules and settings as docket-profile.json, for ☰ > Profile >
// Export and Import, and kept in a folder a cloud service's own app copies between computers (☰ > Profile > Keep my
// profile in…). Docket signs in to nothing and hosts nothing: the file is the person's, on their own storage.
// Only works things out; server.mjs reads and writes the files and applies the result.
import crypto from 'node:crypto';

export const PROFILE_FILE = 'docket-profile.json';
export const PROFILE_VERSION = 1;

// The settings that travel, with the words the preview uses. The first four are the app's own (☰ > Settings); the
// page's (main color, theme, sound) live in the browser, which sends them to the app. What belongs to one computer
// stays out: ports, its name, starting at sign-in, screen control, the feedback destination and its token.
export const SETTINGS = {
  stallStop: 'Stop stuck steps', autoContinue: 'Continue after a crash', autoPause: 'Pause on sleep', restMinutes: 'Rest idle sessions',
  accent: 'Main color', theme: 'Theme', sound: 'Sound',
};
export const PAGE_SETTINGS = ['accent', 'theme', 'sound'];

// What a desk keeps on this computer: what Docket made or started here (copiedFrom, madeFolders, a plan-system switch
// under way) and anything a remote desk holds. Sign-ins never leave: they are in each desk's home folders and browser/,
// which the file never holds, so each computer signs in again.
const DESK_LOCAL = ['copiedFrom', 'madeFolders', 'planSwitch', 'remote', 'forced', 'running', 'hookList', 'connections', 'gatewayModels'];
// A desk's own environment variable whose name says it holds a secret stays out of the file.
export const SECRET_NAME = /KEY|TOKEN|SECRET|PASSWORD|PASSWD|PWD|CREDENTIAL|AUTH|COOKIE|SESSION|PRIVATE|CERT/i;
// The folder paths in each kind of item, converted between computers on import. A dotted name is one level down.
export const PATH_FIELDS = { desk: ['home', 'folder', 'grokHome', 'codexHome', 'planFolder.path'], schedule: ['folder'], setting: [] };
// What a schedule carries: its setup and instructions, never its runs.
const SCHEDULE_FIELDS = ['id', 'client', 'title', 'cron', 'fireAt', 'folder', 'enabled', 'prompt'];

// A desk as the file has it, and the names of the variables left out.
export function deskForFile(c) {
  const item = {}, dropped = [];
  for (const [k, v] of Object.entries(c || {})) if (!DESK_LOCAL.includes(k) && v !== undefined) item[k] = v;
  if (item.env) {
    const env = {};
    for (const [k, v] of Object.entries(item.env)) if (SECRET_NAME.test(k)) dropped.push(k); else env[k] = v;
    if (Object.keys(env).length) item.env = env; else delete item.env;
  }
  return { item, dropped };
}
export function scheduleForFile(s, prompt = '') {
  const item = {};
  for (const k of SCHEDULE_FIELDS) item[k] = k === 'prompt' ? String(prompt || '') : s[k] ?? null;
  item.enabled = !!s.enabled;
  return item;
}

// Every item this computer has, by key ('desk:<id>', 'schedule:<id>', 'setting:<name>'), in the desk list's order.
// desks: the company list; schedules: [{ schedule, prompt }]; settings: { name: value } (one left out is not sent).
export function localItems({ desks = [], schedules = [], settings = {} }) {
  const out = {};
  for (const c of desks) if (c && !c.remote) out['desk:' + c.id] = { kind: 'desk', id: c.id, name: c.name, item: deskForFile(c).item };
  for (const { schedule: s, prompt } of schedules) out['schedule:' + s.id] = { kind: 'schedule', id: s.id, name: s.title || s.id, item: scheduleForFile(s, prompt) };
  for (const k of Object.keys(SETTINGS)) if (settings[k] !== undefined) out['setting:' + k] = { kind: 'setting', id: k, name: SETTINGS[k], item: { value: settings[k] } };
  return out;
}

// The same JSON whatever order the keys were written in.
const sorted = (v) => Array.isArray(v) ? v.map(sorted) : v && typeof v === 'object' ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, sorted(v[k])])) : v;
export const hashOf = (item) => crypto.createHash('sha1').update(JSON.stringify(sorted(item))).digest('hex').slice(0, 16);

// meta: { key: { at, by, hash, gone, synced } }, kept in this computer's state: when each item last changed and on
// which computer, and synced, the change last agreed with the profile folder. An item whose content differs from
// the hash noted changed here now; an item no longer here was removed here now. Gives the new meta and whether any changed.
export function noteChanges(meta, items, { machine, now }) {
  const out = { ...meta };
  let changed = false;
  for (const [key, it] of Object.entries(items)) {
    const h = hashOf(it.item), m = out[key];
    if (m && !m.gone && m.hash === h) continue;
    out[key] = { ...m, at: now, by: machine, hash: h, gone: undefined };
    changed = true;
  }
  for (const [key, m] of Object.entries(out)) if (!items[key] && !m.gone) { out[key] = { ...m, at: now, by: machine, hash: '', gone: true }; changed = true; }
  for (const m of Object.values(out)) if (m.gone === undefined) delete m.gone;
  return { meta: out, changed };
}

// The file. Each record says when it last changed, on which computer, and that computer's platform and home, so
// another computer can convert its folder paths. Item by item, the newer of this computer's version and the one
// already in the file (keep) is written; an equal one keeps the file's own, so paths are not rewritten back and forth.
// A removed item stays as gone, so the other computers remove it too.
export function profileFile({ items, meta = {}, machine, platform, home, now, keep = {} }) {
  const out = {};
  const mine = (key) => {
    const m = meta[key] || { at: now, by: machine };
    return m.gone ? { kind: key.split(':')[0], at: m.at, by: m.by, gone: true } : { kind: items[key].kind, at: m.at, by: m.by, platform, home, item: items[key].item };
  };
  for (const key of new Set([...Object.keys(items), ...Object.keys(meta).filter((k) => meta[k].gone), ...Object.keys(keep)])) {
    const own = items[key] || meta[key]?.gone ? mine(key) : null, theirs = keep[key];
    out[key] = !own ? theirs : !theirs || own.at > theirs.at ? own : theirs;
  }
  return { docketProfile: PROFILE_VERSION, savedAt: now, by: machine, items: out };
}

// A profile file's text: { profile } or { error } in words for the person.
export function readProfile(text) {
  let p;
  try { p = JSON.parse(String(text).replace(/^﻿/, '')); } catch { return { error: 'That file is not a Docket profile (it is not JSON).' }; }
  if (!p || typeof p !== 'object' || !p.docketProfile || !p.items || typeof p.items !== 'object') return { error: 'That file is not a Docket profile (docket-profile.json).' };
  if (p.docketProfile > PROFILE_VERSION) return { error: 'That profile was saved by a newer Docket. Update this one first (☰ > About > Check for updates).' };
  const items = {};
  for (const [key, r] of Object.entries(p.items)) {
    const kind = key.split(':')[0];
    if (!r || typeof r !== 'object' || !PATH_FIELDS[kind] || typeof r.at !== 'string') continue;
    if (!r.gone && (!r.item || typeof r.item !== 'object')) continue;
    if (kind === 'setting' && !SETTINGS[key.slice(8)]) continue;
    items[key] = { ...r, kind };
  }
  return { profile: { ...p, items } };
}

// The top-level fields that differ between two items, for the preview ("folder, env").
export function fieldsChanged(a = {}, b = {}) {
  return [...new Set([...Object.keys(a), ...Object.keys(b)])].filter((k) => JSON.stringify(sorted(a[k])) !== JSON.stringify(sorted(b[k])));
}
const getPath = (o, f) => f.split('.').reduce((x, k) => x?.[k], o);
const setPath = (o, f, v) => { const ks = f.split('.'), last = ks.pop(); let x = o; for (const k of ks) x = x[k] = { ...x[k] }; x[last] = v; };
// Every folder path in an item: [{ field, value }].
export const pathsOf = (kind, item) => PATH_FIELDS[kind].map((field) => ({ field, value: getPath(item, field) })).filter((x) => typeof x.value === 'string' && x.value);

// What applying a profile would change here, without changing anything.
// local: localItems(); incoming: a profile's items; mode: 'merge' (add and update, keep what the file lacks), 'replace'
// (also remove what the file lacks) or 'sync' (item by item, the newer side wins; both changed since the last sync asks).
// meta: this computer's meta (sync only). ids: { fileDeskId: localDeskId } learned before.
// place(path, record): this computer's path for one written on the record's computer: { path } when it was found or
// answered before, or { ask: suggestion } when the person has to say.
// Gives { changes, conflicts, ids }: each change { key, kind, id, name, action: add | change | remove, item, rec, fields, ask },
// where ask lists [{ field, from, suggest }] for paths not found here; ids adds desks matched by name.
export function profilePlan({ local, incoming, mode = 'merge', meta = {}, ids = {}, place = (p) => ({ path: p }) }) {
  const deskIds = { ...ids };
  const byName = new Map(Object.values(local).filter((x) => x.kind === 'desk').map((x) => [String(x.name).toLowerCase(), x.id]));
  // A desk in the file matches the one here with its id, else (once, then remembered) the one with its name.
  for (const [key, r] of Object.entries(incoming)) {
    if (r.kind !== 'desk' || r.gone) continue;
    const fid = key.slice(5);
    if (deskIds[fid] && local['desk:' + deskIds[fid]]) continue;
    if (local[key]) { delete deskIds[fid]; continue; }
    const same = byName.get(String(r.item.name).toLowerCase());
    if (same && !Object.values(deskIds).includes(same) && !incoming['desk:' + same]) deskIds[fid] = same;
  }
  const localKey = (key, r) => r.kind === 'desk' ? 'desk:' + (deskIds[key.slice(5)] || key.slice(5)) : key;
  const changes = [], conflicts = [], seen = new Set();
  for (const [fkey, r] of Object.entries(incoming)) {
    const key = localKey(fkey, r), l = local[key], m = meta[key];
    seen.add(key);
    const id = key.slice(key.indexOf(':') + 1);
    let item = null, ask = [];
    if (!r.gone) {
      item = JSON.parse(JSON.stringify(r.item));
      if (r.kind === 'desk') item.id = id;
      if (r.kind === 'schedule' && item.client) item.client = deskIds[item.client] || item.client;
      for (const { field, value } of pathsOf(r.kind, item)) {
        const got = place(value, r);
        if (got.path !== undefined) setPath(item, field, got.path);
        else { ask.push({ field, from: value, suggest: got.ask || '' }); setPath(item, field, got.ask || value); }
      }
    }
    const name = item?.name || item?.title || l?.name || (r.kind === 'setting' ? SETTINGS[id] : id);
    const same = l && item && !ask.length && hashOf(l.item) === hashOf(item);
    const change = (action) => changes.push({ key, kind: r.kind, id, name, action, item, rec: r, fields: action === 'change' ? fieldsChanged(l.item, item) : [], ask });
    if (mode !== 'sync') {
      if (r.gone || same) continue;
      change(l ? 'change' : 'add');
      continue;
    }
    if (m && !m.gone === !r.gone && m.at === r.at) continue; // the same change, already here
    const synced = m?.synced || '';
    if (!(r.at > synced)) continue; // the file has nothing newer than what was agreed: this computer's own is written
    const localNew = !!m && m.at > synced;
    if (r.gone) {
      if (!l) continue;
      if (localNew) conflicts.push({ key, kind: r.kind, id, name, mine: l.item, theirs: null, rec: r, at: r.at, by: r.by, myAt: m.at });
      else change('remove');
      continue;
    }
    if (same) { changes.push({ key, kind: r.kind, id, name, action: 'agree', item, rec: r, fields: [], ask }); continue; }
    // A setting changed on both sides is not worth a question: the newer wins, and on a computer that never synced
    // before, the file's (else a new computer's defaults would undo the settings the others chose).
    if (localNew && r.kind === 'setting') { if (!synced || r.at > m.at) change('change'); continue; }
    if (localNew) { conflicts.push({ key, kind: r.kind, id, name, mine: l?.item || null, theirs: item, rec: r, at: r.at, by: r.by, myAt: m.at, ask }); continue; }
    change(l ? 'change' : 'add');
  }
  if (mode === 'replace') {
    for (const [key, l] of Object.entries(local)) if (!seen.has(key) && l.kind !== 'setting') changes.push({ key, kind: l.kind, id: l.id, name: l.name, action: 'remove', item: null, rec: null, fields: [], ask: [] });
  }
  // Desks first, so a schedule finds its desk; removals last.
  const order = { desk: 0, schedule: 1, setting: 2 };
  changes.sort((a, b) => (a.action === 'remove') - (b.action === 'remove') || order[a.kind] - order[b.kind]);
  return { changes, conflicts, ids: deskIds };
}

// The preview's lines for a plan, by kind: [{ kind, action, name, fields, ask }].
export function planSummary({ changes, conflicts = [] }) {
  return {
    changes: changes.filter((c) => c.action !== 'agree').map((c) => ({ key: c.key, kind: c.kind, action: c.action, name: c.name, fields: c.fields, ask: c.ask, ...(c.kind === 'setting' && c.item ? { value: c.item.value } : {}) })),
    conflicts: conflicts.map((c) => ({ key: c.key, kind: c.kind, name: c.name, by: c.by, at: c.at, myAt: c.myAt, removed: !c.theirs, fields: c.mine && c.theirs ? fieldsChanged(c.mine, c.theirs) : [] })),
  };
}
