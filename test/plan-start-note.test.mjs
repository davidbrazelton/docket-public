// The plan rule reaches a session before it starts its second child session (#651): the short rules say so, and
// start_session's reply after the first child points to plan_create when the session coordinates no plan.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PLAN_HINT, planStartNote } from '../plan-use.mjs';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const server = fs.readFileSync(path.join(root, 'server.mjs'), 'utf8');

test('the short rules say to make a plan before starting several sessions', () => {
  assert.match(PLAN_HINT, /before you start two or more sessions/);
});

test('a session with no plan that starts its first child session is told to make a plan before the next', () => {
  const note = planStartNote({ on: true, own: false, childStarts: 1 });
  assert.match(note, /mcp__portal__plan_create before starting the next session/);
  assert.match(note, /single piece needs no plan/);
});

test('no note for a coordinator, a desk with plans off, or after the first child', () => {
  assert.equal(planStartNote({ on: true, own: true, childStarts: 1 }), '', 'already coordinates a plan');
  assert.equal(planStartNote({ on: false, childStarts: 1 }), '', 'plans off');
  assert.equal(planStartNote({ on: true, childStarts: 0 }), '', 'no child started');
  assert.equal(planStartNote({ on: true, childStarts: 2 }), '', 'the second start brings the plan card instead');
});

test("start_session's reply carries the note", () => {
  const tool = server.slice(server.indexOf("tool('start_session'"), server.indexOf("tool('propose_handoff'"));
  assert.match(tool, /planStartNote\(\{ on: plansOn\(client\), own: !!sessionPlans\(client, parent\.id\)\.own, childStarts: state\.sessions\[parent\.id\]\?\.childStarts \|\| 0 \}\)/);
  assert.match(tool, /\$\{planNote \? `\\n\\n\$\{planNote\}` : ''\}/);
});
