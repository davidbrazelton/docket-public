// What a child session's finished turn means for the session that started it. A child that
// ended its turn asking the user something is waiting on the user, not reporting a result, so its
// parent gets a quiet note instead of being woken (a woken parent repeats or answers the question).

// Lines at the end of a reply that come after the question and say nothing about it: the
// "Terms used" footer, a horizontal rule, a closing code fence.
const TRAILER = /^((>\s*)?\*?_?terms used:.*|[-*_]{3,}|```)$/i;
const LIST = /^\s*([-*+]|\d+[.)])\s+/;

// True when the reply's last paragraph asks a question. A last paragraph that is a list (the
// options under a numbered question) counts together with the paragraph or item above it, so
// "1. **Which one?**" followed by its option bullets still reads as a question.
export function endsAsking(text) {
  const paras = String(text || '').replace(/\r/g, '').split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);
  while (paras.length && paras.at(-1).split('\n').every((l) => TRAILER.test(l.trim()))) paras.pop();
  const tail = [];
  for (let i = paras.length - 1; i >= 0 && tail.length < 6; i--) {
    tail.unshift(paras[i]);
    if (!paras[i].split('\n').every((l) => LIST.test(l) || /^\s+\S/.test(l))) break; // reached plain prose
  }
  return tail.join('\n').split('\n').some((l) => /\?\s*$/.test(l.trim().replace(/[*_`)"'”’\]]+$/, '')));
}

// The words that open a list of what happens next ("Next steps:", "**What is left**", "## Still to do").
const NEXT_LEAD = /\b(next steps?|what happens (now|next)|what('s| is) (left|next)|still (to do|open|left)|left (to do|for you)|waiting on you|your (turn|move))\b/i;
// An item that speaks to the user: "Say merge and I will merge…", "Tell me which…", "Answer…".
const ASKS_USER = /^\s*(?:[-*+]|\d+[.)])\s+[*_]*(say|tell me|answer|reply|choose|pick|decide|approve|confirm)\b/i;

// True when the reply's last paragraph is a list of next steps: a numbered or bulleted list
// opened by a "Next steps" line (in the same paragraph or the one above it), or one with an item
// that asks the user to say or choose something. A list of what was done ("Done:\n- Fixed it") is not.
export function endsWithNextSteps(text) {
  const paras = String(text || '').replace(/\r/g, '').split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);
  while (paras.length && paras.at(-1).split('\n').every((l) => TRAILER.test(l.trim()))) paras.pop();
  const isItem = (l) => LIST.test(l) || /^\s+\S/.test(l);
  // The list may run over several paragraphs (items spaced apart); gather it back to where it starts.
  let i = paras.length - 1;
  const items = [];
  while (i >= 0 && paras[i].split('\n').every(isItem)) { items.unshift(...paras[i].split('\n')); i--; }
  let lead = i >= 0 ? paras[i].split('\n').at(-1) : '';
  if (!items.length && i >= 0) { // "Next steps:" then the list, with no blank line between
    const lines = paras[i].split('\n'), first = lines.findIndex(isItem);
    if (first < 1 || !lines.slice(first).every(isItem)) return false;
    items.push(...lines.slice(first)); lead = lines[first - 1];
  }
  if (!items.length) return false;
  return NEXT_LEAD.test(lead) || items.some((l) => ASKS_USER.test(l));
}

// A reply that leaves the user something to do: it ends by asking, or ends with a next-steps list.
export const endsWaiting = (text) => endsAsking(text) || endsWithNextSteps(text);

// Whether a child that just finished a turn is waiting on the user: a question form or permission
// ask still open, or a reply that ends by asking the user something. A next-steps list does not
// count here: a child that ends its report with one still wakes its parent, which checks the result.
export function waitingOnUser(child, reply) {
  return !!(child.pendingAsks?.size || endsAsking(reply));
}

// Whether a session's latest reply is still waiting on the user's answer. `msgs` are its
// messages, oldest first (Claude transcript lines or kept-chat messages): true when the last reply
// is waiting (endsWaiting) and nothing was sent to the session after it. Tool results and
// Claude Code's own command and reminder lines are not messages.
export function awaitingAnswer(msgs) {
  for (let i = msgs.length - 1; i >= 0; i--) {
    const m = msgs[i];
    if (!m || m.isSidechain || m.parent_tool_use_id) continue;
    const c = m.message?.content;
    const blocks = typeof c === 'string' ? [{ type: 'text', text: c }] : Array.isArray(c) ? c : [];
    if (m.type === 'user') {
      const said = blocks.filter((b) => b.type === 'text' || b.type === 'image').map((b) => b.text || '[image]').join('\n').trim();
      if (said && !/^<(command-|local-command|system-reminder)/.test(said)) return false;
    } else if (m.type === 'assistant') {
      const t = blocks.filter((b) => b.type === 'text' && b.text).at(-1);
      if (t) return endsWaiting(t.text);
    }
  }
  return false;
}

// Why a parent may not close and archive a session with close_session, or '' when it may.
// `rec` is the session's saved record, `live` its running session (if any), `reply` its latest reply.
// Only the session that started it (or that it was moved under) may, or the nearest open session above it when
// its own parent is archived (under, #717); never while it works, and never while it waits on the user:
// an open ask, a question, or a next-steps list, since those are left for the user to act on.
// A session still running is open in the list whatever its saved record says, so it can always be closed (#717).
export function closeRefusal({ callerId, rec, live, reply, busy, under = false }) {
  if (!rec || (rec.reportsTo !== callerId && !under)) return 'it is not a session you started (only your own child sessions can be closed this way)';
  if (rec.archived && (!live || live.status === 'ended')) return 'it is already archived';
  if (busy) return 'it is still working; wait for its report';
  if (live?.pendingAsks?.size || endsWaiting(reply)) return 'its last reply is waiting on the user; leave it for them';
  return '';
}

// Who hears about a session's finished turn. `reportsTo` is the session that started it (or
// that set_parent put it under); `replyTo` is the session that last sent it work with send_to_session
// when that was not its parent. The sender gets the report (woken for it, or a quiet note when the
// turn ends waiting on the user); the parent only gets a note that the work it did not send
// is done. replyTo is used up by a finished turn, and kept while the turn waits on the user, so the
// sender still hears when the work is finished.
export function reportRoute({ reportsTo, replyTo, waiting }) {
  const sent = !!replyTo && replyTo !== reportsTo;
  const to = sent ? replyTo : reportsTo || null;
  return { to, waiting: !!waiting, sent, noteTo: sent && !waiting ? reportsTo || null : null, clearReplyTo: !!replyTo && !waiting };
}

// Who started a session's current turn, from the message that started it: 'person' for what the
// person typed or a Docket button they pressed, 'session' for work another session sent, 'docket' for
// Docket's own wake-ups and notices (a session report, a resume, a save-before-compact).
export function turnStarter({ system = false, from = '', byPerson = false } = {}) {
  if (byPerson) return 'person';
  if (system) return 'docket';
  return from ? 'session' : 'person';
}

// Whether a session with reports waiting is woken now, and its wake count after. After `limit`
// wake-ups in a row with nobody acting, reports are held, so sessions cannot keep each other busy.
// A report from a turn the person started (they typed into the child, or pressed a button) shows
// the person is at work in this family: it wakes the session even at the limit, and starts the
// count again.
export function wakeDecision({ autoWakes = 0, reports = [], limit }) {
  const byPerson = reports.some((r) => r.byPerson);
  if (!byPerson && autoWakes >= limit) return { wake: false, autoWakes };
  return { wake: true, autoWakes: byPerson ? 0 : autoWakes + 1 };
}

// The waiting reports that may go out now. Freed plan tasks found during a session's turn
// (waitFor: that session) wait for that turn's own report, so both go in one wake-up; once that
// session is not running, or its report is in the batch, they go.
export function readyReports(reports = [], running = () => false) {
  const reporting = new Set(reports.filter((r) => r.childId).map((r) => r.childId));
  return reports.filter((r) => !r.waitFor || reporting.has(r.waitFor) || !running(r.waitFor));
}

// The note left in a session's chat when the wake limit holds a report, so the person sees why
// nothing happened instead of only an unread mark.
export function heldNote(reports = [], limit) {
  const what = reports.map((r) => r.kind === 'plan' ? `plan "${r.title}" (${r.tasks.map((t) => t.id).join(', ')} free to start)` : `"${r.title}"`);
  return `Waiting here, not yet read by this session: ${what.join('; ')}. Docket stops waking a session after ${limit} wake-ups in a row with nobody writing to it, so sessions cannot keep each other busy. Write anything here and it will be read.`;
}

// What plan_update_task says about tasks it just freed. The coordinator is woken to start them, so
// any other session is told that, and does not pass the list on to the user as if it waited on them.
export function freedReply({ nowReady = [], isCoordinator = false, coordinatorTitle = '' }) {
  if (!nowReady.length) return '';
  const list = nowReady.map((t) => `${t.id} ${t.title}`).join('; ');
  if (isCoordinator || !coordinatorTitle) return `Now free to start: ${list}.`;
  return `This freed ${list}. The plan's coordinator, "${coordinatorTitle}", was told and starts them: nothing for you or the user to do about them, so do not mention them to the user.`;
}

// Where a session a parent waits on stands: 'working' (busy on a turn, compacting, or its background jobs
// still running), 'waiting' (it asked the user something, or a form or permission ask is open), or 'done'
// (finished, nothing asked). A parent shows the still blue ring while any is working or waiting (#645).
export function childState({ status, compacting = false, jobs = 0, asks = 0, reply = '' }) {
  if (status === 'ended') return 'done';
  if (['starting', 'running', 'requires_action'].includes(status) || compacting || jobs > 0) return status === 'requires_action' ? 'waiting' : 'working';
  return asks > 0 || endsAsking(reply) ? 'waiting' : 'done';
}

// Why a turn may not end quietly (no orange dot), or '' when it may. Only a turn woken by session reports
// may, never one answering a message, never an error. Whether a child still works does not matter (#671): a
// parent passing on a child's news (finished, waiting on the person, its pull request ready) adds no second
// orange dot, since the child's own row already has one. A turn the session marked as asking the user (mark_turn
// "question") is never quiet either: its row says question, and the chat never folds it away (#672). Nor is a
// turn that finishes the parent's own job (#694): one marked "done", or one that closed its last open child
// (closedLast), since a child finishing then is the end of the whole job, not news along the way.
export function quietRefusal({ turnBy, report = false, error = false, said = '', closedLast = false }) {
  if (turnBy !== 'docket') return 'this turn answers a message, not a session report';
  if (!report) return 'this turn was not woken by a session report';
  if (error) return 'the turn ended in an error';
  if (said === 'question') return 'the turn asks the user a question (mark_turn)';
  if (said === 'done') return 'the turn marks your own work done (mark_turn)';
  if (closedLast) return 'you closed your last open session this turn, so your own job is done: call mark_turn with "done"';
  return '';
}

// ---------- a turn that ends with background jobs still running (#713) ----------
// The turn is held: it reports when its jobs end, since a session often ends a turn on purpose to wait for a
// build, a test run, a CI Monitor, a subagent or a test server. But a turn the session marked done (mark_turn
// "done") says the work is over: it reports now, naming the jobs still running, rather than leave the parent
// waiting on a job nobody needs. If one of them later starts a turn of its own, that turn reports as usual.
// 'now': report this turn; 'hold': wait for the jobs; 'none': not reported at all (Docket's own quiet turn).
export function heldTurnReport({ jobs = 0, said = '', quiet = false }) {
  if (quiet) return 'none';
  return !jobs || said === 'done' ? 'now' : 'hold';
}
// What mark_turn "done" answers while jobs still run, so the session settles them inside the same turn.
// jobs: runningJobs() from tasks.mjs.
export function doneWithJobsReply(jobs) {
  const list = jobs.map((j) => `- ${j.label} (task id ${j.taskId}${j.minutes === null ? '' : `, running ${j.minutes} min`})`).join('\n');
  return `Your row will say "done", but ${jobs.length === 1 ? 'a background job you started is' : `${jobs.length} background jobs you started are`} still running:\n${list}\n`
    + 'Stop each one you no longer need now (TaskStop with its task id, or KillShell for a shell), or say in your reply why you still need it. '
    + 'A job left running holds this session: if this turn still ends with one running, the session that started you is told you are done and which jobs are left.';
}
// The line a parent's report adds for jobs a child left running when it marked its turn done.
export const leftoverJobsText = (jobs) => !jobs?.length ? ''
  : `It marked its turn done with ${jobs.length === 1 ? '1 background job' : `${jobs.length} background jobs`} still running: ${jobs.join('; ')}.`;

// ---------- news-only reports (#734) ----------
// Most child reports used to wake the parent for a full turn that only read the news and replied. Docket knows when
// a child's turn can only be news, from what started it, so it marks the turn when it starts (turnNews):
// 'ack'    a Docket notice that says "Nothing to do now; reply in one line at most" (a move, a handoff, a start);
// 'agreed' the parent's send_to_session that says it checked and agrees the work is done (its done flag, or the
//          wording the rules give it), so the reply is the child's "complete and ready to close";
// 'quiet'  the child is a parent too, and ended its own turn with report_quiet: it only passed news up.
// Such a report goes into the parent's chat as a note with the halo, and reaches the parent with its next turn
// (its next wake-up or the person's next message), so a parent whose cache went cold is not woken to re-read it all.
// A turn that failed is never news, nor an 'agreed' reply from the last session the parent waits on: that finishes
// the parent's own job, so it is woken to write the closing reply.
export const ACK_NOTICE = /Nothing to do now; reply in one line at most/;
const AGREES = /\b(checked and agree|i agree (it|this|the work) is done|agree (that )?(it is|it's|the work is|your work is) done)\b/i;
const DISAGREES = /(\bnot|n't|\bcannot)\s+(yet\s+)?agree\b/i;
// The cause a message gives the turn it starts. done: the send_to_session flag.
export function turnNewsFor({ notice = '', message = '', done = false } = {}) {
  if (notice) return ACK_NOTICE.test(notice) ? 'ack' : '';
  return done || (AGREES.test(message) && !DISAGREES.test(message)) ? 'agreed' : '';
}
// Whether a finished child turn is only news. cause: its turnNews ('' when nothing marked it), or 'quiet'.
// lastOpen: no other session the parent waits on is still working or waiting on the person.
export function reportIsNews({ cause = '', error = false, lastOpen = false } = {}) {
  if (error || !cause) return false;
  if (cause === 'agreed' && lastOpen) return false;
  return true;
}
// The other way (#755): a parent's 'agreed' message to a child whose last finished turn already said it is complete
// and ready to close goes into the child's chat as a note, not a new turn that would only say so again. Only when
// nothing waits on the person: lastDone (its last turn was marked done, asking nothing), state (childState) 'done'
// (idle, no jobs, no prompt, no question), and no open pull request. Otherwise the turn runs, to end on that one thing.
export function agreedAsNote({ news = '', lastDone = false, state = '', pr = null } = {}) {
  return news === 'agreed' && !!lastDone && state === 'done' && !(pr && (pr.status === 'open' || pr.status === 'conflict'));
}
// The block a session's next turn carries for the news it took in without a wake-up.
export function heldNewsText(news = []) {
  if (!news.length) return '';
  const lines = news.map((r) => `- "${r.title}" (id ${r.childId}) finished a turn: ${r.text}`);
  return `(From Docket: while you were not working, these sessions you started reported news only, so Docket left it in your chat instead of waking you. Nothing to do about it unless it changes what you are doing.\n${lines.join('\n')})`;
}

// Children that finish close together share one wake-up: an idle session's reports wait until none has come for
// quietMs, but no longer than maxMs after the first. A report from a turn the person started goes at once.
export const REPORT_DEBOUNCE = { quietMs: 10000, maxMs: 45000 };
export function debounceLeft(reports = [], now = Date.now(), { quietMs, maxMs } = REPORT_DEBOUNCE) {
  if (!reports.length || reports.some((r) => r.byPerson)) return 0;
  const ats = reports.map((r) => r.at || 0);
  return Math.max(0, Math.min(Math.max(...ats) + quietMs, Math.min(...ats) + maxMs) - now);
}
