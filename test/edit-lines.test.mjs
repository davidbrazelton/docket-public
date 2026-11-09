// Lines added and removed: read from a fixture Claude log (an edit, a multi-hunk edit, a new file, a Write over
// a file, a Read that is not an edit, and an edit copied in again by a resume), a helper agent's log, and Codex patches.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { readSession, sessionRows, sessionCost, editTotals, rowLines, editLines, CSV_COLUMNS } from '../costs.mjs';
import { readCodexSession, patchLines } from '../codex-usage.mjs';

const HERE = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
const PRICING = path.join(path.dirname(HERE), 'pricing.json');
const FIXTURE = path.join(HERE, '..', 'test-fixtures', 'edits-session.jsonl');

// The fixture as a session folder, with a helper agent that made one edit of two new lines.
function session() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'edit-lines-'));
  const main = path.join(dir, 'S1.jsonl');
  fs.copyFileSync(FIXTURE, main);
  const sub = path.join(dir, 'S1', 'subagents');
  fs.mkdirSync(sub, { recursive: true });
  fs.writeFileSync(path.join(sub, 'agent-1.jsonl'), [
    { type: 'assistant', uuid: 'g1', isSidechain: true, requestId: 'rg1', timestamp: '2026-10-20T12:01:00Z', message: { id: 'mg1', model: 'claude-haiku-5-5', content: [], usage: { input_tokens: 5, output_tokens: 5 } } },
    { type: 'user', uuid: 'gt1', isSidechain: true, timestamp: '2026-10-20T12:01:01Z', message: { role: 'user', content: [] },
      toolUseResult: { filePath: 'C:/Acme/notes.md', structuredPatch: [{ lines: [' x', '+y', '+z'] }] } },
  ].map((l) => JSON.stringify(l)).join('\n') + '\n');
  return main;
}

test('a tool result counts its patch, or a new file its content', () => {
  assert.deepEqual(editLines({ structuredPatch: [{ lines: [' a', '-b', '+c', '+d'] }, { lines: ['-e'] }] }), { added: 2, removed: 2 });
  assert.deepEqual(editLines({ type: 'create', content: 'one\ntwo\nthree', structuredPatch: [] }), { added: 3, removed: 0 });
  assert.deepEqual(editLines({ type: 'create', content: 'one\ntwo\n', structuredPatch: [] }), { added: 2, removed: 0 });
  assert.equal(editLines({ type: 'text', file: { content: '+x' } }), null);
  assert.equal(editLines(null), null);
  assert.equal(editLines('Error: file not found'), null);
});

test('each edit in the log counts once, helper agents included', () => {
  const main = session();
  const { edits } = readSession([main, path.join(path.dirname(main), 'S1', 'subagents', 'agent-1.jsonl')]);
  // edit +2 -1, multi-hunk +3 -3, new file +4, Write over it +1 -1, helper +2; next day +1 -1. The resumed copy of t1 is skipped.
  assert.equal(edits.length, 6);
  const sum = (k) => edits.reduce((a, e) => a + e[k], 0);
  assert.equal(sum('added'), 13);
  assert.equal(sum('removed'), 6);
});

test('the rows carry each day\'s lines on its first row, so any set of rows adds up once', () => {
  const main = session();
  const rows = sessionRows('acme', main, 'S1', PRICING, 'Price sheet', {});
  assert.ok(CSV_COLUMNS.includes('LinesAdded') && CSV_COLUMNS.includes('LinesRemoved'));
  const day = (d) => rows.filter((r) => r.Date === d);
  const total = (rs, k) => rs.reduce((a, r) => a + r[k], 0);
  assert.equal(total(day('2026-10-20'), 'LinesAdded'), 12);
  assert.equal(total(day('2026-10-20'), 'LinesRemoved'), 5);
  assert.equal(total(day('2026-10-21'), 'LinesAdded'), 1);
  assert.equal(total(day('2026-10-21'), 'LinesRemoved'), 1);
  assert.equal(day('2026-10-20').filter((r) => r.LinesAdded).length, 1); // the main and agent rows do not both carry them
  for (const r of rows) assert.equal(typeof r.LinesAdded, 'number');
});

test('the details panel gets the session\'s total lines, the same as its rows add up to on the Usage page', () => {
  const main = session();
  const rows = sessionRows('acme', main, 'S1', PRICING, 'Price sheet', {});
  const cost = sessionCost(main, 'S1', PRICING);
  assert.deepEqual(cost.lines, { added: 13, removed: 6 }); // helper agent included
  assert.deepEqual(cost.lines, rowLines(rows));
  // An edit with no time has no day to go on, and a session with no replies has no rows: neither counts.
  assert.deepEqual(editTotals([{ at: 0, added: 5, removed: 5 }, { at: 1, added: 1, removed: 2 }]), { added: 1, removed: 2 });
  assert.deepEqual(editTotals([{ at: 1, added: 1, removed: 2 }], false), { added: 0, removed: 0 });
  assert.deepEqual(rowLines([{ LinesAdded: 3 }, { LinesRemoved: 4 }, {}]), { added: 3, removed: 4 }); // Codex and Grok rows
});

test('Codex counts its apply_patch calls once each, and not the ones that failed', () => {
  const patch = '*** Begin Patch\n*** Update File: a.js\n@@\n-old\n+new\n+more\n context\n*** Add File: b.md\n+one\n+two\n*** Delete File: c.txt\n*** End Patch';
  assert.deepEqual(patchLines(patch), { added: 4, removed: 1 });
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-edits-'));
  const file = path.join(dir, 'rollout-S1.jsonl');
  const line = (timestamp, type, payload) => JSON.stringify({ timestamp, type, payload });
  fs.writeFileSync(file, [
    line('2026-10-20T12:00:00Z', 'session_meta', { session_id: 'S1', id: 'S1' }),
    line('2026-10-20T12:00:01Z', 'response_item', { type: 'custom_tool_call', name: 'apply_patch', call_id: 'c1', input: patch }),
    line('2026-10-20T12:00:01Z', 'response_item', { type: 'custom_tool_call', name: 'apply_patch', call_id: 'c1', input: patch }), // copied by a fork
    line('2026-10-20T12:00:02Z', 'response_item', { type: 'function_call', name: 'shell', call_id: 'c2', arguments: JSON.stringify({ command: ['apply_patch', '*** Begin Patch\n*** Update File: a.js\n@@\n-x\n*** End Patch'] }) }),
    line('2026-10-20T12:00:03Z', 'response_item', { type: 'custom_tool_call', name: 'apply_patch', call_id: 'c3', input: '*** Begin Patch\n*** Add File: d.md\n+bad\n*** End Patch' }),
    line('2026-10-20T12:00:04Z', 'event_msg', { type: 'patch_apply_end', call_id: 'c3', success: false }),
    line('2026-10-20T12:00:05Z', 'response_item', { type: 'function_call', name: 'shell', call_id: 'c4', arguments: JSON.stringify({ command: ['git', 'diff'] }) }),
  ].join('\n') + '\n');
  const { edits } = readCodexSession([file]);
  assert.deepEqual(edits.map((e) => [e.added, e.removed]), [[4, 1], [0, 1]]);
});
