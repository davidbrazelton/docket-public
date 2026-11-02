// When Docket may restart to take in a change, kept apart so it can be tested. The runner (runner.mjs) and the
// app (server.mjs) use the same rule: a session holds the restart while a reply is in progress, a question
// waits, something was said in the last minute, or it has background commands or subagents running (the app marks
// those held). The app adds its own in-app jobs (an ask_desk run, say).
export const QUIET_MS = 60000;

const askCount = (r) => (typeof r.asks === 'number' ? r.asks : r.asks?.size || 0);
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

// What keeps it from being quiet, in words for the log and the ☰ menu; '' when it is quiet.
// sessions: [{ ended, busy, held, asks (a Map or a count), lastAt, scheduled }]; jobs: the app's own runs still going.
// scheduled (the app knows it): a scheduled task's run, counted as a scheduled task while it works.
export function notQuiet(sessions, now = Date.now(), { jobs = 0 } = {}) {
  const open = sessions.filter((r) => !r.ended);
  const count = { scheduled: 0, asking: 0, replying: 0, background: 0, recent: 0 };
  for (const r of open) {
    if (r.scheduled && (r.busy || r.held || askCount(r))) count.scheduled++;
    else if (askCount(r)) count.asking++;
    else if (r.busy) count.replying++;
    else if (r.held) count.background++;
    else if (now - (r.lastAt || 0) < QUIET_MS) count.recent++;
  }
  return [
    count.replying && `${plural(count.replying, 'session', 'sessions')} replying`,
    count.asking && `${plural(count.asking, 'session', 'sessions')} waiting on an answer`,
    count.scheduled && `${plural(count.scheduled, 'scheduled task', 'scheduled tasks')} running`,
    count.background && `${plural(count.background, 'session', 'sessions')} with background work running`,
    count.recent && `${plural(count.recent, 'session', 'sessions')} active in the last minute`,
    jobs && `${plural(jobs, 'Docket job', 'Docket jobs')} running`,
  ].filter(Boolean).join(', ');
}

export function restartBlocked(sessions, now = Date.now()) {
  return !!notQuiet(sessions, now);
}

// The app's wait for a quiet moment before it restarts. check() says what is still working ('' = quiet);
// go(pending, how) does the restart, how saying why now. It looks again every `every` ms and never gives up: only
// now() (Restart now) skips the wait. log(why) is called once, when the wait starts; changed() each time the reason changes.
export function restartWaiter({ check, go, log = () => {}, changed = () => {}, every = 5000, timers = { setTimeout, clearTimeout } }) {
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
    if (pending.why !== why) { pending.why = why; changed(); }
    timer = timers.setTimeout(look, every);
  };
  return {
    // Asked again while waiting: the reasons add up, and the wait goes on.
    want(reason) {
      if (pending) { pending.reasons.push(reason); return; }
      pending = { since: Date.now(), reasons: [reason], why: '', waited: false };
      look();
    },
    now() { if (pending) fire(true); },
    cancel() { timers.clearTimeout(timer); timer = null; pending = null; },
    get pending() { return pending; },
  };
}
