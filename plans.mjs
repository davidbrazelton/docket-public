// Docket's own plan system (#180): a plan is a markdown checklist file a session coordinates, made of tasks other
// sessions claim and finish. One file per plan, in one folder per desk. Each task is one "- [ ]" line (the same
// shape other plan tools use, so a person can read the file and a desk can switch systems cheaply), with its details
// as indented "- Key: value" lines under it. Plans nest along the session tree: a plan made by a session working a
// task hangs off that task, and both files name each other. The plan with no parent is the master plan.
// Not "tasks": tasks.mjs is a session's background jobs.
import fs from 'node:fs';
import path from 'node:path';
import { randomBytes } from 'node:crypto';

export const STATES = ['open', 'claimed', 'done', 'waiting_on_user', 'sent_back', 'dropped'];
const STATE_WORDS = { open: 'open', claimed: 'claimed', done: 'done', waiting_on_user: 'waiting on the user', sent_back: 'sent back', dropped: 'dropped' };
// What a task is (#639): set when it is made and never changed. Tasks made before kinds existed have none.
export const KINDS = ['build', 'test', 'decision', 'research'];
// Task names follow the plan tree (#639): T1, T2 in the master plan; T3.1, T3.2 in a plan made for task T3; T3.2.1
// one level deeper. Numbers are never reused: a dropped task keeps its number and stays in the file.
const TASK_ID = /T\d+(?:\.\d+)*/;
const TASK_IDS = new RegExp(TASK_ID.source, 'g');
const TASK_LINE = new RegExp(`^- \\[([ xX])\\] (${TASK_ID.source})\\s*(.*)$`);
const PART_OF_TASK = new RegExp(`\\btask (${TASK_ID.source})\\b`);
// A task that no longer stops anything: done, or dropped (out of the plan's work, counted neither open nor done).
const finished = (t) => t.state === 'done' || t.state === 'dropped';
const wordToState = (w) => Object.keys(STATE_WORDS).find((k) => STATE_WORDS[k] === String(w).trim().toLowerCase()) || 'open';
const PLAN_ID = /\bp-[a-z0-9]{4,}\b/;
const stamp = (t) => new Date(t).toISOString().slice(0, 16).replace('T', ' ');
const oneLine = (s) => String(s ?? '').replace(/\s+/g, ' ').trim();

// "<session id> (<title>)" both ways.
const who = (id, title) => id ? `${id}${title ? ` (${oneLine(title).replace(/[()]/g, '')})` : ''}` : '';
function parseWho(v) {
  const m = String(v).trim().match(/^(\S+)(?:\s+\((.*)\))?/);
  return m ? { id: m[1], title: m[2] || '' } : { id: '', title: '' };
}

// ---------- the file ----------
export function parsePlan(text, file = '') {
  const lines = String(text).replace(/\r\n/g, '\n').split('\n');
  const plan = { id: '', title: '', coordinator: '', coordinatorTitle: '', parent: null, made: '', goal: '', tasks: [], file };
  let where = 'head', goal = [], task = null, key = null;
  for (const line of lines) {
    if (where === 'head' && /^# /.test(line) && !plan.title) { plan.title = line.slice(2).trim(); continue; }
    if (/^## Tasks\s*$/.test(line)) { where = 'tasks'; continue; }
    if (where === 'head') {
      const m = line.match(/^- (Plan|Coordinator|Part of|Made): (.*)$/);
      if (m && !goal.length) {
        if (m[1] === 'Plan') plan.id = m[2].match(PLAN_ID)?.[0] || '';
        else if (m[1] === 'Coordinator') { const w = parseWho(m[2]); plan.coordinator = w.id; plan.coordinatorTitle = w.title; }
        else if (m[1] === 'Part of') { const p = m[2].match(PLAN_ID)?.[0], t = m[2].match(PART_OF_TASK)?.[1]; if (p) plan.parent = { plan: p, task: t || '' }; }
        else plan.made = m[2].trim();
        continue;
      }
      if (line.trim() || goal.length) goal.push(line);
      continue;
    }
    const t = line.match(TASK_LINE);
    if (t) {
      task = { id: t[2], title: t[3].trim(), kind: '', state: t[1] === ' ' ? 'open' : 'done', holder: '', holderTitle: '', claimedAt: '', after: [], brief: '', note: '', links: [], plan: '' };
      plan.tasks.push(task); key = null; continue;
    }
    if (!task) continue;
    const d = line.match(/^ {2}- (State|Kind|Held by|After|Brief|Note|Link|Plan): ?(.*)$/);
    if (d) {
      key = d[1];
      const v = d[2];
      // The box wins: a ticked task is done whatever its State line says, and an unticked one is never done.
      if (key === 'State') { const s = wordToState(v.replace(/ since .*$/, '')); if (task.state !== 'done') task.state = s === 'done' ? 'open' : s; task.claimedAt = v.match(/ since (.*)$/)?.[1] || ''; }
      else if (key === 'Held by') { const w = parseWho(v); task.holder = w.id; task.holderTitle = w.title; }
      else if (key === 'Kind') task.kind = v.trim().toLowerCase();
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
  return plan;
}

const more = (s) => String(s).replace(/\r\n/g, '\n').split('\n').map((l, i) => i ? '    ' + l : l).join('\n');
export function formatPlan(p, fileOf = (id) => id) {
  const out = [`# ${oneLine(p.title)}`, '', `- Plan: ${p.id}`];
  if (p.coordinator) out.push(`- Coordinator: ${who(p.coordinator, p.coordinatorTitle)}`);
  if (p.parent) out.push(`- Part of: [${p.parent.plan}](${fileOf(p.parent.plan)}), task ${p.parent.task}`);
  if (p.made) out.push(`- Made: ${p.made}`);
  out.push('');
  if (p.goal) out.push(p.goal.trim(), '');
  out.push('## Tasks', '');
  for (const t of p.tasks) {
    out.push(`- [${t.state === 'done' ? 'x' : ' '}] ${t.id} ${oneLine(t.title)}`);
    if (t.kind) out.push(`  - Kind: ${t.kind}`);
    out.push(`  - State: ${STATE_WORDS[t.state] || 'open'}${t.claimedAt && t.state !== 'open' ? ` since ${t.claimedAt}` : ''}`);
    if (t.holder) out.push(`  - Held by: ${who(t.holder, t.holderTitle)}`);
    if (t.after.length) out.push(`  - After: ${t.after.join(', ')}`);
    if (t.brief) out.push(`  - Brief: ${more(t.brief.trim())}`);
    if (t.note) out.push(`  - Note: ${more(t.note.trim())}`);
    for (const l of t.links) out.push(`  - Link: ${oneLine(l)}`);
    if (t.plan) out.push(`  - Plan: [${t.plan}](${fileOf(t.plan)})`);
  }
  return out.join('\n') + '\n';
}

// ---------- order ----------
// Tasks free to claim now: open, with every task they wait on done (or dropped: a dropped task stops nothing).
export function readyTasks(plan) {
  const done = new Set(plan.tasks.filter(finished).map((t) => t.id));
  return plan.tasks.filter((t) => t.state === 'open' && t.after.every((a) => done.has(a)));
}
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
  const parts = left.map((t) => t.state === 'open' ? `${t.id} waits on ${t.after.filter((a) => !done.has(a)).join(', ')}`
    : `${t.id} is ${STATE_WORDS[t.state]}${t.holder ? ` (${t.holderTitle || t.holder})` : ''}`);
  return `No task is free: ${parts.join('; ')}.`;
}

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
    for (const s of specs) {
      const what = oneLine(s.title) ? `Task "${oneLine(s.title)}"` : 'Every task';
      const k = String(s.kind ?? '').trim().toLowerCase();
      if (!k) throw new Error(`${what} needs a kind: build, test, decision or research.`);
      if (!KINDS.includes(k)) throw new Error(`${what} has the kind "${oneLine(s.kind)}", which is not one of build, test, decision or research.`);
    }
    const made = specs.map((s) => ({ id: `${pre}${++n}`, title: oneLine(s.title), kind: String(s.kind).trim().toLowerCase(), state: 'open', holder: '', holderTitle: '', claimedAt: '',
      after: [], brief: String(s.brief || '').trim(), note: '', links: (s.links || []).map(oneLine).filter(Boolean), plan: '' }));
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
      if (old.state === 'done') throw new Error(`${old.id} is done, so nothing can replace it.`);
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
  function create({ title, goal = '', tasks = [], coordinator, coordinatorTitle = '', parent = null }) {
    if (!oneLine(title)) throw new Error('A plan needs a title.');
    return locked(() => {
      let id; do id = 'p-' + randomBytes(4).toString('hex').slice(0, 6); while (fileOf(id));
      const plan = { id, title: oneLine(title), coordinator: coordinator || '', coordinatorTitle, parent: null, made: stamp(now()), goal: String(goal).trim(), tasks: [], file: '' };
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
        if (t.state !== 'open') throw new Error(`${t.id} is already held by ${t.holderTitle || t.holder} (${STATE_WORDS[t.state]}).`);
        if (!readyTasks(p).includes(t)) throw new Error(`${t.id} waits on ${t.after.filter((a) => { const x = p.tasks.find((y) => y.id === a); return !x || !finished(x); }).join(', ')}, which ${t.after.length > 1 ? 'are' : 'is'} not done yet.`);
      } else {
        t = readyTasks(p)[0];
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
  function update(id, taskId, { state, note, links, kind } = {}, actor, actorTitle = '') {
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
      if (state === 'dropped' && t.state !== 'dropped') {
        if (!isCoord) throw new Error(`Only the plan's coordinator can drop ${t.id}.`);
        if (t.state === 'done') throw new Error(`${t.id} is already done.`);
        if (!oneLine(note)) throw new Error(`Say why ${t.id} is dropped, in a one-line note.`);
        note = oneLine(note);
      }
      if (k && t.kind && t.kind !== k) throw new Error(`${t.id} already has the kind ${t.kind}, and a kind never changes. Add a new task with the right kind that replaces it.`);
      const before = new Set(readyTasks(p).map((x) => x.id));
      if (state) {
        if (state === 'open') { t.holder = ''; t.holderTitle = ''; t.claimedAt = ''; }
        // A task set going or done with no holder records the session that set it, so the plan says who did it.
        else if ((state === 'claimed' || state === 'done') && !t.holder) Object.assign(t, { holder: actor, holderTitle: actorTitle });
        // Each change of state stamps its own time, so "done since" is when it was set done, not when it was claimed.
        if (state !== 'open' && state !== t.state) t.claimedAt = stamp(now());
        t.state = state;
      }
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
  return { dir, read, list, create, addTasks, claim, update, setCoordinator, setGoal, rollup, fileOf: (id) => { const f = fileOf(id); return f ? path.join(dir, f) : ''; } };
}
