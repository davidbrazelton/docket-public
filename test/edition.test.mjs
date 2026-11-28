// Tests for the two public copies on an install (#1155): which copy it is (edition.json), and the one time an update
// waits for the person: a Labs install about to go local-first asks Keep everything or Go local-first, before the
// update, or just after it when the computer missed the chance to ask first. Run with: npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { parseEdition, editionStep, lateHandover } from '../update-mode.mjs';

const hasGit = spawnSync('git', ['--version']).status === 0;
const labs = { edition: 'labs', name: 'Docket Labs', repo: 'pat/docket-labs', other: { edition: 'local', repo: 'pat/docket' } };
const local = { edition: 'local', name: 'Docket', repo: 'pat/docket', other: { edition: 'labs', name: 'Docket Labs', repo: 'pat/docket-labs' } };

test('edition.json is read only when it names one of the two copies', () => {
  assert.deepEqual(parseEdition(JSON.stringify(local)), local);
  assert.equal(parseEdition(''), null, 'a clone of the private repo has none');
  assert.equal(parseEdition('fatal: path does not exist'), null);
  assert.equal(parseEdition('{"edition":"other"}'), null);
});

test('only a Labs install meeting a local-first update waits, until the person picks local-first', () => {
  assert.equal(editionStep({ own: labs, incoming: local }), 'ask');
  assert.equal(editionStep({ own: labs, incoming: local, choice: 'local' }), 'take');
  assert.equal(editionStep({ own: labs, incoming: local, choice: 'labs' }), 'ask', 'a move to Labs that did not happen asks again');
  assert.equal(editionStep({ own: labs, incoming: labs }), 'take');
  assert.equal(editionStep({ own: local, incoming: local }), 'take');
  assert.equal(editionStep({ own: local, incoming: labs }), 'take', 'Keep everything after the update: back to Labs');
  assert.equal(editionStep({ own: null, incoming: null }), 'take', 'a clone of the private repo');
  assert.equal(editionStep({ own: null, incoming: local }), 'take');
});

// A folder whose history is: before (edition.json of that commit, or none), then a local-first commit, as an old
// updater leaves it (git reset --hard onto the new master, so HEAD@{1} is the commit before).
function install(before) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'docket-edition-'));
  const g = (...a) => spawnSync('git', a, { cwd: dir, encoding: 'utf8' });
  g('init', '-q'); g('config', 'user.name', 'Docket'); g('config', 'user.email', 'docket@noreply.invalid');
  if (before) fs.writeFileSync(path.join(dir, 'edition.json'), JSON.stringify(before)); else fs.writeFileSync(path.join(dir, 'server.mjs'), '');
  g('add', '-A'); g('commit', '-q', '-m', 'before');
  const first = g('rev-parse', 'HEAD').stdout.trim();
  g('checkout', '-q', '--orphan', 'next'); fs.writeFileSync(path.join(dir, 'edition.json'), JSON.stringify(local)); g('add', '-A'); g('commit', '-q', '-m', 'local-first');
  const second = g('rev-parse', 'HEAD').stdout.trim();
  g('checkout', '-q', '-B', 'master', first); g('reset', '-q', '--hard', second);
  const git = async (args) => { const r = spawnSync('git', args, { cwd: dir, encoding: 'utf8' }); return { code: r.status, out: r.stdout + r.stderr }; };
  return { git, done: () => fs.rmSync(dir, { recursive: true, force: true }) };
}

test('a local-first install that came straight from every feature asks once, after the update', { skip: !hasGit }, async () => {
  for (const before of [null, labs]) { // a public tree from before the split, and the bridge
    const i = install(before);
    try {
      assert.deepEqual(await lateHandover(i.git, local), { other: local.other, late: true });
      assert.equal(await lateHandover(i.git, local, 'local'), null, 'not once the person chose');
      assert.equal(await lateHandover(i.git, labs), null, 'a Labs install has nothing to ask');
    } finally { i.done(); }
  }
  const i = install(local);
  try { assert.equal(await lateHandover(i.git, local), null, 'local-first before as well: nothing went'); } finally { i.done(); }
});
