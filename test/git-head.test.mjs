// Tests for git-head.mjs: a folder's branch read from HEAD gives what `git branch --show-current` does. Run with: npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { currentBranch } from '../git-head.mjs';

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'git-head-'));
const git = (dir, ...args) => execFileSync('git', ['-C', dir, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
const showCurrent = (dir) => git(dir, 'branch', '--show-current');

function repo() {
  const dir = tmp();
  git(dir, 'init', '-q', '-b', 'main');
  git(dir, '-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '--allow-empty', '-m', 'first');
  return dir;
}

test('a repository, a folder inside it, and a branch with a slash', async () => {
  const dir = repo();
  fs.mkdirSync(path.join(dir, 'a', 'b'), { recursive: true });
  assert.equal(await currentBranch(dir), 'main');
  assert.equal(await currentBranch(path.join(dir, 'a', 'b')), 'main');
  git(dir, 'checkout', '-q', '-b', 'feature/ABC-1-x');
  assert.equal(await currentBranch(dir), showCurrent(dir));
  assert.equal(await currentBranch(dir), 'feature/ABC-1-x');
});

test('a worktree reads its own HEAD, through its .git file', async () => {
  const dir = repo(), wt = path.join(tmp(), 'wt');
  git(dir, 'worktree', 'add', '-q', '-b', 'side', wt);
  assert.equal(await currentBranch(wt), 'side');
  assert.equal(await currentBranch(wt), showCurrent(wt));
  assert.equal(await currentBranch(dir), 'main');
});

test('detached HEAD is no branch; a missing folder is null', async () => {
  const dir = repo();
  git(dir, 'checkout', '-q', '--detach');
  assert.equal(await currentBranch(dir), '');
  assert.equal(await currentBranch(dir), showCurrent(dir));
  assert.equal(await currentBranch(path.join(dir, 'not-there')), null);
});
