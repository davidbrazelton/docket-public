// A desk's own environment variables: which names are allowed, and the blocks a terminal runs to use them.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { cleanEnv, isReserved, envScripts, CLEARED } from '../company-env.mjs';

test('cleanEnv: rows or an object; names Docket sets itself are refused', () => {
  assert.deepEqual(cleanEnv([['BATON_NOTES_ROOT', 'C:\\D\\notes'], { name: 'B', value: '' }, ['', '']]), { env: { BATON_NOTES_ROOT: 'C:\\D\\notes', B: '' } });
  assert.deepEqual(cleanEnv({ A: 1 }), { env: { A: '1' } });
  assert.deepEqual(cleanEnv(undefined), { env: {} });
  for (const n of ['CLAUDE_CONFIG_DIR', 'codex_home', 'GROK_HOME', 'GH_CONFIG_DIR', 'DOCKET_ENGINE', 'CLAUDE_CODE_USE_BEDROCK', 'AWS_PROFILE', 'AWS_REGION']) {
    assert.ok(isReserved(n), n);
    assert.match(cleanEnv([[n, 'x']]).error, /set by Docket/);
  }
  assert.ok(!isReserved('BATON_NOTES_ROOT'));
  assert.match(cleanEnv([['1A', 'x']]).error, /not a variable name/);
  assert.match(cleanEnv([['A B', 'x']]).error, /not a variable name/);
  assert.match(cleanEnv([['A', 'x\ny']]).error, /one line/);
  assert.match(cleanEnv([['A', '1'], ['A', '2']]).error, /twice/);
});

test('envScripts: each block clears what another desk left, then sets this desk\'s', () => {
  const { ps, sh, cmd } = envScripts({ CLAUDE_CONFIG_DIR: 'C:\\D\\it\'s', BATON_NOTES_ROOT: 'C:\\D\\notes', GH_CONFIG_DIR: '' }, 'New');
  assert.ok(CLEARED.includes('GROK_') && CLEARED.includes('CODEX_'));
  assert.match(ps, /Where-Object Name -match '\^\(CLAUDE\|ANTHROPIC\|USE_LOCAL_OAUTH\|USE_STAGING_OAUTH\|CODEX_\|GROK_\|DOCKET_\)'/);
  assert.ok(ps.includes("$env:CLAUDE_CONFIG_DIR = 'C:\\D\\it''s'"));
  assert.ok(ps.includes('Remove-Item env:GH_CONFIG_DIR'));
  assert.ok(ps.indexOf('Get-ChildItem env:') < ps.indexOf('$env:BATON_NOTES_ROOT'));
  assert.ok(sh.includes(`export CLAUDE_CONFIG_DIR='C:\\D\\it'\\''s'`));
  assert.ok(sh.includes('unset GH_CONFIG_DIR'));
  assert.ok(cmd.includes(`for /f "delims==" %v in ('set GROK_ 2^>nul') do @set "%v="`));
  assert.ok(cmd.includes('set "BATON_NOTES_ROOT=C:\\D\\notes"'));
  assert.match(ps, /New's homes/);
});

test('envScripts: the bash block really clears and sets', { skip: process.platform === 'win32' }, () => {
  const { sh } = envScripts({ CLAUDE_CONFIG_DIR: '/d/new', BATON_NOTES_ROOT: "/d/it's" });
  const r = spawnSync('bash', ['-c', `${sh}\nenv | sort`], { encoding: 'utf8', env: { PATH: process.env.PATH, GROK_HOME: '/old', CODEX_HOME: '/old', ANTHROPIC_API_KEY: 'x', KEEP: '1' } });
  assert.match(r.stdout, /^CLAUDE_CONFIG_DIR=\/d\/new$/m);
  assert.match(r.stdout, /^BATON_NOTES_ROOT=\/d\/it's$/m);
  assert.match(r.stdout, /^KEEP=1$/m);
  assert.doesNotMatch(r.stdout, /GROK_HOME|CODEX_HOME|ANTHROPIC_API_KEY/);
});

test('envScripts: the PowerShell block really clears and sets', { skip: process.platform !== 'win32' }, () => {
  const { ps } = envScripts({ CLAUDE_CONFIG_DIR: 'C:\\d\\new', BATON_NOTES_ROOT: "C:\\d\\it's" });
  const r = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', `${ps}\nGet-ChildItem env: | ForEach-Object { $_.Name + '=' + $_.Value }`],
    { encoding: 'utf8', env: { SystemRoot: process.env.SystemRoot, PATH: process.env.PATH, GROK_HOME: 'C:\\old', CODEX_HOME: 'C:\\old', ANTHROPIC_API_KEY: 'x', KEEP: '1' } });
  assert.match(r.stdout, /^CLAUDE_CONFIG_DIR=C:\\d\\new\r?$/m);
  assert.match(r.stdout, /^BATON_NOTES_ROOT=C:\\d\\it's\r?$/m);
  assert.match(r.stdout, /^KEEP=1\r?$/m);
  assert.doesNotMatch(r.stdout, /GROK_HOME|CODEX_HOME|ANTHROPIC_API_KEY/);
});
