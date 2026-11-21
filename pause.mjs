// Pause all / Resume all: the rules, kept apart from the server so they can be tested.
// pauseAll and resumeAll in server.mjs do the work; the automatic pause on sleep calls those.

// Why Docket was paused, in the words the resume note uses.
const WHY = {
  user: 'the user pressed Pause all, to put the computer to sleep',
  sleep: 'the computer was about to sleep',
  shutdown: 'the computer was about to shut down or restart',
  slept: 'the computer went to sleep without warning Docket first',
};
export const pauseWhy = (reason) => WHY[reason] || WHY.user;

// A pause Docket made by itself ends by itself on wake or restart; the person's own Pause all waits for them.
export const autoPaused = (paused) => !!paused && paused.reason !== 'user';

// The wake check: a timer that ticks every `tick` ms finds far more time passed than that, so the
// computer slept, whether or not the helper heard it go.
export const clockJumped = (last, now, gap = 5 * 60000) => now - last >= gap;

// A session working right now: a reply in progress, or one that ended with background commands
// still running. stop: its turn is stopped (one waiting on the person's answer is left as it is).
export function workingNow(s, runningJobs = 0) {
  if (['starting', 'running'].includes(s.status)) return { stop: true };
  if (s.status !== 'ended' && (runningJobs > 0 || s.heldTurn)) return { stop: false };
  return null;
}

// The saved record of a pause: { at, reason, sessions: [{ id, client, title, stopped, messaged }], held: [...] }.
export function newPause(reason, sessions, at = new Date().toISOString()) {
  return { at, reason: WHY[reason] ? reason : 'user', sessions, held: [] };
}

// While paused, a message Docket or another session sends (a child's report, a wake-up, send_to_session)
// waits for Resume all, so it does not start the session up again. What the person types goes through.
export const holdsMessage = (paused, { system = false, from = '' } = {}) => !!paused && (system || from === 'session');

// While paused, a turn the session started by itself: Claude Code begins one when a background command
// ends (or a scheduled wake-up fires), and that skips holdsMessage. What the person sends sets the status
// to running first (sendToSession), and an answer to a question comes from requires_action, so neither
// counts. Docket stops such a turn at once (#644).
const WORKING = ['starting', 'running'];
export const wokeByItself = (paused, prev, next) => !!paused && WORKING.includes(next) && ![...WORKING, 'requires_action'].includes(prev);

// Marks that session in the paused list (adding it if Pause all left it out), so Resume all tells it to
// take in what woke it, even when the person had written to it earlier in the pause.
export function noteWoke(paused, { id, client, title }) {
  if (!paused) return false;
  let row = paused.sessions.find((x) => x.id === id);
  if (!row) paused.sessions.push(row = { id, client, title: title || 'Untitled', stopped: false });
  row.woke = true;
  row.messaged = false;
  return true;
}

// The person wrote to a paused session: Resume all leaves it alone, since it already has its next step.
export function noteMessaged(paused, id) {
  const row = paused?.sessions.find((x) => x.id === id);
  if (!row || row.messaged) return false;
  row.messaged = true;
  return true;
}

// What Resume all sends, in order: the resume note to each paused session the person did not write to,
// then each held message as it came.
// skip: a session paused on its own (Pause in its menu), which stays paused and gets no note.
export function resumePlan(paused, { skip = () => false } = {}) {
  if (!paused) return [];
  return [
    ...paused.sessions.filter((x) => !x.messaged && !skip(x.id)).map((x) => ({ kind: 'note', id: x.id, client: x.client, stopped: x.stopped, woke: !!x.woke })),
    ...paused.held.map((h) => ({ kind: 'held', ...h })),
  ];
}

export function resumeNote(paused, { stopped = true, woke = false } = {}) {
  const when = new Date(paused.at).toLocaleString();
  return [
    `(From Docket: all sessions were paused at ${when} because ${pauseWhy(paused.reason)}, and Docket has now resumed them.`,
    stopped
      ? 'This session was stopped partway through its turn. That stop is why the last step shows as rejected or interrupted: Docket did it, not the user.'
      : 'This session had background commands running when it was paused.',
    ...(woke ? ['During the pause a background command (or a scheduled wake-up) finished and started a new turn by itself. Docket stopped that turn at once, so what it brought has not been dealt with yet: read that command\'s result or output now and act on it.'] : []),
    'The computer may have slept since then, so any test server, browser or background command this session was using may have stopped. Check that each one still answers and restart it if not, then carry on with the work.)',
  ].join('\n\n');
}

// The runner restarts itself to take in a change once nothing is working (runner-idle.mjs). The app marks a
// session held there by the same test Pause all uses, so a restart waits for its background commands.
export const holdsRunner = (s, runningJobs = 0) => !!workingNow(s, runningJobs);

// Added to the next message of a session the runner restarted, so it checks what it had running.
export const RUNNER_RESTART_NOTE = '(From Docket: Docket restarted this session while it was idle, to take in an update. Any test server, browser or background command it started before then may have stopped. Check that each one still answers and restart it if not.)';

// ---------- Pause one session (#1070) ----------
// The session menu's Pause: its turn is stopped, it is put to rest to free its memory, and what Docket or other
// sessions send it waits until Resume (or until the person writes to it, which resumes it). Saved in
// state.sessionPauses (id -> the record below), so a pause survives app restarts. Pause all and Resume all leave it be.

// jobs: what to do with background commands still running: 'wait' (it rests once they end) or 'stop' (resting now
// ends its process, and the commands with it). '' when it had none.
export function newSessionPause({ client, title }, { stopped = false, jobs = '' } = {}, at = new Date().toISOString()) {
  return { at, client, title: title || 'Untitled', stopped: !!stopped, jobs: ['wait', 'stop'].includes(jobs) ? jobs : '', woke: false, held: [] };
}

// Pausing a session with background commands running asks first: wait for them or stop them. Never frozen.
export const pauseNeedsChoice = (runningJobs, jobs = '') => runningJobs > 0 && !['wait', 'stop'].includes(jobs);

// Pause stops a turn in progress, including one waiting on the person mid-turn (they pressed Pause, after all).
export const pauseStops = (s) => ['starting', 'running', 'requires_action'].includes(s?.status);

// Whether it may rest now: once its turn is stopped and no background command it waits for still runs.
export const restsNow = (p, { status, runningJobs = 0 } = {}) => !!p && !['starting', 'running'].includes(status) && (p.jobs === 'stop' || runningJobs === 0);

// While paused, everything waits except what the person types to it (no system flag, no sender), which resumes it.
export const sessionHolds = (p, { system = false, from = '' } = {}) => !!p && (system || !!from);

// Its messages waiting in queue mode join the held ones, so the queue never starts a paused session.
export function takeQueued(queue = [], id) {
  return { queue: queue.filter((x) => x.id !== id), taken: queue.filter((x) => x.id === id) };
}

// The pause view the page reads: the row's "paused" indicator and its tip.
export const sessionPauseView = (p, { resting = false } = {}) => ({ at: p.at, held: p.held.length, waiting: p.jobs === 'wait' && !resting });

// Told to the session on resume: with the person's message when they wrote to it, or alone from Resume.
export function sessionResumeNote(p, { typed = false } = {}) {
  const when = new Date(p.at).toLocaleString();
  return [
    `(From Docket: the user paused this session at ${when} and has now resumed it${typed ? ' by writing to it' : ''}.`,
    ...(p.stopped ? ['It was stopped partway through its turn. That stop is why the last step shows as rejected or interrupted: Docket did it when the user pressed Pause.'] : []),
    ...(p.jobs === 'stop' ? ['Its background commands were stopped when it was paused, so any test server or watcher it had running is gone: start it again if the work still needs it.'] : []),
    ...(p.woke ? ['While paused, a background command finished and started a turn by itself. Docket stopped that turn, so read that command\'s result now and act on it.'] : []),
    ...(p.held.length ? [`${p.held.length} message${p.held.length === 1 ? '' : 's'} sent to it during the pause (reports, notices or messages from other sessions) ${p.held.length === 1 ? 'comes' : 'come'} next, after this turn.`] : []),
    'It was put to rest while paused, so its browser and connected services start fresh. Carry on where you left off.)',
  ].join('\n\n');
}
