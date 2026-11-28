// A task's brief can be replaced when it goes stale (a moved file, a changed pull request): the coordinator's to do,
// with plan_update_task and brief.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createPlanStore } from '../plans.mjs';

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'plan-brief-'));
const root = path.join(path.dirname(new URL(import.meta.url).pathname.replace(/^\/(\w:)/, '$1')), '..');

test('the coordinator replaces a brief, and the new one is saved in the plan file and read back', () => {
  const s = createPlanStore({ dir: tmp() });
  const p = s.create({ title: 'Docs', tasks: [{ kind: 'build', title: 'Fix the guide', brief: 'Edit docs/old.md.' }], coordinator: 'c1' });
  s.claim(p.id, 'T1', 'w1', 'Worker');
  const r = s.update(p.id, 'T1', { brief: '  Edit docs/guide/new.md.\nDone when it builds.  ' }, 'c1');
  assert.equal(r.task.brief, 'Edit docs/guide/new.md.\nDone when it builds.');
  const back = s.read(p.id).tasks[0];
  assert.equal(back.brief, 'Edit docs/guide/new.md.\nDone when it builds.');
  // the rest of the task is left as it was
  assert.deepEqual([back.state, back.holder, back.note], ['claimed', 'w1', '']);
  assert.doesNotMatch(fs.readFileSync(p.file, 'utf8'), /old\.md/);
});

test('only the coordinator changes a brief, and an empty one is refused', () => {
  const s = createPlanStore({ dir: tmp() });
  const p = s.create({ title: 'Docs', tasks: [{ kind: 'build', title: 'Fix the guide', brief: 'Edit docs/old.md.' }], coordinator: 'c1' });
  s.claim(p.id, 'T1', 'w1');
  assert.throws(() => s.update(p.id, 'T1', { brief: 'Something easier.' }, 'w1'), /Only the plan's coordinator changes the brief of T1/);
  assert.throws(() => s.update(p.id, 'T1', { brief: 'Something easier.' }, 'w2'), /Only the session holding T1/);
  assert.throws(() => s.update(p.id, 'T1', { brief: '   ' }, 'c1'), /A brief cannot be empty/);
  assert.equal(s.read(p.id).tasks[0].brief, 'Edit docs/old.md.');
  // the holder still changes what is its own to change
  assert.equal(s.update(p.id, 'T1', { state: 'done', note: 'Done.' }, 'w1').task.state, 'done');
});

test('plan_update_task offers brief, passes it on, and the plan rules say to use it', () => {
  const src = fs.readFileSync(path.join(root, 'server.mjs'), 'utf8');
  const tool = src.slice(src.indexOf("tool('plan_update_task'"), src.indexOf("tool('plan_read'"));
  assert.match(tool, /brief: d\(z\.string\(\)\.optional\(\), 'Coordinator only/);
  assert.match(tool, /answer, brief, nextQ:/);
  const md = fs.readFileSync(path.join(root, 'prompts', 'optional', 'plans.md'), 'utf8');
  assert.match(md, /replace it with brief on mcp__portal__plan_update_task/);
});
