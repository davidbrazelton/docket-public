// Keeping plans moving (#889): whether an open plan is moving, waiting on the user, stalled or paused, which of its
// claimed tasks were left by a session that stopped, and when Docket nudges its coordinator. Kept apart from the
// server so it can be tested; server.mjs gathers where each session stands and does the waking.
import { readyTasks, sessionReady, planOpen, whyNoneReady } from './plans.mjs';

// A holder that finished its turn, asks nothing and has done nothing for this long has left its task.
export const ORPHAN_IDLE_MS = 10 * 60000;
// A coordinator's turn has been over this long before Docket checks it: a session it started at the end of the turn
// claims its task within its first steps, so a task still open after this has no session.
export const NUDGE_GRACE_MS = 90000;
// How often the server looks.
export const MOTION_TICK_MS = 30000;

// Where a session stands, as the server sees it (look): 'working' (in a turn, or its background jobs run), 'waiting'
// (it asked the user something, or a form or permission ask is open), 'done' (its turn is over, nothing asked), or
// 'stopped' (closed, archived, deleted, or not running in Docket). idleMs: how long since it last did anything.
// why: for 'stopped', in a few words ('it was closed', 'it is not running').
export const standing = (look, id) => (id && look(id)) || { st: 'stopped', idleMs: Infinity, why: 'Docket does not know it' };

const mins = (ms) => Math.max(1, Math.round(ms / 60000));

// Claimed or sent-back tasks whose session is no longer working on them. kind: 'stopped' (closed, archived, not
// running), 'idle' (its turn ended ORPHAN_IDLE_MS or more ago, asking nothing) or 'waiting' (it waits on the user in its
// own chat: reported as that, not as stopped). key: the same task, holder and kind give the same key, so each is told once.
export function orphanTasks(plan, look, { idleMs = ORPHAN_IDLE_MS } = {}) {
  const out = [];
  for (const t of plan.tasks) {
    if (!['claimed', 'sent_back'].includes(t.state) || !t.holder) continue;
    const h = standing(look, t.holder);
    const kind = h.st === 'stopped' ? 'stopped' : h.st === 'waiting' ? 'waiting' : h.st === 'done' && h.idleMs >= idleMs ? 'idle' : '';
    if (kind) out.push({ task: t, kind, key: `${t.id}|${t.holder}|${kind}`, why: h.why || '', idleMs: h.idleMs });
  }
  return out;
}

// The plan's state for the user: 'paused', 'waiting' (on you), 'moving' or 'stalled', with a line saying why.
// null for a plan with nothing left to do. coord: the coordinator's standing ({ st }), or null when it has none.
// paused: 'plan' (Pause plan), 'docket' (Pause all) or ''.
export function planMotion({ plan, look, coord = null, paused = '' }) {
  if (!planOpen(plan)) return null;
  if (paused === 'plan') return { state: 'paused', why: 'Paused with Pause plan: Docket does not nudge its coordinator or wake it for freed tasks until you press Resume plan.' };
  if (paused === 'docket') return { state: 'paused', why: 'Docket is paused (Pause all).' };
  const open = plan.tasks.filter((t) => t.state !== 'done' && t.state !== 'dropped');
  const ready = readyTasks(plan), free = ready.filter((t) => !t.forUser), yours = ready.filter((t) => t.forUser);
  const holders = [...new Set(open.filter((t) => t.holder).map((t) => t.holder))];
  const working = holders.filter((id) => standing(look, id).st === 'working');
  const running = working.length ? `${working.length === 1 ? '1 session' : `${working.length} sessions`} working` : '';
  const coordWorks = coord?.st === 'working';
  // waiting on you: your steps are due, a task waits on your answer, or the coordinator (or a task's session) asked
  const asking = open.filter((t) => t.state === 'waiting_on_user' || (t.holder && standing(look, t.holder).st === 'waiting'));
  const due = [
    coord?.st === 'waiting' && 'its coordinator asked you something',
    yours.length && `your step${yours.length > 1 ? 's' : ''} ${yours.map((t) => t.id).join(', ')} ${yours.length > 1 ? 'are' : 'is'} due`,
    asking.length && `${asking.map((t) => t.id).join(', ')} ${asking.length > 1 ? 'wait' : 'waits'} on your answer`,
  ].filter(Boolean);
  if (due.length) return { state: 'waiting', why: cap(`${due.join('; ')}${running ? `. Also ${running}` : ''}.`) };
  if (working.length || coordWorks) return { state: 'moving', why: cap(`${[running, coordWorks && 'its coordinator is working'].filter(Boolean).join('; ')}.`) };
  // stalled: nothing running and nothing waits on the user, yet work is open
  const left = orphanTasks(plan, look, { idleMs: 0 }).filter((o) => o.kind !== 'waiting');
  const reasons = [
    free.length && `${free.map((t) => t.id).join(', ')} ${free.length > 1 ? 'are' : 'is'} free to start but no session works on ${free.length > 1 ? 'them' : 'it'}`,
    // no minutes here: the line stays the same while nothing changes, so pages redraw only when it does
    ...left.map((o) => `${o.task.id}'s session ${o.kind === 'stopped' ? 'stopped' : 'finished its turn'} without marking it done`),
  ].filter(Boolean);
  const outside = open.filter((t) => t.state === 'waiting_outside');
  if (!reasons.length && outside.length === open.length) reasons.push(`everything left waits outside Docket: ${outside.map((t) => `${t.id}${t.waitsOn ? ` on ${t.waitsOn}` : ''}`).join('; ')}`);
  if (coord?.st === 'stopped') reasons.push(`its coordinator ${coord.why || 'is not running'}`);
  return { state: 'stalled', why: cap(reasons.length ? `${reasons.join('; ')}.` : whyNoneReady(plan)) };
}
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);

// What a plan looks like for the "state changed" rule: each task's state, holder and what it waits on.
export const planSig = (plan) => plan.tasks.map((t) => `${t.id}:${t.state}:${t.holder || ''}:${t.after.join('+')}:${t.forUser ? 'u' : ''}`).join('|');

// Whether Docket nudges the coordinator now. Only while neither Docket nor the plan is paused, and only once the
// coordinator's turn has been over NUDGE_GRACE_MS, asking the user nothing. It nudges for tasks free to start with
// no session (only when the plan changed since the last nudge, so it never loops on the same state) and for tasks
// whose session stopped (each told once). last: what the last nudge saw, { sig, told }; give back `last` to keep.
// Returns { send, free, orphans, last }.
export function nudgeFor({ plan, look, coord, paused = '', last = null, graceMs = NUDGE_GRACE_MS, idleMs = ORPHAN_IDLE_MS }) {
  const was = { sig: last?.sig || '', told: last?.told || [] };
  const none = (keep = was) => ({ send: false, free: [], orphans: [], last: keep });
  if (paused || !planOpen(plan) || !coord) return none();
  if (coord.st !== 'done' || coord.idleMs < graceMs) return none();
  const free = sessionReady(plan), sig = planSig(plan);
  const orphans = orphanTasks(plan, look, { idleMs });
  // a task told about and settled since is forgotten, so it is told again if it is left again later
  const told = was.told.filter((k) => orphans.some((o) => o.key === k));
  const fresh = orphans.filter((o) => !told.includes(o.key));
  const freeDue = free.length > 0 && sig !== was.sig;
  if (!freeDue && !fresh.length) return none({ sig: was.sig, told });
  return { send: true, free, orphans: fresh, last: { sig, told: [...told, ...fresh.map((o) => o.key)] } };
}

// Said in every plan wake-up: run as much at once as the plan allows rather than wait on a long-running session.
export const PARALLEL_PUSH = 'While sessions run, keep the plan moving: look for anything else that can run beside them now, such as an "after" that is not truly needed (loosen it with after on plan_update_task), a task that can be split, or a check you can do yourself, and start it. Do not sit waiting on a long-running session.';
// What the coordinator says when the user asks it to hold off: pausing is the user's, never the coordinator's own call.
export const HOLD_OFF = 'If the user told you to hold off, do not just stop: tell them to press Pause plan (in this session\'s menu, or the plan\'s section of the Plan panel) or Pause all.';

const holderName = (t) => t.holderTitle ? `"${t.holderTitle}" (${t.holder})` : t.holder;
// The nudge's lines, for the session-report block it goes in.
export function nudgeText(plan, { free = [], orphans = [] }) {
  const L = [`- Plan "${plan.title}" (${plan.id}), which you coordinate, is stalled: your last turn ended with no session working on what is below, and nothing asked of the user.`];
  if (free.length) L.push(`  Free to start now, with no session started for ${free.length > 1 ? 'them' : 'it'}: ${free.map((t) => `${t.id} ${t.title}`).join('; ')}. Start a session for ${free.length > 1 ? 'every one of them' : 'it'} now, as the plan's rules say.`);
  for (const o of orphans) {
    const t = o.task;
    if (o.kind === 'waiting') L.push(`  ${t.id} ${t.title}: its session ${holderName(t)} is waiting on the user in its own chat. Nothing to do unless you can answer it yourself; it is told here once.`);
    else L.push(`  ${t.id} ${t.title}: its session ${holderName(t)} ${o.kind === 'stopped' ? `stopped without marking it done (${o.why || 'it is not running'})` : `finished its turn ${mins(o.idleMs)} min ago without marking it done`}. Check it (get_session_report), then mark it done, send it back, or set it open and start a session for it again.`);
  }
  L.push(`  ${PARALLEL_PUSH} ${HOLD_OFF}`);
  return L.join('\n');
}

// The line a "now free to start" wake-up gives, with the same push to run work side by side.
export function freedLine(r, userTag) {
  const n = r.tasks.length, mine = r.tasks.some((t) => t.title.endsWith(userTag));
  return `- Plan "${r.title}" (${r.planId}), which you coordinate: ${r.tasks.map((t) => `${t.id} ${t.title}`).join('; ')} ${n === 1 ? 'is' : 'are'} now free to start. Start ${n === 1 ? 'it' : 'every one of them'} now as the plan's rules say${mine ? "; gather the user's steps that are due into one message, saying in a line each what to decide or do" : ''}. ${PARALLEL_PUSH} ${HOLD_OFF}`;
}
