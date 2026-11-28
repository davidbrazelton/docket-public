// The setup wizard's working folder from the person's own AI history, on made-up history files in a temp folder:
// Claude Code's ~/.claude.json and saved sessions, Codex's and Grok's sessions, VS Code's window list, the usual code folders.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { readHistory, tidy, pickRoot, workFolders, existingHomes, sourceText } from '../work-folders.mjs';

const tmp = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'docket-303-')));
after(() => fs.rmSync(tmp, { recursive: true, force: true }));
const win = process.platform === 'win32';
const write = (f, text) => { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, text); };
const mk = (...p) => { const d = path.join(...p); fs.mkdirSync(d, { recursive: true }); return d; };
// One made-up computer: a user folder and a "drive" (a folder standing in for C:\) holding the work.
function computer(name) {
  const root = mk(tmp, name), user = mk(root, 'Users', 'pat'), appData = mk(user, 'AppData', 'Roaming');
  return { root, user, appData };
}
const slashes = (p) => p.split(path.sep).join('/');
const fileUri = (p) => 'file:///' + slashes(p).split('/').map((s, i) => i === 0 && /^[A-Za-z]:$/.test(s) ? s.toLowerCase().replace(':', '%3A') : encodeURIComponent(s)).join('/').replace(/^\/+/, '');

test('reads every source, merges spellings, and drops worktrees, missing folders and hidden ones', () => {
  const { root, user, appData } = computer('a');
  const projects = mk(root, 'Projects'), app = mk(projects, 'app'), site = mk(projects, 'site'), notes = mk(projects, 'notes');
  const wt = mk(app, '.claude', 'worktrees', 'fix-1'); write(path.join(wt, '.git'), 'gitdir: ../../../.git/worktrees/fix-1');
  const linked = mk(projects, 'app-work', 'feature'); write(path.join(linked, '.git'), 'gitdir: elsewhere');
  // Claude Code: the folders it was opened in, one spelt with forward slashes and lower-case, one gone, the user folder.
  write(path.join(user, '.claude.json'), JSON.stringify({ projects: { [slashes(app).toLowerCase()]: {}, [path.join(projects, 'gone')]: {}, [user]: {}, [wt]: {} } }));
  // Its saved sessions: two logs whose folder is app, in a folder named the way Claude Code names it.
  const logs = mk(user, '.claude', 'projects', app.replace(/[\\/:.]/g, '-'));
  for (const id of ['s1', 's2']) write(path.join(logs, id + '.jsonl'), JSON.stringify({ type: 'queue-operation' }) + '\n' + JSON.stringify({ type: 'user', cwd: app }) + '\n');
  // Codex: three sessions in site, one in a git worktree.
  const day = mk(user, '.codex', 'sessions', '2026', '10', '27');
  ['x', 'y', 'z'].forEach((id) => write(path.join(day, `rollout-${id}.jsonl`), JSON.stringify({ type: 'session_meta', payload: { cwd: site } }) + '\n'));
  write(path.join(day, 'rollout-w.jsonl'), JSON.stringify({ type: 'session_meta', payload: { cwd: linked } }) + '\n');
  // Grok: two sessions in notes.
  mk(user, '.grok', 'sessions', encodeURIComponent(notes), 'g1'); mk(user, '.grok', 'sessions', encodeURIComponent(notes), 'g2');
  // VS Code: notes again, and a workspace file that is not a folder.
  write(path.join(appData, 'Code', 'User', 'globalStorage', 'storage.json'), JSON.stringify({ windowsState: { lastActiveWindow: { folder: fileUri(notes) } }, w: fileUri(path.join(projects, 'x.code-workspace')) }));
  // The usual code folder.
  const repo = mk(user, 'source', 'repos', 'tool');

  const raw = readHistory({ userHome: user, appData });
  const found = tidy(raw, { userHome: user, win });
  const by = Object.fromEntries(found.map((f) => [f.path, f]));
  assert.deepEqual(Object.keys(by).sort(), [app, notes, repo, site].sort());
  assert.equal(by[app].claude, 2, 'two Claude Code sessions');
  assert.equal(by[app].claudeJson, true, 'the lower-case, forward-slash spelling merged into the real one');
  assert.equal(by[site].codex, 3);
  assert.equal(by[notes].grok, 2);
  assert.equal(by[notes].vscode, true);
  assert.equal(by[repo].usual, true);
  assert.equal(sourceText(by[app]), 'used in 2 Claude Code sessions');
  assert.equal(sourceText(by[notes]), 'used in 2 Grok sessions, opened in VS Code');
  assert.equal(sourceText(by[repo]), 'in your usual code folder');

  const r = workFolders({ userHome: user, appData, win });
  assert.equal(r.suggested, projects, 'most of the work is in Projects');
  assert.match(r.why, /^3 folders you worked in are in it, of 4 found/);
  assert.ok(r.others.some((o) => o.path === repo && o.from === 'in your usual code folder'));
  assert.ok(!r.others.some((o) => o.path === projects), 'the suggestion is not listed again');
});

test('a folder of many Claude Code logs: read only until one names its folder, all of them counted', () => {
  const { root, user } = computer('many');
  const app = mk(root, 'Projects', 'app');
  const logs = mk(user, '.claude', 'projects', 'C--Projects-app');
  for (let i = 0; i < 50; i++) write(path.join(logs, `s${String(i).padStart(2, '0')}.jsonl`), JSON.stringify({ cwd: app }) + '\n');
  const read = [];
  const raw = readHistory({ userHome: user, read: (f) => { read.push(f); return fs.readFileSync(f, 'utf8'); } });
  assert.equal(read.length, 1, 'the first log named the folder, so no other was read');
  assert.deepEqual(raw.filter((e) => e.claude), [{ path: app, claude: 50 }]);
});

test('work straight on a drive (V:\\a, V:\\b) suggests the drive itself', () => {
  if (!win) return; // drive letters are Windows paths
  const user = path.resolve('C:/Users/pat');
  const folders = ['V:/a', 'V:/b', 'V:/c/x', 'C:/Users/pat/source/repos/d'].map((p) => ({ path: path.resolve(p) }));
  assert.equal(pickRoot(folders, { userHome: user, win }), path.resolve('V:/'));
});

test('the choice: into the part holding most of the work, never the user folder or above, never into one project', () => {
  const r = (p) => path.resolve(p), user = r('C:/Users/pat');
  const at = (...ps) => ps.map((p) => ({ path: r(p) }));
  // Most in C:\Projects, some in C:\Work and the user folder.
  assert.equal(pickRoot(at('C:/Projects/a', 'C:/Projects/b', 'C:/Projects/c/x', 'C:/Work/d', 'C:/Users/pat/e'), { userHome: user, win: true }), r('C:/Projects'));
  // All under one part of Projects: down into it.
  assert.equal(pickRoot(at('C:/Projects/Work/a', 'C:/Projects/Work/b', 'C:/Projects/Work/c', 'C:/Projects/old'), { userHome: user, win: true }), r('C:/Projects/Work'));
  // One project only: the folder holding it, not the project.
  assert.equal(pickRoot(at('C:/Projects/a'), { userHome: user, win: true }), r('C:/Projects'));
  // Everything in the user folder's source\repos: there, never C:\Users\pat.
  assert.equal(pickRoot(at('C:/Users/pat/source/repos/a', 'C:/Users/pat/source/repos/b'), { userHome: user, win: true }), r('C:/Users/pat/source/repos'));
  // Work only in the user folder itself: nothing to suggest.
  assert.equal(pickRoot(at('C:/Users/pat'), { userHome: user, win: true }), null);
  assert.equal(pickRoot([], { userHome: user, win: true }), null);
});

test('a computer with no AI history: nothing suggested, nothing listed, no errors', () => {
  const { user, appData } = computer('empty');
  const r = workFolders({ userHome: user, appData, win });
  assert.deepEqual(r, { suggested: null, why: '', others: [], total: 0 });
  // Nothing at all, not even the folders.
  assert.deepEqual(workFolders({ userHome: path.join(tmp, 'no-such-user'), appData: undefined, win }).others, []);
  // A broken ~/.claude.json and VS Code file are skipped.
  write(path.join(user, '.claude.json'), '{ not json');
  write(path.join(appData, 'Code', 'User', 'globalStorage', 'storage.json'), 'file:///%E0%A4%A');
  assert.equal(workFolders({ userHome: user, appData, win }).total, 0);
});

test('folders holding three or more are offered as one choice', () => {
  const { root, user, appData } = computer('groups');
  const apps = mk(root, 'Work', 'apps'), main = mk(root, 'Projects');
  const json = {};
  for (const n of ['a', 'b', 'c']) json[mk(apps, n)] = {};
  for (const n of ['d', 'e', 'f', 'g']) json[mk(main, n)] = {};
  write(path.join(user, '.claude.json'), JSON.stringify({ projects: json }));
  const r = workFolders({ userHome: user, appData, win });
  assert.equal(r.suggested, main);
  assert.deepEqual(r.others[0], { path: apps, from: 'holds 3 folders you worked in' });
  assert.ok(!r.others.some((o) => o.path.startsWith(apps + path.sep)), 'the folders inside it are not listed one by one');
});

test('a setup already on this computer is offered when its program is installed and no company uses it', () => {
  const { user } = computer('existing');
  mk(user, '.claude'); mk(user, '.codex');
  const all = { claude: '2.1.0', codex: '0.163.0', grok: '1.0.70' };
  assert.deepEqual(existingHomes({ userHome: user, installed: all }), { claude: path.join(user, '.claude'), codex: path.join(user, '.codex') });
  assert.deepEqual(existingHomes({ userHome: user, installed: { claude: '2.1.0' } }), { claude: path.join(user, '.claude') }, 'Codex not installed');
  assert.deepEqual(existingHomes({ userHome: user, installed: all, taken: [path.join(user, '.claude').toLowerCase()] }), { codex: path.join(user, '.codex') }, 'a company uses ~/.claude already');
});
