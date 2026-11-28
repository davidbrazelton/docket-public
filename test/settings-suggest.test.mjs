// Tests for settings-suggest.mjs: a settings change a session proposes and the person applies (#1239). Run with: npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { settingsTargets, findTarget, mergePatch, settingsError, propose, lineDiff, applySettings, hashText } from '../settings-suggest.mjs';

test('targets are the settings files of the layers the desk loads, named by layer or path', () => {
  const home = path.resolve('/h'), cwd = path.resolve('/w');
  const all = settingsTargets({ home, cwd });
  assert.deepEqual(all.map((t) => t.layer), ['user', 'user', 'project', 'local']);
  assert.equal(findTarget(all, 'user').file, path.join(home, 'settings.json'));
  assert.equal(findTarget(all, 'local').file, path.join(cwd, '.claude', 'settings.local.json'));
  assert.equal(findTarget(all, path.join(home, 'settings.local.json')).layer, 'user');
  assert.equal(findTarget(all, path.join(home, 'other.json')), null, 'nothing else can be written');
  assert.equal(findTarget(all, 'settings.json'), null, 'a relative path is not a target');
  const userOnly = settingsTargets({ home, cwd, sources: ['user'] });
  assert.equal(findTarget(userOnly, 'project'), null, 'a layer the desk does not load');
  assert.equal(settingsTargets({ home, cwd: '' }).length, 2);
});

test('merge patch: objects merge, null takes out, lists replace', () => {
  const cur = { a: 1, permissions: { allow: ['Read'], deny: ['Bash(rm:*)'] }, env: { X: '1' } };
  assert.deepEqual(mergePatch(cur, { permissions: { allow: ['Read', 'Edit'] }, env: null, b: 2 }),
    { a: 1, permissions: { allow: ['Read', 'Edit'], deny: ['Bash(rm:*)'] }, b: 2 });
  assert.deepEqual(cur.permissions.allow, ['Read'], 'the original is left as it was');
});

test('settings are checked before a card is shown', () => {
  assert.equal(settingsError({ permissions: { allow: ['Bash(git status)'] }, hooks: { PreToolUse: [] } }), '');
  assert.match(settingsError([]), /JSON object/);
  assert.match(settingsError({ permissions: [] }), /"permissions" is an object/);
  assert.match(settingsError({ permissions: { deny: 'Bash' } }), /list of rules/);
  assert.match(settingsError({ permissions: { allow: ['not a rule!'] } }), /permissions\.allow/);
  assert.match(settingsError({ hooks: { Stop: {} } }), /hooks\.Stop/);
  assert.match(propose({ json: '{ nope' }).error, /Not valid JSON/);
  assert.match(propose({ currentText: '{ broken', json: '{}' }).error, /not valid JSON/);
  assert.match(propose({ currentText: '{"a":1}', json: '{"a":1}' }).error, /changes nothing/);
});

test('a proposal shows the diff against the file as it is', () => {
  const currentText = JSON.stringify({ model: 'x', permissions: { allow: ['Read'] } }, null, 2) + '\n';
  const p = propose({ currentText, json: '{"permissions":{"allow":["Read","Edit"]},"autoMode":{"allow":["x"]}}', merge: true });
  assert.equal(p.error, undefined);
  assert.deepEqual(JSON.parse(p.nextText), { model: 'x', permissions: { allow: ['Read', 'Edit'] }, autoMode: { allow: ['x'] } });
  assert.equal(p.base, hashText(currentText));
  assert.ok(p.diff.some((d) => d[0] === '+' && d[1].includes('"Edit"')));
  assert.ok(p.diff.some((d) => d[0] === '-' && d[1].trim() === '"Read"'), 'the line that is no longer last in its list');
  assert.equal(p.removed, p.diff.filter((d) => d[0] === '-').length);
  const fresh = propose({ json: '{"env":{"A":"1"}}' });
  assert.ok(fresh.diff.every((d) => d[0] === '+'), 'a new file is all added');
});

test('the diff keeps a few lines round each change and folds the rest', () => {
  const a = Array.from({ length: 20 }, (_, i) => `l${i}`).join('\n'), b = a.replace('l10', 'L10');
  const d = lineDiff(a, b, 2);
  assert.deepEqual(d, [['…', ''], [' ', 'l8'], [' ', 'l9'], ['-', 'l10'], ['+', 'L10'], [' ', 'l11'], [' ', 'l12'], ['…', '']]);
});

test('apply keeps a backup, writes the file, and refuses when the file changed meanwhile', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'docket-ssug-'));
  try {
    const file = path.join(dir, 'settings.json');
    fs.writeFileSync(file, '{"a":1}');
    const p = propose({ currentText: '{"a":1}', json: '{"b":2}', merge: true });
    const r = applySettings({ file, nextText: p.nextText, base: p.base }, new Date('2026-11-24T10:20:30Z'));
    assert.equal(r.ok, true);
    assert.equal(r.backup, `${file}.bak-20261124-102030`);
    assert.equal(fs.readFileSync(r.backup, 'utf8'), '{"a":1}');
    assert.deepEqual(JSON.parse(fs.readFileSync(file, 'utf8')), { a: 1, b: 2 });
    const again = applySettings({ file, nextText: p.nextText, base: p.base });
    assert.equal(again.stale, true, 'the file is no longer what was proposed against');
    const nf = path.join(dir, '.claude', 'settings.local.json'), q = propose({ json: '{"x":1}' });
    const made = applySettings({ file: nf, nextText: q.nextText, base: q.base });
    assert.equal(made.ok, true); assert.equal(made.backup, '', 'nothing to back up');
    assert.deepEqual(JSON.parse(fs.readFileSync(nf, 'utf8')), { x: 1 });
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
