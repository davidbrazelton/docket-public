// Tests for how an update is taken when GitHub's master is not a fast-forward (#1126): a public-copy install with
// nothing of its own is moved onto a republished master; local commits, edits or a private clone still skip.
// Run with: npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { updateWay, updateFacts, PUBLISH_IDENTITY } from '../update-mode.mjs';

const hasGit = spawnSync('git', ['--version']).status === 0;
const published = { author: PUBLISH_IDENTITY, committer: PUBLISH_IDENTITY };
const someone = 'Pat Example <pat@example.com>';

test('a fast-forward is merged, unless there are edits', () => {
  assert.equal(updateWay({ fastForward: true, publicCopy: false }).way, 'merge');
  const d = updateWay({ fastForward: true, publicCopy: false, dirty: ' M server.mjs' });
  assert.equal(d.way, 'skip'); assert.match(d.why, /edits that are not in a git commit/);
});

test('a republished public copy with nothing of this computer\'s is moved onto', () => {
  const r = updateWay({ fastForward: false, publicCopy: true, theirs: PUBLISH_IDENTITY, local: [published, published] });
  assert.equal(r.way, 'reset'); assert.match(r.why, /published afresh/);
});

test('a public copy with a commit made here, edits, or a master not from the publish is left alone', () => {
  const own = updateWay({ fastForward: false, publicCopy: true, theirs: PUBLISH_IDENTITY, local: [published, { author: someone, committer: someone }] });
  assert.equal(own.way, 'skip'); assert.match(own.why, /1 of them was made on this computer \(by Pat Example/);
  const recommitted = updateWay({ fastForward: false, publicCopy: true, theirs: PUBLISH_IDENTITY, local: [{ author: PUBLISH_IDENTITY, committer: someone }] });
  assert.equal(recommitted.way, 'skip', 'a published commit amended or rebased here is this computer\'s');
  assert.equal(updateWay({ fastForward: false, publicCopy: true, dirty: ' M index.html', theirs: PUBLISH_IDENTITY, local: [published] }).way, 'skip');
  const stranger = updateWay({ fastForward: false, publicCopy: true, theirs: someone, local: [published] });
  assert.equal(stranger.way, 'skip'); assert.match(stranger.why, /not the Docket publish/);
});

test('a clone of the private repo only ever fast-forwards', () => {
  const r = updateWay({ fastForward: false, publicCopy: false, theirs: PUBLISH_IDENTITY, local: [published] });
  assert.equal(r.way, 'skip'); assert.match(r.why, /not a fast-forward\. Sort it out by hand\./);
});

// A stand-in public repo and an install cloned from it, in a scratch folder. Commits are by the publish identity
// unless `by` says otherwise; each publish is a fresh parentless commit, as publish/build.mjs makes them.
function setup({ files = { 'server.mjs': 'one\n' } } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'docket-update-'));
  const origin = path.join(dir, 'origin.git'), work = path.join(dir, 'work'), install = path.join(dir, 'install');
  const run = (cwd, args, by = PUBLISH_IDENTITY) => {
    const [, name, email] = by.match(/^(.*) <(.*)>$/);
    const env = { ...process.env, GIT_AUTHOR_NAME: name, GIT_AUTHOR_EMAIL: email, GIT_COMMITTER_NAME: name, GIT_COMMITTER_EMAIL: email };
    const r = spawnSync('git', args, { cwd, env, encoding: 'utf8' });
    return { code: r.status, out: `${r.stdout}${r.stderr}` };
  };
  run(dir, ['init', '-q', '--bare', origin]);
  run(dir, ['init', '-q', '-b', 'master', work]);
  const publish = (content) => {
    run(work, ['checkout', '-q', '--orphan', 'next']);
    run(work, ['rm', '-q', '-rf', '--cached', '.']);
    for (const [f, text] of Object.entries(content)) { fs.mkdirSync(path.dirname(path.join(work, f)), { recursive: true }); fs.writeFileSync(path.join(work, f), text); run(work, ['add', f]); }
    run(work, ['commit', '-q', '-m', 'Docket x']);
    run(work, ['push', '-q', '--force', origin, 'next:master']);
    run(work, ['checkout', '-q', '-B', 'master']); run(work, ['branch', '-q', '-D', 'next']);
  };
  publish(files);
  run(dir, ['clone', '-q', origin, install]);
  const git = (args) => Promise.resolve(run(install, args));
  const facts = async () => {
    run(install, ['fetch', '-q', 'origin', 'master']);
    const head = run(install, ['rev-parse', 'HEAD']).out.trim(), theirs = run(install, ['rev-parse', 'FETCH_HEAD']).out.trim();
    return updateFacts(git, head, theirs);
  };
  return { install, run, publish, facts, done: () => fs.rmSync(dir, { recursive: true, force: true }) };
}

test('with git: a clean install of a republished public copy resets onto it', { skip: !hasGit }, async () => {
  const s = setup();
  try {
    s.publish({ 'server.mjs': 'two\n' });
    const f = await s.facts();
    assert.equal(f.fastForward, false); assert.equal(f.publicCopy, true); assert.equal(f.dirty, '');
    assert.equal(updateWay(f).way, 'reset');
  } finally { s.done(); }
});

test('with git: a commit made on the install, or an edit, keeps it where it is', { skip: !hasGit }, async () => {
  const s = setup();
  try {
    s.publish({ 'server.mjs': 'two\n' });
    fs.writeFileSync(path.join(s.install, 'server.mjs'), 'mine\n');
    const edited = updateWay(await s.facts());
    assert.equal(edited.way, 'skip'); assert.match(edited.why, /server\.mjs/);
    s.run(s.install, ['commit', '-q', '-am', 'my change'], someone);
    const committed = updateWay(await s.facts());
    assert.equal(committed.way, 'skip'); assert.match(committed.why, /made on this computer/);
  } finally { s.done(); }
});

test('with git: a clone with publish/ (the private repo) never resets', { skip: !hasGit }, async () => {
  const s = setup({ files: { 'server.mjs': 'one\n', 'publish/exclude.txt': 'CLAUDE.md\n' } });
  try {
    s.publish({ 'server.mjs': 'two\n', 'publish/exclude.txt': 'CLAUDE.md\n' });
    const f = await s.facts();
    assert.equal(f.publicCopy, false);
    assert.equal(updateWay(f).way, 'skip');
  } finally { s.done(); }
});

test('with git: an ordinary new commit on top is still a fast-forward', { skip: !hasGit }, async () => {
  const s = setup();
  try {
    const origin = path.join(path.dirname(s.install), 'origin.git'), work = path.join(path.dirname(s.install), 'work');
    fs.writeFileSync(path.join(work, 'server.mjs'), 'two\n');
    s.run(work, ['commit', '-q', '-am', 'Docket y']);
    s.run(work, ['push', '-q', origin, 'master']);
    const f = await s.facts();
    assert.equal(f.fastForward, true);
    assert.equal(updateWay(f).way, 'merge');
  } finally { s.done(); }
});
