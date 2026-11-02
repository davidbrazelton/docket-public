import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { typedText, typedTextOf, createIndex } from '../search.mjs';

const line = (o) => JSON.stringify(o);
const user = (content, extra = {}) => line({ type: 'user', message: { role: 'user', content }, ...extra });
const assistant = (content) => line({ type: 'assistant', message: { role: 'assistant', content } });

test('keeps what the person typed, as a string or as text blocks', () => {
  assert.equal(typedText(user('fix the walrus forecast')), 'fix the walrus forecast');
  assert.equal(typedText(user([{ type: 'image', source: {} }, { type: 'text', text: 'look at this' }])), 'look at this');
});

test("keeps Claude's written reply and drops its thinking and tool calls", () => {
  const l = assistant([{ type: 'thinking', thinking: 'secret plan' }, { type: 'text', text: 'Done.' }, { type: 'tool_use', name: 'Bash', input: { command: 'ls walrus' } }]);
  assert.equal(typedText(l), 'Done.');
});

test('drops tool results, system lines and summaries', () => {
  assert.equal(typedText(user([{ type: 'tool_result', tool_use_id: 'x', content: 'walrus walrus' }])), '');
  assert.equal(typedText(line({ type: 'system', content: 'walrus' })), '');
  assert.equal(typedText(user('<system-reminder>cwd changed</system-reminder>', { isMeta: true })), '');
  assert.equal(typedText(user('Summary: walrus', { isCompactSummary: true })), '');
  assert.equal(typedText(line({ type: 'summary', summary: 'walrus' })), '');
  assert.equal(typedText('not json {'), '');
});

test('strips reminders and Docket notes from inside typed text', () => {
  assert.equal(typedText(user('<system-reminder>\nCLAUDE.md mentions walrus\n</system-reminder>\nbuild the toggle')), 'build the toggle');
  assert.equal(typedText(user([{ type: 'text', text: 'hello' }, { type: 'text', text: '<system-reminder>walrus</system-reminder>' }])), 'hello');
  assert.equal(typedText(user([{ type: 'text', text: 'go' }, { type: 'text', text: '(From Docket: this session\'s title is "Walrus", one you chose.)' }])), 'go');
  assert.equal(typedText(user('<command-name>/clear</command-name><local-command-stdout>walrus</local-command-stdout>')), '');
});

test('a last line still being written is left for the next read', () => {
  const r = typedTextOf(user('one') + '\n' + user('two').slice(0, 10));
  assert.equal(r.text, 'one');
  assert.equal(r.used, Buffer.byteLength(user('one') + '\n'));
});

test('the index finds a word in one conversation only, and picks up a new message', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'docket-search-'));
  const a = path.join(dir, 'a.jsonl'), b = path.join(dir, 'b.jsonl');
  fs.writeFileSync(a, [user('plan the Zanzibar rollout'), assistant([{ type: 'text', text: 'Sure.' }])].join('\n') + '\n');
  fs.writeFileSync(b, [user('something else'), user([{ type: 'tool_result', tool_use_id: 'x', content: 'zanzibar in a tool' }])].join('\n') + '\n');
  const idx = createIndex();
  const files = new Map([['A', a], ['B', b]]);
  await idx.refresh(files);
  assert.deepEqual(Object.keys(idx.search('zanzibar')), ['A']);
  assert.match(idx.search('ZANZIBAR').A, /Zanzibar rollout/);
  assert.deepEqual(idx.search('quokka'), {});
  fs.appendFileSync(b, assistant([{ type: 'text', text: 'a quokka appeared' }]) + '\n');
  await idx.refresh(files);
  assert.deepEqual(Object.keys(idx.search('quokka')), ['B']);
  assert.match(idx.search('something').B, /something else/); // earlier text kept when only the new part is read
  fs.rmSync(dir, { recursive: true, force: true });
});
