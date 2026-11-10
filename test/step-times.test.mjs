// Tests for step-times.mjs: how long steps usually take, per repo and command (#847). Run with: npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { normalizeRemote, normalizeCommand, commandDir, repoOf, stepKey, emptyHistory, addRun, median, typical, usualFor, roughTime, wellPast, estimateNote, trimHistory, transcriptRuns, seedHistory, RUNS_KEPT } from '../step-times.mjs';

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'step-times-'));
// A repo with an origin, and a worktree of it in another folder (its .git a file naming the main git folder).
function repoWithWorktree(url = 'git@github.com:acme/app.git') {
  const base = tmp(), main = path.join(base, 'app'), wt = path.join(base, 'work', 'fix');
  fs.mkdirSync(path.join(main, '.git', 'worktrees', 'fix'), { recursive: true });
  fs.writeFileSync(path.join(main, '.git', 'config'), `[core]\n\tbare = false\n[remote "origin"]\n\turl = ${url}\n\tfetch = +refs/heads/*:refs/remotes/origin/*\n`);
  fs.writeFileSync(path.join(main, '.git', 'worktrees', 'fix', 'commondir'), '../..\n');
  fs.mkdirSync(path.join(wt, 'src'), { recursive: true });
  fs.writeFileSync(path.join(wt, '.git'), `gitdir: ${path.join(main, '.git', 'worktrees', 'fix')}\n`);
  return { base, main, wt };
}

test('remote URLs in every spelling become one key', () => {
  for (const u of ['git@github.com:Acme/App.git', 'https://github.com/acme/app', 'https://github.com/acme/app.git/', 'ssh://git@github.com/acme/app.git', 'https://user@github.com/acme/app.git']) {
    assert.equal(normalizeRemote(u), 'github.com/acme/app', u);
  }
  assert.equal(normalizeRemote('ssh://git@host.example:2222/team/repo.git'), 'host.example/team/repo');
  assert.equal(normalizeRemote(''), '');
});

test('a leading cd goes, repo paths become relative, arguments stay', () => {
  const root = 'C:/Work/app';
  assert.equal(normalizeCommand('cd C:/Work/app && npm test', [root]), 'npm test');
  assert.equal(normalizeCommand('cd /c/Work/app; npm test -- one.test.js', [root]), 'npm test -- one.test.js');
  assert.equal(normalizeCommand('Set-Location "C:\\Work\\app"; npm run build', [root]), 'npm run build');
  assert.equal(normalizeCommand('node C:\\Work\\app\\scripts\\x.mjs', [root]), 'node .\\scripts\\x.mjs');
  assert.equal(normalizeCommand('node /c/Work/app/scripts/x.mjs', [root]), 'node ./scripts/x.mjs');
  assert.equal(normalizeCommand('node "C:/Work/app/scripts/x.mjs"', [root]), 'node "./scripts/x.mjs"');
  assert.notEqual(normalizeCommand('npm test', [root]), normalizeCommand('npm test -- one.test.js', [root]));
  // A folder that only starts like the root is not the root.
  assert.equal(normalizeCommand('ls C:/Work/app2', [root]), 'ls C:/Work/app2');
});

test('temp paths and output filters do not split one step into many', () => {
  assert.equal(normalizeCommand('node "$TEMP/x.mjs"'), 'node "$TEMP/x.mjs"');
  assert.equal(normalizeCommand('node C:/Users/me/AppData/Local/Temp/abc123/try.mjs'), 'node <tmp>');
  assert.equal(normalizeCommand('cat /tmp/out-123.txt && make'), 'cat <tmp> && make');
  assert.equal(normalizeCommand('npm test 2>&1 | grep -E "^ℹ (pass|fail)"'), 'npm test');
  assert.equal(normalizeCommand('npm test 2>&1 | tail -5'), 'npm test');
  assert.equal(normalizeCommand('npm test | head -20 | grep x'), 'npm test');
  assert.equal(normalizeCommand('git log | xargs echo'), 'git log | xargs echo'); // not a filter
  assert.equal(normalizeCommand('a || b'), 'a || b');
  assert.equal(normalizeCommand('npm   test'), 'npm test');
});

test('commandDir follows a leading cd, absolute or relative', () => {
  assert.equal(commandDir('cd /c/Work/app && npm test', 'D:/x'), 'C:/Work/app');
  assert.equal(commandDir('npm test', 'D:/x'), 'D:/x');
  assert.equal(path.resolve(commandDir('cd sub && ls', 'D:/x')), path.resolve('D:/x/sub'));
});

test('worktrees of one repo share a key; another repo and no repo do not', () => {
  const { base, main, wt } = repoWithWorktree();
  const cache = new Map();
  assert.deepEqual(repoOf(path.join(wt, 'src'), cache), { root: wt.replace(/\\/g, '/'), repo: 'github.com/acme/app' });
  const a = stepKey('npm test', main, cache), b = stepKey('npm test', wt, cache);
  assert.equal(a, 'github.com/acme/app\nnpm test');
  assert.equal(a, b);
  // A cd into the worktree from elsewhere is the same step too.
  assert.equal(stepKey(`cd ${wt.replace(/\\/g, '/')} && npm test`, base, cache), a);
  assert.equal(stepKey(`node ${path.join(wt, 'x.mjs')}`, wt, cache), stepKey(`node ${path.join(main, 'x.mjs')}`, main, cache));
  const other = repoWithWorktree('https://github.com/acme/other.git');
  assert.notEqual(stepKey('npm test', other.main, new Map()), a);
  const none = tmp();
  if (!repoOf(none, new Map())) assert.equal(stepKey('npm test', none, new Map()), null); // unless tmp sits in a repo
});

test('a repo with no origin falls back to its main folder, shared by its worktrees', () => {
  const { main, wt } = repoWithWorktree('');
  fs.writeFileSync(path.join(main, '.git', 'config'), '[core]\n\tbare = false\n');
  const k = stepKey('make', wt, new Map());
  assert.match(k, /^dir:.*\/app\nmake$/);
  assert.equal(stepKey('make', main, new Map()), k);
});

test('typical time is the median of successful runs; failed and stopped runs are kept apart', () => {
  assert.equal(median([3, 1, 2]), 2);
  assert.equal(median([1, 2, 3, 10]), 3); // (2 + 3) / 2 rounded
  assert.equal(median([]), null);
  const h = emptyHistory(), k = 'r\nnpm test';
  for (const ms of [60000, 90000, 30000]) addRun(h, k, { ms, ok: true });
  addRun(h, k, { ms: 2000, ok: false, status: 'failed' });
  addRun(h, k, { ms: 900000, ok: false, status: 'stopped' });
  assert.deepEqual(typical(h, k), { ms: 60000, runs: 3, failed: 2 });
  assert.equal(h.steps[k].bad[1][2], 'stopped');
  assert.equal(typical(h, 'r\nother'), null);
  // Only failures: nothing to estimate from.
  addRun(h, 'r\nbroken', { ms: 50000, ok: false });
  assert.equal(typical(h, 'r\nbroken'), null);
});

test('only the last runs are kept, and short steps show no estimate', () => {
  const h = emptyHistory();
  for (let i = 0; i < RUNS_KEPT + 5; i++) addRun(h, 'k', { ms: i < 5 ? 1000 : 40000, ok: true, at: i });
  assert.equal(h.steps.k.ok.length, RUNS_KEPT);
  assert.equal(typical(h, 'k').ms, 40000); // the five old 1s runs fell off
  addRun(h, 'quick', { ms: 4000, ok: true });
  assert.equal(usualFor(h, 'quick'), null);
  assert.ok(usualFor(h, 'k'));
});

test('trimHistory keeps the steps run most recently', () => {
  const h = emptyHistory();
  addRun(h, 'old', { ms: 1, ok: true, at: 1 });
  addRun(h, 'new', { ms: 1, ok: false, at: 5 });
  addRun(h, 'mid', { ms: 1, ok: true, at: 3 });
  trimHistory(h, 2);
  assert.deepEqual(Object.keys(h.steps).sort(), ['mid', 'new']);
});

test('rough times, well past, and the note for the session', () => {
  assert.equal(roughTime(12000), '~12s');
  assert.equal(roughTime(47000), '~45s');
  assert.equal(roughTime(150000), '~2m 30s');
  assert.equal(roughTime(120000), '~2m');
  assert.equal(roughTime(3900000), '~1h 5m');
  assert.equal(wellPast(100000, 60000), false);
  assert.equal(wellPast(130000, 60000), true);
  assert.equal(wellPast(40000, 16000), false); // twice, but not a minute over
  assert.match(estimateNote({ ms: 150000, runs: 12, failed: 1 }), /about 2m 30s in this repo \(median of 12 earlier successful runs; 1 failed or stopped run not counted\)/);
});

test('past transcripts seed the history: foreground answers and background notifications', async () => {
  const { base, main } = repoWithWorktree();
  const t = (s) => new Date(Date.UTC(2026, 10, 1, 10, 0, s)).toISOString();
  const lines = [
    { type: 'assistant', timestamp: t(0), cwd: main, message: { content: [{ type: 'tool_use', id: 'toolu_a', name: 'Bash', input: { command: 'npm test' } }] } },
    { type: 'user', timestamp: t(40), message: { content: [{ type: 'tool_result', tool_use_id: 'toolu_a', content: 'ok' }] } },
    { type: 'assistant', timestamp: t(50), cwd: main, message: { content: [{ type: 'tool_use', id: 'toolu_b', name: 'Bash', input: { command: 'npm test' } }] } },
    { type: 'user', timestamp: t(55), message: { content: [{ type: 'tool_result', tool_use_id: 'toolu_b', is_error: true, content: 'Exit code 1' }] } },
    { type: 'assistant', timestamp: t(60), cwd: main, message: { content: [{ type: 'tool_use', id: 'toolu_c', name: 'Bash', input: { command: 'npm run build', run_in_background: true } }] } },
    { type: 'user', timestamp: t(61), message: { content: [{ type: 'tool_result', tool_use_id: 'toolu_c', content: 'Command running in background with ID: b1' }] } },
    { type: 'queue-operation', timestamp: t(120), content: '<task-notification>\n<task-id>b1</task-id>\n<tool-use-id>toolu_c</tool-use-id>\n<status>completed</status>\n<summary>done</summary></task-notification>' },
    { type: 'assistant', timestamp: t(130), cwd: main, isSidechain: true, message: { content: [{ type: 'tool_use', id: 'toolu_d', name: 'Bash', input: { command: 'npm test' } }] } },
    { type: 'assistant', timestamp: t(140), cwd: main, message: { content: [{ type: 'tool_use', id: 'toolu_e', name: 'Bash', input: { command: 'sleep 999' } }] } }, // never answered
  ];
  const home = path.join(base, 'home'), proj = path.join(home, 'projects', 'C--x');
  fs.mkdirSync(proj, { recursive: true });
  fs.writeFileSync(path.join(proj, 's1.jsonl'), lines.map((l) => JSON.stringify(l)).join('\n') + '\n');
  const runs = await transcriptRuns(path.join(proj, 's1.jsonl'));
  assert.deepEqual(runs.map((r) => [r.command, r.ms, r.ok]), [['npm test', 40000, true], ['npm test', 5000, false], ['npm run build', 60000, true]]);
  const h = emptyHistory();
  const r = await seedHistory(h, [home], { before: Date.UTC(2026, 10, 2) });
  assert.equal(r.runs, 3);
  assert.deepEqual(typical(h, 'github.com/acme/app\nnpm test'), { ms: 40000, runs: 1, failed: 1 });
  assert.equal(typical(h, 'github.com/acme/app\nnpm run build').ms, 60000);
  assert.ok(h.seeded);
});
