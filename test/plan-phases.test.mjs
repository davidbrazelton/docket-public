// Phases (#869): a plan names its sections in the order the work happens, each task sits in one, and progress is
// counted per phase. Plans without phases are unchanged.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parsePlan, formatPlan, phaseGroups, findPhase, createPlanStore } from '../plans.mjs';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'plan-phases-'));
const phased = () => {
  const s = createPlanStore({ dir: tmp() });
  const p = s.create({ title: 'Ship it', coordinator: 'c1', phases: ['Set up', 'Build', 'Ship'], tasks: [
    { kind: 'build', title: 'Make the repo', phase: 'set up' },
    { kind: 'build', title: 'Write the form', phase: 'Build', after: [1] },
    { kind: 'test', title: 'Test the form', phase: 'Build', after: [2] },
    { kind: 'build', title: 'A loose end' },
  ] });
  return { s, p };
};

test('phases and each task\'s phase are kept in the file and read back in order', () => {
  const { s, p } = phased();
  const text = fs.readFileSync(p.file, 'utf8');
  assert.match(text, /^- Phases: Set up \| Build \| Ship$/m);
  assert.match(text, /^- \[ \] T1 Make the repo\n {2}- Kind: build\n {2}- Phase: Set up$/m);
  const back = s.read(p.id);
  assert.deepEqual(back.phases, ['Set up', 'Build', 'Ship']);
  assert.deepEqual(back.tasks.map((t) => t.phase), ['Set up', 'Build', 'Build', '']); // the plan's own spelling
  assert.equal(formatPlan(back), formatPlan(parsePlan(formatPlan(back))));
});

test('a plan without phases is written and read exactly as before', () => {
  const s = createPlanStore({ dir: tmp() });
  const p = s.create({ title: 'Flat', coordinator: 'c1', tasks: [{ kind: 'build', title: 'One' }] });
  const text = fs.readFileSync(p.file, 'utf8');
  assert.doesNotMatch(text, /Phase/);
  assert.deepEqual(s.read(p.id).phases, []);
  assert.deepEqual(s.phaseRollup(p.id), []);
  assert.deepEqual(phaseGroups(s.read(p.id)).map((g) => [g.name, g.tasks.length]), [['', 1]]);
  // An old file with no Phases line at all.
  const old = parsePlan('# Old\n\n- Plan: p-abc123\n\n## Tasks\n\n- [ ] T1 A\n  - State: open\n');
  assert.deepEqual([old.phases, old.tasks[0].phase], [[], '']);
});

test('a task naming a phase missing from the list (a hand edit) adds it at the end', () => {
  const p = parsePlan('# X\n\n- Plan: p-abc123\n- Phases: Build\n\n## Tasks\n\n- [ ] T1 A\n  - Phase: build\n- [ ] T2 B\n  - Phase: Later\n');
  assert.deepEqual(p.phases, ['Build', 'Later']);
  assert.deepEqual(p.tasks.map((t) => t.phase), ['Build', 'Later']);
  assert.equal(findPhase(p, ' later '), 'Later');
});

test('progress is counted per phase, in order, with tasks in no phase last; dropped tasks count in neither', () => {
  const { s, p } = phased();
  s.claim(p.id, 'T1', 'w1'); s.update(p.id, 'T1', { state: 'done' }, 'w1');
  s.update(p.id, 'T4', { state: 'dropped', note: 'Not needed.' }, 'c1');
  assert.deepEqual(s.phaseRollup(p.id), [
    { name: 'Set up', done: 1, total: 1 }, { name: 'Build', done: 0, total: 2 }, { name: 'Ship', done: 0, total: 0 }, { name: '', done: 0, total: 0 },
  ]);
  assert.deepEqual(phaseGroups(s.read(p.id)).map((g) => [g.name, g.tasks.map((t) => t.id)]), [['Set up', ['T1']], ['Build', ['T2', 'T3']], ['Ship', []], ['', ['T4']]]);
});

test('a task with its own plan counts as that plan\'s tasks in its phase', () => {
  const { s, p } = phased();
  s.claim(p.id, 'T1', 'w1'); s.update(p.id, 'T1', { state: 'done' }, 'w1');
  s.claim(p.id, 'T2', 'w2');
  s.create({ title: 'Form', coordinator: 'w2', parent: { plan: p.id, task: 'T2' }, tasks: [{ kind: 'build', title: 'a' }, { kind: 'build', title: 'b' }, { kind: 'build', title: 'c' }] });
  assert.deepEqual(s.phaseRollup(p.id).find((g) => g.name === 'Build'), { name: 'Build', done: 0, total: 4 });
});

test('tasks are added into a phase, and a phase the plan lacks is refused', () => {
  const { s, p } = phased();
  const r = s.addTasks(p.id, [{ kind: 'build', title: 'Publish', phase: 'ship' }], 'c1');
  assert.equal(r.added[0].phase, 'Ship');
  assert.throws(() => s.addTasks(p.id, [{ kind: 'build', title: 'X', phase: 'Later' }], 'c1'), /does not have\. Its phases are Set up, Build, Ship\. Add the phase first/);
  const flat = s.create({ title: 'Flat', coordinator: 'c2', tasks: [] });
  assert.throws(() => s.addTasks(flat.id, [{ kind: 'build', title: 'X', phase: 'Build' }], 'c2'), /It has no phases yet/);
});

test('the coordinator moves a task to another phase, or out of any; its holder cannot', () => {
  const { s, p } = phased();
  s.claim(p.id, 'T1', 'w1');
  assert.throws(() => s.update(p.id, 'T1', { phase: 'Ship' }, 'w1'), /Only the plan's coordinator moves T1/);
  s.update(p.id, 'T1', { state: 'done', phase: 'set up' }, 'w1'); // naming the phase it is already in is no move
  assert.equal(s.update(p.id, 'T4', { phase: 'Ship' }, 'c1').task.phase, 'Ship');
  assert.equal(s.update(p.id, 'T2', { phase: '' }, 'c1').task.phase, '');
  assert.throws(() => s.update(p.id, 'T3', { phase: 'Nope' }, 'c1'), /has no phase "Nope"/);
  assert.deepEqual(s.read(p.id).tasks.map((t) => t.phase), ['Set up', '', 'Build', 'Ship']);
});

test('the coordinator adds, renames and reorders phases; tasks follow a rename', () => {
  const { s, p } = phased();
  assert.throws(() => s.setPhases(p.id, { phases: ['A'] }, 'w1'), /Only the plan's coordinator changes the phases/);
  let q = s.setPhases(p.id, { phases: ['Set up', 'Build', 'Check', 'Ship'] }, 'c1');
  assert.deepEqual(q.phases, ['Set up', 'Build', 'Check', 'Ship']);
  q = s.setPhases(p.id, { renames: [{ from: 'build', to: 'Make' }] }, 'c1');
  assert.deepEqual(q.phases, ['Set up', 'Make', 'Check', 'Ship']);
  assert.deepEqual(s.read(p.id).tasks.map((t) => t.phase), ['Set up', 'Make', 'Make', '']);
  q = s.setPhases(p.id, { phases: ['Ship', 'Set up', 'Prepare', 'Check'], renames: [{ from: 'Make', to: 'Prepare' }] }, 'c1');
  assert.deepEqual(q.phases, ['Ship', 'Set up', 'Prepare', 'Check']);
  assert.deepEqual(s.read(p.id).tasks.map((t) => t.phase), ['Set up', 'Prepare', 'Prepare', '']);
});

test('a phase with tasks cannot be left out, and names are checked', () => {
  const { s, p } = phased();
  assert.throws(() => s.setPhases(p.id, { phases: ['Set up', 'Ship'] }, 'c1'), /The phase "Build" still has tasks \(T2, T3\)/);
  assert.throws(() => s.setPhases(p.id, { phases: ['Set up', 'Build', 'build'] }, 'c1'), /named twice/);
  assert.throws(() => s.setPhases(p.id, { phases: ['Set up', 'Build', ' '] }, 'c1'), /needs a name/);
  assert.throws(() => s.setPhases(p.id, { renames: [{ from: 'Nope', to: 'X' }] }, 'c1'), /no phase "Nope" to rename/);
  assert.deepEqual(s.read(p.id).phases, ['Set up', 'Build', 'Ship']); // refused calls change nothing
  assert.deepEqual(s.setPhases(p.id, { phases: ['Set up', 'Build'] }, 'c1').phases, ['Set up', 'Build']); // an empty phase can go
  // A "|" in a name would break the file's one line, so it becomes "/".
  assert.deepEqual(s.setPhases(p.id, { phases: ['Set up', 'Build', 'Check | ship'] }, 'c1').phases, ['Set up', 'Build', 'Check / ship']);
  assert.deepEqual(s.read(p.id).phases, ['Set up', 'Build', 'Check / ship']);
});

test('the server gives the phases to plan_read, the plan tools and the Plan panel', () => {
  const src = fs.readFileSync(path.join(root, 'server.mjs'), 'utf8');
  assert.match(src, /tool\('plan_set_phases'/);
  assert.match(src, /phaseProgress: store\.phaseRollup\(p\.id, all\)/);
  assert.match(src, /store\.create\(\{ title, goal, tasks, phases,/);
  assert.match(src, /\{ state: st, note, links, kind, waitsOn, forUser, phase \}/);
  const md = fs.readFileSync(path.join(root, 'prompts', 'optional', 'plans.md'), 'utf8');
  assert.match(md, /more than about eight tasks is grouped into phases/);
  assert.match(md, /plan_set_phases/);
});
