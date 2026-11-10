// Tests for how sessions are told to end a turn: mark_turn names its label parameter and takes state as another
// name for it (#864), and the closing tools come before the final reply, not after it (#862). Run with: npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { turnLabelOf, BEFORE_REPLY } from '../reports.mjs';
import { closedNote } from '../family.mjs';

const read = (f) => fs.readFileSync(new URL('../' + f, import.meta.url), 'utf8');
const toolText = (name) => {
  const src = read('server.mjs'), i = src.indexOf(`tool('${name}',`);
  assert.ok(i >= 0, `server.mjs defines ${name}`);
  return src.slice(i, src.indexOf('async (', i));
};

test('mark_turn takes label, or state as its other name (#864)', () => {
  for (const l of ['done', 'question', 'reply', 'merge']) {
    assert.equal(turnLabelOf({ label: l }), l);
    assert.equal(turnLabelOf({ state: l }), l);
  }
  assert.equal(turnLabelOf({ label: 'question', state: 'done' }), 'question', 'label wins when both are given');
  assert.equal(turnLabelOf({}), '');
  assert.equal(turnLabelOf(undefined), '');
  const t = toolText('mark_turn');
  assert.match(t, /label: z\.enum\(\['done', 'question', 'reply', 'merge'\]\)\.optional\(\)/);
  assert.match(t, /state: z\.enum\(\['done', 'question', 'reply', 'merge'\]\)\.optional\(\)/);
});

test('the page reads state as well as label for the done line and the Merge card (#864)', () => {
  const page = read('index.html');
  assert.match(page, /\(ev\.input\?\.label \|\| ev\.input\?\.state\) === 'done'/);
  assert.match(page, /\(ev\.input\?\.label \|\| ev\.input\?\.state\) === 'merge'/);
});

test('the instructions name the label parameter wherever they call mark_turn (#864)', () => {
  const texts = { 'prompts/turns.md': read('prompts/turns.md'), 'prompts/sessions.md': read('prompts/sessions.md'), 'closedNote': closedNote([]), 'quietRefusal text': read('reports.mjs') };
  for (const [name, s] of Object.entries(texts)) {
    assert.doesNotMatch(s, /mark_turn (with )?"(done|question|reply|merge)"/, `${name} says mark_turn "…" without naming label`);
  }
  assert.match(texts['prompts/turns.md'], /mark_turn with label "done"/);
  assert.match(texts['prompts/turns.md'], /mark_turn with label "merge" and pr 146/);
});

test('the closing tools are called before the final reply, not near the end (#862)', () => {
  assert.match(BEFORE_REPLY, /before your final reply/);
  assert.match(BEFORE_REPLY, /the full reply is the last thing in the turn, with no tool call after it/);
  for (const name of ['mark_turn', 'report_quiet']) {
    const t = toolText(name);
    assert.doesNotMatch(t, /near the end/, `${name} still says near the end`);
    assert.match(t, /BEFORE_REPLY/, `${name} says to call it before the final reply`);
  }
  const turns = read('prompts/turns.md');
  assert.match(turns, /Call the closing tools \(mark_turn, report_quiet, present_file, rename_session\) before your final reply, never after it: the full reply is the last thing in the turn, with no tool call after it\./);
  assert.doesNotMatch(read('prompts/sessions.md'), /closing reply[^.]*, then mcp__portal__mark_turn/, 'sessions.md no longer puts mark_turn after the reply');
  assert.match(closedNote([]), /before your final reply/);
  for (const f of ['prompts/turns.md', 'prompts/sessions.md', 'prompts/titles.md', 'server.mjs', 'family.mjs', 'reports.mjs', 'platform.mjs']) {
    assert.doesNotMatch(read(f), /near the end/i, `${f} says near the end`);
  }
});
