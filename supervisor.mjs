// Runs the Docket app with no window and keeps it running (app-keeper.mjs decides each step):
// - it starts the app again at once when the app restarts itself to take in a change (exit code 75);
// - after a crash it starts it again after a growing wait (about 1 s, 5 s, 30 s, then every minute), and keeps trying;
// - an app that keeps crashing on start right after an update is put back on the last commit that started cleanly,
//   and the updater skips the bad commit until a newer one is on master; the page says so once it is back;
// - an app that has not answered for several minutes (frozen, though still holding its port) is stopped and started again.
// An exit with 0 (Quit Docket, Restart Docket handing over to a new supervisor, Ctrl+C) or this supervisor being
// stopped ends it. The app's output goes to portal.log; portal-events.log keeps the record of starts, stops and crashes.
// Each app start gets the environment as it is now (platform.mjs freshEnv: on Windows the person's and the
// computer's variables from the registry) and the node found on that PATH, never what this supervisor was started
// with days ago. ☰ > Restart Docket replaces the supervisor too: the app starts a new one with --after <its pid>,
// which waits for that app to be gone, and exits with 0, which ends this one.
// supervisor.json in the data folder says this supervisor is running (a heartbeat every check), so a second one
// started meanwhile (the Start menu, or the session runner's backstop, runner-revive.mjs) leaves the app to it.
import { spawn, execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { envReadCommand, parseEnvRead, freshEnv, findNode } from './platform.mjs';
import * as keep from './app-keeper.mjs';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORTAL_PORT || 4400);
const files = keep.keeperFiles(path.resolve(ROOT, process.env.PORTAL_DATA || 'data'));
// Only the tests set these, to not wait minutes.
const EVERY_MS = Number(process.env.DOCKET_CHECK_EVERY_MS) || keep.CHECK_EVERY_MS;
const FROZEN_MS = Number(process.env.DOCKET_FROZEN_MS) || keep.FROZEN_MS;
const STABLE_MS = Number(process.env.DOCKET_STABLE_MS) || keep.STABLE_MS;
const TIMEOUT_MS = Number(process.env.DOCKET_CHECK_TIMEOUT_MS) || keep.CHECK_TIMEOUT_MS;
const START_CRASH_MS = Number(process.env.DOCKET_START_CRASH_MS) || keep.START_CRASH_MS;
const out = fs.openSync(path.join(ROOT, 'portal.log'), 'a');
const note = (what) => { try { fs.writeSync(out, `${new Date().toISOString()}  supervisor (pid ${process.pid}): ${what}\n`); } catch {} };
// Starts, crashes and stops go in portal-events.log too, as the app's own do.
const event = (what, detail = '') => {
  note(what);
  const indented = detail ? '\n  ' + String(detail).trim().replace(/\n/g, '\n  ') : '';
  try { fs.appendFileSync(path.join(ROOT, 'portal-events.log'), `${new Date().toISOString()}  port ${PORT}  supervisor (pid ${process.pid}): ${what}${indented}\n`); } catch {}
};
// A copy put here by Docket-Setup.exe runs on its own Node.js, with its runtime\ folders at the end of the PATH
// (as start-hidden.ps1 sets them).
const runtime = path.join(path.dirname(ROOT), 'runtime');
const bundled = fs.existsSync(path.join(runtime, 'docket-runtime.txt'));
// Names the registry has given, passed on to the next supervisor through the app, so one deleted since is dropped.
let managed = (process.env.DOCKET_ENV_NAMES || '').split(';').filter(Boolean);
let app = null; // { proc, pid, startedAt, head, version, watch, answered, good, frozen, done }
let counts = keep.noCrashes();
let stopping = '';
let lastEnv = process.env;
const samePath = (a, b) => { try { return fs.realpathSync.native(a).toLowerCase() === fs.realpathSync.native(b).toLowerCase(); } catch { return false; } };

function startWith() {
  const c = envReadCommand();
  let read = null;
  if (c) {
    try { read = parseEnvRead(execFileSync(c.cmd, c.args, { encoding: 'utf8', windowsHide: true, timeout: 30_000 })); } catch (e) { note(`could not read the environment, so the app gets this supervisor's: ${e.message}`); }
  }
  const f = freshEnv({ current: process.env, read, managed, extraPath: bundled ? [path.join(runtime, 'node'), path.join(runtime, 'git', 'cmd')] : [], samePath });
  managed = f.names;
  const env = { ...f.env, ...(managed.length ? { DOCKET_ENV_NAMES: managed.join(';') } : {}) };
  const ownNode = path.join(runtime, 'node', process.platform === 'win32' ? 'node.exe' : 'node');
  const node = bundled && fs.existsSync(ownNode) ? ownNode : findNode({ env, exists: (p) => fs.existsSync(p), fallback: process.execPath });
  const changes = [f.changed.length && `changed since this supervisor started: ${f.changed.join(', ')}`, f.dropped.length && `deleted: ${f.dropped.join(', ')}`,
    node !== process.execPath && `node: ${node}`].filter(Boolean);
  if (changes.length) note(`starting the app with a fresh environment; ${changes.join('; ')}`);
  return { env, node };
}
// git in this folder, with the app's PATH (a bundled copy's own git); null when it fails.
function git(args) {
  try { return execFileSync('git', args, { cwd: ROOT, env: lastEnv, encoding: 'utf8', windowsHide: true, timeout: 60_000, stdio: ['ignore', 'pipe', 'pipe'] }).trim(); } catch { return null; }
}
const versionOf = (text) => { try { return JSON.parse(text).version || ''; } catch { return ''; } };
// The end of portal.log, where a crash on start leaves its error.
function logTail(bytes = 4000) {
  try {
    const f = path.join(ROOT, 'portal.log'), size = fs.statSync(f).size, fd = fs.openSync(f, 'r'), buf = Buffer.alloc(Math.min(bytes, size));
    fs.readSync(fd, buf, 0, buf.length, size - buf.length); fs.closeSync(fd);
    return buf.toString('utf8').split('\n').filter((l) => l.trim() && !/ supervisor \(pid \d+\): /.test(l)).slice(-12).join('\n');
  } catch { return ''; }
}
function heartbeat(extra = {}) {
  const rec = keep.readJson(files.supervisor);
  if (rec?.pid && rec.pid !== process.pid && keep.supervisorAlive(rec)) return; // another one keeps the app now
  keep.writeJson(files.supervisor, { pid: process.pid, appPid: app?.pid || 0, port: PORT, root: ROOT, every: EVERY_MS, at: Date.now(), stopped: '', ...extra });
}
// Stopping on purpose: the session runner must not start Docket again (runner-revive.mjs).
function markStopped(why, appPid) {
  const rec = keep.readJson(files.supervisor);
  if (!rec || rec.pid === process.pid) heartbeat({ stopped: why });
  const run = keep.readJson(files.app);
  if (run && appPid && run.pid === appPid && !run.stopped) keep.writeJson(files.app, { ...run, stopped: why });
}

function run() {
  const { env, node } = startWith();
  lastEnv = env;
  let version = ''; try { version = versionOf(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')); } catch {}
  const proc = spawn(node, [path.join(ROOT, 'server.mjs')], { cwd: ROOT, env: { ...env, DOCKET_SUPERVISOR_PID: String(process.pid) }, stdio: ['ignore', out, out], windowsHide: true });
  const startedAt = Date.now();
  const me = app = { proc, pid: proc.pid, startedAt, head: git(['rev-parse', 'HEAD']) || '', version, watch: keep.newWatch(startedAt), answered: false, good: false, frozen: false, done: false };
  heartbeat();
  proc.on('error', (e) => { note(`could not start the app: ${e.message}`); ended(me, null, e.code || 'error'); });
  proc.on('exit', (code, signal) => ended(me, code, signal));
}
function ended(me, code, signal) {
  if (me.done) return;
  me.done = true;
  if (app === me) app = null;
  const upMs = Date.now() - me.startedAt;
  const kind = keep.exitKind({ code, stopping: !!stopping, frozen: me.frozen });
  const step = keep.afterExit(counts, { kind, upMs, startCrashMs: START_CRASH_MS });
  // Every exit goes in portal-events.log with its code.
  const how = code === null || code === undefined ? signal || 'no exit code' : `exit code ${code}`, ran = `after ${Math.round(upMs / 1000)} s`;
  if (step.action === 'stop') {
    event(stopping ? `stopped (${stopping}); the app with it (${how})` : `the app exited (${how}) ${ran}: Quit Docket, Restart Docket or stopped, so this supervisor ends`);
    markStopped(stopping || 'the app exited with 0', me.pid);
    process.exit(0);
  }
  if (kind === 'restart') { event(`the app exited (${how}) ${ran} to take in a change; starting it again now`); return run(); }
  counts = step.counts;
  const when = `starting it again in ${Math.round(step.waitMs / 1000)} s (try ${counts.crashes})`;
  if (kind === 'frozen') event(`replaced the frozen app (pid ${me.pid}, ${how}); ${when}`);
  else event(`the app stopped unexpectedly (${how}) ${ran}${upMs < START_CRASH_MS ? ', on start' : ''}; ${when}`, logTail());
  if (step.loop && goBack()) { counts = keep.noCrashes(); return run(); }
  setTimeout(() => { if (!app && !stopping) run(); }, step.waitMs);
}
// Crashing on start: back to the last commit that started cleanly, when an update moved HEAD off it.
function goBack() {
  const guard = keep.readJson(files.guard) || {};
  const head = git(['rev-parse', 'HEAD']);
  const facts = { head, good: guard.good, branch: git(['rev-parse', '--abbrev-ref', 'HEAD']), clean: !keep.localEdits(git(['status', '--porcelain', '--untracked-files=no']) ?? 'unknown').length };
  facts.goodExists = !!guard.good?.head && git(['cat-file', '-e', `${guard.good.head}^{commit}`]) !== null;
  const d = keep.rollBack(facts);
  if (!d.go) { event(`the app keeps crashing on start; not going back to an earlier commit: ${d.why}`); return false; }
  const good = guard.good.head, file = (sha, f) => git(['show', `${sha}:${f}`]) || '';
  const libs = keep.librariesDiffer({ goodPkg: file(good, 'package.json'), badPkg: file(head, 'package.json'), goodLock: file(good, 'package-lock.json'), badLock: file(head, 'package-lock.json') });
  const badVersion = versionOf(file(head, 'package.json')), goodVersion = guard.good.version || versionOf(file(good, 'package.json'));
  const log = logTail();
  git(['checkout', '--', 'package-lock.json']); // npm's own rewrite of it, the only edit going back allows
  if (git(['reset', '--keep', good]) === null) { event(`could not go back to ${good.slice(0, 7)} (git reset --keep failed)`); return false; }
  if (libs) {
    try { execFileSync('npm', ['install', '--no-audit', '--no-fund'], { cwd: ROOT, env: lastEnv, windowsHide: true, timeout: 600_000, stdio: 'ignore', shell: process.platform === 'win32' }); }
    catch (e) { note(`npm install after going back failed: ${e.message}`); }
  }
  keep.writeJson(files.guard, { ...guard,
    skip: { bad: head, good, badVersion, goodVersion, at: Date.now() },
    notice: { text: keep.noticeText({ badVersion, goodVersion, bad: head, good, log }), at: Date.now(), shown: false } });
  event(`went back from ${badVersion ? `v${badVersion} ` : ''}${head.slice(0, 7)} to ${goodVersion ? `v${goodVersion} ` : ''}${good.slice(0, 7)}: ${d.why}; the updater skips ${head.slice(0, 7)} until a newer commit is on master`, log);
  return true;
}
// Started cleanly: its commit is the one to go back to, and the crash count starts over.
function ranCleanly(me) {
  me.good = true; counts = keep.noCrashes();
  if (!me.head) return;
  const guard = keep.readJson(files.guard) || {};
  if (guard.good?.head === me.head && guard.skip?.bad !== me.head) return;
  const { skip, ...rest } = guard;
  keep.writeJson(files.guard, { ...rest, good: { head: me.head, version: me.version, at: Date.now() }, ...(skip && skip.bad !== me.head ? { skip } : {}) });
}
// The health check (and heartbeat): any answer from the app counts.
let checking = false;
async function check() {
  heartbeat();
  const me = app;
  if (!me || checking) return;
  checking = true;
  try {
    const started = Date.now();
    let answered = false;
    try { const r = await fetch(`http://127.0.0.1:${PORT}/api/alive`, { signal: AbortSignal.timeout(TIMEOUT_MS) }); await r.arrayBuffer(); answered = true; } catch {}
    if (app !== me || me.done) return;
    const now = Date.now();
    me.watch = keep.healthStep(me.watch, { verdict: keep.probeVerdict({ answered, elapsedMs: now - started, timeoutMs: TIMEOUT_MS }), now, everyMs: EVERY_MS, frozenMs: FROZEN_MS });
    if (answered) { me.answered = true; if (!me.good && now - me.startedAt >= STABLE_MS) ranCleanly(me); }
    if (me.watch.frozen && !me.frozen) {
      me.frozen = true;
      event(`the app (pid ${me.pid}) has not answered for ${Math.round((now - me.watch.since) / 1000)} s; stopping it to start a new one`);
      me.proc.kill('SIGKILL');
    }
  } finally { checking = false; }
}
for (const sig of ['SIGINT', 'SIGTERM', 'SIGBREAK']) process.on(sig, () => {
  stopping = sig;
  if (app) app.proc.kill(); else { event(`stopped (${sig})`); markStopped(sig, 0); process.exit(0); }
});
// --after <pid>: started by ☰ > Restart Docket; the app that started it is still stopping, so wait for it (30 s at most).
const after = process.argv.includes('--after') ? Number(process.argv[process.argv.indexOf('--after') + 1]) : 0;
for (let i = 0; after && i < 150 && keep.pidAlive(after); i++) await new Promise((r) => setTimeout(r, 200));
if (after) note(`replaces the supervisor of app pid ${after} (Restart Docket)`);
const other = keep.otherSupervisor(keep.readJson(files.supervisor), { pid: process.pid, after });
if (other) { note(`supervisor pid ${other.pid} already keeps the app on port ${PORT} running; this one ends`); process.exit(0); }
setInterval(check, EVERY_MS);
run();
