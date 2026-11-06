// prompts/optional/split-work.md holds the push to send work to child sessions on a session's own (a desk can turn it
// off); prompts/sessions.md, which every session reads, keeps how to start, report back and close (#551).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DOCKET_KEYS } from '../copy-company.mjs';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (f) => fs.readFileSync(path.join(root, f), 'utf8');

test('the push to split work is only in the optional file', () => {
  const always = read('prompts/sessions.md'), split = read('prompts/optional/split-work.md');
  for (const push of ['real work the user asks for goes to a child session', 'Everything bigger goes to a child session right away', 'Asking for agents, subagents']) {
    assert.ok(split.includes(push), `split-work.md has: ${push}`);
    assert.ok(!always.includes(push), `sessions.md leaves out: ${push}`);
  }
});

test('every session keeps starting, reporting back and closing', () => {
  const always = read('prompts/sessions.md');
  for (const keep of ['mcp__portal__start_session', '"user_asked" starts it now', 'When a session you started says it is done', 'tells you your work is done',
    'own git worktree', 'Keeping each session on its own topic', 'After filing issues']) assert.ok(always.includes(keep), `sessions.md keeps: ${keep}`);
});

test('a copied desk keeps its split-work setting', () => {
  assert.ok(DOCKET_KEYS.includes('splitWork'));
});

test('the session-report note points at sections that exist in sessions.md', () => {
  const always = read('prompts/sessions.md'), server = read('server.mjs');
  const note = server.slice(server.indexOf('These are reports from sessions you started'), server.indexOf('</session-report>`'));
  const named = [...note.matchAll(/"(When [^"]+)"/g)].map((m) => m[1]);
  assert.ok(named.length >= 2, 'the note names the sections it points at');
  for (const h of named) assert.ok(always.includes(h + ' ') || always.includes(h + ':') || always.includes(h + ' ('), `sessions.md has: ${h}`);
});
