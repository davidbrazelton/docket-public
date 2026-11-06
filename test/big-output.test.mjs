// Tests for the big-output hook (plugin/hooks/big-output.mjs) and its counts (big-output-use.mjs), #748. Run with: npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { decide, rereadOf, cutText } from '../plugin/hooks/big-output.mjs';
import { CUT_OVER_CHARS, HEAD_CHARS, TAIL_CHARS } from '../output-limits.mjs';
import { outputUseRows, addRows, OUTPUT_LOG } from '../big-output-use.mjs';

const HOOK = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'plugin', 'hooks', 'big-output.mjs');
const dir = () => fs.mkdtempSync(path.join(os.tmpdir(), 'big-output-'));
const lines = (n, from = 1) => Array.from({ length: n }, (_, i) => `line ${from + i} ${'x'.repeat(40)}`).join('\n');
const bash = (stdout, command = 'npm run build', extra = {}) => ({ hook_event_name: 'PostToolUse', tool_name: 'Bash', tool_use_id: 'toolu_1', tool_input: { command },
  tool_response: { stdout, stderr: '', interrupted: false, isImage: false, noOutputExpected: false, ...extra } });
const read = (content, input = {}) => ({ hook_event_name: 'PostToolUse', tool_name: 'Read', tool_use_id: 'toolu_2', tool_input: { file_path: 'C:\\w\\big.js', ...input },
  tool_response: { type: 'text', file: { filePath: 'C:\\w\\big.js', content, numLines: content.split('\n').length, startLine: 1, totalLines: content.split('\n').length } } });
const mcp = (blocks) => ({ hook_event_name: 'PostToolUse', tool_name: 'mcp__jira__jira_search', tool_use_id: 'toolu_3', tool_input: { jql: 'x' }, tool_response: blocks });

test('the limits: cut over about 8k tokens, keep about 3.6k', () => {
  assert.equal(CUT_OVER_CHARS, 18000);
  assert.ok(HEAD_CHARS + TAIL_CHARS < CUT_OVER_CHARS / 2);
});

test('Bash: under the limit is left alone', () => {
  assert.equal(decide(bash(lines(100)), dir()), null);
});

test('Bash: over the limit keeps the head and tail, saves the whole output', () => {
  const d = dir(), out = lines(1000);
  const r = decide(bash(out), d);
  const got = r.out.hookSpecificOutput;
  assert.equal(got.hookEventName, 'PostToolUse');
  const stdout = got.updatedToolOutput.stdout;
  assert.ok(stdout.length < HEAD_CHARS + TAIL_CHARS + 600, stdout.length);
  assert.ok(stdout.startsWith('line 1 '));
  assert.ok(stdout.trimEnd().endsWith(`line 1000 ${'x'.repeat(40)}`));
  assert.match(stdout, /full output is saved to .*toolu_1\.txt; read ranges from it/);
  assert.equal(r.save.file, path.join(d, 'toolu_1.txt'));
  assert.equal(r.save.text, out);
  // the rest of the shape stays, so Claude Code takes it
  assert.equal(got.updatedToolOutput.interrupted, false);
  assert.equal(got.updatedToolOutput.noOutputExpected, false);
});

test('Bash: stderr is passed on whole and saved with the output', () => {
  const r = decide(bash(lines(1000), 'make', { stderr: 'warning: something' }), dir());
  assert.equal(r.out.hookSpecificOutput.updatedToolOutput.stderr, 'warning: something');
  assert.match(r.save.text, /--- stderr ---\nwarning: something$/);
});

test('Bash: a range the command asks for, an interrupted run and an image are left alone', () => {
  const big = lines(1000);
  for (const c of ['git log | head -800', 'sed -n 1,900p server.mjs', 'cd x && tail -n 700 log.txt', 'tail -f a.log'])
    assert.equal(decide(bash(big, c), dir()), null, c);
  assert.ok(decide(bash(big, 'head -5 a.txt; cat big.txt'), dir()), 'a head earlier in the command is not the range');
  assert.equal(decide(bash(big, 'npm test', { interrupted: true }), dir()), null);
  assert.equal(decide(bash(big, 'x', { isImage: true }), dir()), null);
});

test('failures are never seen: the hook is only on PostToolUse, and an input without a result is left', () => {
  const hooks = JSON.parse(fs.readFileSync(path.join(path.dirname(HOOK), 'hooks.json'), 'utf8')).hooks;
  assert.deepEqual(Object.keys(hooks).filter((e) => JSON.stringify(hooks[e]).includes('big-output')), ['PostToolUse']);
  assert.equal(decide({ hook_event_name: 'PostToolUseFailure', tool_name: 'Bash', tool_input: { command: 'x' }, error: lines(1000) }, dir()), null);
});

test('Read: a whole file over the limit keeps its head numbered right and its tail as a note', () => {
  const content = lines(1000);
  const r = decide(read(content), dir());
  assert.equal(r.save, undefined, 'the file is already on disk');
  const h = r.out.hookSpecificOutput, file = h.updatedToolOutput.file;
  assert.equal(h.updatedToolOutput.type, 'text');
  assert.equal(file.filePath, 'C:\\w\\big.js');
  assert.ok(file.content.startsWith('line 1 '));
  const shown = file.content.split('\n').length - 1; // the last line is the note
  assert.ok(file.content.split('\n')[shown - 1].startsWith(`line ${shown} `), 'head lines are the first lines');
  assert.match(file.content, new RegExp(`\\[Docket: lines 1-${shown} of 1,000 shown;.*Read the rest with offset and limit`));
  assert.match(h.additionalContext, /^The end of C:\\w\\big\.js \(lines (\d+)-1000\)/);
  const first = Number(h.additionalContext.match(/lines (\d+)-1000/)[1]);
  assert.ok(h.additionalContext.includes(`\n${first}\tline ${first} `), 'tail lines carry their own numbers');
  assert.ok(h.additionalContext.endsWith(`1000\tline 1000 ${'x'.repeat(40)}`));
  assert.ok(file.content.length + h.additionalContext.length < HEAD_CHARS + TAIL_CHARS + 1200);
});

test('Read: a range, allow_large, a small file, an image and a saved output are left alone', () => {
  const big = lines(1000), d = dir();
  assert.equal(decide(read(big, { offset: 100 }), d), null);
  assert.equal(decide(read(big, { limit: 900 }), d), null);
  assert.equal(decide(read(big, { allow_large: true }), d), null);
  assert.equal(decide(read(lines(50)), d), null);
  assert.equal(decide({ ...read(big), tool_response: { type: 'image', file: { base64: 'x'.repeat(30000) } } }, d), null);
  const saved = read(big); saved.tool_response.file.filePath = path.join(d, 'toolu_9.txt');
  assert.equal(decide(saved, d), null);
});

test('MCP: text over the limit becomes one cut block, the whole saved', () => {
  const d = dir(), text = lines(800);
  const r = decide(mcp([{ type: 'text', text }]), d);
  const v = r.out.hookSpecificOutput.updatedToolOutput;
  assert.equal(v.length, 1);
  assert.equal(v[0].type, 'text');
  assert.match(v[0].text, /toolu_3\.txt/);
  assert.equal(r.save.text, text);
  assert.equal(decide(mcp([{ type: 'text', text: 'short' }]), d), null);
  assert.equal(decide(mcp([{ type: 'text', text }, { type: 'image', data: 'x', mimeType: 'image/png' }]), d), null);
  // other shapes keep their shape
  assert.equal(typeof decide({ ...mcp(null), tool_response: text }, d).out.hookSpecificOutput.updatedToolOutput, 'string');
  assert.ok(Array.isArray(decide({ ...mcp(null), tool_response: { content: [{ type: 'text', text }] } }, d).out.hookSpecificOutput.updatedToolOutput.content));
});

test('other tools are left alone', () => {
  assert.equal(decide({ tool_name: 'Grep', tool_input: {}, tool_response: { content: lines(1000) } }, dir()), null);
  assert.equal(decide({ tool_name: 'Edit', tool_input: {}, tool_response: { originalFile: lines(1000) } }, dir()), null);
});

test('reads back of what was cut are found', () => {
  const d = 'C:\\data\\tool-output\\s1';
  const cuts = [{ kind: 'cut', tool: 'Bash', file: `${d}\\toolu_1.txt` }, { kind: 'cut', tool: 'Read', file: 'C:\\w\\big.js' }];
  assert.ok(rereadOf({ tool_name: 'Read', tool_input: { file_path: 'c:/data/tool-output/s1/toolu_1.txt', offset: 10, limit: 50 } }, d, cuts));
  assert.ok(rereadOf({ tool_name: 'Read', tool_input: { file_path: 'C:\\w\\big.js', offset: 400, limit: 100 } }, d, cuts));
  assert.ok(rereadOf({ tool_name: 'Bash', tool_input: { command: 'sed -n 200,300p /c/data/tool-output/s1/toolu_1.txt' } }, d, cuts));
  assert.ok(rereadOf({ tool_name: 'Grep', tool_input: { pattern: 'x', path: 'C:/data/tool-output/s1/toolu_1.txt' } }, d, cuts));
  assert.equal(rereadOf({ tool_name: 'Read', tool_input: { file_path: 'C:\\w\\other.js' } }, d, cuts), null);
  assert.equal(rereadOf({ tool_name: 'Read', tool_input: { file_path: 'C:\\w\\big.js' } }, d, []), null);
});

test('cutText keeps whole lines at both ends', () => {
  const t = cutText(lines(1000), '/tmp/x.txt');
  const [head] = t.split('\n\n[Docket');
  assert.ok(head.endsWith('x'.repeat(40)));
});

test('the counts: per day and desk, added together', () => {
  const at = '2026-11-06T15:00:00.000Z', day = (() => { const t = new Date(at); return `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, '0')}-${String(t.getDate()).padStart(2, '0')}`; })();
  const rows = outputUseRows([{ at, kind: 'cut', chars: 40000, kept: 8000 }, { at, kind: 'cut', chars: 20000, kept: 8000 }, { at, kind: 'reread' }, { kind: 'cut' }], 'acme');
  assert.deepEqual(rows, [{ date: day, client: 'acme', cuts: 2, chars: 60000, kept: 16000, rereads: 1 }]);
  assert.deepEqual(addRows(rows, rows, [{ date: day, client: 'other', cuts: 1, chars: 1, kept: 1, rereads: 0 }]).map((r) => [r.client, r.cuts, r.rereads]), [['acme', 4, 2], ['other', 1, 0]]);
});

test('end to end: the script saves the file, logs the cut and the read back, and answers Claude Code', () => {
  const d = path.join(dir(), 'sess');
  const env = { ...process.env, DOCKET_ENGINE: 'claude', DOCKET_TOOL_OUTPUT_DIR: d, DOCKET_HOOKS_OFF: '' };
  const run = (input, e = env) => spawnSync(process.execPath, [HOOK], { input: JSON.stringify(input), env: e, encoding: 'utf8' });
  const big = lines(1000);
  const r = run(bash(big));
  assert.equal(r.status, 0, r.stderr);
  const out = JSON.parse(r.stdout).hookSpecificOutput;
  assert.match(out.updatedToolOutput.stdout, /full output is saved to/);
  assert.equal(fs.readFileSync(path.join(d, 'toolu_1.txt'), 'utf8'), big);
  assert.equal(run(bash('small')).stdout, '');
  run({ tool_name: 'Read', tool_use_id: 't', tool_input: { file_path: path.join(d, 'toolu_1.txt'), offset: 1, limit: 10 }, tool_response: { type: 'text', file: { content: 'x' } } });
  const log = fs.readFileSync(path.join(d, OUTPUT_LOG), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
  assert.deepEqual(log.map((l) => [l.kind, l.tool]), [['cut', 'Bash'], ['reread', 'Read']]);
  assert.equal(log[0].chars, big.length);
  // turned off, another engine, or no folder: nothing
  assert.equal(run(bash(big), { ...env, DOCKET_HOOKS_OFF: 'big-output' }).stdout, '');
  assert.equal(run(bash(big), { ...env, DOCKET_ENGINE: 'grok' }).stdout, '');
  assert.equal(run(bash(big), { ...env, DOCKET_TOOL_OUTPUT_DIR: '' }).stdout, '');
});
