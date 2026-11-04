// Plans (#652): steps only the user can do ("Owner: the user"), and tasks waiting on something outside Docket that
// is not the user ("waiting outside Docket" with a "Waits on" line), both kept in the plan file.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { parsePlan, formatPlan, readyTasks, sessionReady, userSteps, whyNoneReady, createPlanStore } from '../plans.mjs';
import { parseChecklist } from '../plan-folder.mjs';

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'plans-user-'));
const fileOf = (id) => id + '.md';
const tasks = [
  { kind: 'build', title: 'Build the webhook' },
  { kind: 'decision', title: 'Merge the pull request', for_user: true, after: [1] },
  { kind: 'build', title: 'Send the first text', after: [2] },
];

test("a user's step is kept in the file as its owner and reads back the same", () => {
  const s = createPlanStore({ dir: tmp() });
  const p = s.create({ title: 'Hub', tasks, coordinator: 'c1' });
  const text = fs.readFileSync(p.file, 'utf8');
  assert.match(text, /^- \[ \] T2 Merge the pull request\n {2}- Kind: decision\n {2}- Owner: the user\n {2}- State: open\n {2}- After: T1$/m);
  assert.equal((text.match(/Owner:/g) || []).length, 1);
  const back = s.read(p.id);
  assert.deepEqual(back.tasks.map((t) => t.forUser), [false, true, false]);
  assert.equal(formatPlan(back, fileOf), formatPlan(parsePlan(formatPlan(back, fileOf)), fileOf));
});

test("no session claims a user's step; the next task skips it and the coordinator marks it done", () => {
  const s = createPlanStore({ dir: tmp() });
  const p = s.create({ title: 'Hub', tasks, coordinator: 'c1' });
  s.claim(p.id, 'T1', 'w1');
  s.update(p.id, 'T1', { state: 'done' }, 'w1');
  const now = s.read(p.id);
  assert.deepEqual(readyTasks(now).map((t) => t.id), ['T2']);
  assert.deepEqual(sessionReady(now), []);
  assert.deepEqual(userSteps(now).map((t) => t.id), ['T2']);
  assert.match(whyNoneReady(now), /T2 is the user's to do/);
  assert.throws(() => s.claim(p.id, 'T2', 'w2'), /T2 is the user's to do, so no session claims it/);
  assert.equal(s.claim(p.id, null, 'w2').task, null);
  const r = s.update(p.id, 'T2', { state: 'done', note: 'The user merged it.' }, 'c1');
  assert.deepEqual(r.nowReady.map((t) => t.id), ['T3']);
  assert.deepEqual(userSteps(r.plan), []);
});

test("the coordinator can make a task the user's step or give it back, and no one else can", () => {
  const s = createPlanStore({ dir: tmp() });
  const p = s.create({ title: 'Hub', tasks: [{ kind: 'build', title: 'A' }, { kind: 'build', title: 'B' }], coordinator: 'c1' });
  s.claim(p.id, 'T1', 'w1');
  assert.throws(() => s.update(p.id, 'T1', { forUser: true }, 'w1'), /Only the plan's coordinator says whose step T1 is/);
  assert.throws(() => s.update(p.id, 'T1', { forUser: true }, 'c1'), /held by w1; set it open first/);
  assert.equal(s.update(p.id, 'T1', { state: 'open', forUser: true }, 'c1').task.forUser, true);
  assert.match(fs.readFileSync(p.file, 'utf8'), /^- \[ \] T1 A\n {2}- Kind: build\n {2}- Owner: the user\n/m);
  assert.equal(s.update(p.id, 'T1', { forUser: false }, 'c1').task.forUser, false);
  assert.doesNotMatch(fs.readFileSync(p.file, 'utf8'), /Owner:/);
});

test('waiting outside Docket says on what, is not waiting on the user, and clears when the task moves on', () => {
  const s = createPlanStore({ dir: tmp() });
  const p = s.create({ title: 'Hub', tasks: [{ kind: 'build', title: 'Text from the Hub number' }, { kind: 'test', title: 'Check', after: [1] }], coordinator: 'c1' });
  assert.throws(() => s.update(p.id, 'T1', { state: 'waiting_outside' }, 'c1'), /Say what T1 waits on outside Docket/);
  assert.throws(() => s.update(p.id, 'T1', { waitsOn: 'Quo' }, 'c1'), /only with the state waiting_outside/);
  const r = s.update(p.id, 'T1', { state: 'waiting_outside', waitsOn: "Quo to issue the Hub's phone number" }, 'c1');
  assert.equal(r.task.state, 'waiting_outside');
  const text = fs.readFileSync(p.file, 'utf8');
  assert.match(text, /^ {2}- State: waiting outside Docket since .*\n {2}- Waits on: Quo to issue the Hub's phone number$/m);
  const back = s.read(p.id);
  assert.equal(back.tasks[0].state, 'waiting_outside');
  assert.equal(back.tasks[0].waitsOn, "Quo to issue the Hub's phone number");
  assert.equal(formatPlan(back, fileOf), text.replace(/\r\n/g, '\n'));
  assert.match(whyNoneReady(back), /T1 is waiting outside Docket on Quo to issue the Hub's phone number/);
  assert.doesNotMatch(whyNoneReady(back), /waiting on the user/);
  assert.throws(() => s.claim(p.id, 'T1', 'w1'), /T1 is waiting outside Docket on Quo/);
  // The note can change what it waits on while it still waits.
  assert.equal(s.update(p.id, 'T1', { waitsOn: 'Quo, due Friday' }, 'c1').task.waitsOn, 'Quo, due Friday');
  // When it arrives the task goes back to open, and the line goes.
  s.update(p.id, 'T1', { state: 'open' }, 'c1');
  assert.equal(s.read(p.id).tasks[0].waitsOn, '');
  assert.doesNotMatch(fs.readFileSync(p.file, 'utf8'), /Waits on:/);
  assert.equal(s.claim(p.id, null, 'w1').task.id, 'T1');
  // A session holding a task can set it waiting outside, and carry on later.
  s.update(p.id, 'T1', { state: 'waiting_outside', waitsOn: 'the vendor' }, 'w1');
  assert.equal(s.claim(p.id, 'T1', 'w1').already, true);
  assert.equal(s.update(p.id, 'T1', { state: 'claimed' }, 'w1').task.waitsOn, '');
});

test('a plan file from before these lines reads and writes back unchanged, with no user steps and no outside waits', () => {
  const old = '# Old\n\n- Plan: p-0c0c0c\n- Coordinator: c1\n\n## Tasks\n\n- [x] T1 One\n  - Kind: build\n  - State: done since 2026-11-01 09:00\n- [ ] T2 Two\n  - State: waiting on the user since 2026-11-01 10:00\n  - Held by: w1 (Worker)\n  - After: T1\n';
  const p = parsePlan(old);
  assert.deepEqual(p.tasks.map((t) => [t.state, t.forUser, t.waitsOn]), [['done', false, ''], ['waiting_on_user', false, '']]);
  assert.equal(formatPlan(p, fileOf), old);
});

test("the read-only plan folder reads a user's step and an outside wait from a Docket plan file", () => {
  const dir = tmp();
  const f = path.join(dir, 'p-1d1d1d-hub.md');
  fs.writeFileSync(f, '# Hub\n\n## Tasks\n\n- [ ] T1 Merge it\n  - Owner: the user\n- [ ] T2 Text\n  - State: waiting outside Docket since 2026-11-04 10:00\n  - Waits on: Quo\n');
  const p = parseChecklist(fs.readFileSync(f, 'utf8'), f);
  assert.deepEqual(p.items.map((i) => [i.id, i.state, i.forUser, i.waitsOn]), [['T1', 'open', true, ''], ['T2', 'waiting_outside', false, 'Quo']]);
});

test("the coordinator setting a user's step done does not record itself as the one who did it", () => {
  const s = createPlanStore({ dir: tmp() });
  const p = s.create({ title: 'Hub', tasks: [{ kind: 'decision', title: 'Merge it', for_user: true }], coordinator: 'c1' });
  const t = s.update(p.id, 'T1', { state: 'done' }, 'c1').task;
  assert.equal(t.state, 'done');
  assert.equal(t.holder, '');
});
