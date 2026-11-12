// What Docket says about its own updates, kept apart so it can be tested. Updates are always taken by themselves
// (server.mjs, lookForUpdate); this file says why files changed, and when typing holds an update.

// Why files in the Docket folder changed, for portal-events.log and the ☰ menu, so an update Docket
// pulled can be told apart from a pull someone else made there. pulledBy: 'auto' or 'now' when Docket's own
// update made the change, else null; from/to: the folder's git commit when the app started and now.
export function changeReason({ pulledBy, from, to }) {
  if (pulledBy === 'auto') return { short: 'taking in an update (auto)', detail: 'Docket pulled it by itself.' };
  if (pulledBy === 'now') return { short: 'taking in an update (Update now)', detail: 'Pulled on Update now.' };
  const moved = !!(from && to && from !== to);
  return {
    short: 'files changed on disk outside an update',
    moved,
    detail: moved
      ? `This folder's git commit moved ${from.slice(0, 7)} → ${to.slice(0, 7)} without Docket pulling it: a pull, merge, checkout or commit was made in the Docket folder itself. It is taken in anyway, since the new code is already on disk.`
      : 'Files in the Docket folder were edited without a new git commit.',
  };
}

// Typing in a session holds an automatic update (and the app restart after any update): the page pings the app
// as you type (at most every TYPING_PING_MS), and typing counts as going on for a minute after the last ping,
// the same minute the page's typing time uses (TYPING_IDLE in index.html). A held update looks again every
// TYPING_RETRY_MS, so it goes ahead soon after the minute is up rather than at the next timed check.
export const TYPING_QUIET_MS = 60000;
export const TYPING_PING_MS = 5000;
export const TYPING_RETRY_MS = 5000;
export const typingNow = (last, now) => last > 0 && now >= last && now - last < TYPING_QUIET_MS;
// Typing holds one wait (a restart waiting for a quiet moment, or a held update) for at most TYPING_CAP_MS from
// when that wait began (since), so pings that keep coming can never hold it for hours (#965). since 0: no cap.
export const TYPING_CAP_MS = 15 * 60000;
export const typingHolds = (last, now, since = 0) => typingNow(last, now) && !(since > 0 && now - since >= TYPING_CAP_MS);
export const TYPING_HOLD = 'you are typing in a session; the update is taken in once you stop for a minute, or after 15 minutes at most';
