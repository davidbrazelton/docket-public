// The Auto mode rules Docket passes each Claude session (#1262): "$defaults" first unless the user dropped the built-in
// rules on purpose, merged after a gateway's own settings layer, and the user's settings.json read as Claude Code reads it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DOCKET_AUTO_MODE, docketAutoMode, withAutoMode, userAutoMode } from '../automode-settings.mjs';

test('with no user lists, each Docket list starts with $defaults', () => {
  for (const user of [undefined, null, {}, { allow: [] }]) {
    const a = docketAutoMode(user);
    assert.deepEqual(a.allow, ['$defaults', ...DOCKET_AUTO_MODE.allow]);
    assert.deepEqual(a.environment, ['$defaults', ...DOCKET_AUTO_MODE.environment]);
  }
});

test('a user list that has $defaults still gets $defaults (a second one is harmless)', () => {
  const a = docketAutoMode({ allow: ['$defaults', 'my own rule'] });
  assert.equal(a.allow[0], '$defaults');
  assert.equal(a.environment[0], '$defaults');
});

test('a non-empty user list without $defaults keeps the built-ins dropped, for that key only', () => {
  const a = docketAutoMode({ allow: ['only my rule'], environment: [] });
  assert.deepEqual(a.allow, DOCKET_AUTO_MODE.allow);
  assert.equal(a.environment[0], '$defaults');
});

test('Docket names only its own tools and safe cleanup, never --force', () => {
  const all = [...DOCKET_AUTO_MODE.allow, ...DOCKET_AUTO_MODE.environment].join(' ');
  assert.match(all, /mcp__portal__/);
  assert.match(all, /git worktree remove \(no --force\)/);
  assert.match(all, /git branch -d/);
});

test('a gateway settings layer keeps its own keys and gets autoMode added', () => {
  const gw = { apiKeyHelper: 'lite token', env: { X: '1' } };
  const s = withAutoMode(gw, docketAutoMode({}));
  assert.equal(s.apiKeyHelper, 'lite token');
  assert.deepEqual(s.env, { X: '1' });
  assert.deepEqual(s.autoMode.allow, ['$defaults', ...DOCKET_AUTO_MODE.allow]);
  assert.equal(gw.autoMode, undefined); // not changed in place
});

test('autoMode lists already in the layer come first, with one $defaults', () => {
  const s = withAutoMode({ autoMode: { allow: ['$defaults', 'gateway rule'], soft_deny: ['x'] } }, docketAutoMode({}));
  assert.deepEqual(s.autoMode.allow, ['$defaults', 'gateway rule', ...DOCKET_AUTO_MODE.allow]);
  assert.deepEqual(s.autoMode.soft_deny, ['x']);
});

test('no gateway: the layer is just autoMode', () => {
  assert.deepEqual(Object.keys(withAutoMode(undefined, docketAutoMode({}))), ['autoMode']);
});

test("userAutoMode reads the home's settings.json, and counts it empty when the user layer is off", () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'automode-'));
  try {
    assert.deepEqual(userAutoMode(home), {});
    fs.writeFileSync(path.join(home, 'settings.json'), '{ not json');
    assert.deepEqual(userAutoMode(home), {});
    fs.writeFileSync(path.join(home, 'settings.json'), JSON.stringify({ autoMode: { allow: ['mine'] } }));
    assert.deepEqual(userAutoMode(home), { allow: ['mine'] });
    assert.deepEqual(userAutoMode(home, ['user', 'project']), { allow: ['mine'] });
    assert.deepEqual(userAutoMode(home, ['project', 'local']), {});
  } finally { fs.rmSync(home, { recursive: true, force: true }); }
});
