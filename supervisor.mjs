// Runs the Docket app with no window and starts it again when it restarts itself to take in a
// change (exit code 75). Any other exit (a crash, or being stopped) ends it, as closing the
// console window used to. The app's output goes to portal.log; portal-events.log keeps the
// record of starts, stops and crashes.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const RESTART_CODE = 75;
const out = fs.openSync(path.join(ROOT, 'portal.log'), 'a');
let app = null;

function run() {
  app = spawn(process.execPath, [path.join(ROOT, 'server.mjs')], { cwd: ROOT, stdio: ['ignore', out, out], windowsHide: true });
  app.on('exit', (code) => { if (code === RESTART_CODE) run(); else process.exit(code ?? 0); });
}
for (const sig of ['SIGINT', 'SIGTERM', 'SIGBREAK']) process.on(sig, () => app?.kill());
run();
