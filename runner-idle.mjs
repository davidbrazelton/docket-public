// When Docket may restart to take in a change, kept apart so it can be tested. The runner (runner.mjs) and the
// app (server.mjs) use the same rule: a session holds the restart while a reply is in progress, a question
// waits, something was said in the last minute, or it has background commands or subagents running (the app marks
// those held). The app adds its own in-app jobs (an ask_desk run, say), and does not wait on a question alone
// (asks: false): its restart loses none of them. A permission or question form lives in the runner and is sent
// again when the app reconnects; an offer or crossing card is saved and found again when the tool call is resent.
export const QUIET_MS = 60000;

const askCount = (r) => (typeof r.asks === 'number' ? r.asks : r.asks?.size || 0);
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

// What keeps it from being quiet, in words for the log and the ☰ menu; '' when it is quiet.
// sessions: [{ ended, busy, held, asks (a Map or a count), lastAt, scheduled }]; jobs: the app's own runs still going.
// scheduled (the app knows it): a scheduled task's run, counted as a scheduled task while it works.
// asks: false leaves a waiting question out (the app's rule); the runner's own rule keeps it.
export function notQuiet(sessions, now = Date.now(), { jobs = 0, asks = true } = {}) {
  const count = { scheduled: 0, asking: 0, replying: 0, background: 0, recent: 0 };
  for (const r of sessions) { const k = busyKind(r, now, asks); if (k) count[k]++; }
  return [
    count.replying && `${plural(count.replying, 'session', 'sessions')} replying`,
    count.asking && `${plural(count.asking, 'session', 'sessions')} waiting on an answer`,
    count.scheduled && `${plural(count.scheduled, 'scheduled task', 'scheduled tasks')} running`,
    count.background && `${plural(count.background, 'session', 'sessions')} with background work running`,
    count.recent && `${plural(count.recent, 'session', 'sessions')} active in the last minute`,
    jobs && `${plural(jobs, 'Docket job', 'Docket jobs')} running`,
  ].filter(Boolean).join(', ');
}

// Which of notQuiet's counts one session falls in, or '' when it holds nothing.
function busyKind(r, now, asks = true) {
  if (r.ended) return '';
  const asking = asks && askCount(r) > 0;
  if (r.scheduled && (r.busy || r.held || asking)) return 'scheduled';
  if (asking) return 'asking';
  if (r.busy) return 'replying';
  if (r.held) return 'background';
  if (now - (r.lastAt || 0) < QUIET_MS) return 'recent';
  return '';
}
const HOW = { scheduled: 'scheduled task running', asking: 'waiting on an answer', replying: 'replying', background: 'background work running', recent: 'active in the last minute' };
// What one session is doing that holds the restart, in words for the update arrow's list; '' when nothing.
export const busyHow = (r, now = Date.now(), { asks = true } = {}) => HOW[busyKind(r, now, asks)] || '';

export function restartBlocked(sessions, now = Date.now()) {
  return !!notQuiet(sessions, now);
}

// The app's wait for a quiet moment before it restarts. check() says what is still working ('' = quiet);
// go(pending, how) does the restart, how saying why now. It looks again every `every` ms and never gives up: only
// now() (Restart now) skips the wait. log(why) is called once, when the wait starts; changed() each time the reason
// changes, or names() does (the sessions it waits on, by name: one can finish as another starts, same count, same words).
export function restartWaiter({ check, go, log = () => {}, changed = () => {}, names = () => '', every = 5000, timers = { setTimeout, clearTimeout } }) {
  let pending = null, timer = null;
  const fire = (forced) => {
    timers.clearTimeout(timer); timer = null;
    const p = pending; pending = null;
    go(p, forced ? 'Restart now was pressed while waiting' : p.waited ? `quiet after waiting ${Math.round((Date.now() - p.since) / 1000)} s` : 'nothing was working');
  };
  const look = () => {
    timer = null;
    if (!pending) return;
    const why = check();
    if (!why) return fire(false);
    if (!pending.waited) { pending.waited = true; log(why); }
    const who = names();
    if (pending.why !== why || pending.who !== who) { pending.why = why; pending.who = who; changed(); }
    timer = timers.setTimeout(look, every);
  };
  return {
    // Asked again while waiting: the reasons add up, and the wait goes on.
    want(reason) {
      if (pending) { pending.reasons.push(reason); return; }
      pending = { since: Date.now(), reasons: [reason], why: '', who: '', waited: false };
      look();
    },
    now() { if (pending) fire(true); },
    cancel() { timers.clearTimeout(timer); timer = null; pending = null; },
    get pending() { return pending; },
  };
}

// When a runner with no open session stops for good (#740), so leftovers don't pile up: its folder was removed (a
// worktree gone, its files with it), or it is a test runner (not on the real port) whose app has not been in touch
// for appGoneMs (the app checks on it every few seconds). '' = keep running. The real runner only stops when its files are gone.
export const REAL_RUNNER_PORT = 4410;
export const APP_GONE_MS = 3 * 60000;
export function stopForGood({ port, open, filesGone, lastContact, now = Date.now(), appGoneMs = APP_GONE_MS }) {
  if (open > 0) return '';
  if (filesGone) return 'its files are gone';
  if (port !== REAL_RUNNER_PORT && now - lastContact >= appGoneMs) return `test runner with no word from its app for ${Math.round(appGoneMs / 1000)} s`;
  return '';
}
