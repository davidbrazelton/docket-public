import test from 'node:test';
import assert from 'node:assert/strict';
import { narrationText, thinTurn } from '../narration.mjs';

// Signature headers as Claude Code 2.1.303 saves them: a few bytes, then the kind's name.
const sig = (kind) => Buffer.concat([Buffer.from([8, 4, 18, 159, 19, 10, 17, 8, 19, 24, 2, 56, 1, 66, kind.length]), Buffer.from(kind), Buffer.from('rest-of-signature')]).toString('base64');

test('a narration block is reply text', () => {
  assert.equal(narrationText({ type: 'thinking', thinking: 'The answer is 11/27.\n\n', signature: sig('narration') }), 'The answer is 11/27.');
});

test('real thinking, an empty block and other blocks are not', () => {
  assert.equal(narrationText({ type: 'thinking', thinking: 'weighing it', signature: sig('thinking') }), '');
  assert.equal(narrationText({ type: 'thinking', thinking: '', signature: sig('narration') }), '');
  assert.equal(narrationText({ type: 'thinking', thinking: 'no signature' }), '');
  assert.equal(narrationText({ type: 'text', text: 'hi' }), '');
  assert.equal(narrationText(undefined), '');
});

// #863: the COSCRYPTO-1026 turn: tools, an empty narration block, mark_turn, then one question.
const tool = (name) => ({ type: 'tool_use', id: name, name, input: {} });
const nar = (t) => ({ type: 'thinking', thinking: t, signature: sig('narration') });
const text = (t) => ({ type: 'text', text: t });

test('a turn whose answer went into an empty narration block is flagged', () => {
  assert.equal(thinTurn([tool('Bash'), tool('Bash'), nar(''), tool('mcp__portal__mark_turn'), text('Should I delete both the remote branch and the local worktree?')]), true);
});

test('a narration longer than a short reply is flagged; a single long question counts as short', () => {
  assert.equal(thinTurn([tool('Bash'), nar('The branch is merged. '.repeat(10)), tool('mcp__portal__mark_turn'), text('Merged.')]), true);
  const ask = 'Should I ' + 'also clean up the old worktree and its remote branch, '.repeat(5) + 'or leave them?';
  assert.equal(thinTurn([nar(''), tool('mcp__portal__mark_turn'), text(ask)]), true);
});

test('a normal turn is not flagged', () => {
  const full = 'I merged pull request #146.\n\n' + 'The tests passed on both computers and the branch is gone. '.repeat(5);
  assert.equal(thinTurn([tool('Bash'), text(full)]), false); // no narration
  assert.equal(thinTurn([nar('Checking the tests.'), tool('Bash'), text(full)]), false); // a long reply
  assert.equal(thinTurn([nar('Checking.'), tool('Bash'), text('All 12 tests pass.')]), false); // narration shorter than the reply
  assert.equal(thinTurn([{ type: 'thinking', thinking: '', signature: sig('thinking') }, tool('Bash'), text('Done?')]), false); // real thinking
  assert.equal(thinTurn([]), false);
});

test('the server flags the turn live and from the transcript, and the next message asks for the answer again', async () => {
  const fs = await import('node:fs');
  const server = fs.readFileSync(new URL('../server.mjs', import.meta.url), 'utf8');
  const page = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  assert.match(server, /const thin = !err && thinTurn\(s\.turnBlocks \|\| \[\]\);/);
  assert.match(server, /addEvent\(s, \{ k: 'result',[^\n]*\.\.\.\(thin \? \{ thin: true \} : \{\}\)/);
  assert.match(server, /events\.push\(\{ k: 'result', at: turnAt, \.\.\.thinMark\(\) \}\)/);
  assert.match(server, /if \(!system && state\.sessions\[s\.id\]\?\.thinNote\) \{ blocks\.push\(\{ type: 'text', text: THIN_NOTE \}\);/);
  assert.match(page, /ev\.thin \? `<div class="thin-line"[^`]*>Part of this reply was not saved<\/div>`/);
});
