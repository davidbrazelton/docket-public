// Continuing a session cut off by an unplanned stop: the rules, kept apart from the server so they can be tested.
// A planned stop (Pause all, sleep, a restart) is continued by resumeAll (pause.mjs); this is the stop nobody planned:
// the runner crashed or was killed, the computer lost power, Windows rebooted for an update.

export const RECENT_MS = 3 * 3600_000; // older cut-offs wait for the person
export const ELSEWHERE_MS = 2 * 60_000; // the page's "may be running in another app" check
export const GAP_MS = 15_000; // between one automatic continue and the next

// The saved record of a cut-off (state.sessions[id].cutOff). how: 'runner' when the app saw the runner go,
// 'start' when the app found it at its own start. mtime: the session file's time when Docket last knew it.
export const newCutOff = (how, mtime, now = Date.now()) => ({ how, at: how === 'start' && mtime ? mtime : now, mtime: mtime || null });

// Something other than Docket has written to the session since it was cut off (Claude desktop or the CLI may
// have it). Seen by the app as it happened: any write after that. Found at start: Docket cannot tell whose the
// last write was, so a write in the last 2 minutes counts, as on the page.
export function elsewhere(cut, mtime, now = Date.now()) {
  if (!mtime) return false;
  if (cut.how === 'runner' && cut.mtime) return mtime > cut.mtime + 2000;
  return now - mtime < ELSEWHERE_MS;
}

// Whether Docket continues the session by itself, and if not, why (for the log). rec: its saved record.
export function autoContinueCheck({ on, rec, mtime, now = Date.now(), paused = false, archived = false }) {
  const cut = rec?.cutOff;
  if (!cut) return { go: false, why: 'not cut off' };
  if (!on) return { go: false, why: 'the setting is off' };
  if (rec.autoContinued) return { go: false, why: 'it was already continued once by itself and was cut off again' };
  if (archived) return { go: false, why: 'it is archived' };
  if (paused) return { go: false, why: 'Docket is paused' };
  if (now - (cut.at || 0) > RECENT_MS) return { go: false, why: 'the cut-off was more than 3 hours ago' };
  if (elsewhere(cut, mtime, now)) return { go: false, why: 'its file changed after Docket lost it, or in the last 2 minutes, so it may be open in another app' };
  return { go: true };
}

export function cutOffNote(cut) {
  const when = new Date(cut.at).toLocaleString();
  return [
    `(From Docket: Docket stopped unexpectedly at about ${when}, partway through this session's turn, and has now continued it by itself.`,
    'The user did not stop it, and nothing was planned: that stop is why the last step shows as rejected or interrupted. That last step may or may not have finished.',
    'Before redoing anything, check what state things are in: git (commits, branches, pushes), any test server, browser or background command, and anything sent or posted. Restart what has stopped, then carry on with the work.)',
  ].join('\n\n');
}
