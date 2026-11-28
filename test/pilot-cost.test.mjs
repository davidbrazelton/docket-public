// What an autopilot run costs (#1194): bigger batches (longer while the person is at work on the desk), a daily limit
// per desk, the cost per item handled, a brief with the notes cut down, and a run that starts with only its own tools.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runSteps, BATCH_MS, BATCH_ACTIVE_MS, batchDelay, CAP_DEFAULT, deskCap, spentToday, capReached, perItem, briefNotes } from '../pilot.mjs';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const item = (id, desk, may = 'allow') => ({ id, desk, may });

test('a batch fills for a minute, and three while the person is at work on that desk', () => {
  assert.equal(BATCH_MS, 60_000);
  assert.equal(BATCH_ACTIVE_MS, 180_000);
  assert.equal(batchDelay(false), BATCH_MS);
  assert.equal(batchDelay(true), BATCH_ACTIVE_MS);
  assert.equal(batchDelay(true, 1500, 3000), 3000);
  assert.equal(batchDelay(true, 300_000, 3000), 300_000, 'never shorter than the plain delay');
});

test('runSteps takes a delay per desk: the active desk waits longer, the other starts on time', () => {
  const items = [item('a', 'busy'), item('b', 'quiet')];
  const since = new Map([['busy', 0], ['quiet', 0]]);
  const delay = (desk) => batchDelay(desk === 'busy');
  const at = (now) => Object.fromEntries(runSteps({ items, since, now, delay }).map((s) => [s.desk, s.act === 'wait' ? s.ms : s.act]));
  assert.deepEqual(at(30_000), { busy: 150_000, quiet: 30_000 });
  assert.deepEqual(at(60_000), { busy: 120_000, quiet: 'start' }, 'the quiet desk starts after a minute');
  assert.deepEqual(at(180_000), { busy: 'start', quiet: 'start' });
  // A number still works as before.
  assert.deepEqual(runSteps({ items, since: new Map(), now: 0, delay: 1000 }).map((s) => s.ms), [1000, 1000]);
});

test("a desk's daily limit: its own, else the default; 0 stops every run", () => {
  assert.equal(CAP_DEFAULT, 5);
  assert.equal(deskCap(undefined, 'd'), 5);
  assert.equal(deskCap({ d: 2.5 }, 'd'), 2.5);
  assert.equal(deskCap({ d: 0 }, 'd'), 0);
  assert.equal(deskCap({ d: -1, e: 'x' }, 'd'), 5, 'a bad value is the default');
  assert.equal(deskCap({ e: 'x' }, 'e'), 5);
});

test("today's spend counts only today's runs, and the limit is reached at the cap, not before", () => {
  const day = (t) => (t < 100 ? 'yesterday' : 'today');
  const runs = [{ at: 50, cost: 9 }, { at: 150, cost: 1.25 }, { at: 160, cost: 2.5 }, { at: 170 }];
  assert.equal(spentToday(runs, 200, day), 3.75);
  assert.equal(spentToday([], 200, day), 0);
  assert.equal(capReached({ spent: 4.99, cap: 5, name: 'Acme' }), '');
  assert.match(capReached({ spent: 5, cap: 5, name: 'Acme' }), /^Acme's autopilot runs cost \$5\.00 today, which reaches its daily limit of \$5\.00, so no more runs start there until tomorrow\. Raise the limit on the desk's Autopilot tab\.$/);
  assert.match(capReached({ spent: 0, cap: 0, name: 'Acme' }), /daily limit on Acme is \$0, so no autopilot runs start there/);
  // With the real local day, a run from yesterday is left out.
  const now = Date.now();
  assert.equal(spentToday([{ at: now - 2 * 86400e3, cost: 3 }, { at: now, cost: 0.5 }], now), 0.5);
});

test('cost per item handled', () => {
  assert.equal(perItem(1, 4), 0.25);
  assert.equal(perItem(1, 3), 0.3333);
  assert.equal(perItem(1, 0), null);
});

test("the brief's notes: the standing lines and the newest dated ones, within a size, saying how many were left out", () => {
  const standing = ['- Cards for bug fixes: suggest Start.', '- Forms: suggest the Recommended option.'];
  const dated = Array.from({ length: 20 }, (_, i) => `- 2026-11-${String(i + 1).padStart(2, '0')}: run ${i + 1} suggested something.`);
  const notes = [standing[0], dated[0], standing[1], ...dated.slice(1)].join('\n') + '\n';
  let r = briefNotes(notes);
  assert.deepEqual(r.text.split('\n'), [...standing, ...dated.slice(12)], 'in their order, the last 8 dated');
  assert.equal(r.left, 12);
  r = briefNotes(notes, 8, 200);
  assert.ok(r.text.length <= 200, r.text.length);
  assert.ok(r.text.startsWith(standing.join('\n')), 'the oldest dated lines go first, the standing ones stay');
  assert.ok(r.text.endsWith(dated[19]));
  assert.deepEqual(briefNotes(''), { text: '', left: 0 });
  assert.deepEqual(briefNotes('- one\n- two\n'), { text: '- one\n- two', left: 0 });
});

test('a run starts with only its own tools, the 5-minute cache and a short note in place of the session rules', () => {
  const server = fs.readFileSync(path.join(ROOT, 'server.mjs'), 'utf8');
  const fn = server.slice(server.indexOf('function pilotRunOptions('), server.indexOf('// A run\'s session closed'));
  assert.match(fn, /tools: \[\], skills: \[\]/);
  assert.match(fn, /mcpServers: \{ portal: portalTools\(id\) \}/, 'no browser, desk or claude.ai tool servers');
  assert.match(fn, /append: PILOT_RUN_RULES/);
  for (const v of ["CLAUDE_CODE_PROMPT_CACHE_TTL: '5m'", "ENABLE_TOOL_SEARCH: 'false'", "ENABLE_CLAUDEAI_MCP_SERVERS: 'false'", "CLAUDE_CODE_DISABLE_CLAUDE_MDS: '1'"]) assert.ok(fn.includes(v), v);
  assert.ok(server.includes('...(record?.pilotRun || state.sessions[id]?.pilotRun ? pilotRunOptions(client, id) : {}),'), 'startSession uses them for a run');
  assert.ok(server.includes("TEST_RUN || state.sessions[s.id]?.pilotRun) return ''; // a pilot run has no browser"), 'and no desk browser is added after');
});
