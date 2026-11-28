// Tests for refusal-fix.mjs: what Docket offers on a step Auto mode turned down (#1285). Run with: npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { allowRule, allowPatch, docketCause } from '../refusal-fix.mjs';
import { refusal } from '../hook-notes.mjs';

const DENIED = 'Permission for this action was denied by the Claude Code auto mode classifier. Reason: [Undermining Oversight]. '
  + 'If you believe this is a mistake, the user can add a permission rule for mcp__playwright__browser_snapshot to their settings.';

test('the denial text is read as Auto mode, with its category', () => {
  const r = refusal(DENIED, true);
  assert.equal(r.source, 'auto');
  assert.equal(r.reason, 'Undermining Oversight');
});

test('an MCP tool is allowed by its name', () => {
  assert.equal(allowRule('mcp__playwright__browser_snapshot', { filename: 'x.yml' }), 'mcp__playwright__browser_snapshot');
  assert.equal(allowRule('mcp__claude_ai_Gmail__send', {}), 'mcp__claude_ai_Gmail__send');
});

test('a command is allowed only word for word, and only a short one-line one', () => {
  assert.equal(allowRule('Bash', { command: 'git push origin feat' }), 'Bash(git push origin feat)');
  assert.equal(allowRule('PowerShell', { command: 'Get-ChildItem C:/x' }), 'PowerShell(Get-ChildItem C:/x)');
  assert.equal(allowRule('Bash', { command: 'a\nb' }), '');
  assert.equal(allowRule('Bash', { command: 'echo $(whoami)' }), '');
  assert.equal(allowRule('Bash', { command: 'x'.repeat(301) }), '');
  assert.equal(allowRule('Bash', {}), '');
});

test('a web fetch is allowed for its site; file edits get no rule', () => {
  assert.equal(allowRule('WebFetch', { url: 'https://docs.example.com/a?b=1' }), 'WebFetch(domain:docs.example.com)');
  assert.equal(allowRule('WebFetch', { url: 'not a url' }), '');
  assert.equal(allowRule('Edit', { file_path: '/a/b' }), '');
  assert.equal(allowRule('Write', { file_path: '/a/b' }), '');
});

test('the patch keeps the rules already there and adds the new one', () => {
  const cur = JSON.stringify({ model: 'opus', permissions: { allow: ['Read'], deny: ['Bash(rm *)'] } });
  assert.deepEqual(JSON.parse(allowPatch(cur, 'mcp__a__b')), { permissions: { allow: ['Read', 'mcp__a__b'] } });
  assert.deepEqual(JSON.parse(allowPatch('', 'mcp__a__b')), { permissions: { allow: ['mcp__a__b'] } });
  assert.equal(allowPatch(cur, 'Read'), '');
});

test("Docket's own tools and its private browser are flagged as Docket's doing", () => {
  assert.match(docketCause({ name: 'mcp__portal__recycle', input: {} }), /Docket's own tools/);
  assert.match(docketCause({ name: 'mcp__playwright__browser_take_screenshot', input: { filename: 'a.png' } }), /private browser/);
});

test("a step naming a path in Docket's folders is flagged, one elsewhere is not", () => {
  const folders = ['V:\\Repos\\docket', 'V:\\Repos\\docket\\data'];
  assert.match(docketCause({ name: 'Write', input: { file_path: 'v:\\repos\\DOCKET\\data\\x.json' }, folders, platform: 'win32' }), /inside Docket's own folders/);
  assert.equal(docketCause({ name: 'Write', input: { file_path: 'V:\\Repos\\docket-work\\x.json' }, folders, platform: 'win32' }), '');
  assert.equal(docketCause({ name: 'Bash', input: { command: 'rm -rf build' }, folders, platform: 'win32' }), '');
  assert.match(docketCause({ name: 'Edit', input: { edits: [{ path: '/opt/docket/uploads/a' }] }, folders: ['/opt/docket'], platform: 'linux' }), /\/opt\/docket\/uploads\/a/);
  // A path as a word of a command, with either slash.
  assert.match(docketCause({ name: 'Bash', input: { command: 'ls V:/Repos/docket/data; echo hi' }, folders, platform: 'win32' }), /names V:\/Repos\/docket\/data,/);
  assert.match(docketCause({ name: 'PowerShell', input: { command: 'Get-Content "V:\\Repos\\docket\\server.mjs"' }, folders, platform: 'win32' }), /names V:\\Repos\\docket\\server\.mjs,/);
  // A session working in Docket's folder is meant to touch it; its data folder still counts.
  assert.equal(docketCause({ name: 'Bash', input: { command: 'cat V:/Repos/docket/server.mjs' }, folders, cwd: 'V:\\Repos\\docket', platform: 'win32' }), '');
  assert.equal(docketCause({ name: 'Bash', input: { command: 'cat V:/Repos/docket/data/state.json' }, folders: ['V:\\Repos\\docket\\data'], cwd: 'V:\\Repos\\docket', platform: 'win32' }) !== '', true);
});

test('the server offers Allow through a settings card and marks the row until the person looks', () => {
  const server = fs.readFileSync(new URL('../server.mjs', import.meta.url), 'utf8');
  assert.match(server, /action === 'refused-allow'/);
  assert.match(server, /suggestSettings\(s, \{ file: t\.file, json: patch, merge: true/);
  assert.match(server, /refusedAuto: state\.sessions\[s\.id\]\?\.refusedAuto/);
  assert.match(server, /if \(rec\.refusedAuto\) \{ delete rec\.refusedAuto/);
  const page = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  assert.match(page, /data-refused-allow/);
  assert.match(page, /\$\{refusedTag\(s\)\}/);
});
