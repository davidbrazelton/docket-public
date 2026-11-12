// Tests for tool-watch.mjs: noticing a session's Docket tool list is out of date (#923). Run with: npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { toolNames, toolChange, toolRestartWhy } from '../tool-watch.mjs';

const defs = (...names) => names.map((name) => ({ name }));

test('the names a session is shown leave out hidden tools and are sorted', () => {
  assert.deepEqual(toolNames([...defs('start_session', 'mark_turn'), { name: 'screen_shot', hidden: true }]), ['mark_turn', 'start_session']);
});

test('a session that has not listed its tools yet, or got the same list, has nothing to load', () => {
  assert.equal(toolChange(undefined, ['mark_turn']), null);
  assert.equal(toolChange(['a', 'b'], ['a', 'b']), null);
});

test('tools that come together are named as one family', () => {
  assert.equal(toolChange(['mark_turn'], ['mark_turn', 'plan_create', 'plan_read']), 'plan tools added');
  assert.equal(toolChange(['key_press', 'mark_turn', 'mouse_click', 'screen_shot'], ['mark_turn']), 'screen tools removed');
  assert.equal(toolChange(['mark_turn'], ['mark_turn', 'pilot_answer', 'pilot_pending']), 'autopilot tools added');
});

test('other tools are named one by one, and added and removed both show', () => {
  assert.equal(toolChange(['mark_turn', 'old_tool'], ['mark_turn', 'new_tool', 'plan_read']), 'plan tools, new_tool added; old_tool removed');
});

test('why a session restarts: its tools, else Refresh, else no reason', () => {
  assert.equal(toolRestartWhy('plan tools added', false), 'to load its Docket tools: plan tools added');
  assert.equal(toolRestartWhy('plan tools added', true), 'to load its Docket tools: plan tools added');
  assert.equal(toolRestartWhy(null, true), 'because the user pressed Refresh');
  assert.equal(toolRestartWhy(null, false), null);
});
