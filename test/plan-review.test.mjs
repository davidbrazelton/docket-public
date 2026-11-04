// The one-time review against new plan rules (#661): asked once per plan per rules version, only of open plans,
// only when the coordinator can be reached, and the nudge itself never changes a plan file.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { parsePlan, createPlanStore, reviewDue, PLAN_RULES_VERSION } from '../plans.mjs';
import { nextReview, reviewSent, reviewText } from '../plan-review.mjs';

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'plan-review-'));
const OLD = '# Old plan\n\n- Plan: p-old123\n- Coordinator: c1 (Coordinator)\n- Made: 2026-10-01 09:00\n\nShip it.\n\n## Tasks\n\n- [x] T1 First\n  - State: done\n- [ ] T2 Second\n  - State: open\n';
// An old-style plan file, written straight to the folder the way plans made before this version are.
function oldPlan(dir, text = OLD, name = 'p-old123-old-plan.md') { fs.mkdirSync(dir, { recursive: true }); fs.writeFileSync(path.join(dir, name), text); return path.join(dir, name); }
const all = () => true;

test('a plan file without the rules line reads as not reviewed, and is due while open', () => {
  const p = parsePlan(OLD);
  assert.equal(p.rulesChecked, 0);
  assert.equal(reviewDue(p), true);
});

test('a plan made now starts at the current rules version and is never due', () => {
  const s = createPlanStore({ dir: tmp() });
  const p = s.create({ title: 'New', tasks: [{ kind: 'build', title: 'A' }], coordinator: 'c1' });
  assert.match(fs.readFileSync(p.file, 'utf8'), new RegExp(`^- Rules checked: ${PLAN_RULES_VERSION}$`, 'm'));
  assert.equal(s.read(p.id).rulesChecked, PLAN_RULES_VERSION);
  assert.equal(reviewDue(s.read(p.id)), false);
  assert.equal(nextReview({ plans: s.list(), canReach: all }), null);
});

test('finished plans are left alone: every task done or dropped, or no tasks at all', () => {
  const done = parsePlan(OLD.replace('- [ ] T2 Second\n  - State: open', '- [ ] T2 Second\n  - State: dropped'));
  const empty = parsePlan('# E\n\n- Plan: p-empty1\n- Coordinator: c1\n\n## Tasks\n');
  assert.equal(reviewDue(done), false);
  assert.equal(reviewDue(empty), false);
  assert.equal(nextReview({ plans: [done, empty], canReach: all }), null);
});

test('once per plan per rules version and coordinator: a sent nudge is not sent again', () => {
  const p = parsePlan(OLD);
  assert.equal(nextReview({ plans: [p], canReach: all })?.id, 'p-old123');
  const sent = { 'p-old123': { version: PLAN_RULES_VERSION, to: 'c1', at: 1 } };
  assert.equal(reviewSent(p, sent), true);
  assert.equal(nextReview({ plans: [p], sent, canReach: all }), null);
  // A new coordinator (plan_take_over) clears the way; so does a later rules version.
  assert.equal(nextReview({ plans: [{ ...p, coordinator: 'c2' }], sent, canReach: all })?.coordinator, 'c2');
  assert.equal(nextReview({ plans: [p], sent, canReach: all, version: PLAN_RULES_VERSION + 1 })?.id, 'p-old123');
});

test('a closed coordinator is skipped, and gets it once it can be reached; a plan with none keeps waiting', () => {
  const p = parsePlan(OLD), lone = parsePlan(OLD.replace('- Coordinator: c1 (Coordinator)\n', '').replace('p-old123', 'p-lone12'));
  let open = new Set();
  const canReach = (id) => open.has(id);
  assert.equal(nextReview({ plans: [p, lone], canReach }), null);
  open = new Set(['c1']);
  assert.equal(nextReview({ plans: [p, lone], canReach })?.id, 'p-old123');
  assert.equal(reviewDue(lone), true); // still tagged
});

test('one plan at a time: each call picks one', () => {
  const a = parsePlan(OLD), b = parsePlan(OLD.replace('p-old123', 'p-old456').replace('c1 (', 'c9 ('));
  const sent = {};
  const first = nextReview({ plans: [a, b], sent, canReach: all });
  sent[first.id] = { version: PLAN_RULES_VERSION, to: first.coordinator, at: 1 };
  const second = nextReview({ plans: [a, b], sent, canReach: all });
  assert.notEqual(first.id, second.id);
  sent[second.id] = { version: PLAN_RULES_VERSION, to: second.coordinator, at: 2 };
  assert.equal(nextReview({ plans: [a, b], sent, canReach: all }), null);
});

test('picking and wording a nudge leave the plan file as it was', () => {
  const dir = tmp(), f = oldPlan(dir), s = createPlanStore({ dir });
  const before = fs.readFileSync(f, 'utf8');
  const p = nextReview({ plans: s.list(), canReach: all });
  reviewText(p);
  assert.equal(fs.readFileSync(f, 'utf8'), before);
});

test('the tag stays until the coordinator marks the review done, which records the version', () => {
  const dir = tmp(), f = oldPlan(dir), s = createPlanStore({ dir });
  s.setGoal('p-old123', 'Ship it, tested.', 'c1'); // other changes keep it unreviewed
  assert.equal(reviewDue(s.read('p-old123')), true);
  assert.throws(() => s.markReviewed('p-old123', 'w1'), /Only the plan's coordinator/);
  s.markReviewed('p-old123', 'c1');
  assert.match(fs.readFileSync(f, 'utf8'), new RegExp(`^- Rules checked: ${PLAN_RULES_VERSION}$`, 'm'));
  assert.equal(reviewDue(s.read('p-old123')), false);
  assert.equal(s.read('p-old123').tasks.map((t) => t.state).join(), 'done,open'); // the tasks are untouched
});

test('the message asks for repairs with the plan tools and for no work to be redone', () => {
  const t = reviewText(parsePlan(OLD));
  for (const w of ['replaces', 'for_user', 'waiting_outside', 'waits_on', 'plan_set_goal', 'plan_review_done']) assert.ok(t.includes(w), w);
  assert.match(t, /Do not redo, restart or reopen any work/);
  assert.match(t, /also when nothing needed changing/);
});
