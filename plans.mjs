// Docket's own plan system (#180): a plan is a markdown checklist file a session coordinates, made of tasks other
// sessions claim and finish. One file per plan, in one folder per desk. Each task is one "- [ ]" line (the same
// shape other plan tools use, so a person can read the file and a desk can switch systems cheaply), with its details
// as indented "- Key: value" lines under it. Plans nest along the session tree: a plan made by a session working a
// task hangs off that task, and both files name each other. The plan with no parent is the master plan.
// Not "tasks": tasks.mjs is a session's background jobs.
import fs from 'node:fs';
import path from 'node:path';
import { randomBytes } from 'node:crypto';

// waiting_outside (#652): waiting on something outside Docket that is not the user (a colleague, a vendor, a date),
// with what it waits on in the task's "Waits on" line.
export const STATES = ['open', 'claimed', 'done', 'waiting_on_user', 'waiting_outside', 'sent_back', 'dropped'];
const STATE_WORDS = { open: 'open', claimed: 'claimed', done: 'done', waiting_on_user: 'waiting on the user', waiting_outside: 'waiting outside Docket', sent_back: 'sent back', dropped: 'dropped' };
// What a task is (#639): set when it is made and never changed. Tasks made before kinds existed have none.
export const KINDS = ['build', 'test', 'decision', 'research'];
// The plan rules' version (#661): raised when the rules change in a way older plans should be checked against. A plan
// records, on its "- Rules checked:" line, the version its coordinator last reviewed it at; a plan file without that
// line was never reviewed (0). New plans start at the current version. 1: the rules of #651 to #655. 2: done means
// done, and a task set done by mistake is corrected (#663). 3: fewer user steps, checks and other people's work are not
// the user's, and the coordinator starts everything free at once and gathers the user's decisions (#870). 4: waiting_outside only when someone said so,
// keep the plan moving in parallel, and pausing is the user's (#889).
export const PLAN_RULES_VERSION = 4;
// Task names follow the plan tree (#639): T1, T2 in the master plan; T3.1, T3.2 in a plan made for task T3; T3.2.1
// one level deeper. Numbers are never reused: a dropped task keeps its number and stays in the file.
const TASK_ID = /T\d+(?:\.\d+)*/;
const TASK_IDS = new RegExp(TASK_ID.source, 'g');
const TASK_LINE = new RegExp(`^- \\[([ xX])\\] (${TASK_ID.source})\\s*(.*)$`);
const PART_OF_TASK = new RegExp(`\\btask (${TASK_ID.source})\\b`);
// A task that no longer stops anything: done, or dropped (out of the plan's work, counted neither open nor done).
const finished = (t) => t.state === 'done' || t.state === 'dropped';
const wordToState = (w) => Object.keys(STATE_WORDS).find((k) => STATE_WORDS[k].toLowerCase() === String(w).trim().toLowerCase()) || 'open';
// A task the user does themself (#652): "- Owner: the user" in the file. No session claims it; the coordinator tells
// the user when it is their turn and marks it done once they have done it. Tasks without the line are sessions' work.
const USER_OWNER = 'the user';
// A task's place in a sentence: "T4 Merge the pull request (the user's step)".
export const userTag = (t) => t.forUser ? " (the user's step)" : '';
const PLAN_ID = /\bp-[a-z0-9]{4,}\b/;
const stamp = (t) => new Date(t).toISOString().slice(0, 16).replace('T', ' ');
const oneLine = (s) => String(s ?? '').replace(/\s+/g, ' ').trim();
// Phases (#869): a plan may name its sections, in the order the work happens, and put each task in one. The file keeps
// them on one "- Phases: Setup | Build | Ship" line, so a name never holds "|". Plans without phases are unchanged.
const phaseName = (s) => oneLine(String(s ?? '').replace(/\|/g, '/'));
const PHASE_SEP = ' | ';

// "<session id> (<title>)" both ways.
const who = (id, title) => id ? `${id}${title ? ` (${oneLine(title).replace(/[()]/g, '')})` : ''}` : '';
function parseWho(v) {
  const m = String(v).trim().match(/^(\S+)(?:\s+\((.*)\))?/);
  return m ? { id: m[1], title: m[2] || '' } : { id: '', title: '' };
}

// ---------- the file ----------
export function parsePlan(text, file = '') {
  const lines = String(text).replace(/\r\n/g, '\n').split('\n');
  const plan = { id: '', title: '', coordinator: '', coordinatorTitle: '', parent: null, made: '', rulesChecked: 0, phases: [], goal: '', tasks: [], file };
  let where = 'head', goal = [], task = null, key = null;
  for (const line of lines) {
    if (where === 'head' && /^# /.test(line) && !plan.title) { plan.title = line.slice(2).trim(); continue; }
    if (/^## Tasks\s*$/.test(line)) { where = 'tasks'; continue; }
    if (where === 'head') {
      const m = line.match(/^- (Plan|Coordinator|Part of|Made|Rules checked|Phases): (.*)$/);
      if (m && !goal.length) {
        if (m[1] === 'Plan') plan.id = m[2].match(PLAN_ID)?.[0] || '';
        else if (m[1] === 'Coordinator') { const w = parseWho(m[2]); plan.coordinator = w.id; plan.coordinatorTitle = w.title; }
        else if (m[1] === 'Part of') { const p = m[2].match(PLAN_ID)?.[0], t = m[2].match(PART_OF_TASK)?.[1]; if (p) plan.parent = { plan: p, task: t || '' }; }
        else if (m[1] === 'Rules checked') plan.rulesChecked = Number(m[2].match(/\d+/)?.[0] || 0);
        else if (m[1] === 'Phases') plan.phases = m[2].split('|').map(phaseName).filter((n, i, a) => n && a.findIndex((x) => x.toLowerCase() === n.toLowerCase()) === i);
        else plan.made = m[2].trim();
        continue;
      }
      if (line.trim() || goal.length) goal.push(line);
      continue;
    }
    const t = line.match(TASK_LINE);
    if (t) {
      task = { id: t[2], title: t[3].trim(), kind: '', forUser: false, state: t[1] === ' ' ? 'open' : 'done', holder: '', holderTitle: '', claimedAt: '', after: [], waitsOn: '', brief: '', note: '', links: [], plan: '', phase: '' };
      plan.tasks.push(task); key = null; continue;
    }
    if (!task) continue;
    const d = line.match(/^ {2}- (State|Kind|Owner|Phase|Held by|After|Waits on|Brief|Note|Link|Plan): ?(.*)$/);
    if (d) {
      key = d[1];
      const v = d[2];
      // The box wins: a ticked task is done whatever its State line says, and an unticked one is never done.
      if (key === 'State') { const s = wordToState(v.replace(/ since .*$/, '')); if (task.state !== 'done') task.state = s === 'done' ? 'open' : s; task.claimedAt = v.match(/ since (.*)$/)?.[1] || ''; }
      else if (key === 'Held by') { const w = parseWho(v); task.holder = w.id; task.holderTitle = w.title; }
      else if (key === 'Kind') task.kind = v.trim().toLowerCase();
      else if (key === 'Owner') task.forUser = v.trim().toLowerCase() === USER_OWNER;
      else if (key === 'Phase') task.phase = phaseName(v);
      else if (key === 'Waits on') task.waitsOn = oneLine(v);
      else if (key === 'After') task.after = v.match(TASK_IDS) || [];
      else if (key === 'Brief') task.brief = v;
      else if (key === 'Note') task.note = v;
      else if (key === 'Link') { if (v.trim()) task.links.push(v.trim()); }
      else if (key === 'Plan') task.plan = v.match(PLAN_ID)?.[0] || '';
      continue;
    }
    if (/^ {4}/.test(line) && (key === 'Brief' || key === 'Note')) { task[key.toLowerCase()] += '\n' + line.slice(4); continue; }
    if (line.trim()) key = null;
  }
  plan.goal = goal.join('\n').trim();
  // A task naming a phase the list lacks (a file edited by hand) keeps it: the phase joins the end of the list.
  for (const t of plan.tasks) {
    if (!t.phase) continue;
    const known = plan.phases.find((n) => n.toLowerCase() === t.phase.toLowerCase());
    if (known) t.phase = known; else plan.phases.push(t.phase);
  }
  return plan;
}

const more = (s) => String(s).replace(/\r\n/g, '\n').split('\n').map((l, i) => i ? '    ' + l : l).join('\n');
export function formatPlan(p, fileOf = (id) => id) {
  const out = [`# ${oneLine(p.title)}`, '', `- Plan: ${p.id}`];
  if (p.coordinator) out.push(`- Coordinator: ${who(p.coordinator, p.coordinatorTitle)}`);
  if (p.parent) out.push(`- Part of: [${p.parent.plan}](${fileOf(p.parent.plan)}), task ${p.parent.task}`);
  if (p.made) out.push(`- Made: ${p.made}`);
  if (p.rulesChecked) out.push(`- Rules checked: ${p.rulesChecked}`);
  if (p.phases?.length) out.push(`- Phases: ${p.phases.map(phaseName).join(PHASE_SEP)}`);
  out.push('');
  if (p.goal) out.push(p.goal.trim(), '');
  out.push('## Tasks', '');
  for (const t of p.tasks) {
    out.push(`- [${t.state === 'done' ? 'x' : ' '}] ${t.id} ${oneLine(t.title)}`);
    if (t.kind) out.push(`  - Kind: ${t.kind}`);
    if (t.forUser) out.push(`  - Owner: ${USER_OWNER}`);
    if (t.phase) out.push(`  - Phase: ${phaseName(t.phase)}`);
    out.push(`  - State: ${STATE_WORDS[t.state] || 'open'}${t.claimedAt && t.state !== 'open' ? ` since ${t.claimedAt}` : ''}`);
    if (t.holder) out.push(`  - Held by: ${who(t.holder, t.holderTitle)}`);
    if (t.after.length) out.push(`  - After: ${t.after.join(', ')}`);
    if (t.waitsOn) out.push(`  - Waits on: ${oneLine(t.waitsOn)}`);
    if (t.brief) out.push(`  - Brief: ${more(t.brief.trim())}`);
    if (t.note) out.push(`  - Note: ${more(t.note.trim())}`);
    for (const l of t.links) out.push(`  - Link: ${oneLine(l)}`);
    if (t.plan) out.push(`  - Plan: [${t.plan}](${fileOf(t.plan)})`);
  }
  return out.join('\n') + '\n';
}

// ---------- order ----------
// Tasks free to start now: open, with every task they wait on done (or dropped: a dropped task stops nothing). The
// user's steps among them are the user's to do now; sessions claim only the rest (sessionReady).
export function readyTasks(plan) {
  const done = new Set(plan.tasks.filter(finished).map((t) => t.id));
  return plan.tasks.filter((t) => t.state === 'open' && t.after.every((a) => done.has(a)));
}
export const sessionReady = (plan) => readyTasks(plan).filter((t) => !t.forUser);
// The user's steps not yet done or dropped, in plan order (#652).
export const userSteps = (plan) => plan.tasks.filter((t) => t.forUser && !finished(t));
// A loop in the "after" lists (A after B, B after A), as the ids around it, or null.
export function findLoop(tasks) {
  const by = new Map(tasks.map((t) => [t.id, t])), seen = new Map(); // id -> 1 visiting, 2 done
  const visit = (id, trail) => {
    if (seen.get(id) === 2) return null;
    if (seen.get(id) === 1) return [...trail.slice(trail.indexOf(id)), id];
    seen.set(id, 1);
    for (const a of by.get(id)?.after || []) { const l = visit(a, [...trail, id]); if (l) return l; }
    seen.set(id, 2);
    return null;
  };
  for (const t of tasks) { const l = visit(t.id, []); if (l) return l; }
  return null;
}
// Why no task can be claimed, in plain words.
export function whyNoneReady(plan) {
  const left = plan.tasks.filter((t) => !finished(t));
  if (!plan.tasks.length) return 'The plan has no tasks.';
  if (!left.length) return plan.tasks.some((t) => t.state === 'dropped') ? 'Every task in this plan is done or dropped.' : 'Every task in this plan is done.';
  const done = new Set(plan.tasks.filter(finished).map((t) => t.id));
  const parts = left.map((t) => t.state === 'open' && t.forUser && t.after.every((a) => done.has(a)) ? `${t.id} is the user's to do`
    : t.state === 'open' ? `${t.id} waits on ${t.after.filter((a) => !done.has(a)).join(', ')}`
    : t.state === 'waiting_outside' ? `${t.id} is waiting outside Docket${t.waitsOn ? ` on ${t.waitsOn}` : ''}`
    : `${t.id} is ${STATE_WORDS[t.state]}${t.holder ? ` (${t.holderTitle || t.holder})` : ''}`);
  return `No task is free for a session: ${parts.join('; ')}.`;
}

// ---------- reviews against new rules (#661) ----------
// Open: some task not done or dropped. A finished plan is never asked to be reviewed.
export const planOpen = (plan) => plan.tasks.some((t) => !finished(t));
export const reviewDue = (plan, version = PLAN_RULES_VERSION) => planOpen(plan) && (plan.rulesChecked || 0) < version;

// ---------- phases (#869) ----------
// The plan's own name for a phase given loosely (any case), or '' when it has none by that name.
export const findPhase = (plan, name) => (plan.phases || []).find((n) => n.toLowerCase() === phaseName(name).toLowerCase()) || '';
// The plan's phases in order, each with its tasks in plan order; tasks with no phase come last under the name ''
// (only when there are any). A plan without phases gives one '' group holding every task.
export function phaseGroups(plan) {
  const phases = plan.phases || [];
  const groups = phases.map((name) => ({ name, tasks: plan.tasks.filter((t) => t.phase === name) }));
  const loose = plan.tasks.filter((t) => !phases.includes(t.phase));
  if (loose.length || !groups.length) groups.push({ name: '', tasks: loose });
  return groups;
}
// A phase list as given: names checked, and none twice.
function phaseList(names) {
  const out = [];
  for (const n of names || []) {
    const name = phaseName(n);
    if (!name) throw new Error('Every phase needs a name.');
    if (out.some((x) => x.toLowerCase() === name.toLowerCase())) throw new Error(`The phase "${name}" is named twice.`);
    out.push(name);
  }
  return out;
}
const phasesSay = (p) => p.phases?.length ? `Its phases are ${p.phases.join(', ')}.` : 'It has no phases yet.';

// ---------- the folder ----------
const sleep = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
const slug = (s) => oneLine(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40);

// One desk's plans. Every change runs start to finish while holding the folder's lock file, so two writers (two
// Docket apps, or Docket and a person's script) never both read "free" and both write "mine". Inside one Docket
// the changes are already one at a time: each is synchronous.
export function createPlanStore({ dir, now = Date.now, staleMs = 30000, waitMs = 5000 }) {
  const lockFile = path.join(dir, '.lock');
  function locked(fn) {
    fs.mkdirSync(dir, { recursive: true });
    const until = now() + waitMs;
    for (;;) {
      try { fs.closeSync(fs.openSync(lockFile, 'wx')); break; }
      catch (e) {
        if (e.code !== 'EEXIST') throw e;
        let age = 0; try { age = Date.now() - fs.statSync(lockFile).mtimeMs; } catch { continue; }
        if (age > staleMs) { try { fs.unlinkSync(lockFile); } catch {} continue; } // left by a crash
        if (Date.now() > until) throw new Error('The plan folder is busy; try again in a moment.');
        sleep(25);
      }
    }
    try { return fn(); } finally { try { fs.unlinkSync(lockFile); } catch {} }
  }
  const files = () => { try { return fs.readdirSync(dir).filter((n) => /^p-[a-z0-9]+(-.*)?\.md$/.test(n)); } catch { return []; } };
  const fileOf = (id) => files().find((n) => n === `${id}.md` || n.startsWith(`${id}-`)) || '';
  function read(id) {
    const f = fileOf(id); if (!f) return null;
    return parsePlan(fs.readFileSync(path.join(dir, f), 'utf8'), path.join(dir, f));
  }
  function must(id) { const p = read(id); if (!p) throw new Error(`No plan ${id} on this desk.`); return p; }
  function write(p) {
    const f = path.join(dir, fileOf(p.id) || `${p.id}-${slug(p.title) || 'plan'}.md`), tmp = f + '.tmp';
    fs.writeFileSync(tmp, formatPlan(p, (id) => fileOf(id) || `${id}.md`));
    fs.renameSync(tmp, f);
    p.file = f;
    return p;
  }
  function list() { return files().map((n) => { try { return parsePlan(fs.readFileSync(path.join(dir, n), 'utf8'), path.join(dir, n)); } catch { return null; } }).filter((p) => p?.id); }

  // The start of this plan's task names: "T" for a master plan, "T3." for a plan made for task T3. A plan under a
  // task that was made before names followed the tree, and already numbered T1, T2, keeps numbering that way.
  function prefixOf(plan) {
    if (!plan.parent?.task) return 'T';
    const dotted = plan.parent.task + '.';
    return plan.tasks.length && !plan.tasks.some((t) => t.id.startsWith(dotted)) ? 'T' : dotted;
  }
  // New tasks for a plan, numbered after the highest number it has ever used. "after" names tasks by id (T1) or by
  // their place in this same list (1 for the first new task), so a whole plan with its order can be made in one call.
  // "replaces" names a task this one takes the place of: that task is dropped, and tasks waiting on it wait on this.
  function newTasks(plan, specs) {
    const pre = prefixOf(plan), mine = new RegExp(`^${pre.replace(/\./g, '\\.')}(\\d+)$`);
    let n = Math.max(0, ...plan.tasks.map((t) => Number(t.id.match(mine)?.[1] || 0)));
    // Every task without a kind is named at once, so one retry fixes them all (#858).
    const kindless = specs.filter((s) => !String(s.kind ?? '').trim());
    if (kindless.length === 1) throw new Error(`${oneLine(kindless[0].title) ? `Task "${oneLine(kindless[0].title)}"` : 'Every task'} needs a kind: build, test, decision or research. Nothing was made: give it a kind and call again.`);
    if (kindless.length) throw new Error(`${kindless.length} tasks need a kind (build, test, decision or research), so nothing was made: ${kindless.slice(0, 10).map((s) => `"${oneLine(s.title)}"`).join(', ')}${kindless.length > 10 ? `, and ${kindless.length - 10} more` : ''}. Give every task a kind and call again.`);
    for (const s of specs) {
      const what = oneLine(s.title) ? `Task "${oneLine(s.title)}"` : 'Every task';
      const k = String(s.kind).trim().toLowerCase();
      if (!KINDS.includes(k)) throw new Error(`${what} has the kind "${oneLine(s.kind)}", which is not one of build, test, decision or research.`);
    }
    const made = specs.map((s) => ({ id: `${pre}${++n}`, title: oneLine(s.title), kind: String(s.kind).trim().toLowerCase(), forUser: !!s.for_user, state: 'open', holder: '', holderTitle: '', claimedAt: '',
      after: [], waitsOn: '', brief: String(s.brief || '').trim(), note: '', links: (s.links || []).map(oneLine).filter(Boolean), plan: '', phase: '' }));
    specs.forEach((s, i) => {
      if (!phaseName(s.phase)) return;
      made[i].phase = findPhase(plan, s.phase);
      if (!made[i].phase) throw new Error(`Task "${made[i].title}" is in the phase "${phaseName(s.phase)}", which this plan does not have. ${phasesSay(plan)} Add the phase first.`);
    });
    const ids = new Set([...plan.tasks, ...made].map((t) => t.id));
    specs.forEach((s, i) => {
      made[i].after = [...new Set((s.after || []).map((a) => typeof a === 'number' || /^\d+$/.test(a) ? made[Number(a) - 1]?.id : String(a).toUpperCase()))];
      const bad = made[i].after.filter((a) => !a || !ids.has(a));
      if (bad.length || s.after?.some((a) => (typeof a === 'number' || /^\d+$/.test(a)) && !made[Number(a) - 1])) throw new Error(`Task "${made[i].title}" waits on a task that is not in this plan.`);
      if (made[i].after.includes(made[i].id)) throw new Error(`Task "${made[i].title}" cannot wait on itself.`);
    });
    for (const t of made) if (!t.title) throw new Error('Every task needs a title.');
    const swaps = new Map();
    specs.forEach((s, i) => {
      if (!s.replaces) return;
      const old = plan.tasks.find((t) => t.id === String(s.replaces).trim().toUpperCase());
      if (!old) throw new Error(`Task "${made[i].title}" replaces ${oneLine(s.replaces)}, which is not in this plan.`);
      if (old.state === 'done') throw new Error(`${old.id} is done, so nothing can replace it. If it was set done by mistake, correct it first (set it dropped with a note saying why), then add the replacement.`);
      if (swaps.has(old.id)) throw new Error(`Only one new task can replace ${old.id}.`);
      swaps.set(old.id, made[i]);
    });
    const swap = (t) => finished(t) ? t.after : [...new Set(t.after.map((a) => swaps.has(a) ? swaps.get(a).id : a))];
    // Checked on copies, so a refused call (a loop) leaves the plan as it was.
    const loop = findLoop([...plan.tasks.map((t) => ({ ...t, after: swap(t) })), ...made]);
    if (loop) throw new Error(`Those tasks wait on each other in a loop: ${loop.join(' → ')}.`);
    for (const t of plan.tasks) {
      t.after = swap(t);
      const by = swaps.get(t.id);
      if (by) { t.note = t.state === 'dropped' ? `${t.note ? t.note + ' ' : ''}Replaced by ${by.id}.` : `Replaced by ${by.id}.`; t.state = 'dropped'; }
    }
    return made;
  }

  // A new plan. parent { plan, task } hangs it off that task, and the task names it back.
  function create({ title, goal = '', tasks = [], phases = [], coordinator, coordinatorTitle = '', parent = null }) {
    if (!oneLine(title)) throw new Error('A plan needs a title.');
    return locked(() => {
      let id; do id = 'p-' + randomBytes(4).toString('hex').slice(0, 6); while (fileOf(id));
      const plan = { id, title: oneLine(title), coordinator: coordinator || '', coordinatorTitle, parent: null, made: stamp(now()), rulesChecked: PLAN_RULES_VERSION, phases: phaseList(phases), goal: String(goal).trim(), tasks: [], file: '' };
      let up = null, t = null;
      if (parent) {
        up = must(parent.plan);
        t = up.tasks.find((x) => x.id === String(parent.task).toUpperCase());
        if (!t) throw new Error(`Plan ${parent.plan} has no task ${parent.task}.`);
        if (t.plan) throw new Error(`Task ${t.id} of plan ${parent.plan} already has its own plan, ${t.plan}.`);
        plan.parent = { plan: up.id, task: t.id };
      }
      plan.tasks = newTasks(plan, tasks);
      if (t) t.plan = plan.id;
      write(plan);
      if (up) write(up);
      return plan;
    });
  }
  function addTasks(id, specs, actor) {
    return locked(() => {
      const p = must(id);
      if (actor && p.coordinator && actor !== p.coordinator) throw new Error(`Only the plan's coordinator adds tasks to ${id}.`);
      const made = newTasks(p, specs);
      p.tasks.push(...made);
      write(p);
      return { plan: p, added: made };
    });
  }
  // Claim a task for a session: the named one, or the first ready one. Refused when someone else holds it, when it
  // is done, or when a task it waits on is not done yet.
  function claim(id, taskId, actor, actorTitle = '') {
    if (!actor) throw new Error('Docket could not tell which session is claiming.');
    return locked(() => {
      const p = must(id);
      let t;
      if (taskId) {
        t = p.tasks.find((x) => x.id === String(taskId).toUpperCase());
        if (!t) throw new Error(`Plan ${id} has no task ${taskId}.`);
        if (t.holder === actor && t.state !== 'done' && t.state !== 'open') return { plan: p, task: t, already: true };
        if (t.state === 'done') throw new Error(`${t.id} is already done.`);
        if (t.state === 'dropped') throw new Error(`${t.id} was dropped${t.note ? `: ${t.note}` : '.'}`);
        if (t.forUser) throw new Error(`${t.id} is the user's to do, so no session claims it. The plan's coordinator tells the user when it is their turn and marks it done once they have done it.`);
        if (t.state === 'waiting_outside' && !t.holder) throw new Error(`${t.id} is waiting outside Docket${t.waitsOn ? ` on ${t.waitsOn}` : ''}; the coordinator sets it open when that arrives.`);
        if (t.state !== 'open') throw new Error(`${t.id} is already held by ${t.holderTitle || t.holder} (${STATE_WORDS[t.state]}).`);
        if (!readyTasks(p).includes(t)) throw new Error(`${t.id} waits on ${t.after.filter((a) => { const x = p.tasks.find((y) => y.id === a); return !x || !finished(x); }).join(', ')}, which ${t.after.length > 1 ? 'are' : 'is'} not done yet.`);
      } else {
        t = sessionReady(p)[0];
        if (!t) return { plan: p, task: null, why: whyNoneReady(p) };
      }
      Object.assign(t, { state: 'claimed', holder: actor, holderTitle: actorTitle, claimedAt: stamp(now()) });
      write(p);
      return { plan: p, task: t };
    });
  }
  // Change a task: its state, a note, links. Only the session holding it or the plan's coordinator. Dropping a task
  // is the coordinator's, with a note saying why, and a dropped task stays dropped. Returns the tasks that became
  // free to claim because of this change.
  // A kind can be filled in once, on a task made before kinds existed; a kind already set never changes.
  // waiting_outside needs what it waits on (waitsOn, or the one the task already has); leaving that state clears it.
  // forUser (true or false) makes a task the user's step or gives it back to sessions: the coordinator's to say.
  // Done is undone only by the coordinator (#663): sent back after checking it, or corrected when it was set done by
  // mistake, to dropped or back to open, with a note saying why; the note then starts "Corrected from done:".
  // phase moves a task to another of the plan's phases ('' takes it out of any): the coordinator's to say (#869).
  // after replaces the tasks it waits on, so a chain that is not truly needed can be loosened (#889): the coordinator's too.
  function update(id, taskId, { state, note, links, kind, waitsOn, forUser, phase, after } = {}, actor, actorTitle = '') {
    if (state && !STATES.includes(state)) throw new Error(`State must be one of ${STATES.join(', ')}.`);
    const k = kind === undefined ? '' : String(kind).trim().toLowerCase();
    if (kind !== undefined && !KINDS.includes(k)) throw new Error(`The kind "${oneLine(kind)}" is not one of build, test, decision or research.`);
    return locked(() => {
      const p = must(id);
      const t = p.tasks.find((x) => x.id === String(taskId).toUpperCase());
      if (!t) throw new Error(`Plan ${id} has no task ${taskId}.`);
      const isCoord = !!actor && actor === p.coordinator, isHolder = !!actor && actor === t.holder;
      if (!isCoord && !isHolder) throw new Error(`Only the session holding ${t.id}${t.holder ? ` (${t.holderTitle || t.holder})` : ''} or the plan's coordinator can change it.`);
      if (t.state === 'dropped' && state && state !== 'dropped') throw new Error(`${t.id} was dropped and stays dropped; add a new task instead.`);
      const correcting = t.state === 'done' && (state === 'dropped' || state === 'open');
      if (t.state === 'done' && state && state !== 'done') {
        if (!isCoord) throw new Error(`${t.id} is already done. Only the plan's coordinator can correct a task set done by mistake.`);
        if (!correcting && state !== 'sent_back') throw new Error(`${t.id} is done. To correct it, set it dropped or open with a note saying why; to have its holder fix it, set it sent_back.`);
        if (correcting && !oneLine(note)) throw new Error(`Say why ${t.id} was not really done, in a one-line note.`);
      }
      if (state === 'dropped' && t.state !== 'dropped') {
        if (!isCoord) throw new Error(`Only the plan's coordinator can drop ${t.id}.`);
        if (!oneLine(note)) throw new Error(`Say why ${t.id} is dropped, in a one-line note.`);
        note = oneLine(note);
      }
      if (correcting) note = `Corrected from done: ${oneLine(note)}${t.note ? ` (earlier note: ${oneLine(t.note)})` : ''}`;
      if (k && t.kind && t.kind !== k) throw new Error(`${t.id} already has the kind ${t.kind}, and a kind never changes. Add a new task with the right kind that replaces it.`);
      const waits = waitsOn === undefined ? '' : oneLine(waitsOn);
      if (waits && (state || t.state) !== 'waiting_outside') throw new Error(`Say what ${t.id} waits on only with the state waiting_outside.`);
      if (state === 'waiting_outside' && !waits && !t.waitsOn) throw new Error(`Say what ${t.id} waits on outside Docket (a person, a vendor, a date) with waits_on.`);
      if (forUser !== undefined && !!forUser !== t.forUser) {
        if (!isCoord) throw new Error(`Only the plan's coordinator says whose step ${t.id} is.`);
        if (forUser && t.holder && (state || t.state) !== 'open' && !finished(t)) throw new Error(`${t.id} is held by ${t.holderTitle || t.holder}; set it open first, then make it the user's step.`);
      }
      let ph;
      if (phase !== undefined) {
        ph = phaseName(phase) ? findPhase(p, phase) : '';
        if (phaseName(phase) && !ph) throw new Error(`Plan ${id} has no phase "${phaseName(phase)}". ${phasesSay(p)}`);
        if (ph !== t.phase && !isCoord) throw new Error(`Only the plan's coordinator moves ${t.id} to another phase.`);
      }
      let aft;
      if (after !== undefined) {
        if (!isCoord) throw new Error(`Only the plan's coordinator changes what ${t.id} waits on.`);
        aft = [...new Set(after.map((a) => String(a).trim().toUpperCase()).filter(Boolean))];
        const bad = aft.filter((a) => a === t.id || !p.tasks.some((x) => x.id === a));
        if (bad.length) throw new Error(`${t.id} cannot wait on ${bad.join(', ')}: ${bad.includes(t.id) ? 'a task cannot wait on itself' : `plan ${id} has no such task`}.`);
        const loop = findLoop(p.tasks.map((x) => x === t ? { ...x, after: aft } : x));
        if (loop) throw new Error(`That makes a loop: ${loop.join(' after ')}.`);
      }
      const before = new Set(readyTasks(p).map((x) => x.id));
      if (aft) t.after = aft;
      if (state) {
        if (state === 'open') { t.holder = ''; t.holderTitle = ''; t.claimedAt = ''; }
        // A task set going or done with no holder records the session that set it, so the plan says who did it. A
        // user's step was done by the user, so it keeps no session as its holder.
        else if ((state === 'claimed' || state === 'done') && !t.holder && !t.forUser) Object.assign(t, { holder: actor, holderTitle: actorTitle });
        // Each change of state stamps its own time, so "done since" is when it was set done, not when it was claimed.
        if (state !== 'open' && state !== t.state) t.claimedAt = stamp(now());
        if (state !== 'waiting_outside') t.waitsOn = '';
        t.state = state;
      }
      if (waits) t.waitsOn = waits;
      if (forUser !== undefined) t.forUser = !!forUser;
      if (ph !== undefined) t.phase = ph;
      if (k) t.kind = k;
      if (note !== undefined) t.note = String(note).trim();
      for (const l of links || []) if (oneLine(l) && !t.links.includes(oneLine(l))) t.links.push(oneLine(l));
      write(p);
      return { plan: p, task: t, nowReady: readyTasks(p).filter((x) => !before.has(x.id)) };
    });
  }
  // A fresh session takes over as coordinator.
  function setCoordinator(id, actor, actorTitle = '') {
    return locked(() => { const p = must(id); p.coordinator = actor; p.coordinatorTitle = actorTitle; return write(p); });
  }
  // A handoff (#667): the named tasks still held by session from, and not done or dropped, are held by session to now.
  // Returns the ids of the tasks that moved.
  function passTasks(id, taskIds, from, to, toTitle = '') {
    if (!from || !to) throw new Error('Docket could not tell which sessions the tasks move between.');
    return locked(() => {
      const p = must(id), want = new Set(taskIds.map((x) => String(x).toUpperCase()));
      const moved = p.tasks.filter((t) => want.has(t.id) && t.holder === from && !finished(t));
      for (const t of moved) Object.assign(t, { holder: to, holderTitle: toTitle });
      if (moved.length) write(p);
      return moved.map((t) => t.id);
    });
  }
  // The coordinator changes the goal, so it keeps matching the finish line as tasks are added or replaced.
  function setGoal(id, goal, actor) {
    if (!String(goal ?? '').trim()) throw new Error('A goal cannot be empty.');
    return locked(() => {
      const p = must(id);
      if (!actor || actor !== p.coordinator) throw new Error(`Only the plan's coordinator changes the goal of ${id}.`);
      p.goal = String(goal).trim();
      return write(p);
    });
  }
  // The coordinator sets the plan's phases (#869): the whole list in its new order, which adds and reorders, with
  // renames { from, to } applied first so tasks follow their phase to its new name; with renames alone the order
  // stays. A phase that still has tasks cannot be left out: move them first, or rename it.
  function setPhases(id, { phases, renames = [] } = {}, actor) {
    return locked(() => {
      const p = must(id);
      if (!actor || actor !== p.coordinator) throw new Error(`Only the plan's coordinator changes the phases of ${id}.`);
      const names = new Map(p.phases.map((n) => [n, n]));
      for (const r of renames || []) {
        const from = findPhase(p, r.from), to = phaseName(r.to);
        if (!from) throw new Error(`Plan ${id} has no phase "${phaseName(r.from)}" to rename. ${phasesSay(p)}`);
        if (!to) throw new Error(`Say the new name for the phase "${from}".`);
        names.set(from, to);
      }
      const next = phaseList(phases === undefined ? p.phases.map((n) => names.get(n)) : phases);
      const keep = (n) => next.find((x) => x.toLowerCase() === n.toLowerCase()) || '';
      const left = [...new Set(p.tasks.filter((t) => t.phase && !keep(names.get(t.phase) || t.phase)).map((t) => t.phase))];
      if (left.length) throw new Error(`The phase${left.length > 1 ? 's' : ''} ${left.map((n) => `"${n}"`).join(', ')} still ${left.length > 1 ? 'have' : 'has'} tasks (${p.tasks.filter((t) => left.includes(t.phase)).map((t) => t.id).join(', ')}). Move them to another phase first with plan_update_task, or keep the phase.`);
      for (const t of p.tasks) if (t.phase) t.phase = keep(names.get(t.phase) || t.phase);
      p.phases = next;
      return write(p);
    });
  }
  // The coordinator has reviewed the plan against the current rules (#661), changes or none: the version is recorded.
  function markReviewed(id, actor) {
    return locked(() => {
      const p = must(id);
      if (!actor || actor !== p.coordinator) throw new Error(`Only the plan's coordinator marks the review of ${id} done.`);
      p.rulesChecked = PLAN_RULES_VERSION;
      return write(p);
    });
  }
  // Progress counted on the smallest pieces: a task with its own plan counts as that plan's tasks, all the way down.
  // A dropped task counts as neither open nor done.
  function rollup(id, all = list(), seen = new Set()) {
    const p = all.find((x) => x.id === id); if (!p || seen.has(id)) return { done: 0, total: 0 };
    seen.add(id);
    let done = 0, total = 0;
    for (const t of p.tasks) {
      if (t.state === 'dropped') continue;
      const sub = t.plan && rollup(t.plan, all, seen);
      if (sub && sub.total) { done += sub.done; total += sub.total; } else { total++; if (t.state === 'done') done++; }
    }
    return { done, total };
  }
  // Progress per phase (#869), counted like rollup: [{ name, done, total }] in phase order, with '' last for tasks in
  // no phase when there are any. A plan without phases gives [].
  function phaseRollup(id, all = list()) {
    const p = all.find((x) => x.id === id); if (!p?.phases?.length) return [];
    return phaseGroups(p).map((g) => {
      let done = 0, total = 0;
      for (const t of g.tasks) {
        if (t.state === 'dropped') continue;
        const sub = t.plan && rollup(t.plan, all);
        if (sub && sub.total) { done += sub.done; total += sub.total; } else { total++; if (t.state === 'done') done++; }
      }
      return { name: g.name, done, total };
    });
  }
  // What lies behind rollup's two numbers, for the plan badge's hover (#841): the smallest pieces by state (dropped
  // ones too, which rollup leaves out), and this plan's own tasks: how many were made, which were dropped, and which
  // count as their own plan's tasks instead of themselves.
  function breakdown(id, all = list()) {
    const p = all.find((x) => x.id === id); if (!p) return null;
    const states = {};
    const walk = (q, seen) => {
      if (!q || seen.has(q.id)) return; seen.add(q.id);
      for (const t of q.tasks) {
        const sub = t.state !== 'dropped' && t.plan && rollup(t.plan, all).total ? all.find((x) => x.id === t.plan) : null;
        if (sub) walk(sub, seen); else states[t.state] = (states[t.state] || 0) + 1;
      }
    };
    walk(p, new Set());
    const subs = p.tasks.filter((t) => t.state !== 'dropped' && t.plan && rollup(t.plan, all).total);
    return { states, made: p.tasks.length, first: p.tasks[0]?.id || '', last: p.tasks.at(-1)?.id || '',
      dropped: p.tasks.filter((t) => t.state === 'dropped').length,
      subs: subs.map((t) => t.id), subTotal: subs.reduce((n, t) => n + rollup(t.plan, all).total, 0) };
  }
  return { dir, read, list, create, addTasks, claim, update, setCoordinator, passTasks, setGoal, setPhases, markReviewed, rollup, phaseRollup, breakdown, fileOf: (id) => { const f = fileOf(id); return f ? path.join(dir, f) : ''; } };
}
