// Whether this computer pulls updates by itself or waits for Update now. Kept in state.updates.mode,
// per computer: 'auto' pulls and restarts by itself, 'manual' only says an update is waiting, and no answer
// yet counts as manual, with the first update asking which it should be.
export const UPDATE_MODES = ['auto', 'manual'];
export const cleanMode = (m) => (UPDATE_MODES.includes(m) ? m : null);
export const pullsByItself = (mode) => cleanMode(mode) === 'auto';
// What the page's lower-right card shows for an update GitHub has and this folder has not taken:
// 'first' asks which mode to use, 'manual' offers Update now, null shows nothing.
export function updatePrompt({ waiting, mode }) {
  if (!waiting) return null;
  const m = cleanMode(mode);
  if (m === 'auto') return null; // it pulls by itself
  return m ? 'manual' : 'first';
}

// Why files in the Docket folder changed, for portal-events.log and the ☰ menu, so an update Docket
// pulled can be told apart from a pull someone else made there. pulledBy: 'auto' or 'now' when Docket's own
// update made the change, else null; from/to: the folder's git commit when the app started and now.
export function changeReason({ pulledBy, from, to }) {
  if (pulledBy === 'auto') return { short: 'taking in an update (auto)', detail: 'Docket pulled it by itself (Updates: automatic).' };
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
