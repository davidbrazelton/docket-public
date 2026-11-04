// Tests for shift-up.mjs and its hook: Docket raises a Shift session to its top gear before the first file
// edit or git commit. Run with: npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { workKind, shiftUpFor, coordinatorHold } from '../shift-up.mjs';
import { gearsOf } from '../gears.mjs';
import { hookOutput } from '../plugin/hooks/shift-first-edit.mjs';

const HOOK = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'plugin', 'hooks', 'shift-first-edit.mjs');
const shift = { model: 'shift' };

test('file edits count, on every brand', () => {
  for (const t of ['Edit', 'Write', 'NotebookEdit', 'MultiEdit', 'search_replace', 'write']) assert.equal(workKind(t, {}), 'first file edit', t);
  for (const t of ['Read', 'Grep', 'Glob', 'read_file', 'WebFetch', 'mcp__portal__shift_gear', undefined]) assert.equal(workKind(t, {}), null, String(t));
});

test('a git commit counts, from any shell tool; other commands do not', () => {
  for (const c of ['git commit -m "x"', 'git add . && git commit -m x', 'git -C "C:/Work/acme" commit -am x', 'git -c user.name=x commit', 'cd x; git commit --amend', 'git.exe commit']) {
    for (const t of ['Bash', 'PowerShell', 'Shell', 'run_terminal_command']) assert.equal(workKind(t, { command: c }), 'git commit', `${t}: ${c}`);
  }
  for (const c of ['git status', 'git log --oneline', 'git commit-tree abc', 'git push', 'npm test', 'echo commit', '']) assert.equal(workKind('Bash', { command: c }), null, c);
  assert.equal(workKind('Bash', undefined), null);
  assert.equal(workKind('Read', { command: 'git commit' }), null); // only a shell runs commands
});

test('a Shift session on a lower gear goes to its top gear', () => {
  const d = shiftUpFor({ settings: shift, brand: 'claude', gear: 'claude-haiku-5-5', tool: 'Edit', input: {} });
  assert.deepEqual([d.from.key, d.to.key, d.why], ['haiku', 'opus', 'first file edit']);
  const c = shiftUpFor({ settings: shift, brand: 'claude', gear: 'claude-sonnet-5-5', tool: 'Bash', input: { command: 'git commit -m x' } });
  assert.deepEqual([c.from.key, c.to.key, c.why], ['sonnet', 'opus', 'git commit']);
  assert.equal(shiftUpFor({ settings: shift, brand: 'codex', gear: 'gpt-6-luna', tool: 'Edit', input: {} }).to.key, 'astra');
  assert.equal(shiftUpFor({ settings: shift, brand: 'grok', gear: 'grok-4.7-build-fast', tool: 'search_replace', input: {} }).to.key, 'full');
  // A gear Docket does not know (none saved yet) counts as the lowest, so it is shifted up to be safe.
  assert.equal(shiftUpFor({ settings: shift, brand: 'claude', gear: undefined, tool: 'Write', input: {} }).from.key, 'haiku');
});

test('already on the top gear, a model the user chose, or nothing that changes files: no shift', () => {
  assert.equal(shiftUpFor({ settings: shift, brand: 'claude', gear: 'claude-opus-5-5', tool: 'Edit', input: {} }), null);
  assert.equal(shiftUpFor({ settings: shift, brand: 'grok', gear: 'grok-4.7', tool: 'write', input: {} }), null);
  for (const model of ['claude-haiku-5-5', '', undefined]) assert.equal(shiftUpFor({ settings: { model }, brand: 'claude', gear: 'claude-haiku-5-5', tool: 'Edit', input: {} }), null);
  assert.equal(shiftUpFor({ settings: undefined, brand: 'claude', gear: 'claude-haiku-5-5', tool: 'Edit', input: {} }), null);
  assert.equal(shiftUpFor({ settings: shift, brand: 'claude', gear: 'claude-haiku-5-5', tool: 'Read', input: {} }), null);
});

test('the hook turns the call down only when the app says so', () => {
  assert.equal(hookOutput({}), null);
  assert.equal(hookOutput(null), null);
  const out = hookOutput({ deny: 'make it again' }).hookSpecificOutput;
  assert.deepEqual([out.hookEventName, out.permissionDecision, out.permissionDecisionReason], ['PreToolUse', 'deny', 'make it again']);
});

test('the hook does nothing outside Docket, when turned off, or when the app cannot be reached', () => {
  const run = (env, input) => spawnSync(process.execPath, [HOOK], { input: JSON.stringify(input), encoding: 'utf8', env: { PATH: process.env.PATH, ...env } });
  const edit = { tool_name: 'Edit', tool_input: { file_path: 'a' } };
  const base = { DOCKET_ENGINE: 'claude', DOCKET_SESSION: 's1', DOCKET_URL: 'http://127.0.0.1:9' }; // nothing listens on port 9
  for (const env of [{}, { ...base, DOCKET_ENGINE: '' }, { ...base, DOCKET_HOOKS_OFF: 'shift-first-edit' }, base]) {
    const r = run(env, edit);
    assert.equal(r.status, 0);
    assert.equal(r.stdout, '');
  }
});

test('becoming a plan coordinator raises a Shift session to its top gear (#654)', () => {
  for (const t of ['mcp__portal__plan_create', 'mcp__portal__plan_take_over', 'portal.plan_create', 'plan_create']) assert.equal(workKind(t, {}), 'becoming a plan coordinator', t);
  for (const t of ['mcp__portal__plan_add_tasks', 'mcp__portal__plan_read', 'mcp__portal__plan_claim_task', 'myplan_creator']) assert.equal(workKind(t, {}), null, t);
  const d = shiftUpFor({ settings: shift, brand: 'claude', gear: 'claude-haiku-5-5', tool: 'mcp__portal__plan_create', input: {} });
  assert.deepEqual([d.from.key, d.to.key, d.why], ['haiku', 'opus', 'becoming a plan coordinator']);
  assert.equal(shiftUpFor({ settings: shift, brand: 'claude', gear: 'claude-opus-5-5', tool: 'mcp__portal__plan_create', input: {} }), null);
  assert.equal(shiftUpFor({ settings: { model: 'claude-haiku-5-5' }, brand: 'claude', gear: 'claude-haiku-5-5', tool: 'mcp__portal__plan_create', input: {} }), null);
});

test('a coordinator with tasks left cannot shift below its top gear (#654)', () => {
  const gears = gearsOf('claude'), [haiku, sonnet, opus] = gears;
  const plan = (...states) => ({ id: 'p-ab12', title: 'Ship it', tasks: states.map((state, i) => ({ id: `T${i + 1}`, state })) });
  for (const to of [haiku, sonnet]) {
    const why = coordinatorHold({ gears, to, plan: plan('done', 'open', 'claimed') });
    assert.match(why, /p-ab12 \("Ship it"\), which has 2 tasks not done or dropped/);
    assert.match(why, /stays on Opus 5\.5/);
    assert.ok(!why.includes('\n'), 'one line');
  }
  assert.match(coordinatorHold({ gears, to: haiku, plan: plan('waiting_on_user', 'dropped') }), /has 1 task not/);
  assert.match(coordinatorHold({ gears, to: haiku, plan: plan('sent_back') }), /has 1 task not/);
  assert.match(coordinatorHold({ gears, to: haiku, plan: plan('waiting_outside') }), /has 1 task not/);
  // Shifting to the top gear, every task done or dropped, or no plan at all: allowed.
  assert.equal(coordinatorHold({ gears, to: opus, plan: plan('open') }), null);
  assert.equal(coordinatorHold({ gears, to: haiku, plan: plan('done', 'dropped') }), null);
  assert.equal(coordinatorHold({ gears, to: haiku, plan: plan() }), null);
  assert.equal(coordinatorHold({ gears, to: haiku, plan: null }), null);
  // A gateway that offers only some gears: its highest offered gear is the top.
  assert.equal(coordinatorHold({ gears: [haiku, sonnet], to: sonnet, plan: plan('open') }), null);
  assert.match(coordinatorHold({ gears: [haiku, sonnet], to: haiku, plan: plan('open') }), /stays on Sonnet 5\.5/);
});
