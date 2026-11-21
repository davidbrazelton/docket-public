// Runs the Docket app with no window and starts it again when it restarts itself to take in a
// change (exit code 75). Any other exit (a crash, or being stopped) ends it, as closing the
// console window used to. The app's output goes to portal.log; portal-events.log keeps the
// record of starts, stops and crashes.
// Each app start gets the environment as it is now (platform.mjs freshEnv: on Windows the person's and the
// computer's variables from the registry) and the node found on that PATH, never what this supervisor was started
// with days ago. ☰ > Restart Docket replaces the supervisor too: the app starts a new one with --after <its pid>,
// which waits for that app to be gone, and exits with 0, which ends this one.
import { spawn, execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { envReadCommand, parseEnvRead, freshEnv, findNode } from './platform.mjs';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const RESTART_CODE = 75;
const out = fs.openSync(path.join(ROOT, 'portal.log'), 'a');
const note = (what) => { try { fs.writeSync(out, `${new Date().toISOString()}  supervisor (pid ${process.pid}): ${what}\n`); } catch {} };
// A copy put here by Docket-Setup.exe runs on its own Node.js, with its runtime\ folders at the end of the PATH
// (as start-hidden.ps1 sets them).
const runtime = path.join(path.dirname(ROOT), 'runtime');
const bundled = fs.existsSync(path.join(runtime, 'docket-runtime.txt'));
// Names the registry has given, passed on to the next supervisor through the app, so one deleted since is dropped.
let managed = (process.env.DOCKET_ENV_NAMES || '').split(';').filter(Boolean);
let app = null;
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
function run() {
  const { env, node } = startWith();
  app = spawn(node, [path.join(ROOT, 'server.mjs')], { cwd: ROOT, env, stdio: ['ignore', out, out], windowsHide: true });
  app.on('error', (e) => { note(`could not start the app: ${e.message}`); process.exit(1); });
  app.on('exit', (code) => { if (code === RESTART_CODE) run(); else process.exit(code ?? 0); });
}
for (const sig of ['SIGINT', 'SIGTERM', 'SIGBREAK']) process.on(sig, () => app?.kill());
// --after <pid>: started by ☰ > Restart Docket; the app that started it is still stopping, so wait for it (30 s at most).
const after = process.argv.includes('--after') ? Number(process.argv[process.argv.indexOf('--after') + 1]) : 0;
const alive = (pid) => { try { process.kill(pid, 0); return true; } catch (e) { return e.code === 'EPERM'; } };
for (let i = 0; after && i < 150 && alive(after); i++) await new Promise((r) => setTimeout(r, 200));
if (after) note(`replaces the supervisor of app pid ${after} (Restart Docket)`);
run();
