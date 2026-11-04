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
export function resumePlan(paused) {
  if (!paused) return [];
  return [
    ...paused.sessions.filter((x) => !x.messaged).map((x) => ({ kind: 'note', id: x.id, client: x.client, stopped: x.stopped, woke: !!x.woke })),
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
