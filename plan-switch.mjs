// Switching a desk's plan system (#700). Before planSystem changes, Docket looks for what the desk was planning with
// and, when there is something the switch would leave behind, warns and offers a conversion in a session of its own.
// What it looks for: another system's per-session marker files in the desk's Claude home (".acme-plan-<id>" and the
// like, which say which session claimed which plan file), the plan files they name, Claude Code hooks that look like a
// plan system (in the desk's settings.json files), the desk's plan folder, and Docket's own plans when leaving them.
// Plan files nobody claims are found too: the ones a found plan links to, and plan files in the folders around the
// found ones (a QA plan in a testing folder). A claim whose file is gone is reported as missing, not as a plan.
// A conversion can take the whole desk or one project or folder (scope): only the plans under it are carried over.
// Nothing here writes anything: it uses readdir, stat and readFile only, so the old system stays as it is.
import fs from 'node:fs';
import path from 'node:path';
import { readMarkers, parseChecklist } from './plan-folder.mjs';
import { plansOnFor } from './plan-use.mjs';

const SYSTEM_NAMES = { docket: "Docket's plans", folder: 'a plan folder, read-only', none: 'no plans', '': "Docket's plans (not chosen yet)" };
export const systemName = (v) => SYSTEM_NAMES[v || ''] || String(v);

// A marker file: a dot name ending in "plan-" and the start of a session id, such as .acme-plan-8ad80cd72d86.
const MARKER_NAME = /^(\.[\w.-]*plan-)([A-Za-z0-9_-]{6,})$/i;
// A hook command that looks like it belongs to a plan system: it names a plan, a claim, or baton.
const PLAN_HOOK = /plan|claim|baton/i;
// The brief lists this many of each kind (plans, claims, hooks), then says how many more and where they are.
const MAX_LIST = 400;
// Looking for unclaimed plan files around the found ones: this deep, at most this many folder entries.
const WALK_DEPTH = 3, WALK_ENTRIES = 5000;
const SKIP_DIRS = new Set(['node_modules', 'bin', 'obj']);
// A plan file nobody claims is a markdown file named like one; notes, facts and run logs with a checkbox are not plans.
const PLAN_FILE = /plan[^\\/]*\.md$/i;

// The marker patterns in a folder's file names: [{ pattern: '.acme-plan-*', count }], the most used first.
export function markerPatterns(names) {
  const by = new Map();
  for (const n of names) { const m = String(n).match(MARKER_NAME); if (m) by.set(m[1], (by.get(m[1]) || 0) + 1); }
  return [...by].map(([p, count]) => ({ pattern: p + '*', count })).sort((a, b) => b.count - a.count);
}

// Every hook command in one settings.json's text: [{ event, matcher, command }]. A file that is not JSON gives none.
export function hookCommands(text) {
  let s; try { s = JSON.parse(String(text)); } catch { return []; }
  const out = [];
  for (const [event, groups] of Object.entries(s?.hooks || {})) {
    for (const g of Array.isArray(groups) ? groups : []) for (const h of g?.hooks || []) if (h?.command) out.push({ event, matcher: g.matcher || '', command: String(h.command) });
  }
  return out;
}
// The plan hooks among them, and the other hooks from the same folders (a gate shipped with the plan scripts).
export function planHooks(hooks) {
  const script = (c) => c.match(/([^\\/"' ]+\.(?:ps1|sh|mjs|js|py|cmd|bat))["']?(?:\s|$)/i)?.[1] || '';
  const isPlan = (c) => PLAN_HOOK.test(script(c) || c); // the script's own name, not the folders it sits in
  const dirOf = (c) => { const m = c.match(/["']?([A-Za-z]:[\\/][^"']*|\/[^"' ]*)[\\/][^\\/"']+\.(?:ps1|sh|mjs|js|py|cmd|bat)["']?/i); return m ? m[1].toLowerCase() : ''; };
  const plan = hooks.filter((h) => isPlan(h.command));
  const dirs = new Set(plan.map((h) => dirOf(h.command)).filter(Boolean));
  const seen = new Set();
  return hooks.filter((h) => isPlan(h.command) || dirs.has(dirOf(h.command)))
    .map((h) => ({ ...h, plan: isPlan(h.command) }))
    .filter((h) => { const k = h.event + '|' + h.command; if (seen.has(k)) return false; seen.add(k); return true; });
}

// Open and done lines of one plan file, and the markdown files it links to (full paths), or null when it cannot be read.
function planCounts(file) {
  try {
    const st = fs.statSync(file); if (!st.isFile() || st.size > 2_000_000) return null;
    const p = parseChecklist(fs.readFileSync(file, 'utf8'), file);
    const local = (r) => PLAN_FILE.test(path.basename(r)) && !/^[a-z][\w+.-]+:\/\//i.test(r);
    const links = [...new Set(p.links.map((l) => String(l.ref).split('#')[0]).filter(local).map((r) => { try { return path.resolve(path.dirname(file), decodeURI(r)); } catch { return path.resolve(path.dirname(file), r); } }))];
    return { title: p.title, open: p.items.filter((x) => !x.done).length, done: p.items.filter((x) => x.done).length, links };
  } catch { return null; }
}
const readText = (f) => { try { return fs.readFileSync(f, 'utf8'); } catch { return ''; } };
const keyOf = (f) => path.resolve(f).toLowerCase();
const exists = (f) => { try { fs.statSync(f); return true; } catch { return false; } };
// Whether a file is in a folder (or below it). Compared without case, as Windows and macOS do.
export const inFolder = (file, dir) => { const r = path.relative(path.resolve(dir).toLowerCase(), path.resolve(file).toLowerCase()); return !!r && !r.startsWith('..') && !path.isAbsolute(r); };
// The markdown files named like a plan ("plan" in the name) under each folder, a few levels down. Hidden folders and
// build folders are left out.
function planFilesUnder(dirs) {
  const out = [], seen = new Set();
  let left = WALK_ENTRIES;
  const go = (dir, depth) => {
    if (seen.has(keyOf(dir)) || left <= 0) return;
    seen.add(keyOf(dir));
    let ents; try { ents = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of ents) {
      if (--left <= 0) return;
      const p = path.join(dir, e.name);
      if (e.isDirectory()) { if (depth < WALK_DEPTH && !e.name.startsWith('.') && !SKIP_DIRS.has(e.name.toLowerCase())) go(p, depth + 1); }
      else if (e.isFile() && PLAN_FILE.test(e.name)) out.push(p);
    }
  };
  for (const d of dirs) go(d, 0);
  return out;
}
// The projects on a desk: the folders its plan files are in, a folder inside another one counted with it.
// [{ folder, name, files, open, claims, missing, working }]: the ones with a session working, then the most open, first.
export function projectsOf(plans, missing = []) {
  const dirs = [...new Set(plans.map((p) => path.dirname(p.file)))].sort((a, b) => a.length - b.length);
  const roots = [];
  for (const d of dirs) if (!roots.some((r) => keyOf(r) === keyOf(d) || inFolder(d, r))) roots.push(d);
  const under = (f, r) => inFolder(f, r);
  return roots.map((r) => {
    const ps = plans.filter((p) => under(p.file, r)), ms = missing.filter((m) => under(m.file, r));
    const sum = (k) => ps.reduce((n, p) => n + (p[k] || 0), 0);
    return { folder: r, name: path.basename(r) || r, files: ps.length, open: sum('open'), claims: sum('claims'), missing: ms.length, working: sum('working') };
  }).sort((a, b) => (b.working - a.working) || (b.open - a.open) || a.folder.localeCompare(b.folder));
}

// What a desk is planning with today. desk: { planSystem, planFolder, home, folder }. Docket's side comes in as
// arguments, since only the app knows them: docketPlans [{ id, title, file, done, total }] (the desk's own plans),
// sessions [{ id, title, working }] (the desk's sessions Docket knows), folderTree (the plan folder's tree, when read).
// scope: a folder (full path) to convert alone. Plans, claims and missing files outside it are left out; projects still
// lists every project on the desk, so the page can offer them.
export function scanPlanSystem(desk, { docketPlans = [], sessions = [], folderTree = null, scope = '' } = {}) {
  const home = desk.home || '';
  let names = []; try { names = home ? fs.readdirSync(home) : []; } catch {}
  const patterns = markerPatterns(names);
  const own = desk.planFolder?.marker;
  if (own && !patterns.some((p) => p.pattern.toLowerCase() === own.toLowerCase())) patterns.unshift({ pattern: own, count: 0 });
  const claims = patterns.flatMap((p) => readMarkers(p.pattern, home).map((m) => ({ ...m, pattern: p.pattern })));
  for (const c of claims) {
    const s = sessions.find((x) => x.id.replace(/-/g, '').startsWith(c.session.replace(/-/g, ''))); // markers often leave out the dashes
    if (s) Object.assign(c, { id: s.id, title: s.title || '', working: !!s.working });
  }
  // The plan files the claims name, each once, with what is left in it. A claim on a file that is gone is missing.
  const byFile = new Map();
  for (const c of claims) {
    const f = path.isAbsolute(c.plan) ? c.plan : path.resolve(desk.planFolder?.path || home, c.plan);
    c.path = f;
    if (!byFile.has(keyOf(f))) byFile.set(keyOf(f), { file: f, claims: 0, working: 0 });
    const e = byFile.get(keyOf(f)); e.claims++; if (c.working) e.working++;
  }
  const plans = [], missing = [], known = new Set(byFile.keys());
  for (const e of byFile.values()) {
    const n = planCounts(e.file);
    if (n) plans.push({ ...e, ...n });
    else if (!exists(e.file)) { missing.push({ file: e.file, claims: e.claims }); for (const c of claims) if (keyOf(c.path) === keyOf(e.file)) c.missing = true; }
  }
  // The plan folder's own plans, when one is set and read.
  if (folderTree?.plans) for (const p of folderTree.plans) if (!known.has(keyOf(p.file))) { known.add(keyOf(p.file)); plans.push({ file: p.file, title: p.title, open: p.own.total - p.own.done, done: p.own.done, claims: 0, working: 0 }); }
  // Plan files nobody claims, with a checklist in them: the ones the found plans link to (and those link to), then
  // plan files in the folders around them, or under the scope.
  const unclaimed = (f, how) => { if (known.has(keyOf(f))) return; known.add(keyOf(f)); const n = planCounts(f); if (n && n.open + n.done) plans.push({ file: f, claims: 0, working: 0, ...n, found: how }); };
  for (let i = 0; i < plans.length; i++) for (const l of plans[i].links || []) unclaimed(l, 'linked');
  for (const f of planFilesUnder(scope ? [scope] : projectsOf(plans).map((p) => p.folder))) unclaimed(f, 'folder');
  for (const p of plans) delete p.links;
  plans.sort((a, b) => (b.working - a.working) || (b.open - a.open) || a.file.localeCompare(b.file));
  missing.sort((a, b) => (b.claims - a.claims) || a.file.localeCompare(b.file));
  const projects = projectsOf(plans, missing);
  const inScope = (f) => !scope || inFolder(f, scope), mine = claims.filter((c) => inScope(c.path));
  // Hooks: the desk's Claude home and its working folder's project settings.
  const files = [path.join(home, 'settings.json'), path.join(home, 'settings.local.json'),
    ...(desk.folder ? [path.join(desk.folder, '.claude', 'settings.json'), path.join(desk.folder, '.claude', 'settings.local.json')] : [])];
  const hooks = [...new Set(files.map((f) => path.resolve(f)))].flatMap((f) => planHooks(hookCommands(readText(f))).map((h) => ({ ...h, file: f })));
  return {
    planSystem: desk.planSystem || '',
    planFolder: desk.planFolder?.path ? { path: desk.planFolder.path, marker: desk.planFolder.marker || '', error: folderTree?.error || '' } : null,
    markers: patterns.filter((p) => p.count || claims.some((c) => c.pattern === p.pattern)).map((p) => ({ ...p, dir: home, claims: mine.filter((c) => c.pattern === p.pattern).length })),
    claims: mine, plans: plans.filter((p) => inScope(p.file)), missing: missing.filter((m) => inScope(m.file)), hooks,
    scope: scope || '', projects,
    docketPlans: docketPlans.map((p) => ({ id: p.id, title: p.title, file: p.file, done: p.done || 0, total: p.total || 0 })),
    working: sessions.filter((s) => s.working).map((s) => ({ id: s.id, title: s.title || '' })),
  };
}

// Whether switching from one plan system to another leaves something behind, and what: { warn, way, lines }.
// way: 'in' (onto Docket's plans: the outside system's plans and claims), 'out' (off Docket's plans: its own plans), or ''.
export function switchWarning(found, from, to) {
  const was = plansOnFor(from), will = plansOnFor(to);
  const none = { warn: false, way: '', lines: [] };
  if ((from || '') === (to || '')) return none;
  if (will) { // onto Docket's plans: from another system, from none, or confirming a desk that never chose
    if (!outsideFound(found)) return none;
    const lines = [];
    const open = found.plans.filter((p) => p.open), tasks = open.reduce((n, p) => n + p.open, 0);
    if (found.scope) lines.push(`Only the plans in ${found.scope}.`);
    if (found.plans.length) lines.push(`${found.plans.length} plan file${s(found.plans.length)} another system keeps${open.length ? `, ${open.length} with open tasks (${tasks} open in all)` : ''}.`);
    const gone = found.claims.filter((c) => c.missing).length, missing = found.missing || [];
    if (found.claims.length) lines.push(`${found.claims.length} claim${s(found.claims.length)} in marker files (${found.markers.map((m) => m.pattern).join(', ')})${claimWorking(found)}${gone ? `; ${gone} of them name ${missing.length} file${s(missing.length)} that no longer exist${missing.length === 1 ? 's' : ''}` : ''}.`);
    if (found.hooks.length) lines.push(`${found.hooks.length} Claude Code hook${s(found.hooks.length)} of that system (${hookEvents(found.hooks)}), which keep running: Docket does not change them.`);
    if (found.planFolder?.path) lines.push(`The plan folder ${found.planFolder.path}.`);
    return { warn: true, way: 'in', lines: [...lines, ...workingLine(found)] };
  }
  if (was) { // off Docket's plans
    const n = found.docketPlans.length;
    if (!n) return none;
    const open = found.docketPlans.filter((p) => p.done < p.total).length;
    return { warn: true, way: 'out', lines: [`${n} Docket plan${s(n)}${open ? `, ${open} not finished` : ''}. They stay in Docket's folder but stop showing, and sessions lose the plan tools.`, ...workingLine(found)] };
  }
  return none;
}
const s = (n) => n === 1 ? '' : 's';
// How many hooks run at each event: "1 at SessionStart, 2 at PreToolUse".
const hookEvents = (hooks) => [...hooks.reduce((m, h) => m.set(h.event, (m.get(h.event) || 0) + 1), new Map())].map(([e, n]) => `${n} at ${e}`).join(', ');
const outsideFound = (f) => !!(f.plans.length || f.claims.length || f.hooks.some((h) => h.plan));
const claimWorking = (f) => { const w = f.claims.filter((c) => c.working).length; return w ? `, ${w} by a session working now` : ''; };
const workingLine = (f) => f.working.length ? [`${f.working.length} session${s(f.working.length)} working now keep${f.working.length === 1 ? 's' : ''} the rules ${f.working.length === 1 ? 'it' : 'they'} started with until ${f.working.length === 1 ? 'it starts' : 'they start'} again.`] : [];

// How the conversion onto Docket's plans is split (#858): one plan file can fill half a session's room, so each file
// is converted in a session of its own, started by the conversion session, which keeps the order and the index plans.
// Those sessions have the plan tools before the switch, and any of them may make several plans (Docket allows it
// only in a conversion).
const CONVERT_IN_PIECES = [
  '- Convert each plan file in a session of its own, so no session has to read every file: start one per file with mcp__portal__start_session (initiation user_asked: the user asked for this conversion), with a brief that names the file, its claims from the list above, and the rules in this brief. Those sessions have the plan tools too. A small file you may convert here yourself; this session, and each session it starts, may make several plans.',
  '- Index plans first: start the sessions for the index plans, and wait for each to report the plan id it made. Then start the sessions for the files an index links to, each told to make its plan under the index plan\'s task for that file with plan_create\'s for_task, as "<index plan id>/<task id>".',
  '- Every task needs a kind, one of build, test, decision or research, or plan_create refuses the whole call. A question or approval someone else must give is a decision.',
];

// The brief for the session that converts: what was found, what to make, what to leave alone, and how it ends.
export function conversionBrief({ desk, from, to, found, convertTo = '' }) {
  const L = [];
  const list = (arr, fmt, rest = 'not listed here') => { for (const x of arr.slice(0, MAX_LIST)) L.push(fmt(x)); if (arr.length > MAX_LIST) L.push(`- …and ${arr.length - MAX_LIST} more, ${rest}.`); };
  const scope = found.scope || '';
  L.push(`Docket is switching the desk "${desk}" from ${systemName(from)} to ${systemName(to)}, and the user asked for the work that lives in the old system to be carried over. The desk stays on its old plan system until the user presses Finish the switch on the card Docket shows for it, so take your time and say when you are done.`);
  if (to && plansOnFor(to)) {
    if (scope) L.push('', `The user chose to convert one project now: only the plans in ${scope}. Everything below is in that folder. Leave the desk's other plans alone and do not convert them.`);
    L.push('', '## What was found');
    const how = (p) => p.claims ? `; claimed by ${p.claims} session${s(p.claims)}${p.working ? ` (${p.working} working now)` : ''}` : p.found === 'linked' ? '; no claim, a plan above links to it' : p.found === 'folder' ? '; no claim and no link, found beside the others' : '';
    if (found.plans.length) { L.push('', 'Plan files (markdown checklists: "- [ ]" open, "- [x]" done), with the sessions that claimed each:'); list(found.plans, (p) => `- ${p.file} — "${p.title}": ${p.open} open, ${p.done} done${how(p)}`); }
    const markerDirs = found.markers.map((m) => path.join(m.dir, m.pattern)).join(', ');
    const held = found.claims.filter((c) => !c.missing);
    if (held.length) { L.push('', `Claims (marker files in ${markerDirs}; each holds "state=" and "plan=" lines, the file name ends in the start of the session id):`); list(held, (c) => `- ${path.basename(c.file)} → ${c.plan}${c.id ? ` (session ${c.id}${c.title ? ` "${c.title}"` : ''}${c.working ? ', working now' : ''})` : ''}`, `the marker files in ${markerDirs} name them`); }
    if (found.missing?.length) { L.push('', `Claims on files that no longer exist (${found.missing.reduce((n, m) => n + m.claims, 0)} claims, ${found.missing.length} file${s(found.missing.length)}): nothing is left to convert from them. Mention them in your report, do not look for them:`); list(found.missing, (m) => `- ${m.file}: ${m.claims} claim${s(m.claims)}`); }
    if (found.hooks.length) { L.push('', 'Claude Code hooks of that system:'); list(found.hooks, (h) => `- ${h.event}${h.matcher ? ` (${h.matcher})` : ''} in ${h.file}: ${h.command}`); }
    if (found.planFolder?.path) L.push('', `The desk's plan folder: ${found.planFolder.path}${found.planFolder.marker ? ` (markers ${found.planFolder.marker})` : ''}.`);
    L.push('', '## What to make',
      '- Read each plan file above that still has open tasks (and the index plans that link to them), and make Docket plans for them with mcp__portal__plan_create: one Docket plan per plan file, sub-plans under the task of the index plan that links to them.',
      ...CONVERT_IN_PIECES,
      '- Carry over each task: its title, done or open, who holds it (a claim above, when its session is still around), what it waits on ("B waits on A" written in prose becomes After), and anything waiting on the user or someone outside Docket. Keep links to tickets, pull requests and the old file.',
      '- Plans whose every task is done need no Docket plan: list them in your report instead.',
      '- A plan file above with no claim was found by its name only: check that it is a plan of work and not, say, the checklist of a test run, and ask the user when it is not clear.',
      '- Ask the user before guessing at an order, a holder or a state that the file does not say.');
  } else {
    L.push('', '## What was found', '', "Docket's own plans on this desk:");
    list(found.docketPlans, (p) => `- ${p.id} "${p.title}": ${p.done} of ${p.total} done — ${p.file}`);
    L.push('', '## What to make',
      `- Best effort: write each plan above as a markdown checklist ("- [ ]" open, "- [x]" done, indented "- Held by:", "- After:", "- Note:" lines) in ${convertTo ? convertTo : 'a folder the user picks (ask them first)'}, one file per plan, with the index plan linking to its sub-plans.`,
      "- Read them with mcp__portal__plan_list and plan_show, or from the files listed. Docket's own plan files stay where they are.");
  }
  L.push('', '## What to leave alone',
    '- Do not change, move, rename or delete any of the old files: plan files, marker files, hooks and settings.json all stay exactly as they are, read-only. Nothing is deleted.',
    '- Do not edit the desk\'s settings, and do not switch the plan system yourself.',
    '', '## When you are done',
    '- Report what you made, what could not be carried over and why, and anything the user should decide.',
    `- Then tell the user that the desk is still on ${systemName(from)}, and that they finish the switch with Finish the switch on Docket's card for this desk (or Cancel the switch there to stay as it is).${scope ? " Say too that the desk's other projects were not converted: they stay in the old files." : ''}`);
  return L.join('\n');
}
