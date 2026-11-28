// Continuing a session cut off by an unplanned stop: the rules, kept apart from the server so they can be tested.
// A planned stop (Pause all, sleep, a restart) is continued by resumeAll (pause.mjs); this is the stop nobody planned:
// the runner crashed or was killed, the computer lost power, Windows rebooted for an update.

export const RECENT_MS = 3 * 3600_000; // older cut-offs wait for the person
export const ELSEWHERE_MS = 2 * 60_000; // the page's "may be running in another app" check
export const GAP_MS = 15_000; // between one automatic continue and the next

// The saved record of a cut-off (state.sessions[id].cutOff). how: 'runner' when the app saw the runner go,
// 'start' when the app found it at its own start, 'restart' when the person chose ☰ > Restart Docket anyway, 'quit' for ☰ > Quit Docket. mtime: the session file's time when Docket last knew it.
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
  if (cut.how === 'restart') return { go: false, why: 'it was stopped by Restart Docket, so it waits for the person' };
  if (cut.how === 'quit') return { go: false, why: 'it was stopped by Quit Docket, so it waits for the person' };
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

// Waiting for the network before the first automatic continue after a start (#1093). Right after a sign-in, Wi-Fi
// or the VPN may not be up yet, and each cut-off session gets only one automatic try, so that try must not go out
// while nothing answers. urls: the addresses the desks reach (networkUrls); answers(url) resolves true when one gives
// any reply at all. Checks every everyMs until all answer or capMs has gone by, then lets the queue run either way.
// Gives { ok, waited, down }: down, the addresses that never answered.
export const NET_CAP_MS = 3 * 60_000, NET_EVERY_MS = 5_000;
export const ANTHROPIC_URL = 'https://api.anthropic.com';
// Anthropic's API, and each desk's company gateway (which may only answer on the VPN). Remote desks run on their own computer.
export function networkUrls(clients) {
  const u = new Set([ANTHROPIC_URL]);
  for (const c of clients || []) if (!c?.remote && c?.gateway?.url) u.add(c.gateway.url);
  return [...u];
}
export async function waitForNetwork({ urls, answers, sleep = (ms) => new Promise((r) => setTimeout(r, ms)), now = Date.now, capMs = NET_CAP_MS, everyMs = NET_EVERY_MS }) {
  const t0 = now();
  for (;;) {
    const ok = await Promise.all(urls.map((u) => Promise.resolve().then(() => answers(u)).catch(() => false)));
    const down = urls.filter((_, i) => !ok[i]);
    if (!down.length || now() - t0 + everyMs > capMs) return { ok: !down.length, waited: now() - t0, down };
    await sleep(everyMs);
  }
}
