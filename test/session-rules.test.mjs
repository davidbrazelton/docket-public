// Which prompt files a session starts with (#800): a top-level session gets every prompts/*.md and split-work.md;
// a child session leaves out the rules for handing work out and other desks, and gets child.md instead.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ruleFiles, ruleText, PARENT_ONLY } from '../session-rules.mjs';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const dir = path.join(root, 'prompts');
const names = fs.readdirSync(dir);
const read = (f) => fs.readFileSync(path.join(dir, f), 'utf8').trim();

test('a top-level session gets every prompts file and split-work.md', () => {
  const files = ruleFiles(names, { child: false, split: true });
  for (const n of names.filter((x) => x.endsWith('.md'))) assert.ok(files.includes(n), n);
  assert.ok(files.includes('optional/split-work.md'));
  assert.ok(!files.includes('optional/child.md'));
});

test('a top-level session on a desk that does not split leaves out split-work.md only', () => {
  const files = ruleFiles(names, { child: false, split: false });
  assert.ok(!files.includes('optional/split-work.md'));
  assert.ok(files.includes('sessions.md') && files.includes('desks.md'));
});

test('a child session leaves out the parent-only rules and gets child.md', () => {
  for (const split of [true, false]) {
    const files = ruleFiles(names, { child: true, split });
    for (const n of PARENT_ONLY) assert.ok(!files.includes(n), `child leaves out ${n}`);
    assert.ok(!files.includes('optional/split-work.md'));
    assert.ok(files.includes('optional/child.md'));
    for (const keep of ['turns.md', 'cleanup.md', 'test-servers.md', 'titles.md']) assert.ok(files.includes(keep), `child keeps ${keep}`);
  }
});

test('a child still reads how to end a turn and how it is told it is done', () => {
  const text = ruleText(dir, { child: true });
  for (const keep of ['tells you your work is done', 'Row label', '(Docket state', 'Folders in use', 'Test servers in the background', 'Session titles', 'Working as a child session'])
    assert.ok(text.includes(keep), `child has: ${keep}`);
  for (const gone of ['Other desks', 'Starting other sessions', 'Sending work to child sessions', 'After filing issues']) assert.ok(!text.includes(gone), `child leaves out: ${gone}`);
});

test('a child starts smaller than a top-level session', () => {
  const top = ruleText(dir, { child: false }).length, child = ruleText(dir, { child: true }).length;
  assert.ok(child < top / 2, `child ${child} chars, top-level ${top}`);
});

test('the text is the files in order, joined by blank lines', () => {
  assert.equal(ruleText(dir, { child: true }), ruleFiles(names, { child: true }).map(read).join('\n\n'));
});

test('the server builds rules from session-rules.mjs, a child by its parent, and hands sessions.md to a child that starts one', () => {
  const server = fs.readFileSync(path.join(root, 'server.mjs'), 'utf8');
  assert.ok(server.includes("import { ruleText, PARENT_ONLY } from './session-rules.mjs'"));
  assert.ok(server.includes('s.slimRules = !!s.parentId'));
  const start = server.slice(server.indexOf("tool('start_session',"), server.indexOf("tool('propose_handoff',"));
  assert.equal((start.match(/withSessionRules\(parent,/g) || []).length, 3, 'started, offered-and-started, and proposed');
});
