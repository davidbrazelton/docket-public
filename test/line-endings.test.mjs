// The line-ending guard (#1114): many lines changed only in their ending stop a commit, real edits do not.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { endingRewrites, message, LIMIT } from '../scripts/line-endings.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const git = (cwd, ...args) => spawnSync('git', args, { cwd, encoding: 'utf8' });
const hasGit = !git(root, '--version').error;

// A scratch repo with one committed file of `n` CRLF lines and a few LF ones, like index.html.
function repo(n = 100) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'docket-eol-'));
  git(dir, 'init', '-q');
  git(dir, 'config', 'core.autocrlf', 'false');
  const lines = Array.from({ length: n }, (_, i) => `line ${i}${i % 10 ? '\r\n' : '\n'}`);
  fs.writeFileSync(path.join(dir, 'page.html'), lines.join(''));
  git(dir, 'add', '.');
  git(dir, '-c', 'user.name=T', '-c', 'user.email=t@example.com', 'commit', '-q', '--no-verify', '-m', 'one');
  return { dir, lines, write: (text) => fs.writeFileSync(path.join(dir, 'page.html'), text) };
}

test('stripping every CR is caught, naming the file', { skip: !hasGit }, () => {
  const r = repo();
  try {
    r.write(r.lines.join('').replace(/\r\n/g, '\n').replace('line 5', 'line five'));
    git(r.dir, 'add', '.');
    const found = endingRewrites(r.dir);
    assert.deepEqual(found, [{ file: 'page.html', lines: 89 }]);
    const text = message(found);
    assert.match(text, /page\.html: 89 lines/);
    assert.match(text, /newline=''/);
    assert.match(text, /git checkout origin\/master -- <file>/);
  } finally { fs.rmSync(r.dir, { recursive: true, force: true }); }
});

test('turning LF lines into CRLF is caught too', { skip: !hasGit }, () => {
  const r = repo(300); // 30 LF lines
  try {
    r.write(r.lines.join('').replace(/\r?\n/g, '\r\n'));
    git(r.dir, 'add', '.');
    assert.deepEqual(endingRewrites(r.dir), [{ file: 'page.html', lines: 30 }]);
  } finally { fs.rmSync(r.dir, { recursive: true, force: true }); }
});

test('real edits and a few ending changes pass', { skip: !hasGit }, () => {
  const r = repo();
  try {
    const edited = r.lines.map((l, i) => (i < 50 ? l.replace('line', 'row') : l));
    for (let i = 60; i < 60 + LIMIT; i++) edited[i] = edited[i].replace('\r\n', '\n'); // up to the limit is fine
    r.write(edited.join(''));
    git(r.dir, 'add', '.');
    assert.deepEqual(endingRewrites(r.dir), []);
  } finally { fs.rmSync(r.dir, { recursive: true, force: true }); }
});

test('only what is staged counts, and a commit can be given to compare the working tree with', { skip: !hasGit }, () => {
  const r = repo();
  try {
    r.write(r.lines.join('').replace(/\r\n/g, '\n'));
    assert.deepEqual(endingRewrites(r.dir), []);
    assert.equal(endingRewrites(r.dir, ['HEAD'])[0]?.lines, 90);
  } finally { fs.rmSync(r.dir, { recursive: true, force: true }); }
});

test('the command stops a staged rewrite with the message', { skip: !hasGit }, () => {
  const r = repo();
  try {
    r.write(r.lines.join('').replace(/\r\n/g, '\n'));
    git(r.dir, 'add', '.');
    const run = spawnSync(process.execPath, [path.join(root, 'scripts/line-endings.mjs')], { cwd: r.dir, encoding: 'utf8' });
    assert.equal(run.status, 1);
    assert.match(run.stderr, /Commit stopped\. Line endings rewritten by accident/);
    assert.match(run.stderr, /page\.html: 90 lines/);
  } finally { fs.rmSync(r.dir, { recursive: true, force: true }); }
});

const hook = path.join(root, '.githooks/pre-commit'); // left out of the public copy
test('the pre-commit hook runs the guard', { skip: !fs.existsSync(hook) }, () => {
  assert.match(fs.readFileSync(hook, 'utf8'), /node scripts\/line-endings\.mjs \|\| exit 1/);
});

// For computers without the hook turned on: this branch's changes since master, committed or not.
test('this branch rewrites no line endings by accident', { skip: !hasGit }, (t) => {
  const base = git(root, 'merge-base', 'HEAD', 'origin/master');
  if (base.status !== 0) return t.skip('no origin/master to compare with');
  const found = endingRewrites(root, [base.stdout.trim()]);
  assert.deepEqual(found, [], message(found));
});
