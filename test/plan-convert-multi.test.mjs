// A conversion makes one Docket plan per plan file (#858): the conversion session and the sessions it starts (one per
// file, so no session has to read every file) have the plan tools in full before the desk switches, may coordinate
// several plans, and hang a file's plan under its index plan's task. Every task needs a kind, and the brief says so.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { inConversion, secondPlanRefusal, ownPlanOf, planUse } from '../plan-use.mjs';
import { createPlanStore } from '../plans.mjs';
import { conversionBrief } from '../plan-switch.mjs';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const server = fs.readFileSync(path.join(root, 'server.mjs'), 'utf8');
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'docket-convert-multi-'));

// conv started kid, kid started grandkid; other is a session of the same desk outside the conversion.
const parents = { kid: 'conv', grandkid: 'kid', other: null, conv: null };
const parentOf = (id) => parents[id] ?? null;

test('the conversion session and every session it starts, at any depth, are in the conversion; others are not', () => {
  const ps = { to: 'docket', from: 'none', session: 'conv' };
  for (const id of ['conv', 'kid', 'grandkid']) assert.equal(inConversion(id, ps, parentOf), true, id);
  assert.equal(inConversion('other', ps, parentOf), false);
  assert.equal(inConversion('', ps, parentOf), false);
  assert.equal(inConversion('kid', null, parentOf), false, 'no switch pending');
  assert.equal(inConversion('kid', { ...ps, to: 'none' }, parentOf), false, 'a switch off Docket\'s plans needs no plan tools');
  const loop = { a: 'b', b: 'a' };
  assert.equal(inConversion('a', ps, (id) => loop[id]), false, 'a parent loop ends');
});

test('conversion sessions carry the full plan rules and argument notes from the start', () => {
  assert.equal(planUse({ on: true, converting: true }), 'full');
  assert.equal(planUse({ on: true }), 'short');
  assert.match(server, /converting: converting\(client, s\.id\) \}\)/);
  assert.match(server, /const plansOnIn = \(client, id\) => plansOn\(client\) \|\| converting\(client, id\);/);
});

test('a second plan is refused outside a conversion and allowed in one', () => {
  const owns = [{ id: 'p-aaaa11', title: 'Index' }];
  assert.equal(secondPlanRefusal({ owns: [] }), '');
  assert.match(secondPlanRefusal({ owns }), /already coordinates plan p-aaaa11 \("Index"\)/);
  assert.equal(secondPlanRefusal({ owns, converting: true }), '');
  const create = server.slice(server.indexOf("tool('plan_create'"), server.indexOf("tool('plan_add_tasks'"));
  assert.match(create, /secondPlanRefusal\(\{ owns: mine\.owns, converting: converting\(client, parent\.id\) \}\)/);
});

test('with several plans, a coordinator\'s tool asks which one instead of guessing', () => {
  assert.deepEqual(ownPlanOf([{ id: 'p-a' }]), { id: 'p-a' });
  assert.deepEqual(ownPlanOf([{ id: 'p-a' }, { id: 'p-b' }], 'p-b'), { id: 'p-b' });
  assert.match(ownPlanOf([{ id: 'p-a' }, { id: 'p-b' }]).error, /coordinates 2 plans \(p-a, p-b\)\. Say which with plan_id\./);
  assert.match(ownPlanOf([]).error, /coordinates no plan/);
  const defs = server.slice(server.indexOf('function planToolDefs'), server.indexOf('function portalToolDefs'));
  assert.equal(defs.match(/ownPlanOf\(sessionPlans\(client, parent\.id\)\.owns, plan\)/g).length, 4, 'plan_add_tasks, plan_set_goal, plan_set_phases, plan_review_done');
});

test('one session coordinates an index plan and a file plan under its task, as a conversion does', () => {
  const s = createPlanStore({ dir: tmp() });
  const index = s.create({ title: 'Index', tasks: [{ title: 'Widgets', kind: 'build' }, { title: 'QA', kind: 'test' }], coordinator: 'conv' });
  const own = s.create({ title: 'Small file', tasks: [{ title: 'One', kind: 'build' }], coordinator: 'conv' });
  const sub = s.create({ title: 'Widgets', tasks: [{ title: 'A', kind: 'build' }, { title: 'B', kind: 'decision', after: [1] }], coordinator: 'kid', parent: { plan: index.id, task: 'T1' } });
  assert.deepEqual(sub.parent, { plan: index.id, task: 'T1' });
  assert.deepEqual(sub.tasks.map((t) => t.id), ['T1.1', 'T1.2']);
  assert.equal(s.read(index.id).tasks[0].plan, sub.id, 'the index task names its plan');
  assert.deepEqual(s.list().filter((p) => p.coordinator === 'conv').map((p) => p.id).sort(), [index.id, own.id].sort());
});

test('every task without a kind is named in one refusal, so one retry fixes them all', () => {
  const s = createPlanStore({ dir: tmp() });
  assert.throws(() => s.create({ title: 'P', tasks: [{ title: 'A' }, { title: 'B', kind: 'build' }, { title: 'C' }], coordinator: 'c1' }),
    /2 tasks need a kind \(build, test, decision or research\), so nothing was made: "A", "C"\. Give every task a kind and call again\./);
  assert.throws(() => s.create({ title: 'P', tasks: [{ title: 'A' }], coordinator: 'c1' }), /Task "A" needs a kind: build, test, decision or research\. Nothing was made/);
  assert.equal(s.list().length, 0);
});

test('the brief splits the conversion into one session per file, index plans first, and says every task needs a kind', () => {
  const b = conversionBrief({ desk: 'Acme', from: 'none', to: 'docket', found: { plans: [], claims: [], hooks: [], markers: [], docketPlans: [] } });
  assert.match(b, /Convert each plan file in a session of its own/);
  assert.match(b, /mcp__portal__start_session \(initiation user_asked/);
  assert.match(b, /Index plans first/);
  assert.match(b, /for_task, as "<index plan id>\/<task id>"/);
  assert.match(b, /Every task needs a kind, one of build, test, decision or research/);
  const off = conversionBrief({ desk: 'Acme', from: 'docket', to: 'none', found: { plans: [], claims: [], hooks: [], markers: [], docketPlans: [] } });
  assert.doesNotMatch(off, /session of its own/, 'leaving Docket\'s plans makes no Docket plans');
});
