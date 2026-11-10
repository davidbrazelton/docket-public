// Docket's own plan system (#180): the plan file, task order, claims that never go to two sessions, and plans
// nesting along the session tree with links both ways.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { parsePlan, formatPlan, readyTasks, findLoop, createPlanStore } from '../plans.mjs';

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'plans-'));
const three = [{ kind: 'build', title: 'Write the form', brief: 'The login form.\nDone when it shows.' }, { kind: 'build', title: 'Wire it up', after: [1] }, { kind: 'build', title: 'Write the tests', after: [1] }];

test('a plan file reads back the same, and every task is one checklist line', () => {
  const s = createPlanStore({ dir: tmp() });
  const p = s.create({ title: 'Login page', goal: 'A working login page.', tasks: three, coordinator: 'c1', coordinatorTitle: 'Coordinator' });
  const text = fs.readFileSync(p.file, 'utf8');
  assert.match(text, /^# Login page\n/);
  assert.equal(text.match(/^- \[[ x]\] T\d+ /gm).length, 3);
  assert.match(text, /^ {2}- After: T1$/m);
  assert.match(text, /^ {2}- Brief: The login form\.\n {4}Done when it shows\.$/m);
  const back = s.read(p.id);
  assert.equal(back.title, 'Login page'); assert.equal(back.goal, 'A working login page.'); assert.equal(back.coordinator, 'c1');
  assert.deepEqual(back.tasks.map((t) => [t.id, t.title, t.state, t.after]), [['T1', 'Write the form', 'open', []], ['T2', 'Wire it up', 'open', ['T1']], ['T3', 'Write the tests', 'open', ['T1']]]);
  assert.equal(back.tasks[0].brief, 'The login form.\nDone when it shows.');
  assert.equal(formatPlan(back, (id) => id + '.md'), formatPlan(parsePlan(formatPlan(back, (id) => id + '.md')), (id) => id + '.md'));
});

test('the tick box decides done: a person ticking or unticking the file is honoured', () => {
  const p = parsePlan('# X\n\n- Plan: p-abcd12\n\n## Tasks\n\n- [x] T1 A\n  - State: claimed\n- [ ] T2 B\n  - State: done\n');
  assert.equal(p.tasks[0].state, 'done');
  assert.equal(p.tasks[1].state, 'open');
});

test('tasks wait on the ones they name, and a loop is refused', () => {
  const s = createPlanStore({ dir: tmp() });
  const p = s.create({ title: 'P', tasks: three, coordinator: 'c1' });
  assert.deepEqual(readyTasks(p).map((t) => t.id), ['T1']);
  assert.throws(() => s.claim(p.id, 'T2', 'w1'), /waits on T1/);
  assert.throws(() => s.create({ title: 'Loop', tasks: [{ kind: 'build', title: 'A', after: [2] }, { kind: 'build', title: 'B', after: [1] }] }), /loop/);
  assert.throws(() => s.addTasks(p.id, [{ kind: 'build', title: 'D', after: ['T9'] }], 'c1'), /not in this plan/);
  assert.deepEqual(findLoop([{ id: 'T1', after: ['T2'] }, { id: 'T2', after: ['T1'] }]), ['T1', 'T2', 'T1']);
});

test('two workers never hold the same task, and finishing one frees the tasks waiting on it', () => {
  const s = createPlanStore({ dir: tmp() });
  const p = s.create({ title: 'P', tasks: three, coordinator: 'c1' });
  const a = s.claim(p.id, null, 'w1', 'Worker one');
  assert.equal(a.task.id, 'T1');
  const b = s.claim(p.id, null, 'w2', 'Worker two');
  assert.equal(b.task, null); assert.match(b.why, /T1 is claimed \(Worker one\)/);
  assert.throws(() => s.claim(p.id, 'T1', 'w2'), /already held by Worker one/);
  assert.throws(() => s.update(p.id, 'T1', { state: 'done' }, 'w2'), /Only the session holding T1/);
  const d = s.update(p.id, 'T1', { state: 'done', note: 'Form is in.', links: ['https://github.com/o/r/issues/1'] }, 'w1');
  assert.deepEqual(d.nowReady.map((t) => t.id), ['T2', 'T3']);
  const c = s.claim(p.id, null, 'w2', 'Worker two'), e = s.claim(p.id, null, 'w1', 'Worker one');
  assert.deepEqual([c.task.id, e.task.id], ['T2', 'T3']);
  const back = s.read(p.id).tasks[0];
  assert.deepEqual([back.state, back.holder, back.note, back.links], ['done', 'w1', 'Form is in.', ['https://github.com/o/r/issues/1']]);
});

test('the coordinator can send a task back, and letting go makes it free again', () => {
  const s = createPlanStore({ dir: tmp() });
  const p = s.create({ title: 'P', tasks: [{ kind: 'build', title: 'A' }], coordinator: 'c1' });
  s.claim(p.id, 'T1', 'w1');
  s.update(p.id, 'T1', { state: 'sent_back', note: 'Tests missing' }, 'c1');
  assert.equal(s.read(p.id).tasks[0].holder, 'w1');
  assert.equal(s.claim(p.id, null, 'w2').task, null);
  s.update(p.id, 'T1', { state: 'open' }, 'w1');
  assert.equal(s.claim(p.id, null, 'w2').task.id, 'T1');
});

test('only the coordinator adds tasks, and a new session can take a plan over', () => {
  const s = createPlanStore({ dir: tmp() });
  const p = s.create({ title: 'P', tasks: [{ kind: 'build', title: 'A' }], coordinator: 'c1' });
  assert.throws(() => s.addTasks(p.id, [{ kind: 'build', title: 'B' }], 'w1'), /coordinator/);
  assert.deepEqual(s.addTasks(p.id, [{ kind: 'build', title: 'B', after: ['T1'] }], 'c1').added.map((t) => [t.id, t.after]), [['T2', ['T1']]]);
  s.setCoordinator(p.id, 'c2', 'Fresh one');
  assert.equal(s.read(p.id).coordinator, 'c2');
  s.addTasks(p.id, [{ kind: 'build', title: 'C' }], 'c2');
  assert.equal(s.read(p.id).tasks.length, 3);
});

test('a plan made for a task hangs off it, both files name each other, and progress rolls up', () => {
  const s = createPlanStore({ dir: tmp() });
  const top = s.create({ title: 'Top', tasks: [{ kind: 'build', title: 'A' }, { kind: 'build', title: 'B' }], coordinator: 'c1' });
  s.claim(top.id, 'T2', 'w1');
  const sub = s.create({ title: 'Sub', tasks: [{ kind: 'build', title: 'x' }, { kind: 'build', title: 'y' }, { kind: 'build', title: 'z' }], coordinator: 'w1', parent: { plan: top.id, task: 'T2' } });
  assert.deepEqual(s.read(sub.id).parent, { plan: top.id, task: 'T2' });
  assert.equal(s.read(top.id).tasks[1].plan, sub.id);
  assert.match(fs.readFileSync(s.fileOf(top.id), 'utf8'), new RegExp(`- Plan: \\[${sub.id}\\]\\(${path.basename(s.fileOf(sub.id))}\\)`));
  assert.throws(() => s.create({ title: 'Again', parent: { plan: top.id, task: 'T2' } }), /already has its own plan/);
  assert.deepEqual(s.read(sub.id).tasks.map((t) => t.id), ['T2.1', 'T2.2', 'T2.3']);
  s.claim(sub.id, 'T2.1', 'w2'); s.update(sub.id, 'T2.1', { state: 'done' }, 'w2');
  assert.deepEqual(s.rollup(top.id), { done: 1, total: 4 });
});

test('a claim from another program waits for the lock file, and a lock left by a crash is taken over', () => {
  const dir = tmp(), s = createPlanStore({ dir, waitMs: 300 });
  const p = s.create({ title: 'P', tasks: [{ kind: 'build', title: 'A' }], coordinator: 'c1' });
  fs.writeFileSync(path.join(dir, '.lock'), '');
  assert.throws(() => s.claim(p.id, null, 'w1'), /busy/);
  const old = new Date(Date.now() - 60000); fs.utimesSync(path.join(dir, '.lock'), old, old);
  assert.equal(s.claim(p.id, null, 'w1').task.id, 'T1');
});

test('two programs claiming at the same moment get different tasks', async () => {
  const dir = tmp(), s = createPlanStore({ dir });
  const p = s.create({ title: 'P', tasks: [{ kind: 'build', title: 'A' }, { kind: 'build', title: 'B' }], coordinator: 'c1' });
  const url = new URL('../plans.mjs', import.meta.url).href;
  const script = (w) => `import { createPlanStore } from ${JSON.stringify(url)}; const r = createPlanStore({ dir: ${JSON.stringify(dir)} }).claim(${JSON.stringify(p.id)}, null, '${w}'); console.log(r.task ? r.task.id : 'none');`;
  const runs = await Promise.all([0, 1, 2, 3, 4, 5].map((i) => new Promise((resolve) => {
    const c = spawn(process.execPath, ['--input-type=module', '-e', script('w' + i)]);
    let out = ''; c.stdout.on('data', (d) => { out += d; }); c.on('close', () => resolve(out.trim()));
  })));
  assert.deepEqual(runs.filter((r) => r !== 'none').sort(), ['T1', 'T2']);
});

// #639: task names follow the plan tree, every new task has a kind, and a dropped task stays with its number.
test('task names follow the plan tree, one dot per level, and numbers are never reused', () => {
  const s = createPlanStore({ dir: tmp() });
  const top = s.create({ title: 'Top', tasks: [{ kind: 'build', title: 'A' }, { kind: 'build', title: 'B' }, { kind: 'build', title: 'C' }], coordinator: 'c1' });
  assert.deepEqual(top.tasks.map((t) => t.id), ['T1', 'T2', 'T3']);
  s.claim(top.id, 'T3', 'w1');
  const sub = s.create({ title: 'Sub', tasks: [{ kind: 'build', title: 'x' }, { kind: 'test', title: 'y', after: [1] }], coordinator: 'w1', parent: { plan: top.id, task: 'T3' } });
  assert.deepEqual(sub.tasks.map((t) => [t.id, t.after]), [['T3.1', []], ['T3.2', ['T3.1']]]);
  assert.match(fs.readFileSync(sub.file, 'utf8'), /^- Part of: .*, task T3$/m);
  assert.throws(() => s.claim(sub.id, 't3.2', 'w2'), /T3\.2 waits on T3\.1/);
  s.claim(sub.id, 'T3.1', 'w2'); s.update(sub.id, 'T3.1', { state: 'done' }, 'w2');
  s.claim(sub.id, 'T3.2', 'w3');
  const deep = s.create({ title: 'Deep', tasks: [{ kind: 'research', title: 'z' }], coordinator: 'w3', parent: { plan: sub.id, task: 'T3.2' } });
  assert.equal(deep.tasks[0].id, 'T3.2.1');
  assert.deepEqual(s.read(deep.id).parent, { plan: sub.id, task: 'T3.2' });
  assert.equal(s.read(sub.id).tasks[1].plan, deep.id);
  assert.deepEqual(s.addTasks(sub.id, [{ kind: 'build', title: 'w', after: ['T3.2'] }], 'w1').added.map((t) => [t.id, t.after]), [['T3.3', ['T3.2']]]);
  s.update(sub.id, 'T3.3', { state: 'dropped', note: 'Not needed after all' }, 'w1');
  assert.equal(s.addTasks(sub.id, [{ kind: 'build', title: 'v' }], 'w1').added[0].id, 'T3.4');
  assert.equal(s.update(sub.id, 'T3.4', { note: 'Dotted ids are found' }, 'w1').task.id, 'T3.4');
});

test('a new task needs a kind from the list, and the kind is kept in the file', () => {
  const s = createPlanStore({ dir: tmp() });
  assert.throws(() => s.create({ title: 'P', tasks: [{ title: 'A' }], coordinator: 'c1' }), /Task "A" needs a kind: build, test, decision or research\./);
  const p = s.create({ title: 'P', tasks: [{ kind: 'Decision', title: 'A' }], coordinator: 'c1' });
  assert.throws(() => s.addTasks(p.id, [{ title: 'B' }], 'c1'), /needs a kind/);
  assert.throws(() => s.addTasks(p.id, [{ kind: 'chore', title: 'B' }], 'c1'), /Task "B" has the kind "chore", which is not one of build, test, decision or research\./);
  assert.equal(s.read(p.id).tasks.length, 1);
  assert.match(fs.readFileSync(p.file, 'utf8'), /^- \[ \] T1 A\n {2}- Kind: decision\n {2}- State: open$/m);
  assert.equal(s.read(p.id).tasks[0].kind, 'decision');
  assert.throws(() => s.update(p.id, 'T1', { kind: 'build', note: 'x' }, 'c1'), /T1 already has the kind decision, and a kind never changes/);
  assert.equal(s.read(p.id).tasks[0].kind, 'decision');
  assert.equal(s.read(p.id).tasks[0].note, '');
});

test('a dropped task stays in the plan with its note, frees nothing to reuse, and counts as neither open nor done', () => {
  const s = createPlanStore({ dir: tmp() });
  const p = s.create({ title: 'P', tasks: [{ kind: 'build', title: 'A' }, { kind: 'test', title: 'B', after: [1] }, { kind: 'build', title: 'C' }], coordinator: 'c1' });
  s.claim(p.id, 'T1', 'w1');
  assert.throws(() => s.update(p.id, 'T1', { state: 'dropped', note: 'x' }, 'w1'), /Only the plan's coordinator can drop T1/);
  assert.throws(() => s.update(p.id, 'T3', { state: 'dropped' }, 'c1'), /Say why T3 is dropped, in a one-line note\./);
  s.update(p.id, 'T3', { state: 'dropped', note: 'Covered by T1' }, 'c1');
  assert.match(fs.readFileSync(p.file, 'utf8'), /^- \[ \] T3 C\n {2}- Kind: build\n {2}- State: dropped since .*\n {2}- Note: Covered by T1$/m);
  assert.deepEqual(s.read(p.id).tasks.map((t) => t.state), ['claimed', 'open', 'dropped']);
  assert.deepEqual(s.rollup(p.id), { done: 0, total: 2 });
  assert.throws(() => s.claim(p.id, 'T3', 'w2'), /T3 was dropped: Covered by T1/);
  assert.throws(() => s.update(p.id, 'T3', { state: 'open' }, 'c1'), /stays dropped/);
  s.update(p.id, 'T1', { state: 'done' }, 'w1');
  s.claim(p.id, 'T2', 'w2'); s.update(p.id, 'T2', { state: 'done' }, 'w2');
  assert.deepEqual(s.rollup(p.id), { done: 2, total: 2 });
  assert.equal(s.claim(p.id, null, 'w3').why, 'Every task in this plan is done or dropped.');
  assert.equal(s.addTasks(p.id, [{ kind: 'build', title: 'D' }], 'c1').added[0].id, 'T4');
});

test('a task with the wrong kind is replaced: the old one is dropped and tasks waiting on it wait on the new one', () => {
  const s = createPlanStore({ dir: tmp() });
  const p = s.create({ title: 'P', tasks: [{ kind: 'build', title: 'Pick a vendor' }, { kind: 'build', title: 'Wire the vendor', after: [1] }], coordinator: 'c1' });
  assert.equal(s.addTasks(p.id, [{ kind: 'decision', title: 'Pick a vendor', replaces: 'T1' }], 'c1').added[0].id, 'T3');
  const back = s.read(p.id);
  assert.deepEqual(back.tasks.map((t) => [t.id, t.kind, t.state, t.after]), [['T1', 'build', 'dropped', []], ['T2', 'build', 'open', ['T3']], ['T3', 'decision', 'open', []]]);
  assert.equal(back.tasks[0].note, 'Replaced by T3.');
  assert.deepEqual(readyTasks(back).map((t) => t.id), ['T3']);
  assert.throws(() => s.addTasks(p.id, [{ kind: 'build', title: 'X', replaces: 'T9' }], 'c1'), /replaces T9, which is not in this plan/);
  assert.throws(() => s.addTasks(p.id, [{ kind: 'build', title: 'X', replaces: 'T3', after: ['T2'] }], 'c1'), /loop/);
  assert.equal(s.read(p.id).tasks[2].state, 'open'); // a refused call changes nothing
});

test('a plan file from before names, kinds and dropping reads and works unchanged', () => {
  const dir = tmp(), old = [
    '# Old plan', '', '- Plan: p-0a1b2c', '- Coordinator: c1 (Coordinator)', '- Made: 2026-11-03 09:00', '', 'The goal.', '', '## Tasks', '',
    '- [x] T1 First piece', '  - State: done since 2026-11-04 10:28', '  - Held by: w1 (Worker)', '  - Note: In.',
    '- [ ] T2 Email', '  - State: waiting on the user since 2026-11-04 10:28', '  - Held by: w2 (Worker two)', '  - After: T1',
    '- [ ] T10 Group sends', '  - State: open', '  - After: T1, T2', ''].join('\n');
  fs.writeFileSync(path.join(dir, 'p-0a1b2c-old-plan.md'), old);
  const s = createPlanStore({ dir });
  const p = s.read('p-0a1b2c');
  assert.deepEqual(p.tasks.map((t) => [t.id, t.kind, t.state, t.after]), [['T1', '', 'done', []], ['T2', '', 'waiting_on_user', ['T1']], ['T10', '', 'open', ['T1', 'T2']]]);
  assert.equal(formatPlan(p, (id) => id + '.md'), old);
  assert.deepEqual(s.rollup('p-0a1b2c'), { done: 1, total: 3 });
  assert.equal(s.addTasks('p-0a1b2c', [{ kind: 'build', title: 'New' }], 'c1').added[0].id, 'T11');
  s.update('p-0a1b2c', 'T2', { state: 'done' }, 'w2');
  assert.equal(s.claim('p-0a1b2c', null, 'w3').task.id, 'T10');
  // A task made before kinds gets one filled in, once; after that its kind never changes.
  assert.throws(() => s.update('p-0a1b2c', 'T1', { kind: 'chore' }, 'c1'), /The kind "chore" is not one of build, test, decision or research\./);
  assert.throws(() => s.update('p-0a1b2c', 'T1', { kind: 'build' }, 'w9'), /Only the session holding T1/);
  s.update('p-0a1b2c', 'T1', { kind: 'Build' }, 'c1');
  assert.match(fs.readFileSync(path.join(dir, 'p-0a1b2c-old-plan.md'), 'utf8'), /^- \[x\] T1 First piece\n {2}- Kind: build\n {2}- State: done since 2026-11-04 10:28$/m);
  assert.equal(s.update('p-0a1b2c', 'T1', { kind: 'build' }, 'c1').task.kind, 'build');
  assert.throws(() => s.update('p-0a1b2c', 'T1', { kind: 'test' }, 'c1'), /already has the kind build/);
  assert.equal(s.read('p-0a1b2c').tasks[0].kind, 'build');
  // A plan under a task, made before names followed the tree, keeps numbering T1, T2.
  fs.writeFileSync(path.join(dir, 'p-aaaa11-sub.md'), '# Sub\n\n- Plan: p-aaaa11\n- Coordinator: c2\n- Part of: [p-0a1b2c](p-0a1b2c-old-plan.md), task T10\n\n## Tasks\n\n- [ ] T1 x\n  - State: open\n');
  assert.deepEqual(s.read('p-aaaa11').parent, { plan: 'p-0a1b2c', task: 'T10' });
  assert.equal(s.addTasks('p-aaaa11', [{ kind: 'test', title: 'y' }], 'c2').added[0].id, 'T2');
});

test('"done since" is when the task was set done, and a coordinator doing a task itself is recorded as who did it (#655)', () => {
  let clock = Date.UTC(2026, 10, 4, 2, 10);
  const s = createPlanStore({ dir: tmp(), now: () => clock });
  const p = s.create({ title: 'P', tasks: [{ kind: 'build', title: 'A' }, { kind: 'build', title: 'B' }], coordinator: 'c1', coordinatorTitle: 'Coordinator' });
  s.claim(p.id, 'T1', 'w1', 'Worker');
  clock += 3 * 3600000; s.update(p.id, 'T1', { state: 'waiting_on_user' }, 'w1');
  clock += 3600000; s.update(p.id, 'T1', { state: 'done' }, 'w1');
  s.update(p.id, 'T1', { note: 'In.' }, 'w1'); // a note alone does not move the time
  clock += 3600000; s.update(p.id, 'T2', { state: 'done' }, 'c1', 'Coordinator');
  const text = fs.readFileSync(p.file, 'utf8');
  assert.match(text, /^- \[x\] T1 A\n {2}- Kind: build\n {2}- State: done since 2026-11-04 06:10\n {2}- Held by: w1 \(Worker\)/m);
  assert.match(text, /^- \[x\] T2 B\n {2}- Kind: build\n {2}- State: done since 2026-11-04 07:10\n {2}- Held by: c1 \(Coordinator\)/m);
  assert.deepEqual(s.read(p.id).tasks.map((t) => [t.holder, t.claimedAt]), [['w1', '2026-11-04 06:10'], ['c1', '2026-11-04 07:10']]);
});

test('only the coordinator changes the goal, and the new goal is saved in the plan file and read back (#653)', () => {
  const s = createPlanStore({ dir: tmp() });
  const p = s.create({ title: 'P', goal: 'Done when both pull requests are open.', tasks: [{ kind: 'build', title: 'A' }], coordinator: 'c1' });
  assert.throws(() => s.setGoal(p.id, 'Something else.', 'w1'), /coordinator/);
  assert.throws(() => s.setGoal(p.id, '  ', 'c1'), /empty/);
  s.setGoal(p.id, 'Done when notices are connected.\nAnd Sarah has answered.', 'c1');
  assert.match(fs.readFileSync(p.file, 'utf8'), /^Done when notices are connected\.\nAnd Sarah has answered\.\n\n## Tasks$/m);
  const back = s.read(p.id);
  assert.equal(back.goal, 'Done when notices are connected.\nAnd Sarah has answered.');
  assert.deepEqual(back.tasks.map((t) => t.title), ['A']);
});

test('a handoff passes the old session\'s unfinished tasks to the new one, and leaves the rest (#667)', () => {
  const s = createPlanStore({ dir: tmp() });
  const p = s.create({ title: 'P', coordinator: 'c1', tasks: [{ kind: 'build', title: 'A' }, { kind: 'build', title: 'B' }, { kind: 'build', title: 'C' }] });
  s.claim(p.id, 'T1', 'old', 'Old'); s.claim(p.id, 'T2', 'old', 'Old'); s.claim(p.id, 'T3', 'other', 'Other');
  s.update(p.id, 'T2', { state: 'done' }, 'old');
  assert.deepEqual(s.passTasks(p.id, ['t1', 'T2', 'T3'], 'old', 'new', 'New'), ['T1']);
  const after = s.read(p.id);
  assert.deepEqual(after.tasks.map((t) => [t.id, t.holder, t.holderTitle]), [['T1', 'new', 'New'], ['T2', 'old', 'Old'], ['T3', 'other', 'Other']]);
  // the new session can now change the task it was handed
  assert.equal(s.update(p.id, 'T1', { state: 'done' }, 'new').task.state, 'done');
  assert.deepEqual(s.passTasks(p.id, ['T1'], 'old', 'new'), []);
});
test("the badge's breakdown counts each state, the dropped tasks and the tasks counted as their own plans (#841)", () => {
  const s = createPlanStore({ dir: tmp() });
  const top = s.create({ title: 'Top', tasks: [{ kind: 'build', title: 'A' }, { kind: 'build', title: 'B' }, { kind: 'build', title: 'C' }, { kind: 'build', title: 'D' }], coordinator: 'c1' });
  s.claim(top.id, 'T1', 'w1'); s.update(top.id, 'T1', { state: 'done' }, 'w1');
  s.update(top.id, 'T3', { state: 'dropped', note: 'not needed' }, 'c1');
  s.claim(top.id, 'T2', 'w2');
  const sub = s.create({ title: 'Sub', tasks: [{ kind: 'build', title: 'x' }, { kind: 'build', title: 'y' }, { kind: 'build', title: 'z' }], coordinator: 'w2', parent: { plan: top.id, task: 'T2' } });
  s.claim(sub.id, 'T2.1', 'w3');
  s.update(sub.id, 'T2.3', { state: 'dropped', note: 'not needed' }, 'w2');
  assert.deepEqual(s.rollup(top.id), { done: 1, total: 4 });
  const b = s.breakdown(top.id);
  assert.deepEqual(b.states, { done: 1, claimed: 1, open: 2, dropped: 2 });
  assert.deepEqual({ ...b, states: undefined }, { states: undefined, made: 4, first: 'T1', last: 'T4', dropped: 1, subs: ['T2'], subTotal: 2 });
  assert.equal(s.breakdown('p-none'), null);
});
