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

// Who makes the public copy's commits (publish/build.mjs): every commit a public install gets from GitHub is by it.
export const PUBLISH_IDENTITY = 'Docket <docket@noreply.invalid>';
// How lookForUpdate takes GitHub's master when this folder lacks some of its commits (#1126): 'merge' (a fast-forward),
// 'reset' (move the folder onto it) or 'skip', with why. The public copy keeps no history: each publish replaces its
// master with one fresh commit, so a public install is never a fast-forward behind it, and is moved onto it instead,
// but only when nothing here would be lost: no edits outside a git commit, and every commit the folder has that GitHub's
// master lacks was published (author and committer the publish identity), none made on this computer. A clone of
// the private repo is never moved: it only fast-forwards, as before.
//   fastForward: GitHub's master descends from this folder's commit. publicCopy: this folder is a public-copy install.
//   dirty: git status's list of edits. theirs: author of GitHub's master commit, "Name <email>". local: each commit
//   here that GitHub's master lacks, as { author, committer }.
export function updateWay({ fastForward, publicCopy, dirty = '', theirs = '', local = [] }) {
  const notFf = "This folder has git commits that are not on GitHub's master, so the update is not a fast-forward.";
  if (!fastForward && !publicCopy) return { way: 'skip', why: `${notFf} Sort it out by hand.` };
  if (dirty) return { way: 'skip', why: `This folder has edits that are not in a git commit:\n${dirty}` };
  if (fastForward) return { way: 'merge' };
  if (theirs !== PUBLISH_IDENTITY) return { way: 'skip', why: `${notFf} GitHub's master is by ${theirs || 'someone unknown'}, not the Docket publish, so this folder is not moved onto it. Sort it out by hand.` };
  const own = local.filter((c) => c.author !== PUBLISH_IDENTITY || c.committer !== PUBLISH_IDENTITY);
  if (own.length) return { way: 'skip', why: `${notFf} ${own.length} of them ${own.length === 1 ? 'was' : 'were'} made on this computer (by ${[...new Set(own.map((c) => c.author))].join(', ')}), so this folder is not moved onto GitHub's master, which would drop ${own.length === 1 ? 'it' : 'them'}. Sort it out by hand.` };
  return { way: 'reset', why: "GitHub's master was published afresh (the public copy keeps no history), so this folder is moved onto it." };
}
// What updateWay needs, read with git (args => { code, out }, run in the Docket folder) for this folder's commit (head)
// and GitHub's master (theirs), once theirs is known to have something head lacks.
export async function updateFacts(git, head, theirs) {
  const fastForward = (await git(['merge-base', '--is-ancestor', head, theirs])).code === 0;
  // A public-copy install has no publish/ folder (publish/exclude.txt leaves it out); the private repo always has it.
  const publicCopy = !fastForward && (await git(['cat-file', '-e', `${head}:publish/exclude.txt`])).code !== 0;
  const dirty = (await git(['status', '--porcelain', '--untracked-files=no'])).out.trim();
  if (!publicCopy || dirty) return { fastForward, publicCopy, dirty };
  const who = async (...range) => (await git(['log', '--format=%an <%ae>%x09%cn <%ce>', ...range])).out.split('\n').filter(Boolean)
    .map((l) => { const [author, committer] = l.split('\t'); return { author, committer }; });
  return { fastForward, publicCopy, dirty, theirs: (await who('-1', theirs))[0]?.author, local: await who(`${theirs}..${head}`) };
}

// ---------- the two public copies (#1155) ----------
// A public install's edition.json, written by publish/build.mjs: { edition: 'local' | 'labs', name, repo, pages,
// other: the other copy's { edition, name, repo, pages } }. A clone of the private repo has none (null).
export function parseEdition(text) {
  try { const e = JSON.parse(text); return ['local', 'labs'].includes(e?.edition) ? e : null; } catch { return null; }
}
// Whether an update is taken as it is ('take') or waits for the person to choose ('ask'). A Labs install (every public
// install from before the split is one) about to take a local-first update would lose Remote Desks and the screen
// tools, so it asks once: keep everything (move to Docket Labs, POST /api/edition/choose) or go local-first. own and
// incoming: parseEdition's answers for this folder and for GitHub's master. choice: what the person picked, if anything;
// 'labs' that still meets a local-first update means the move did not happen, so it asks again.
export function editionStep({ own, incoming, choice }) {
  if (own?.edition !== 'labs' || incoming?.edition !== 'local') return 'take';
  return choice === 'local' ? 'take' : 'ask';
}
// An install that missed the handover bridge (switched off the whole time it was out) went local-first with its old
// updater, which does not ask. So a local-first install whose commit before this one had every feature (a Labs tree,
// or a public tree from before the split, which has no edition.json) asks once, after the update: Keep everything
// moves it to Docket Labs at once. git: args => { code, out }, run in the Docket folder. own: parseEdition of this
// folder; choice: what the person picked. Returns { other, late: true } to ask about, or null.
export async function lateHandover(git, own, choice) {
  if (own?.edition !== 'local' || choice || !own.other?.repo) return null;
  const prev = (await git(['rev-parse', '--verify', '-q', 'HEAD@{1}'])).out.trim();
  if (!/^[0-9a-f]{40}$/.test(prev)) return null;
  const was = parseEdition((await git(['show', `${prev}:edition.json`])).out);
  return !was || was.edition === 'labs' ? { other: own.other, late: true } : null;
}
