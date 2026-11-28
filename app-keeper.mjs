// What supervisor.mjs decides about the app it keeps running, kept apart so it can be tested (#1273, #1276):
// - after an exit: stay stopped (an exit asked for), start again at once (a planned restart), or start again after a
//   growing wait (a crash; about 1 s, 5 s, 30 s, then every minute, for as long as it takes);
// - an app that crashes on start several times in a row, right after an update moved HEAD, is put back on the last
//   commit that started cleanly, and the updater skips the bad commit until a newer one is on master;
// - an app that is still running but has not answered for several minutes is frozen: it is stopped and started again.
//   A check whose own timer fired late (the computer slept, or the supervisor stalled) says nothing, and a long gap
//   between checks starts the count again, as runner-watch.mjs does for the runner (#1124).
// The record files live in the data folder: supervisor.json (the live supervisor, with a heartbeat), app-run.json
// (the app's own: its port, whether a supervisor started it, and whether it was stopped on purpose; runner-revive.mjs
// reads both) and update-guard.json (the last commit that started cleanly, the commit the updater skips, and the
// notice the page shows once after going back).
import fs from 'node:fs';
import path from 'node:path';

export const RESTART_CODE = 75; // the app restarts itself to take in a change
export const BACKOFF_MS = [1000, 5000, 30000, 60000]; // the waits before each start after a crash; the last one repeats
export const START_CRASH_MS = 60000; // an exit this soon after starting is a crash on start
export const STABLE_MS = 2 * 60000; // up and answering this long: it started cleanly (the crash count starts over)
export const LOOP_CRASHES = 3; // crashes on start in a row before going back to the last good commit
export const CHECK_EVERY_MS = 30000; // the health check, and the supervisor's heartbeat
export const CHECK_TIMEOUT_MS = 10000;
export const CHECK_SLACK_MS = 5000; // a check that took this much longer than its timeout: the supervisor itself stalled
export const FROZEN_MS = 4 * 60000; // no answer this long: frozen
export const FROZEN_MISSES = 3; // and at least this many real misses in that time

// Why the app exited: 'stop' (asked for: Quit Docket, Restart Docket's new supervisor taking over, Ctrl+C, or this
// supervisor being stopped, which ends the app itself), 'restart' (it restarts itself to take in a change),
// 'frozen' (this supervisor stopped it for not answering) or 'crash' (anything else, a kill from outside included).
export function exitKind({ code, stopping = false, frozen = false }) {
  if (stopping) return 'stop';
  if (frozen) return 'frozen';
  if (code === RESTART_CODE) return 'restart';
  if (code === 0) return 'stop';
  return 'crash';
}

// The wait before start number n after a crash (n = 1 for the first crash in a row).
export const backoffMs = (n) => BACKOFF_MS[Math.min(Math.max(n, 1), BACKOFF_MS.length) - 1];

// What to do after the app exited. counts: { crashes (in a row, since it last ran cleanly), startCrashes (crashes on
// start in a row) }; upMs: how long that app ran. action: 'stop' or 'start', after waitMs; loop: crashing on start,
// time to look at going back to the last good commit (rollBack below).
// A crash after the app ran past its start (a locked file minutes in, say) is only started again: it breaks the run of
// crashes on start, so it never leads to going back, whatever commit it is on.
export function afterExit(counts, { kind, upMs, startCrashMs = START_CRASH_MS }) {
  if (kind === 'stop') return { counts, action: 'stop', waitMs: 0, loop: false };
  if (kind === 'restart') return { counts, action: 'start', waitMs: 0, loop: false };
  const crashes = counts.crashes + 1;
  const startCrashes = kind === 'crash' && upMs < startCrashMs ? counts.startCrashes + 1 : 0;
  return { counts: { crashes, startCrashes }, action: 'start', waitMs: backoffMs(crashes), loop: startCrashes >= LOOP_CRASHES };
}
export const noCrashes = () => ({ crashes: 0, startCrashes: 0 });

// Whether to go back to the last commit that started cleanly. head: the commit that keeps crashing; good: { head,
// version } from update-guard.json; branch: the folder's git branch (only master is updated by itself, so a working
// copy on its own branch is never moved); clean: no edits outside a git commit; goodExists: that commit is still here.
export function rollBack({ head, good, branch, clean, goodExists }) {
  const no = (why) => ({ go: false, why });
  if (!head) return no('git could not say which commit this is');
  if (!good?.head) return no('no commit has started cleanly here yet');
  if (head === good.head) return no(`it crashes on ${good.head.slice(0, 7)}, the last commit that started cleanly, so an update is not the cause`);
  if (branch !== 'master') return no(`the folder is on git branch ${branch || '?'}, not master`);
  if (!clean) return no('the folder has edits not in a git commit');
  if (!goodExists) return no(`${good.head.slice(0, 7)}, the last commit that started cleanly, is no longer in this folder`);
  return { go: true, why: `${head.slice(0, 7)} crashed on start ${LOOP_CRASHES} times in a row; ${good.head.slice(0, 7)} last started cleanly` };
}

// The folder's own edits, from git status --porcelain: package-lock.json is left out, since npm install rewrites it
// after an update by itself (it is put back before going back).
export const localEdits = (porcelain) => String(porcelain || '').split('\n').map((l) => l.trim()).filter((l) => l && !/^\S{1,2}\s+"?package-lock\.json"?$/.test(l));

// One health check's verdict: 'up' (any answer at all: the app's loop is running), 'down' (a real miss), or 'unsure'
// (the check itself came back late, so this supervisor stalled or the computer slept: no verdict).
export function probeVerdict({ answered, elapsedMs, timeoutMs = CHECK_TIMEOUT_MS, slackMs = CHECK_SLACK_MS }) {
  if (answered) return 'up';
  if (elapsedMs > timeoutMs + slackMs) return 'unsure';
  return 'down';
}

// The watch on one app, from its start: since (the start of the time with no answer), misses (real misses in it), last
// (the last check). An app that never answered counts from its start, so one that hangs on start is frozen too.
export const newWatch = (now) => ({ since: now, misses: 0, last: now, frozen: false });
export function healthStep(w, { verdict, now, everyMs = CHECK_EVERY_MS, frozenMs = FROZEN_MS, minMisses = FROZEN_MISSES }) {
  if (verdict === 'up') return { since: 0, misses: 0, last: now, frozen: false };
  const slept = now - w.last > everyMs * 3; // checks far apart: the computer slept or this supervisor stalled, so start over
  if (verdict === 'unsure') return { ...w, since: slept || !w.since ? 0 : w.since, misses: slept ? 0 : w.misses, last: now, frozen: false };
  const since = slept || !w.since ? now : w.since, misses = (slept ? 0 : w.misses) + 1;
  return { since, misses, last: now, frozen: misses >= minMisses && now - since >= frozenMs };
}

// ---------- the record files ----------
export const keeperFiles = (dataDir) => ({
  supervisor: path.join(dataDir, 'supervisor.json'),
  app: path.join(dataDir, 'app-run.json'),
  guard: path.join(dataDir, 'update-guard.json'),
});
export function readJson(file) { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; } }
// Written whole and then moved into place, so a reader never sees half a file.
export function writeJson(file, value) {
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const tmp = `${file}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(value, null, 2));
    fs.renameSync(tmp, file);
    return true;
  } catch { return false; }
}
export function pidAlive(pid) {
  if (!pid) return false;
  try { process.kill(pid, 0); return true; } catch (e) { return e.code === 'EPERM'; }
}
// A supervisor that is running: its process is there and its heartbeat is recent (so a reused process number is no
// supervisor), and it was not stopped.
export function supervisorAlive(rec, now = Date.now(), alive = pidAlive) {
  return !!rec && !rec.stopped && alive(rec.pid) && now - (rec.at || 0) < 3 * (rec.every || CHECK_EVERY_MS);
}
// Another supervisor already keeping this app, which this one leaves it to (no two start the same app): null when
// none. after: the app pid a supervisor started by Restart Docket replaces; that app's supervisor is on its way out.
export function otherSupervisor(rec, { pid, after = 0, now = Date.now(), alive = pidAlive }) {
  if (!supervisorAlive(rec, now, alive) || rec.pid === pid) return null;
  if (after && rec.appPid === after) return null;
  return rec;
}

// What the updater says instead of pulling theirs, when it is the commit Docket went back from: '' = go ahead.
export function updateSkip(guard, theirs) {
  const s = guard?.skip;
  if (!s?.bad || s.bad !== theirs) return '';
  const v = (x, sha) => `${x ? `v${x} ` : ''}(${String(sha).slice(0, 7)})`;
  return `${v(s.badVersion, s.bad)} would not start here, so Docket went back to ${v(s.goodVersion, s.good)}. It takes the next update once a newer one is on master.`;
}

// Whether going back changes the libraries, so npm install has to run: package.json's dependency lists, or
// package-lock.json's packages apart from Docket's own entry (each update bumps the version in both). Texts of the files.
export function librariesDiffer({ goodPkg, badPkg, goodLock, badLock }) {
  const parse = (t) => { try { return JSON.parse(t); } catch { return null; } };
  const deps = (t) => { const j = parse(t) || {}; return JSON.stringify([j.dependencies, j.devDependencies, j.optionalDependencies]); };
  const pkgs = (t) => { const { '': own, ...rest } = parse(t)?.packages || {}; return JSON.stringify(rest); };
  return deps(goodPkg) !== deps(badPkg) || pkgs(goodLock) !== pkgs(badLock);
}

// The error at the end of portal.log: from its last line naming an error, else the last few lines.
export function crashLines(log = '') {
  const lines = String(log).trim().split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const at = lines.findLastIndex((l) => /\w*(Error|Exception)\b:/.test(l));
  return (at >= 0 ? lines.slice(at, at + 2) : lines.slice(-6)).join('\n').slice(0, 600);
}

// The page's one-time notice after going back: the versions and the crash.
export function noticeText({ badVersion, goodVersion, bad, good, log = '' }) {
  const v = (x, sha) => (x ? `v${x}` : String(sha).slice(0, 7));
  const tail = crashLines(log);
  return `Docket went back from ${v(badVersion, bad)} to ${v(goodVersion, good)} because ${v(badVersion, bad)} would not start.${tail ? `\nFrom portal.log:\n${tail}` : ''}`;
}
