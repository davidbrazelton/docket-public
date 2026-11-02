// Tests for grok-home.mjs and the Docket hooks in Grok sessions. Run with: npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { NEW_CONFIG, makeGrokHome, grokHooks, writeGrokHooks, HOOK_FILE, signedInFrom, deviceLink, isInside } from '../grok-home.mjs';
import { checkGrok } from '../plugin/hooks/bash-cmdline-guard.mjs';

const PLUGIN = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'plugin');
const GUARD = path.join(PLUGIN, 'hooks', 'bash-cmdline-guard.mjs');
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'grok-home-'));
const BS = '\x5c';

test('a new Grok home gets config.toml keeping Claude rules and hooks out; an existing one is left alone', () => {
  const h = path.join(tmp(), 'new-home');
  assert.equal(makeGrokHome(h), true);
  const cfg = fs.readFileSync(path.join(h, 'config.toml'), 'utf8');
  assert.equal(cfg, NEW_CONFIG);
  assert.match(cfg, /\[compat\.claude\]\s+hooks = false\s+rules = false/);
  fs.writeFileSync(path.join(h, 'config.toml'), '[ui]\nyolo = false\n');
  assert.equal(makeGrokHome(h), false);
  assert.equal(fs.readFileSync(path.join(h, 'config.toml'), 'utf8'), '[ui]\nyolo = false\n');
});

test('the Docket hook list in Grok form points at the plugin folder, in Claude\'s shape', () => {
  const { hooks } = grokHooks(PLUGIN);
  const [group] = hooks.PreToolUse;
  assert.equal(group.matcher, 'Bash');
  const root = path.resolve(PLUGIN).split(path.sep).join('/');
  assert.equal(group.hooks[0].command, `node "${root}/hooks/bash-cmdline-guard.mjs"`);
  assert.ok(!JSON.stringify(hooks).includes('CLAUDE_PLUGIN_ROOT'));
});

test('writeGrokHooks writes hooks/docket.json once and rewrites it only when it changes', () => {
  const h = tmp();
  assert.equal(writeGrokHooks(h, PLUGIN), true);
  const file = path.join(h, 'hooks', HOOK_FILE);
  assert.deepEqual(JSON.parse(fs.readFileSync(file, 'utf8')), grokHooks(PLUGIN));
  assert.equal(writeGrokHooks(h, PLUGIN), false);
  fs.writeFileSync(file, '{}');
  assert.equal(writeGrokHooks(h, PLUGIN), true);
});

test('reading what grok says: signed in or not, and the device sign-in link', () => {
  assert.equal(signedInFrom('You are logged in with grok.com.\n\nDefault model: grok-4.7'), true);
  assert.equal(signedInFrom('You are not authenticated.\n\nDefault model: grok-4.6'), false);
  assert.equal(signedInFrom(''), false);
  const out = 'To sign in, open this URL in your browser:\n\n  https://accounts.x.ai/oauth2/device?user_code=GGQY-TTB6\n\nConfirm this code';
  assert.deepEqual(deviceLink(out), { url: 'https://accounts.x.ai/oauth2/device?user_code=GGQY-TTB6', code: 'GGQY-TTB6' });
  assert.equal(deviceLink('Waiting for authorization...'), null);
});

test('isInside ignores letter case on Windows, so Docket\'s folder catches C:/Work/Companies/Docket/claude-home', () => {
  const root = path.resolve('C:/Work/Companies/docket');
  assert.equal(isInside('C:/Work/Companies/Docket/claude-home', root, true), true);
  assert.equal(isInside(root, root, true), true);
  assert.equal(isInside('C:/Work/Companies/Docket-company/claude-home', root, true), false);
  assert.equal(isInside('C:/Work/grok_home/Docket', root, true), false);
});

test('guard on Grok: PowerShell has the 32767 limit and no backslash problem', () => {
  assert.equal(checkGrok('Get-ChildItem'), null);
  assert.equal(checkGrok('x'.repeat(20000)), null); // past Claude's 8191, fine for Grok
  assert.equal(checkGrok(`echo C:${BS}${BS}path`), null);
  const long = checkGrok('x'.repeat(32700));
  assert.equal(long.permissionDecision, 'deny');
  assert.match(long.permissionDecisionReason, /too long for Windows.*32767/);
  // Each " costs one more, and the backslashes right before it are doubled.
  assert.equal(checkGrok('"'.repeat(16400)).permissionDecision, 'deny');
  assert.equal(checkGrok('x'.repeat(250), 300).permissionDecision, 'deny');
});

test('the guard script reads Grok\'s hook input and honours the off list and the test limit (Windows only)', { skip: process.platform !== 'win32' }, () => {
  // The fields Grok 1.0.41 sends a PreToolUse hook, as captured on 2026-10-27 (both its own names and Claude's).
  const input = (command) => JSON.stringify({ hookEventName: 'pre_tool_use', hook_event_name: 'PreToolUse', toolName: 'run_terminal_command',
    tool_name: 'run_terminal_command', toolInput: { command }, tool_input: { command }, permission_mode: 'default' });
  const run = (command, env) => spawnSync(process.execPath, [GUARD], { input: input(command), encoding: 'utf8', env: { ...process.env, DOCKET_ENGINE: 'grok', DOCKET_HOOKS_OFF: '', DOCKET_CMDLINE_LIMIT: '', ...env } });
  assert.equal(run('x'.repeat(9000)).stdout, ''); // Claude's limit does not apply to Grok
  assert.match(JSON.parse(run('x'.repeat(33000)).stdout).hookSpecificOutput.permissionDecisionReason, /PowerShell/);
  assert.equal(JSON.parse(run('x'.repeat(400), { DOCKET_CMDLINE_LIMIT: '300' }).stdout).hookSpecificOutput.permissionDecision, 'deny');
  assert.equal(run('x'.repeat(33000), { DOCKET_HOOKS_OFF: 'bash-cmdline-guard' }).stdout, '');
  assert.equal(run('x'.repeat(33000), { DOCKET_ENGINE: '' }).stdout, '');
});
