// Measuring the instruction files Claude Code sends again on every resume (#1021).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { importRefs, foldersUp, measureInstructions, sentInstructions, tooLong, sizeText, summary, explain, fixBrief, resumeRisk, staleWorktrees, parseWorktrees, goneBranches, worktreeFacts, INSTR_LIMIT } from '../instructions-size.mjs';
import { importTarget, fileKey } from '../platform.mjs';
import { execFile } from 'node:child_process';

// A made-up disk: path -> text, with Windows paths matched without regard to case.
const disk = (files, platform) => {
  const m = new Map(Object.entries(files).map(([k, v]) => [fileKey(k, platform), v]));
  return (f) => m.get(fileKey(f, platform)) ?? null;
};
const big = (n) => 'x'.repeat(n);

test('importRefs: @paths at a line start or after a space, not in code, not an email', () => {
  const text = '@CURRENT_STATE.md\nSee @docs/rules.md, and @~/shared.md.\nMail a@b.com\n`@not/this.md`\n```\n@nor/this.md\n```\n@../../standards/BRAIN.md';
  assert.deepEqual(importRefs(text), ['CURRENT_STATE.md', 'docs/rules.md', '~/shared.md', '../../standards/BRAIN.md']);
});

test('importTarget on Windows: relative to the importing file, ~/ from home, a path from / on the same drive', () => {
  const from = 'C:\\Acme\\apps\\leads\\CLAUDE.md', o = { home: 'C:\\Users\\pat', platform: 'win32' };
  assert.equal(importTarget('CURRENT_STATE.md', from, o), 'C:\\Acme\\apps\\leads\\CURRENT_STATE.md');
  assert.equal(importTarget('../../standards/BRAIN.md', from, o), 'C:\\Acme\\standards\\BRAIN.md');
  assert.equal(importTarget('/Acme/standards/BRAIN.md', 'D:\\home\\CLAUDE.md', o), 'D:\\Acme\\standards\\BRAIN.md');
  assert.equal(importTarget('~/notes.md', from, o), 'C:\\Users\\pat\\notes.md');
  assert.equal(importTarget('E:/x/y.md', from, o), 'E:\\x\\y.md');
});

test('importTarget on a Mac: relative, ~/ and from the root', () => {
  const from = '/Users/pat/apps/leads/CLAUDE.md', o = { home: '/Users/pat', platform: 'darwin' };
  assert.equal(importTarget('CURRENT_STATE.md', from, o), '/Users/pat/apps/leads/CURRENT_STATE.md');
  assert.equal(importTarget('../shared/a.md', from, o), '/Users/pat/apps/shared/a.md');
  assert.equal(importTarget('/opt/rules.md', from, o), '/opt/rules.md');
  assert.equal(importTarget('~/notes.md', from, o), '/Users/pat/notes.md');
});

test('foldersUp: outermost first, and a git worktree stops at its own root', () => {
  assert.deepEqual(foldersUp('/a/b/c', { platform: 'darwin', worktreeRoot: () => false }), ['/', '/a', '/a/b', '/a/b/c']);
  const wt = 'C:\\repo\\.claude\\worktrees\\x';
  assert.deepEqual(foldersUp(wt + '\\src', { platform: 'win32', worktreeRoot: (d) => d === wt }), [wt, wt + '\\src']);
});

for (const [platform, root, home, desk] of [['win32', 'C:\\Acme\\apps\\leads', 'C:\\Users\\pat', 'C:\\Claude\\desk'], ['darwin', '/Users/pat/apps/leads', '/Users/pat', '/Users/pat/.claude-desk']]) {
  const p = platform === 'win32' ? path.win32 : path.posix;
  test(`measureInstructions on ${platform}: the desk's CLAUDE.md, the folder's, and every import, each once`, () => {
    const read = disk({
      [p.join(desk, 'CLAUDE.md')]: '@~/shared.md',
      [p.join(home, 'shared.md')]: big(100),
      [p.join(root, 'CLAUDE.md')]: 'Rules\n@CURRENT_STATE.md\n@docs/more.md\n@~/shared.md\n@missing.md',
      [p.join(root, 'CURRENT_STATE.md')]: big(900000),
      [p.join(root, 'docs', 'more.md')]: '@../CLAUDE.md\n' + big(50), // a cycle back to CLAUDE.md
      [p.join(root, '.claude', 'CLAUDE.md')]: big(10),
      [p.join(root, 'CLAUDE.local.md')]: big(20),
    }, platform);
    const m = measureInstructions({ dir: root, home: desk, userHome: home, platform, read, worktreeRoot: () => false });
    const names = m.files.map((f) => p.basename(f.path));
    assert.deepEqual(names, ['CLAUDE.md', 'shared.md', 'CLAUDE.md', 'CURRENT_STATE.md', 'more.md', 'CLAUDE.md', 'CLAUDE.local.md']);
    assert.equal(m.files.filter((f) => p.basename(f.path) === 'shared.md').length, 1, 'shared.md once, though two files import it');
    assert.equal(m.biggest.path, p.join(root, 'CURRENT_STATE.md'));
    assert.equal(m.biggest.by, p.join(root, 'CLAUDE.md'));
    assert.equal(m.files[1].scope, 'user');
    assert.equal(m.files[3].scope, 'project');
    assert.equal(m.total, m.files.reduce((a, f) => a + f.chars, 0));
  });
}

test('measureInstructions: imports stop at the depth cap, and nothing found is an empty measure', () => {
  const read = disk({ '/r/CLAUDE.md': '@a.md', '/r/a.md': '@b.md', '/r/b.md': '@c.md', '/r/c.md': 'end' }, 'linux');
  const m = measureInstructions({ dir: '/r', platform: 'linux', read, worktreeRoot: () => false, depth: 2 });
  assert.deepEqual(m.files.map((f) => f.path), ['/r/CLAUDE.md', '/r/a.md', '/r/b.md']);
  const none = measureInstructions({ dir: '/nothing', platform: 'linux', read: () => null, worktreeRoot: () => false });
  assert.deepEqual(none, { files: [], total: 0, biggest: null });
});

test('measureInstructions on this computer: real files in a temp folder, with a cycle and a missing import', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'instr-'));
  try {
    fs.writeFileSync(path.join(dir, 'CLAUDE.md'), '@STATE.md\n@gone.md\n');
    fs.writeFileSync(path.join(dir, 'STATE.md'), '@CLAUDE.md\n' + big(200000));
    fs.mkdirSync(path.join(dir, 'sub'));
    const m = measureInstructions({ dir: path.join(dir, 'sub'), platform: process.platform, worktreeRoot: (d) => d === dir });
    assert.deepEqual(m.files.map((f) => path.basename(f.path)), ['CLAUDE.md', 'STATE.md']);
    const s = summary(m);
    assert.equal(s.over, true);
    assert.equal(s.biggest.name, 'STATE.md');
    assert.equal(s.biggest.by, 'CLAUDE.md');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('sentInstructions: the last instructions attachment in a log, from lines or entries', () => {
  const lines = [
    JSON.stringify({ type: 'attachment', timestamp: '2026-11-06T19:00:00Z', attachment: { type: 'instructions', files: [{ path: 'C:\\a\\CLAUDE.md', type: 'Project', content: big(10) }] } }),
    JSON.stringify({ type: 'user', message: { content: 'hi' } }),
    'not json "instructions"',
    JSON.stringify({ type: 'attachment', timestamp: '2026-11-06T19:55:39Z', attachment: { type: 'instructions', changed: true, reason: 'session_start', files: [{ path: 'C:\\a\\CLAUDE.md', content: big(81128) }, { path: 'C:\\a\\CURRENT_STATE.md', content: big(894536) }] } }),
  ];
  const s = sentInstructions(lines);
  assert.equal(s.chars, 81128 + 894536);
  assert.equal(s.files.length, 2);
  assert.equal(s.at, Date.parse('2026-11-06T19:55:39Z'));
  assert.equal(sentInstructions([JSON.stringify({ type: 'user' })]), null);
});

test('tooLong, sizeText, resumeRisk', () => {
  assert.ok(tooLong('Prompt is too long'));
  assert.ok(tooLong('API Error: 400 prompt is too long: 1012345 tokens > 1000000 maximum'));
  assert.ok(!tooLong('Output is too long'));
  assert.equal(sizeText(945000), '923 KB');
  assert.equal(sizeText(2 * 1024 * 1024), '2.0 MB');
  assert.ok(resumeRisk({ tokens: 700000, limit: 967000, chars: 940000 }));
  assert.ok(!resumeRisk({ tokens: 200000, limit: 967000, chars: 940000 }));
  assert.ok(!resumeRisk({ tokens: 700000, limit: 0, chars: 940000 }), 'no limit known: no warning');
});

test('explain names the biggest file and what pulled it in; a small set is not blamed', () => {
  const m = { files: [{ path: 'C:\\a\\CLAUDE.md', chars: 81000, by: null, scope: 'project' }, { path: 'C:\\a\\CURRENT_STATE.md', chars: 945000, by: 'C:\\a\\CLAUDE.md', scope: 'project' }], total: 1026000 };
  m.biggest = m.files[1];
  assert.match(explain(summary(m)), /^`CURRENT_STATE\.md` \(923 KB\), pulled in by `CLAUDE\.md`, is sent again on every resume/);
  const small = { files: [{ path: '/a/CLAUDE.md', chars: 20000, by: null, scope: 'project' }], total: 20000 };
  small.biggest = small.files[0];
  assert.match(explain(summary(small)), /not the cause/);
});

test('fixBrief lists the project files biggest first and asks for a pull request, not an edit to main', () => {
  const m = { files: [{ path: '/desk/CLAUDE.md', chars: 30, by: null, scope: 'user' }, { path: '/a/CLAUDE.md', chars: 81000, by: null, scope: 'project' }, { path: '/a/CURRENT_STATE.md', chars: 945000, by: '/a/CLAUDE.md', scope: 'project' }], total: 1026030 };
  m.biggest = m.files[2];
  const b = fixBrief({ repo: '/a', sum: summary(m) });
  assert.ok(b.indexOf('CURRENT_STATE.md: 923 KB (pulled in by CLAUDE.md)') < b.indexOf('/a/CLAUDE.md: 79 KB'));
  assert.ok(!b.includes('/desk/CLAUDE.md'), "the desk's own file is not the repo's to change");
  assert.match(b, /pull request/);
  assert.match(b, /history, changelogs/);
});

test('staleWorktrees: oversized ones while main is not, removable only when clean, gone upstream and not in use', () => {
  const ok = { branch: 'x', total: 940000, clean: true, gone: true, inUse: false };
  const wts = [{ ...ok, path: 'a' }, { ...ok, path: 'b', gone: false }, { ...ok, path: 'c', total: 20000 }, { ...ok, path: 'd', clean: false },
    { ...ok, path: 'e', clean: null }, { ...ok, path: 'f', inUse: true }, { ...ok, path: 'g', branch: '' }];
  const got = staleWorktrees({ main: 22000, worktrees: wts });
  assert.deepEqual(got.map((w) => [w.path, w.removable]), [['a', true], ['b', false], ['d', false], ['e', false], ['f', false], ['g', false]], 'c is not oversized: not listed');
  assert.equal(got[0].why, '');
  assert.match(got[1].why, /not gone/);
  assert.match(got[2].why, /not in a git commit/);
  assert.match(got[3].why, /could not say/);
  assert.match(got[4].why, /session/);
  assert.match(got[5].why, /no branch/);
  assert.deepEqual(staleWorktrees({ main: INSTR_LIMIT + 1, worktrees: wts }), [], 'main oversized too: fix main first');
});

test('parseWorktrees and goneBranches read git output', () => {
  const list = 'worktree C:/r\nHEAD 1\nbranch refs/heads/main\n\nworktree C:/r/.claude/worktrees/x\nHEAD 2\nbranch refs/heads/spec/x\n\nworktree C:/r/w2\nHEAD 3\ndetached\n';
  assert.deepEqual(parseWorktrees(list), [{ path: 'C:/r', branch: 'main', main: true, prunable: false }, { path: 'C:/r/.claude/worktrees/x', branch: 'spec/x', main: false, prunable: false }, { path: 'C:/r/w2', branch: '', main: false, prunable: false }]);
  assert.deepEqual([...goneBranches('a|[gone]\nb|\nc|[ahead 1]\nspec/x|[gone]\n')], ['a', 'spec/x']);
});

// Real git: a repo with a local bare repo as its GitHub, and worktrees in each state the Recycle Bin check must tell apart.
const gitEnv = { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t', GIT_TERMINAL_PROMPT: '0' };
const git = (dir, args) => new Promise((resolve) => execFile('git', ['-C', dir, ...args], { env: gitEnv, windowsHide: true }, (e, out) => resolve(e ? null : String(out))));
const must = async (dir, ...args) => { const out = await git(dir, args); assert.notEqual(out, null, `git ${args.join(' ')} failed in ${dir}`); return out; };

test('worktreeFacts with real git: only a clean worktree whose branch is gone upstream may be recycled', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'instr-wt-'));
  try {
    const remote = path.join(root, 'remote.git'), repo = path.join(root, 'repo');
    await must(root, 'init', '-q', '--bare', remote);
    await must(root, 'init', '-q', '-b', 'main', repo);
    fs.writeFileSync(path.join(repo, 'CLAUDE.md'), 'rules\n');
    fs.writeFileSync(path.join(repo, '.gitignore'), 'build/\n');
    await must(repo, 'add', '.'); await must(repo, 'commit', '-qm', 'init');
    await must(repo, 'remote', 'add', 'origin', remote); await must(repo, 'push', '-q', '-u', 'origin', 'main');
    const wt = (n) => path.join(root, n);
    // A branch merged through a pull request: pushed with a git commit of its own, then its remote branch deleted.
    const merged = async (n) => {
      await must(repo, 'worktree', 'add', '-q', '-b', n, wt(n));
      fs.writeFileSync(path.join(wt(n), `${n}.txt`), n); await must(wt(n), 'add', '.'); await must(wt(n), 'commit', '-qm', n);
      await must(wt(n), 'push', '-q', '-u', 'origin', n); await must(repo, 'push', '-q', 'origin', '--delete', n);
    };
    await merged('done');                                  // clean and gone: may go
    await merged('edited'); fs.appendFileSync(path.join(wt('edited'), 'CLAUDE.md'), 'more\n');           // an edit not in a git commit
    await merged('untracked'); fs.writeFileSync(path.join(wt('untracked'), 'notes.md'), 'draft');        // an untracked file
    await merged('ignored'); fs.mkdirSync(path.join(wt('ignored'), 'build')); fs.writeFileSync(path.join(wt('ignored'), 'build', 'out.js'), 'x'); // only an ignored file
    await must(repo, 'worktree', 'add', '-q', '-b', 'fresh', wt('fresh')); // made just now: no git commits of its own, "merged" by ancestry
    await must(repo, 'fetch', '-q', '--prune');
    const facts = await worktreeFacts(repo, git);
    const by = Object.fromEntries(facts.filter((w) => !w.main).map((w) => [w.branch, w]));
    assert.equal(facts[0].main, true);
    const verdict = (b) => staleWorktrees({ main: 10, worktrees: [{ ...by[b], total: 940000, inUse: false }] })[0];
    assert.deepEqual(Object.fromEntries(['done', 'edited', 'untracked', 'ignored', 'fresh'].map((b) => [b, verdict(b).removable])),
      { done: true, edited: false, untracked: false, ignored: true, fresh: false });
    assert.match(verdict('edited').why, /not in a git commit/);
    assert.match(verdict('untracked').why, /not in a git commit/);
    assert.match(verdict('fresh').why, /not gone/);
    assert.equal(by.fresh.clean, true, 'the fresh one is clean: only its branch keeps it');
    // A worktree git cannot read counts as not clean.
    const broken = await worktreeFacts(repo, (dir, args) => args[0] === 'status' ? Promise.resolve(null) : git(dir, args));
    assert.equal(broken.find((w) => w.branch === 'done').clean, null);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
