// supervisor.mjs for real (#1273, #1276), on a stand-in app in a git folder of its own: a frozen app is replaced, an
// update that crashes on start is backed out to the last good commit (and the updater told to skip it), a crash is
// started again with growing waits, a second supervisor leaves the app to the first, and an exit with 0 ends it.
// Run with: npm test
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { freePorts } from './free-port.mjs';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const APP = (version, bad = false) => `import http from 'node:http';
import fs from 'node:fs';
${bad ? "throw new TypeError('made-up crash on start');\n" : ''}if (fs.existsSync('crash')) { console.error('Error: crash file'); process.exit(3); }
http.createServer((req, res) => {
  if (req.url === '/quit') { res.end('bye'); setTimeout(() => process.exit(0), 50); return; }
  if (req.url === '/restart') { res.end('bye'); setTimeout(() => process.exit(75), 50); return; }
  res.end(JSON.stringify({ pid: process.pid, version: '${version}' }));
}).listen(Number(process.env.PORTAL_PORT), '127.0.0.1');
setInterval(() => { if (fs.existsSync('freeze')) { fs.rmSync('freeze'); for (;;) {} } }, 100);
`;
const tmps = [], procs = [];
after(() => {
  for (const p of procs) try { p.kill(); } catch {}
  for (const t of tmps) try { fs.rmSync(t, { recursive: true, force: true, maxRetries: 5 }); } catch {}
});
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(f, ms, what) {
  for (const end = Date.now() + ms; Date.now() < end; await sleep(200)) { const v = await f(); if (v) return v; }
  assert.fail(`timed out: ${what}`);
}

test('supervisor.mjs replaces a frozen app, backs out an update that will not start, retries crashes, and stops on 0', { timeout: 420000 }, async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'docket-supervisor-')); tmps.push(dir);
  for (const f of ['supervisor.mjs', 'app-keeper.mjs', 'platform.mjs', 'company-env.mjs']) fs.copyFileSync(path.join(ROOT, f), path.join(dir, f));
  const write = (f, s) => fs.writeFileSync(path.join(dir, f), s);
  const git = (...a) => execFileSync('git', ['-c', 'core.autocrlf=false', '-c', 'user.name=Test', '-c', 'user.email=test@example.com', ...a], { cwd: dir, encoding: 'utf8' }).trim();
  write('server.mjs', APP('1.0.0')); write('package.json', '{ "version": "1.0.0" }\n');
  write('.gitignore', 'data/\nportal.log\nportal-events.log\ncrash\nfreeze\n');
  git('init', '-q', '-b', 'master'); git('add', '-A'); git('commit', '-qm', 'good');
  const good = git('rev-parse', 'HEAD');
  const [port] = await freePorts(1);
  const env = { ...process.env, PORTAL_PORT: String(port), PORTAL_DATA: 'data', DOCKET_CHECK_EVERY_MS: '300', DOCKET_STABLE_MS: '4000', DOCKET_START_CRASH_MS: '2000', DOCKET_FROZEN_MS: '2500', DOCKET_CHECK_TIMEOUT_MS: '500' };
  const start = () => { const p = spawn(process.execPath, [path.join(dir, 'supervisor.mjs')], { cwd: dir, env, stdio: 'ignore', windowsHide: true }); procs.push(p); return { p, exited: new Promise((r) => p.on('exit', (code) => r(code))) }; };
  const ask = async () => { try { return await (await fetch(`http://127.0.0.1:${port}/`, { signal: AbortSignal.timeout(400) })).json(); } catch { return null; } };
  const json = (f) => { try { return JSON.parse(fs.readFileSync(path.join(dir, 'data', f), 'utf8')); } catch { return null; } };
  const events = () => { try { return fs.readFileSync(path.join(dir, 'portal-events.log'), 'utf8'); } catch { return ''; } };

  const sup = start();
  const first = await until(ask, 30000, 'the app answers');
  await until(() => json('update-guard.json')?.good?.head === good, 15000, 'the commit that started cleanly is recorded');
  assert.equal(json('supervisor.json').pid, sup.p.pid);

  // A second supervisor (the Start menu, the runner's backstop) leaves the app to the first.
  const second = start();
  assert.equal(await Promise.race([second.exited, sleep(20000).then(() => 'still running')]), 0);

  // Frozen, though still holding its port: replaced.
  write('freeze', '');
  const replaced = await until(async () => { const a = await ask(); return a && a.pid !== first.pid && a; }, 30000, 'a new app after the frozen one');
  assert.match(events(), /has not answered for \d+ s; stopping it to start a new one/);
  assert.match(events(), /replaced the frozen app/);

  // An update that crashes on start: back to the last good commit, and the updater skips the bad one.
  await sleep(4500); // the new app runs cleanly a while, so the crash count starts over
  write('server.mjs', APP('1.1.0', true)); write('package.json', '{ "version": "1.1.0" }\n');
  git('commit', '-qam', 'bad');
  const bad = git('rev-parse', 'HEAD');
  await until(() => json('update-guard.json')?.good?.head === good, 5000, 'still good');
  const restart = () => fetch(`http://127.0.0.1:${port}/restart`).catch(() => {}); // takes the new commit in, as after a pull
  await restart();
  await until(() => git('rev-parse', 'HEAD') === good, 90000, 'HEAD back on the good commit');
  const back = await until(ask, 30000, 'the good app answers again');
  assert.equal(back.version, '1.0.0');
  const guard = json('update-guard.json');
  assert.equal(guard.skip.bad, bad);
  assert.equal(guard.skip.good, good);
  assert.match(guard.notice.text, /^Docket went back from v1\.1\.0 to v1\.0\.0 because v1\.1\.0 would not start\./);
  assert.match(guard.notice.text, /made-up crash on start/);
  assert.equal(guard.notice.shown, false);
  assert.match(events(), /the app stopped unexpectedly \(exit code 1\) after \d+ s, on start; starting it again in \d+ s \(try \d\)/);
  assert.match(events(), /went back from v1\.1\.0 [0-9a-f]{7} to v1\.0\.0 [0-9a-f]{7}/);
  assert.match(events(), /the app exited \(exit code 75\) after \d+ s to take in a change; starting it again now/, 'every exit is logged with its code');

  // A crash that keeps happening: started again after 1 s, then 5 s; on the good commit it does not go back.
  await sleep(4500); // runs cleanly a while, so the count starts over
  const before = events().length;
  write('crash', '');
  process.kill(back.pid);
  await until(() => /starting it again in 5 s \(try 2\)/.test(events().slice(before)), 30000, 'the second wait is 5 s');
  assert.match(events().slice(before), /starting it again in 1 s \(try 1\)/);
  fs.rmSync(path.join(dir, 'crash'));
  await until(ask, 30000, 'it comes back once the crash is gone');

  // The case seen on a real computer: an update starts cleanly, then crashes after running past its start, again and
  // again. Each is started again, and it never goes back: the new commit stays.
  write('server.mjs', APP('1.2.0')); write('package.json', '{ "version": "1.2.0" }\n');
  git('commit', '-qam', 'newer');
  const newer = git('rev-parse', 'HEAD');
  const late = events().length;
  await until(ask, 30000, 'running'); await restart();
  for (let i = 0; i < 3; i++) {
    const a = await until(async () => { const x = await ask(); return x?.version === '1.2.0' && x; }, 90000, 'the newer app answers');
    await sleep(2500); // past its start (DOCKET_START_CRASH_MS), before it counts as clean (DOCKET_STABLE_MS)
    process.kill(a.pid);
  }
  await until(ask, 90000, 'started again after the late crashes');
  assert.equal(git('rev-parse', 'HEAD'), newer, 'not backed out');
  assert.doesNotMatch(events().slice(late), /went back|not going back/);
  assert.match(events().slice(late), /the app stopped unexpectedly \((exit code \d+|SIGTERM)\) after [2-9] s; starting it again/);

  // An exit with 0 (Quit Docket) ends the supervisor, and says so.
  await fetch(`http://127.0.0.1:${port}/quit`).catch(() => {});
  assert.equal(await Promise.race([sup.exited, sleep(20000).then(() => 'still running')]), 0);
  assert.match(json('supervisor.json').stopped, /exited with 0/);
});
