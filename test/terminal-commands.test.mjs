// Claude Code's terminal menus typed in a Docket chat (#1234): which ones Docket takes over, the / list's rows for them,
// and the rules the /permissions dialog writes.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { termCommand, termEntry, termRows, typedCommand, termNote, ruleError, TERMINAL_COMMANDS } from '../terminal-commands.mjs';
import { readRules, setRules, editRules, readDeny } from '../switches.mjs';

test('the command typed is the first word after /', () => {
  assert.equal(typedCommand('/permissions'), 'permissions');
  assert.equal(typedCommand('/Model opus'), 'model');
  assert.equal(typedCommand('/mcp\nmore'), 'mcp');
  assert.equal(typedCommand('hello /permissions'), '');
  assert.equal(typedCommand('/ permissions'), '');
  assert.equal(typedCommand('/plugin:skill do it'), ''); // a plugin's skill, never the /plugin menu
});

test('Docket takes over the menus, never what the session runs itself', () => {
  assert.equal(termCommand('permissions').open, 'permissions');
  assert.equal(termCommand('allowed-tools').name, 'permissions'); // another name for it
  assert.equal(termCommand('model').open, 'model');
  assert.equal(termCommand('mcp').open, 'mcp');
  assert.equal(termCommand('memory').open, 'inspector:memory');
  assert.equal(termCommand('memory').remote, false);
  assert.equal(termCommand('hooks').open, 'inspector:hooks');
  assert.equal(termCommand('config').open, 'inspector:switches');
  assert.equal(termCommand('frobnicate'), null); // not a menu Docket knows, and the session did not call it a terminal one
  assert.deepEqual(termCommand('vim'), { instead: '', name: 'vim' });
  assert.equal(termCommand('compact'), null); // the SDK runs these
  assert.equal(termCommand('context', [], ['context']), null);
  // a skill named like a menu is the session's
  assert.equal(termCommand('hooks', ['hooks', 'compact'], []), null);
  // one the session itself says needs a terminal is Docket's, with a note when there is no view
  assert.equal(termCommand('hooks', ['hooks'], ['hooks']).open, 'inspector:hooks');
  assert.deepEqual(termCommand('statusline', ['statusline'], ['statusline']), { name: 'statusline', instead: '' });
  assert.ok(termCommand('clear').instead);
  for (const [n, e] of Object.entries(TERMINAL_COMMANDS)) {
    const t = termEntry(n);
    assert.ok(t && (t.open ? t.what : typeof t.instead === 'string'), n);
  }
});

test('the / list gets one row per command Docket takes over, marked', () => {
  const rows = termRows(['compact', 'hooks', 'statusline'], ['statusline']);
  const by = Object.fromEntries(rows.map((r) => [r.name, r]));
  assert.equal(by.permissions.view, 'open');
  assert.match(by.permissions.detail, /Permissions dialog/);
  assert.equal(by.clear.view, 'note');
  assert.equal(by.statusline.view, 'note');
  assert.equal(by.hooks, undefined); // the session runs its own hooks command
  assert.equal(by.compact, undefined);
});

test('the note says it only works in a terminal, and what to use', () => {
  assert.match(termNote(termCommand('clear')), /^\/clear .*only works in Claude Code in a terminal.*Instead, start a fresh conversation with \+ New session/);
  assert.match(termNote({ name: 'vim', instead: '' }), /Docket has nothing in its place\.$/);
});

test('a rule is a tool name with what it applies to in brackets', () => {
  for (const r of ['Bash', 'Bash(npm run test:*)', 'Edit(src/**)', 'WebFetch(domain:example.com)', 'mcp__server__tool', 'mcp__server__*', 'Read(//c/Work/a b/**)']) assert.equal(ruleError(r), '', r);
  for (const r of ['', '  ', 'two words', 'Bash(\nx)', '(x)', 'x'.repeat(501)]) assert.ok(ruleError(r), JSON.stringify(r));
});

test('allow and ask lists are written like the deny list, leaving the rest of the file as it was', () => {
  const text = '{\r\n  "model": "opus",\r\n  "permissions": {\r\n    "deny": [\r\n      "WebFetch"\r\n    ]\r\n  }\r\n}\r\n';
  const out = setRules(text, ['Bash(git status)'], 'allow');
  assert.deepEqual(JSON.parse(out), { model: 'opus', permissions: { deny: ['WebFetch'], allow: ['Bash(git status)'] } });
  assert.ok(out.includes('"model": "opus",\r\n')); // untouched lines keep their endings
  assert.deepEqual(readRules(out, 'allow'), ['Bash(git status)']);
  assert.deepEqual(readDeny(out), ['WebFetch']);
  assert.deepEqual(JSON.parse(setRules('', ['Edit'], 'ask')), { permissions: { ask: ['Edit'] } });
});

test('editRules makes the folder\'s .claude when it is not there yet', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'docket-perm-'));
  try {
    const file = path.join(dir, '.claude', 'settings.local.json');
    editRules(file, (l) => [...l, 'Bash(npm test)'], 'allow');
    assert.deepEqual(JSON.parse(fs.readFileSync(file, 'utf8')), { permissions: { allow: ['Bash(npm test)'] } });
    editRules(file, (l) => l.filter((x) => x !== 'Bash(npm test)'), 'allow');
    assert.deepEqual(JSON.parse(fs.readFileSync(file, 'utf8')), { permissions: { allow: [] } });
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
