// Tests for config-watch.mjs: noticing a session's Claude config changed, and when to restart it. Run with: npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { configFiles, readPrint, configChanges, reloadDecision, rulesNote, reloadNote } from '../config-watch.mjs';

function setup() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'docket-cfg-'));
  const home = path.join(root, 'home'), cwd = path.join(root, 'work');
  fs.mkdirSync(path.join(home, 'plugins'), { recursive: true });
  fs.mkdirSync(path.join(cwd, '.claude'), { recursive: true });
  const write = (f, v) => { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, typeof v === 'string' ? v : JSON.stringify(v, null, 2)); };
  const files = (sources) => configFiles({ home, cwd, sources });
  return { root, home, cwd, write, files, print: (sources, cache) => readPrint(files(sources), cache) };
}

test('nothing changed: nothing to reload and no rules to re-read', () => {
  const t = setup();
  t.write(path.join(t.home, 'settings.json'), { enabledPlugins: { 'a@m': true } });
  t.write(path.join(t.cwd, 'CLAUDE.md'), '# rules');
  const a = t.print();
  assert.deepEqual(configChanges(a, t.print()), { reload: [], rules: [] });
});

test('a plugin switched on or off, and hooks edited, are named', () => {
  const t = setup(), f = path.join(t.home, 'settings.json');
  t.write(f, { enabledPlugins: { 'a@m': true, 'b@m': false }, hooks: { Stop: [{ hooks: [{ type: 'command', command: 'x' }] }] } });
  const a = t.print();
  t.write(f, { enabledPlugins: { 'a@m': false, 'b@m': true }, hooks: { Stop: [{ hooks: [{ type: 'command', command: 'y' }] }], PreToolUse: [] }, model: 'opus' });
  const { reload, rules } = configChanges(a, t.print());
  assert.deepEqual(reload.sort(), [
    "PreToolUse hooks added (the desk's settings.json)",
    "Stop hooks edited (the desk's settings.json)",
    "model changed (the desk's settings.json)",
    "plugin a@m turned off (the desk's settings.json)",
    "plugin b@m turned on (the desk's settings.json)",
  ]);
  assert.deepEqual(rules, []);
});

test('a settings file made or removed counts; a permissions change alone does not (Claude Code takes it in live)', () => {
  const t = setup(), local = path.join(t.cwd, '.claude', 'settings.local.json');
  const a = t.print();
  t.write(local, { permissions: { allow: ['Bash(ls)'] } });
  assert.deepEqual(configChanges(a, t.print()).reload, [], 'a new file holding only permissions');
  t.write(local, { permissions: { allow: ['Bash(ls)'] }, tui: 'fullscreen', skipDangerousModePermissionPrompt: true });
  assert.deepEqual(configChanges(a, t.print()).reload, [], 'the terminal\'s own preferences');
  t.write(local, { permissions: { allow: ['Bash(ls)'] }, enabledPlugins: { 'p@m': true } });
  const b = t.print();
  assert.deepEqual(configChanges(a, b).reload, ["plugin p@m turned on (the folder's .claude/settings.local.json)"]);
  fs.unlinkSync(local);
  assert.deepEqual(configChanges(b, t.print()).reload, ["plugin p@m turned off (the folder's .claude/settings.local.json)"]);
});

test('a settings file that no longer reads as JSON is reported as edited', () => {
  const t = setup(), f = path.join(t.home, 'settings.json');
  t.write(f, { model: 'x' });
  const a = t.print();
  t.write(f, '{ broken');
  assert.deepEqual(configChanges(a, t.print()).reload, ["the desk's settings.json edited"]);
});

test('plugins installed or updated, hook files and connected services are named', () => {
  const t = setup();
  const inst = path.join(t.home, 'plugins', 'installed_plugins.json');
  t.write(inst, { version: 2, plugins: { 'a@m': [{ version: '1.0' }] } });
  t.write(path.join(t.home, 'hooks', 'guard.mjs'), 'one');
  t.write(path.join(t.cwd, '.mcp.json'), { mcpServers: { jira: { command: 'a' } } });
  const a = t.print();
  t.write(inst, { version: 2, plugins: { 'a@m': [{ version: '1.1' }], 'b@m': [{ version: '1.0' }] } });
  t.write(path.join(t.home, 'hooks', 'guard.mjs'), 'two!');
  t.write(path.join(t.home, 'hooks', 'new.sh'), 'x');
  t.write(path.join(t.cwd, '.mcp.json'), { mcpServers: { jira: { command: 'a' }, wiki: { command: 'b' } } });
  assert.deepEqual(configChanges(a, t.print()).reload.sort(), [
    'connected service wiki added (the folder\'s .mcp.json)',
    "hook file guard.mjs edited (the desk's hooks folder)",
    "hook file new.sh added (the desk's hooks folder)",
    'plugin a@m updated',
    'plugin b@m installed',
  ]);
});

test('CLAUDE.md changes are rules to re-read, not a reason to restart: the folder\'s, one above it, the desk\'s and rules folders', () => {
  const t = setup();
  const own = path.join(t.cwd, 'CLAUDE.md'), above = path.join(t.root, 'CLAUDE.md'), desk = path.join(t.home, 'CLAUDE.md'), ruleFile = path.join(t.cwd, '.claude', 'rules', 'style.md');
  t.write(own, 'a');
  const a = t.print();
  t.write(own, 'b'); t.write(above, 'new'); t.write(desk, 'desk'); t.write(ruleFile, 'r');
  const { reload, rules } = configChanges(a, t.print());
  assert.deepEqual(reload, []);
  assert.deepEqual(rules.sort(), [own, above, desk, ruleFile].map((f) => path.resolve(f)).sort());
  assert.match(rulesNote([own]), /^\(From Docket: your rules file changed since this session started; re-read .*CLAUDE\.md\.\)$/);
  assert.equal(rulesNote([own]).includes('\n'), false, 'one line');
});

test('a settings layer the desk turned off is not watched', () => {
  const t = setup();
  const a = t.print(['user']);
  t.write(path.join(t.cwd, '.claude', 'settings.json'), { enabledPlugins: { 'p@m': true } });
  t.write(path.join(t.cwd, 'CLAUDE.md'), 'x');
  assert.deepEqual(configChanges(a, t.print(['user'])), { reload: [], rules: [] });
  assert.ok(configFiles({ home: t.home, cwd: t.cwd, sources: ['project'] }).every((f) => !f.file.startsWith(path.resolve(t.home))));
});

test('a file touched with the same text is read again but is no change; the cache skips unchanged files', () => {
  const t = setup(), f = path.join(t.home, 'settings.json'), cache = new Map();
  t.write(f, { model: 'x' });
  const a = t.print(undefined, cache);
  const later = new Date(Date.now() + 5000); fs.utimesSync(f, later, later);
  assert.deepEqual(configChanges(a, t.print(undefined, cache)).reload, []);
  assert.ok(cache.has(path.resolve(f)));
});

test('restart at idle: never mid-turn, never with background commands, never while a question waits', () => {
  const changes = ['plugin a turned on'];
  assert.equal(reloadDecision({ changes, status: 'idle' }), 'reload');
  assert.equal(reloadDecision({ changes, status: 'running' }), 'wait');
  assert.equal(reloadDecision({ changes, status: 'starting' }), 'wait');
  assert.equal(reloadDecision({ changes, status: 'requires_action' }), 'wait');
  assert.equal(reloadDecision({ changes, status: 'idle', asks: 1 }), 'wait');
  assert.equal(reloadDecision({ changes, status: 'idle', runningJobs: 2 }), 'wait', 'background commands running');
  assert.equal(reloadDecision({ changes, status: 'idle', heldTurn: true }), 'wait', 'a turn held open for its jobs');
  assert.equal(reloadDecision({ changes, status: 'idle', reloading: true }), 'none', 'already reloading');
});

test('restart at idle: Ask waits for the person; nothing to do without changes, when ended, or on another brand', () => {
  const changes = ['x'];
  assert.equal(reloadDecision({ changes, status: 'idle', mode: 'ask' }), 'ask');
  assert.equal(reloadDecision({ changes, status: 'idle', mode: 'ask', wanted: true }), 'reload', 'Reload or Reload all pressed');
  assert.equal(reloadDecision({ changes, status: 'running', mode: 'ask', wanted: true }), 'wait', 'even when asked, not mid-turn');
  assert.equal(reloadDecision({ changes: [], status: 'idle' }), 'none');
  assert.equal(reloadDecision({ changes, status: 'ended' }), 'none', 'its next start reads the config afresh');
  assert.equal(reloadDecision({ changes, status: 'idle', engine: 'grok' }), 'none');
  assert.equal(reloadDecision({ changes, status: 'idle', engine: 'codex' }), 'none');
});

test('the note after a reload lists what it took in', () => {
  assert.match(reloadNote(['plugin a turned on', 'Stop hooks edited']), /^\(From Docket: .*same conversation.*plugin a turned on; Stop hooks edited\.\)$/);
});
