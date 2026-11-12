// Tests for budget-stop.mjs, a desk's daily budget as a stop (#959). Run with: npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { today, budgetStopped, continuedToday, heldLine, toolNotice, release } from '../budget-stop.mjs';

test('the day is the computer\'s own calendar day, as YYYY-MM-DD', () => {
  assert.equal(today(new Date(2026, 10, 3, 23, 59)), '2026-11-03');
  assert.match(today(), /^\d{4}-\d{2}-\d{2}$/);
});

test('a desk is stopped at or over its budget, and never without one', () => {
  const day = '2026-11-11';
  assert.equal(budgetStopped({ budget: 0, spent: 500, day }), false, 'no budget: never stopped');
  assert.equal(budgetStopped({ budget: 50, spent: 49.99, day }), false);
  assert.equal(budgetStopped({ budget: 50, spent: 50, day }), true, 'reaching it is enough');
  assert.equal(budgetStopped({ budget: 50, spent: 80, day }), true);
});

test('Continue today lifts the stop for that day only', () => {
  const rec = { day: '2026-11-11', continued: true };
  assert.equal(continuedToday(rec, '2026-11-11'), true);
  assert.equal(budgetStopped({ budget: 50, spent: 80, rec, day: '2026-11-11' }), false);
  assert.equal(continuedToday(rec, '2026-11-12'), false);
  assert.equal(budgetStopped({ budget: 50, spent: 80, rec, day: '2026-11-12' }), true, 'over again the next day: stopped again');
  assert.equal(continuedToday(undefined, '2026-11-11'), false);
});

test('release hands back what was held, in order, and empties the record', () => {
  const rec = { held: [{ id: 'a' }, { id: 'b' }] };
  assert.deepEqual(release(rec).map((x) => x.id), ['a', 'b']);
  assert.deepEqual(rec.held, []);
  assert.deepEqual(release(undefined), []);
});

test('the chat line says whose message is held and how to let it go', () => {
  assert.match(heldLine({ budget: 5, spent: 5.2 }), /^Your message is held, not sent: this desk's daily budget of \$5\.00 is reached \(\$5\.20 spent today\)/);
  assert.match(heldLine({ budget: 5, spent: 6, from: 'session' }), /^A message from another session/);
  assert.match(heldLine({ budget: 5, spent: 6, from: 'brief' }), /^This session's brief/);
  assert.match(heldLine({ budget: 5, spent: 6, system: true }), /^A message from Docket/);
  assert.match(heldLine({ budget: 5, spent: 6 }), /Continue today/);
});

test('a session using a tool is told the work is held, and not to send it again', () => {
  const t = toolNotice({ budget: 1, spent: 1.5 });
  assert.match(t, /daily budget of \$1\.00 is reached \(\$1\.50 spent today\)/);
  assert.match(t, /Do not send it again/);
});
