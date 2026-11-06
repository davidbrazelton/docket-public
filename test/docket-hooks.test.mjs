// Tests for the Docket plugin (plugin/) and docket-hooks.mjs. Run with: npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { pluginHooks, ownCopies, cleanDocketHooks, hooksFor, hooksOffFor } from '../docket-hooks.mjs';
import { check } from '../plugin/hooks/bash-cmdline-guard.mjs';
import { isOff } from '../plugin/hooks/off.mjs';
import { check as artifactCheck } from '../plugin/hooks/artifact-new-guard.mjs';

const PLUGIN = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'plugin');
const GUARD = path.join(PLUGIN, 'hooks', 'bash-cmdline-guard.mjs');
const BS = '\x5c';
const home = (settings) => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'docket-hooks-'));
  if (settings) fs.writeFileSync(path.join(d, 'settings.json'), JSON.stringify(settings));
  return d;
};
const globex = { hooks: { PreToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command: 'node "C:/x/hooks/bash-cmdline-guard.js"' }] }] } };

test('the plugin lists its hooks by their script names', () => {
  const list = pluginHooks(PLUGIN);
  assert.deepEqual(list.map((h) => [h.name, h.event, h.matcher]), [['bash-cmdline-guard', 'PreToolUse', 'Bash'], ['shift-first-edit', 'PreToolUse', 'Edit|Write|NotebookEdit|MultiEdit|Bash|PowerShell|search_replace|write|run_terminal_command'], ['artifact-new-guard', 'PreToolUse', 'Artifact'], ['big-output', 'PostToolUse', 'Bash|Read|Grep|mcp__.*']]);
  assert.ok(fs.existsSync(path.join(PLUGIN, '.claude-plugin', 'plugin.json')));
});

test('the guard file holds no backslash pair (the bug it guards against would corrupt it)', () => {
  assert.ok(!fs.readFileSync(GUARD, 'utf8').includes(BS + BS));
});

test('guard: a short command passes, a long one is refused', () => {
  assert.equal(check('ls -la'), null);
  const long = check("echo '" + 'x'.repeat(8000) + "'");
  assert.equal(long.permissionDecision, 'deny');
  assert.match(long.permissionDecisionReason, /too long for Windows/);
  assert.equal(check("echo 'a' && ".repeat(10)), null); // quotes cost 6 each, still short
});

test('guard: a backslash pair is refused in a heredoc body and warned about elsewhere', () => {
  const heredoc = `cat > f.txt <<'EOF'\nC:${BS}${BS}path\nEOF`;
  assert.equal(check(heredoc).permissionDecision, 'deny');
  assert.match(check(`echo C:${BS}${BS}path`).additionalContext, /backslash pair/);
  assert.equal(check(`echo "a${BS}${BS}"`), null); // a pair right before a double quote survives
});

test('the off list: DOCKET_HOOKS_OFF names a hook by its short name', () => {
  assert.equal(isOff('bash-cmdline-guard', { DOCKET_ENGINE: 'claude', DOCKET_HOOKS_OFF: 'a, bash-cmdline-guard' }), true);
  assert.equal(isOff('bash-cmdline-guard', { DOCKET_ENGINE: 'claude', DOCKET_HOOKS_OFF: 'bash-cmdline' }), false);
  assert.equal(isOff('bash-cmdline-guard', { DOCKET_ENGINE: 'grok' }), false);
  // Outside a Docket session (grok run from a terminal with a Grok home that keeps Docket's hook file) it does nothing.
  assert.equal(isOff('bash-cmdline-guard', {}), true);
});

test('the guard script exits quietly when turned off, and answers when on (Windows only)', { skip: process.platform !== 'win32' }, () => {
  const input = JSON.stringify({ tool_name: 'Bash', tool_input: { command: 'x'.repeat(9000) } });
  const run = (env) => spawnSync(process.execPath, [GUARD], { input, encoding: 'utf8', env: { ...process.env, DOCKET_ENGINE: 'claude', ...env } });
  const on = run({ DOCKET_HOOKS_OFF: '' });
  assert.equal(JSON.parse(on.stdout).hookSpecificOutput.permissionDecision, 'deny');
  const off = run({ DOCKET_HOOKS_OFF: 'bash-cmdline-guard' });
  assert.equal(off.status, 0);
  assert.equal(off.stdout, '');
});

test('cleanDocketHooks keeps real names once and drops an empty list', () => {
  assert.deepEqual(cleanDocketHooks({ off: ['bash-cmdline-guard', ' bash-cmdline-guard ', 'bad name!', ''] }), { off: ['bash-cmdline-guard'] });
  assert.equal(cleanDocketHooks({ off: [] }), undefined);
  assert.equal(cleanDocketHooks(undefined), undefined);
});

test('a home that wires its own copy (Globex) skips Docket\'s, so it never runs twice', () => {
  const h = home(globex);
  assert.deepEqual(ownCopies(h, ['bash-cmdline-guard']), ['bash-cmdline-guard']);
  const [g] = hooksFor({ home: h }, PLUGIN);
  assert.equal(g.ownCopy, true);
  assert.equal(hooksOffFor({ home: h }, PLUGIN), 'bash-cmdline-guard');
});

test('a company gets every Docket hook unless it turns one off', () => {
  const h = home(null);
  assert.equal(hooksOffFor({ home: h }, PLUGIN), '');
  assert.equal(hooksOffFor({ home: h, docketHooks: { off: ['bash-cmdline-guard'] } }, PLUGIN), 'bash-cmdline-guard');
  assert.equal(hooksOffFor({ home: h, docketHooks: { off: ['not-a-docket-hook'] } }, PLUGIN), '');
});

test('artifact guard: a session may update an existing artifact but not make a new one', () => {
  const url = 'https://claude.ai/artifact/abc123';
  assert.equal(artifactCheck({ action: 'publish', file_path: 'C:/r/report.html', url }), null);
  assert.equal(artifactCheck({ file_path: 'C:/r/report.html', url }), null); // no action means publish
  for (const a of ['list', 'read', 'open', 'pin', 'unpin', 'delete']) assert.equal(artifactCheck({ action: a, url }), null);
  assert.equal(artifactCheck({ action: 'publish', file_path: 'C:/r/new.html' }).permissionDecision, 'deny');
  assert.equal(artifactCheck({ file_path: 'C:/r/new.html', url: '  ' }).permissionDecision, 'deny');
  assert.match(artifactCheck({ action: 'quickstart', intent: 'deck' }).permissionDecisionReason, /Publish as artifact/);
});
