// Tests for the environment guard (env-guard.mjs, #1240). Run with: npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { cleanGuard, guardDecide, guardSelfTest, guardScript, withGuardHook, applyGuard, guardCommand, GUARD_MATCHER } from '../env-guard.mjs';

const cfg = { production: ['api.northwind.example', 'northwind-prod'], test: ['staging.northwind.example', 'northwind-test'], protect: ['C:/Docket/data/env-guard/acme.mjs'] };
const bash = (command) => guardDecide({ tool_name: 'Bash', tool_input: { command } }, cfg)?.[0] || 'none';
const ps = (command) => guardDecide({ tool_name: 'PowerShell', tool_input: { command } }, cfg)?.[0] || 'none';
const write = (file_path, content) => guardDecide({ tool_name: 'Write', tool_input: { file_path, content } }, cfg)?.[0] || 'none';

test('cleanGuard: one marker per line or comma, no one-letter markers, nothing at all is null', () => {
  assert.deepEqual(cleanGuard({ production: 'api.northwind.example,\n northwind-prod \n\nx', test: ['northwind-test', 'NORTHWIND-PROD'] }),
    { production: ['api.northwind.example', 'northwind-prod'], test: ['northwind-test'] });
  assert.equal(cleanGuard({ production: '', test: ' ' }), null);
  assert.equal(cleanGuard(null), null);
  assert.deepEqual(cleanGuard({ test: 'qa.northwind.example' }), { production: [], test: ['qa.northwind.example'] });
});

test('settings files and the guard itself cannot be edited', () => {
  assert.equal(write('C:/Work/app/.claude/settings.json', '{}'), 'deny');
  assert.equal(write('C:\\Work\\app\\.claude\\settings.local.json', '{}'), 'deny');
  assert.equal(write('/home/sam/.claude/settings.json', '{}'), 'deny');
  assert.equal(write('C:\\Docket\\data\\env-guard\\acme.mjs', ''), 'deny');
  assert.equal(write('C:/Work/app/.claude/agents/review.md', 'hello'), 'none');
  assert.equal(guardDecide({ tool_name: 'Edit', tool_input: { file_path: 'C:/Work/app/.claude/settings.json', old_string: 'a', new_string: 'b' } }, cfg)[0], 'deny');
});

test('commands that print or save a secret are blocked, using one is not', () => {
  assert.equal(bash('echo $ANTHROPIC_API_KEY'), 'deny');
  assert.equal(bash('printf "%s" "${GH_TOKEN}" > token.txt'), 'deny');
  assert.equal(bash('printenv OPENAI_API_KEY'), 'deny');
  assert.equal(bash('printenv'), 'deny');
  assert.equal(ps('Write-Output $env:Anthropic_Api_Key'), 'deny');
  assert.equal(ps('Get-Item env:AWS_SECRET_ACCESS_KEY'), 'deny');
  assert.equal(ps('$env:NORTHWIND_TOKEN | Out-File key.txt'), 'deny');
  assert.equal(bash('curl -H "x-key: $NORTHWIND_API_KEY" https://example.com/a; echo done'), 'none', 'each step is checked on its own');
  assert.equal(ps('Set-Content key.txt $env:NORTHWIND_TOKEN'), 'deny');
  assert.equal(bash('curl -H "Authorization: Bearer $GH_TOKEN" https://example.com/api'), 'none');
  assert.equal(bash('echo $token'), 'none', 'a lower-case shell variable is not an environment secret');
  assert.equal(bash('echo done && git status'), 'none');
});

test('production: a write in a command is blocked, anything else asks', () => {
  assert.equal(bash('curl -X POST https://api.northwind.example/v1/orders'), 'deny');
  assert.equal(ps('Invoke-RestMethod -Method Delete https://api.northwind.example/v1/orders/7'), 'deny');
  assert.equal(bash('aws dynamodb update-item --table northwind-prod --key x'), 'deny');
  assert.equal(bash('curl https://api.northwind.example/v1/orders --data @order.json'), 'deny');
  assert.equal(bash('kubectl --context northwind-prod deploy app'), 'deny');
  assert.equal(bash('curl https://api.northwind.example/v1/orders'), 'ask');
  assert.equal(bash('kubectl --context northwind-prod get pods'), 'ask');
});

test('production in file text asks, a bare word "production" does nothing', () => {
  assert.equal(write('C:/Work/app/RELEASE.md', 'Deploy to api.northwind.example on Friday.'), 'ask');
  assert.equal(write('C:/Work/app/RELEASE.md', 'Deploy to production on Friday, then update the docs.'), 'none');
  assert.equal(bash('gh issue create --title "Fix the production banner"'), 'none');
  assert.equal(guardDecide({ tool_name: 'MultiEdit', tool_input: { file_path: 'C:/Work/app/a.md', edits: [{ old_string: 'x', new_string: 'see northwind-prod' }] } }, cfg)[0], 'ask');
});

test('markers match whole names only', () => {
  assert.equal(bash('curl -X POST https://xapi.northwind.example/v1'), 'none');
  assert.equal(bash('kubectl --context northwind-prod-replica delete pod x'), 'none');
  assert.equal(bash('curl -X POST https://API.Northwind.Example/v1'), 'deny', 'hosts are matched without case');
});

test('test environments: a write asks, a read and the rest are left to the classifier', () => {
  assert.equal(bash('curl -X PATCH https://staging.northwind.example/v1/orders/7'), 'ask');
  assert.equal(ps('Invoke-RestMethod -Method Post https://staging.northwind.example/v1/orders'), 'ask');
  assert.equal(bash('curl https://staging.northwind.example/v1/orders'), 'none');
  assert.equal(bash('git checkout -b feature-update && npm test'), 'none');
  assert.equal(write('C:/Work/app/notes.md', 'Update northwind-test tomorrow.'), 'none', 'file text naming a test environment is not a write to it');
  assert.equal(guardDecide({ tool_name: 'Read', tool_input: { file_path: 'C:/Work/app/.claude/settings.json' } }, cfg), null);
});

test('the generated script answers as guardDecide does, and the self-test passes', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'env-guard-'));
  try {
    const script = path.join(dir, 'guard.mjs');
    fs.writeFileSync(script, guardScript({ ...cfg, protect: [script] }));
    const r = await guardSelfTest(script, { ...cfg, protect: [script] });
    assert.deepEqual(r.failed, []);
    assert.equal(r.ok, true);
    assert.equal(r.checks, 9);
    // Only test markers: the self-test runs the checks that apply.
    const only = { production: [], test: ['staging.northwind.example'], protect: [script] };
    fs.writeFileSync(script, guardScript(only));
    assert.deepEqual(await guardSelfTest(script, only), { ok: true, checks: 6, failed: [] });
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('a broken script fails the self-test instead of being turned on', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'env-guard-'));
  try {
    const script = path.join(dir, 'guard.mjs');
    fs.writeFileSync(script, 'process.exit(3)');
    const r = await guardSelfTest(script, cfg);
    assert.equal(r.ok, false);
    assert.match(r.failed[0], /failed to run/);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('withGuardHook adds one entry, keeps other hooks, and takes only its own out', () => {
  const other = { matcher: 'Bash', hooks: [{ type: 'command', command: 'node other.mjs' }] };
  const s = { model: 'opus', hooks: { PreToolUse: [other], Stop: [{ hooks: [{ type: 'command', command: 'x' }] }] } };
  const on = withGuardHook(s, 'C:\\Docket\\data\\env-guard\\acme.mjs', true);
  assert.equal(on.model, 'opus');
  assert.equal(on.hooks.PreToolUse.length, 2);
  assert.deepEqual(on.hooks.PreToolUse[0], other);
  assert.equal(on.hooks.PreToolUse[1].matcher, GUARD_MATCHER);
  assert.equal(on.hooks.PreToolUse[1].hooks[0].command, 'node "C:/Docket/data/env-guard/acme.mjs"');
  const again = withGuardHook(on, 'C:\\Docket\\data\\env-guard\\acme.mjs', true);
  assert.equal(again.hooks.PreToolUse.length, 2, 'turning it on twice adds it once');
  const off = withGuardHook(again, 'C:\\Docket\\data\\env-guard\\acme.mjs', false);
  assert.deepEqual(off, s);
  assert.deepEqual(withGuardHook(withGuardHook({}, '/d/g.mjs', true), '/d/g.mjs', false), {});
  assert.deepEqual(withGuardHook(withGuardHook({}, '/old/docket/g.mjs', true), '/new/docket/g.mjs', false), {}, 'found after Docket moved');
});

test('applyGuard writes the script, tests it, then the settings; off takes both away', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'env-guard-'));
  try {
    const scriptFile = path.join(dir, 'data', 'env-guard', 'acme.mjs'), settingsFile = path.join(dir, 'home', 'settings.json');
    fs.mkdirSync(path.dirname(settingsFile), { recursive: true });
    fs.writeFileSync(settingsFile, '\uFEFF{ "theme": "dark" }');
    const r = await applyGuard({ scriptFile, settingsFile, cfg: { production: cfg.production, test: cfg.test } });
    assert.equal(r.ok, true);
    const s = JSON.parse(fs.readFileSync(settingsFile, 'utf8'));
    assert.equal(s.theme, 'dark');
    assert.equal(s.hooks.PreToolUse[0].hooks[0].command, guardCommand(scriptFile));
    assert.match(fs.readFileSync(scriptFile, 'utf8'), /northwind-prod/);
    // The desk's own settings file is protected by the script too.
    assert.equal((await guardSelfTest(scriptFile, { ...cfg, protect: [scriptFile, settingsFile] })).ok, true);
    await applyGuard({ scriptFile, settingsFile, cfg: null });
    assert.deepEqual(JSON.parse(fs.readFileSync(settingsFile, 'utf8')), { theme: 'dark' });
    assert.equal(fs.existsSync(scriptFile), false);
    // A script path given relative to Docket's folder goes in the hook as a full path.
    const cwd = process.cwd(); process.chdir(dir);
    try { await applyGuard({ scriptFile: 'data-dev/env-guard/acme.mjs', settingsFile, cfg: { production: ['northwind-prod'], test: [] } }); }
    finally { process.chdir(cwd); }
    assert.equal(JSON.parse(fs.readFileSync(settingsFile, 'utf8')).hooks.PreToolUse[0].hooks[0].command, guardCommand(path.join(dir, 'data-dev', 'env-guard', 'acme.mjs')));
    await applyGuard({ scriptFile: path.join(dir, 'data-dev', 'env-guard', 'acme.mjs'), settingsFile, cfg: null });
    // A settings file that is not JSON is left alone.
    fs.writeFileSync(settingsFile, '{ not json');
    await assert.rejects(() => applyGuard({ scriptFile, settingsFile, cfg: { production: ['northwind-prod'], test: [] } }), /could not be read/);
    assert.equal(fs.readFileSync(settingsFile, 'utf8'), '{ not json');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
