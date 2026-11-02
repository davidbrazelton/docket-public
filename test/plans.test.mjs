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
const three = [{ title: 'Write the form', brief: 'The login form.\nDone when it shows.' }, { title: 'Wire it up', after: [1] }, { title: 'Write the tests', after: [1] }];

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
  assert.throws(() => s.create({ title: 'Loop', tasks: [{ title: 'A', after: [2] }, { title: 'B', after: [1] }] }), /loop/);
  assert.throws(() => s.addTasks(p.id, [{ title: 'D', after: ['T9'] }], 'c1'), /not in this plan/);
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
  const p = s.create({ title: 'P', tasks: [{ title: 'A' }], coordinator: 'c1' });
  s.claim(p.id, 'T1', 'w1');
  s.update(p.id, 'T1', { state: 'sent_back', note: 'Tests missing' }, 'c1');
  assert.equal(s.read(p.id).tasks[0].holder, 'w1');
  assert.equal(s.claim(p.id, null, 'w2').task, null);
  s.update(p.id, 'T1', { state: 'open' }, 'w1');
  assert.equal(s.claim(p.id, null, 'w2').task.id, 'T1');
});

test('only the coordinator adds tasks, and a new session can take a plan over', () => {
  const s = createPlanStore({ dir: tmp() });
  const p = s.create({ title: 'P', tasks: [{ title: 'A' }], coordinator: 'c1' });
  assert.throws(() => s.addTasks(p.id, [{ title: 'B' }], 'w1'), /coordinator/);
  assert.deepEqual(s.addTasks(p.id, [{ title: 'B', after: ['T1'] }], 'c1').added.map((t) => [t.id, t.after]), [['T2', ['T1']]]);
  s.setCoordinator(p.id, 'c2', 'Fresh one');
  assert.equal(s.read(p.id).coordinator, 'c2');
  s.addTasks(p.id, [{ title: 'C' }], 'c2');
  assert.equal(s.read(p.id).tasks.length, 3);
});

test('a plan made for a task hangs off it, both files name each other, and progress rolls up', () => {
  const s = createPlanStore({ dir: tmp() });
  const top = s.create({ title: 'Top', tasks: [{ title: 'A' }, { title: 'B' }], coordinator: 'c1' });
  s.claim(top.id, 'T2', 'w1');
  const sub = s.create({ title: 'Sub', tasks: [{ title: 'x' }, { title: 'y' }, { title: 'z' }], coordinator: 'w1', parent: { plan: top.id, task: 'T2' } });
  assert.deepEqual(s.read(sub.id).parent, { plan: top.id, task: 'T2' });
  assert.equal(s.read(top.id).tasks[1].plan, sub.id);
  assert.match(fs.readFileSync(s.fileOf(top.id), 'utf8'), new RegExp(`- Plan: \\[${sub.id}\\]\\(${path.basename(s.fileOf(sub.id))}\\)`));
  assert.throws(() => s.create({ title: 'Again', parent: { plan: top.id, task: 'T2' } }), /already has its own plan/);
  s.claim(sub.id, 'T1', 'w2'); s.update(sub.id, 'T1', { state: 'done' }, 'w2');
  assert.deepEqual(s.rollup(top.id), { done: 1, total: 4 });
});

test('a claim from another program waits for the lock file, and a lock left by a crash is taken over', () => {
  const dir = tmp(), s = createPlanStore({ dir, waitMs: 300 });
  const p = s.create({ title: 'P', tasks: [{ title: 'A' }], coordinator: 'c1' });
  fs.writeFileSync(path.join(dir, '.lock'), '');
  assert.throws(() => s.claim(p.id, null, 'w1'), /busy/);
  const old = new Date(Date.now() - 60000); fs.utimesSync(path.join(dir, '.lock'), old, old);
  assert.equal(s.claim(p.id, null, 'w1').task.id, 'T1');
});

test('two programs claiming at the same moment get different tasks', async () => {
  const dir = tmp(), s = createPlanStore({ dir });
  const p = s.create({ title: 'P', tasks: [{ title: 'A' }, { title: 'B' }], coordinator: 'c1' });
  const url = new URL('../plans.mjs', import.meta.url).href;
  const script = (w) => `import { createPlanStore } from ${JSON.stringify(url)}; const r = createPlanStore({ dir: ${JSON.stringify(dir)} }).claim(${JSON.stringify(p.id)}, null, '${w}'); console.log(r.task ? r.task.id : 'none');`;
  const runs = await Promise.all([0, 1, 2, 3, 4, 5].map((i) => new Promise((resolve) => {
    const c = spawn(process.execPath, ['--input-type=module', '-e', script('w' + i)]);
    let out = ''; c.stdout.on('data', (d) => { out += d; }); c.on('close', () => resolve(out.trim()));
  })));
  assert.deepEqual(runs.filter((r) => r !== 'none').sort(), ['T1', 'T2']);
});
