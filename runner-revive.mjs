// The last backstop (#1277): when the app and its supervisor are both gone, the session runner, which keeps running,
// starts the supervisor again. Kept apart from runner.mjs, which only calls tick() every few seconds.
// It starts one only for its own app (the data folder and port it was started for) and only when:
// - that app was started by supervisor.mjs (app-run.json, which the app writes): an app started by hand or from
//   start-docket.cmd's window is never started again, test copies included, so a test runner revives a test app only
//   when a supervisor ran it;
// - the app was not stopped on purpose (Quit Docket, Restart Docket and Ctrl+C mark app-run.json stopped; Quit and
//   Restart Docket stop the runner too);
// - the app has not been in touch for a minute (it checks on the runner every few seconds), counted from when this
//   runner last woke up, so a computer back from sleep is not taken for an app gone;
// - no supervisor is running (supervisor.json's heartbeat): during a planned restart the supervisor is there and
//   starts the app itself;
// - nothing answers on the app's port, and no supervisor was started here in the last five minutes.
// The supervisor it starts checks supervisor.json once more and leaves the app to one already running, so two never
// start the same app.
import fs from 'node:fs';
import path from 'node:path';
import { spawn as nodeSpawn } from 'node:child_process';

export const QUIET_MS = 60000; // no word from the app this long: look
export const AGAIN_MS = 5 * 60000; // between supervisors started here
export const LATE_MS = 30000; // a tick this late (the ticks are seconds apart): the computer slept
const HEARTBEAT_MS = 30000; // supervisor.mjs's, when its record does not say

const readJson = (file) => { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; } };
const pidAlive = (pid) => { if (!pid) return false; try { process.kill(pid, 0); return true; } catch (e) { return e.code === 'EPERM'; } };
export const supervisorRunning = (rec, now, alive = pidAlive) => !!rec && !rec.stopped && alive(rec.pid) && now - (rec.at || 0) < 3 * (rec.every || HEARTBEAT_MS);

// Whether to start the supervisor now: { go, why }. app: app-run.json; quietSince: the app's last word, or this
// runner's last wake-up if later; supervisorAlive: supervisor.json says one is running.
export function reviveDecision({ now, quietSince, app, appPort, supervisorAlive, lastRevive = 0 }) {
  const no = (why) => ({ go: false, why });
  if (!app) return no('no app has run from this data folder yet');
  if (Number(app.port) !== appPort) return no(`the last app here ran on port ${app.port}, not ${appPort}`);
  if (!app.supervised) return no('its app was not started by supervisor.mjs');
  if (app.stopped) return no(`its app was stopped on purpose (${app.stopped})`);
  if (now - quietSince < QUIET_MS) return no('its app was in touch less than a minute ago');
  if (lastRevive && now - lastRevive < AGAIN_MS) return no('a supervisor was started from here less than five minutes ago');
  if (supervisorAlive) return no('its supervisor is running and starts the app itself');
  return { go: true, why: `no word from its app on port ${appPort} for ${Math.round((now - quietSince) / 1000)} s, and no supervisor running` };
}

// tick(lastContact) every few seconds. Only a tick that passes reviveDecision asks the app's port, and only one at a time.
export function makeReviver({ root, dataDir, appPort, log, now = Date.now, fetch = globalThis.fetch, spawn = nodeSpawn, alive = pidAlive, env = process.env }) {
  const appFile = path.join(dataDir, 'app-run.json'), supFile = path.join(dataDir, 'supervisor.json');
  let lastTick = 0, wokeAt = 0, lastRevive = 0, busy = false;
  const decide = (t, lastContact) => reviveDecision({ now: t, quietSince: Math.max(lastContact, wokeAt), app: readJson(appFile), appPort, supervisorAlive: supervisorRunning(readJson(supFile), t, alive), lastRevive });
  const answers = async () => {
    try { const r = await fetch(`http://127.0.0.1:${appPort}/api/alive`, { signal: AbortSignal.timeout(5000) }); await r.arrayBuffer(); return true; } catch { return false; }
  };
  return {
    async tick(lastContact) {
      const t = now();
      if (lastTick && t - lastTick > LATE_MS) wokeAt = t;
      lastTick = t;
      if (busy || !decide(t, lastContact).go) return null;
      busy = true;
      try {
        if (await answers()) { wokeAt = now(); return null; } // answering, just not to this runner: look again in a minute
        const d = decide(now(), lastContact); // read again: a supervisor may have started meanwhile
        if (!d.go) return null;
        lastRevive = now();
        log(`starting the app again: ${d.why}`);
        const child = spawn(process.execPath, [path.join(root, 'supervisor.mjs')], { cwd: root, env, detached: true, stdio: 'ignore', windowsHide: true });
        child.on?.('error', (e) => log(`could not start supervisor.mjs: ${e.message}`));
        child.unref?.();
        return d;
      } finally { busy = false; }
    },
  };
}
