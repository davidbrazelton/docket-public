// Tests for tasks.mjs: the task list a session's Details panel shows. Run with: npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { taskChanges, mergeTask, newScan, repairChanges, markedDone, STUCK_MINUTES, stalledSteps, stallLimit, endedDuring, stuckChanges, talksInTranscript, runningJobs, jobText } from '../tasks.mjs';

const running = (tasks) => [...tasks.values()].filter((t) => t.status === 'running' && !t.ambient).length;
const apply = (tasks, changes) => { for (const [k, p] of changes) mergeTask(tasks, k, p); };
const sys = (subtype, fields) => ({ type: 'system', subtype, uuid: 'u', session_id: 's', ...fields });

// The messages a background Agent-tool subagent produces, in order, with the fields the SDK sends.
const AGENT = { tool_use_id: 'toolu_A', task_id: 'a55b8d6b0964be18b' };
const agentRun = [
  sys('task_started', { ...AGENT, description: 'End-to-end local run', subagent_type: 'general-purpose', task_type: 'local_agent', is_backgrounded: true, spawn_depth: 1 }),
  sys('task_progress', { ...AGENT, description: 'End-to-end local run', last_tool_name: 'Bash', usage: { total_tokens: 10, tool_uses: 1, duration_ms: 5 } }),
  sys('task_updated', { task_id: AGENT.task_id, patch: { status: 'completed', end_time: 2000 } }),
  sys('task_notification', { ...AGENT, status: 'completed', output_file: 'x', summary: 'Agent "End-to-end local run" completed' }),
];

test('a background subagent counts as running from task_started until its notification', () => {
  const tasks = new Map();
  mergeTask(tasks, 'toolu_A', { tool: 'Agent', label: 'End-to-end local run' }); // the Agent tool call itself
  apply(tasks, taskChanges(tasks, agentRun[0]));
  assert.equal(running(tasks), 1);
  apply(tasks, taskChanges(tasks, agentRun[1]));
  assert.equal(running(tasks), 1);
  assert.equal(tasks.get('toolu_A').progress, 'Bash');
  apply(tasks, taskChanges(tasks, agentRun[2]));
  apply(tasks, taskChanges(tasks, agentRun[3]));
  assert.equal(running(tasks), 0);
  assert.equal(tasks.size, 1);
  assert.equal(tasks.get('toolu_A').status, 'completed');
});

test('an ending for a task never seen starting makes one finished row, not two blank ones', () => {
  const tasks = new Map();
  apply(tasks, taskChanges(tasks, sys('task_updated', { task_id: AGENT.task_id, patch: { status: 'killed', end_time: 5 } })));
  assert.equal(tasks.size, 0);
  apply(tasks, taskChanges(tasks, sys('task_notification', { ...AGENT, status: 'stopped', output_file: 'x', summary: 'End-to-end local run' })));
  assert.equal(tasks.size, 1);
  const t = tasks.get('toolu_A');
  assert.equal(t.label, 'End-to-end local run');
  assert.equal(t.status, 'stopped');
  assert.equal(t.start, undefined);
});

// A project folder as Claude writes it, for session `sid`.
function project({ agents = [], lines = [] }) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'docket-tasks-'));
  const transcript = path.join(dir, 'sid.jsonl');
  const sub = path.join(dir, 'sid', 'subagents');
  fs.mkdirSync(sub, { recursive: true });
  for (const a of agents) {
    fs.writeFileSync(path.join(sub, `agent-${a.id}.meta.json`), JSON.stringify({ agentType: 'general-purpose', description: a.description, toolUseId: a.toolUseId, requestShape: 'background', ...(a.finished ? { finished: true } : {}) }));
    fs.writeFileSync(path.join(sub, `agent-${a.id}.jsonl`), JSON.stringify({ type: 'assistant', message: { content: [{ type: 'tool_use', id: 'toolu_x', name: 'Bash', input: {} }] } }) + '\n');
  }
  fs.writeFileSync(transcript, lines.map((l) => JSON.stringify(l)).join('\n') + '\n');
  return { dir, transcript };
}
const notice = (taskId, toolUseId, status, at = '2099-01-01T00:00:00Z') => ({
  type: 'queue-operation', operation: 'enqueue', timestamp: at,
  content: `<task-notification>\n<task-id>${taskId}</task-id>\n<tool-use-id>${toolUseId}</tool-use-id>\n<output-file>x</output-file>\n<status>${status}</status>\n<summary>Agent finished</summary>\n</task-notification>`,
});
const threeAgents = () => project({
  agents: [
    { id: 'aRun', toolUseId: 'toolu_run', description: 'Still working' },
    { id: 'aDone', toolUseId: 'toolu_done', description: 'Finished one' },
    { id: 'aKilled', toolUseId: 'toolu_killed', description: 'Stopped one' },
  ],
  lines: [notice('aDone', 'toolu_done', 'completed'), notice('aKilled', 'toolu_killed', 'killed')],
});

test('repair after a restart: one running agent, one finished, one stopped, no blank rows', () => {
  const { transcript } = threeAgents();
  const tasks = new Map();
  apply(tasks, repairChanges(tasks, { transcript, scan: newScan() }));
  assert.equal(tasks.size, 3);
  assert.equal(running(tasks), 1);
  const run = tasks.get('toolu_run');
  assert.equal(run.label, 'Still working');
  assert.equal(run.taskId, 'aRun');
  assert.equal(run.recovered, true);
  assert.match(run.progress, /Bash/);
  assert.equal(tasks.get('toolu_done').status, 'completed');
  assert.equal(tasks.get('toolu_killed').status, 'stopped');
  for (const t of tasks.values()) assert.ok(t.label && t.start, 'every row has a name and a start');
});

test('a live notification after the repair closes the recovered row, with no duplicate', () => {
  const { transcript } = threeAgents();
  const tasks = new Map();
  apply(tasks, repairChanges(tasks, { transcript, scan: newScan() }));
  // task_updated names only the agent id; it must find the row filed under the tool call id.
  apply(tasks, taskChanges(tasks, sys('task_updated', { task_id: 'aRun', patch: { status: 'completed' } })));
  apply(tasks, taskChanges(tasks, sys('task_notification', { task_id: 'aRun', tool_use_id: 'toolu_run', status: 'completed', output_file: 'x', summary: 'done' })));
  assert.equal(tasks.size, 3);
  assert.equal(running(tasks), 0);
  assert.equal(tasks.get('toolu_run').progress, undefined); // the ending shows, not the last step
});

test('a notice written to the conversation later closes the recovered row on the next repair', () => {
  const p = threeAgents();
  const tasks = new Map(), scan = newScan();
  apply(tasks, repairChanges(tasks, { transcript: p.transcript, scan }));
  assert.equal(running(tasks), 1);
  fs.appendFileSync(p.transcript, JSON.stringify(notice('aRun', 'toolu_run', 'failed')) + '\n');
  apply(tasks, repairChanges(tasks, { transcript: p.transcript, scan }));
  assert.equal(running(tasks), 0);
  assert.equal(tasks.get('toolu_run').status, 'failed');
  assert.equal(tasks.size, 3);
});

test('agents and commands from before the current process are not brought back', () => {
  const { transcript } = threeAgents();
  const tasks = new Map();
  apply(tasks, repairChanges(tasks, { transcript, scan: newScan(), since: Date.now() + 60000 }));
  assert.equal(tasks.size, 0);
});

test('a background command with no ending notice is recovered; one with a notice is finished', () => {
  const at = new Date().toISOString();
  const call = (id, description) => ({ type: 'assistant', timestamp: at, message: { content: [{ type: 'tool_use', id, name: 'Bash', input: { command: 'sleep 100', description, run_in_background: true } }] } });
  const { transcript } = project({ lines: [call('toolu_b1', 'Wait for the build'), call('toolu_b2', 'Quick one'), notice('bx2', 'toolu_b2', 'completed')] });
  const tasks = new Map();
  apply(tasks, repairChanges(tasks, { transcript, scan: newScan(), since: Date.now() - 60000 }));
  assert.equal(running(tasks), 1);
  assert.equal(tasks.get('toolu_b1').label, 'Wait for the build');
  assert.equal(tasks.get('toolu_b1').progress, 'recovered, progress unknown');
  assert.equal(tasks.get('toolu_b2').status, 'completed');
});

test('when the session has stopped, a job still shown running becomes unknown', () => {
  const tasks = new Map();
  mergeTask(tasks, 'toolu_run', { label: 'Still working', recovered: true });
  apply(tasks, repairChanges(tasks, { transcript: 'none', scan: newScan(), alive: false }));
  assert.equal(tasks.get('toolu_run').status, 'unknown');
  assert.equal(running(tasks), 0);
});

test('a job still running from before a runner restart becomes unknown', () => {
  const tasks = new Map();
  mergeTask(tasks, 'toolu_old', { label: 'Old agent' }, 1000);
  apply(tasks, repairChanges(tasks, { transcript: 'none', scan: newScan(), since: 2000 }));
  assert.equal(tasks.get('toolu_old').status, 'unknown');
});

test('an older notice does not close a task that started again after it', () => {
  const p = project({ agents: [{ id: 'aRe', toolUseId: 'toolu_re', description: 'Resumed' }], lines: [notice('aRe', 'toolu_re', 'completed', '2000-01-01T00:00:00Z')] });
  const tasks = new Map();
  apply(tasks, taskChanges(tasks, sys('task_started', { task_id: 'aRe', tool_use_id: 'toolu_re', description: 'Resumed', task_type: 'local_agent', is_backgrounded: true })));
  apply(tasks, repairChanges(tasks, { transcript: p.transcript, scan: newScan() }));
  assert.equal(running(tasks), 1);
});

test('a background call that failed never ran, and a stopped command is finished', () => {
  const at = new Date().toISOString();
  const call = (id, name, input) => ({ type: 'assistant', timestamp: at, message: { content: [{ type: 'tool_use', id, name, input: { run_in_background: true, ...input } }] } });
  const answer = (id, text, is_error = false) => ({ type: 'user', timestamp: at, message: { content: [{ type: 'tool_result', tool_use_id: id, content: text, is_error }] } });
  const { transcript } = project({ lines: [
    call('toolu_f', 'Agent', { description: 'Never started' }), answer('toolu_f', 'worktree isolation needs git', true),
    call('toolu_s', 'Bash', { description: 'Wait 12 minutes', command: 'sleep 720' }), answer('toolu_s', 'Command running in background with ID: be30yqxef. Output is being written to: x'),
    { type: 'assistant', timestamp: at, message: { content: [{ type: 'tool_use', id: 'toolu_stop', name: 'TaskStop', input: { task_id: 'be30yqxef' } }] } },
  ] });
  const tasks = new Map();
  apply(tasks, repairChanges(tasks, { transcript, scan: newScan(), since: Date.now() - 60000 }));
  assert.equal(tasks.has('toolu_f'), false);
  assert.equal(tasks.get('toolu_s').status, 'stopped');
  assert.equal(running(tasks), 0);
});

test('a subagent the session waited for ends with its answer', () => {
  const at = new Date().toISOString();
  const p = project({ agents: [{ id: 'aFg', toolUseId: 'toolu_fg', description: 'Foreground research' }], lines: [
    { type: 'assistant', timestamp: at, message: { content: [{ type: 'tool_use', id: 'toolu_fg', name: 'Agent', input: { description: 'Foreground research' } }] } },
    { type: 'user', timestamp: at, message: { content: [{ type: 'tool_result', tool_use_id: 'toolu_fg', content: [{ type: 'text', text: '# Findings' }] }] } },
  ] });
  const tasks = new Map();
  apply(tasks, repairChanges(tasks, { transcript: p.transcript, scan: newScan() }));
  assert.equal(running(tasks), 0);
  assert.equal(tasks.get('toolu_fg').status, 'completed');
});

test('the real messages of a background Agent-tool run (captured 2026-10-23) count it running, then done', () => {
  const msgs = fs.readFileSync(new URL('./fixtures/background-agent.ndjson', import.meta.url), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
  const tasks = new Map(), seen = [];
  for (const m of msgs) {
    // What server.mjs does with the call and its answer (convertMessage, applyToolResult).
    if (m.type === 'assistant') for (const b of m.message.content) if (b.name === 'Agent') mergeTask(tasks, b.id, { tool: b.name, label: b.input.description });
    if (m.type === 'user') for (const b of m.message.content) {
      const text = b.content.map((x) => x.text).join('\n');
      assert.match(text, /^Async agent launched/); // so the answer does not end the task
    }
    if (m.type === 'system') apply(tasks, taskChanges(tasks, m));
    seen.push(running(tasks));
  }
  assert.deepEqual(seen, [1, 1, 1, 1, 1, 0, 0, 0]);
  assert.equal(tasks.size, 1);
  assert.equal([...tasks.values()][0].label, 'Sleep test for Docket 90');
});

// ---------- a job that holds a finished turn with no sign of life ----------
const MIN = 60000;
const age = (file, ms) => { const t = new Date(Date.now() - ms); fs.utimesSync(file, t, t); };
// A background command whose ending never came: the call, and the answer naming its output file.
function stuckCommand() {
  const { dir, transcript } = project({});
  const output = path.join(dir, 'bwait.output');
  fs.writeFileSync(output, 'waiting for the run log\n');
  const at = new Date(Date.now() - 20 * MIN).toISOString();
  fs.writeFileSync(transcript, [
    { type: 'assistant', timestamp: at, message: { content: [{ type: 'tool_use', id: 'toolu_w', name: 'Bash', input: { command: 'tail -f run.log', description: 'Wait for the run log', run_in_background: true } }] } },
    { type: 'user', timestamp: at, message: { content: [{ type: 'tool_result', tool_use_id: 'toolu_w', content: `Command running in background with ID: bwait. Output is being written to: ${output}. You will be notified when it completes.` }] } },
  ].map((l) => JSON.stringify(l)).join('\n') + '\n');
  const tasks = new Map();
  mergeTask(tasks, 'toolu_w', { taskId: 'bwait', tool: 'Bash', label: 'Wait for the run log', background: true }, Date.now() - 20 * MIN);
  return { transcript, output, tasks };
}

test(`a job with no sign of life for ${STUCK_MINUTES} minutes stops holding the turn`, () => {
  const { transcript, output, tasks } = stuckCommand();
  age(transcript, 20 * MIN); age(output, 20 * MIN);
  apply(tasks, repairChanges(tasks, { transcript, scan: newScan(), since: Date.now() - 60 * MIN }));
  assert.equal(running(tasks), 1, 'a turn not held is left alone');
  apply(tasks, repairChanges(tasks, { transcript, scan: newScan(), since: Date.now() - 60 * MIN, held: true }));
  assert.equal(running(tasks), 0, 'nothing left running, so the hold is released');
  assert.equal(tasks.get('toolu_w').status, 'unknown');
  assert.match(tasks.get('toolu_w').progress, /^no sign of life for 20 min/);
});

test('a job still writing output, or still heard from, keeps the hold', () => {
  const { transcript, output, tasks } = stuckCommand();
  age(transcript, 20 * MIN); age(output, 1 * MIN); // the command printed a minute ago
  apply(tasks, repairChanges(tasks, { transcript, scan: newScan(), since: Date.now() - 60 * MIN, held: true }));
  assert.equal(running(tasks), 1);

  age(output, 20 * MIN); // quiet output, but a progress message was heard two minutes ago
  apply(tasks, taskChanges(tasks, sys('task_progress', { tool_use_id: 'toolu_w', task_id: 'bwait', summary: 'Still waiting' }), Date.now() - 2 * MIN));
  apply(tasks, repairChanges(tasks, { transcript, scan: newScan(), since: Date.now() - 60 * MIN, held: true }));
  assert.equal(running(tasks), 1);

  const quiet = new Map(); // a subagent whose own log was written a minute ago
  const p = project({ agents: [{ id: 'aBusy', toolUseId: 'toolu_busy', description: 'Busy agent' }] });
  mergeTask(quiet, 'toolu_busy', { taskId: 'aBusy', label: 'Busy agent' }, Date.now() - 20 * MIN);
  age(p.transcript, 20 * MIN); age(path.join(p.dir, 'sid', 'subagents', 'agent-aBusy.jsonl'), 1 * MIN);
  apply(quiet, repairChanges(quiet, { transcript: p.transcript, scan: newScan(), since: Date.now() - 60 * MIN, held: true }));
  assert.equal(running(quiet), 1);
});

test('a job marked done by hand stops holding the turn at once', () => {
  const { tasks } = stuckCommand();
  assert.equal(running(tasks), 1);
  apply(tasks, [['toolu_w', markedDone()]]);
  assert.equal(running(tasks), 0);
  assert.equal(tasks.get('toolu_w').status, 'unknown');
  assert.match(tasks.get('toolu_w').progress, /marked done by hand/);
});

// ---------- a step stuck mid-turn (stalledSteps) ----------
const step = (id, tool, start, extra = {}) => [id, { id, tool, label: id, status: 'running', start, ...extra }];

test('a foreground browser step past 3 minutes is stalled, and overdue past its full limit', () => {
  const now = 100 * MIN;
  const tasks = new Map([step('shot', 'mcp__playwright__browser_take_screenshot', now - 4 * MIN), step('fresh', 'mcp__playwright__browser_click', now - MIN)]);
  const out = stalledSteps(tasks, { status: 'running', now });
  assert.deepEqual(out.map((t) => t.id), ['shot']);
  assert.equal(out[0].minutes, 4);
  assert.equal(out[0].limit, 3);
  assert.equal(out[0].overdue, true);
});

test('each kind of step has its own limit', () => {
  assert.equal(stallLimit('mcp__playwright__browser_evaluate'), 3);
  assert.equal(stallLimit('Bash'), 11);
  assert.equal(stallLimit('PowerShell'), 11);
  assert.equal(stallLimit('Agent'), STUCK_MINUTES);
  const now = 100 * MIN;
  const tasks = new Map([step('cmd', 'PowerShell', now - 10 * MIN), step('agent', 'Agent', now - 10 * MIN)]);
  assert.deepEqual(stalledSteps(tasks, { status: 'running', now }), []);
});

test('background jobs are left alone: the held-turn check owns them', () => {
  const now = 100 * MIN;
  const tasks = new Map([
    step('server', 'PowerShell', now - 40 * MIN, { background: true }),
    step('asked', 'Bash', now - 40 * MIN, { wantsBackground: true }), // run_in_background, before task_started arrives
    step('watch', 'Monitor', now - 40 * MIN),
  ]);
  assert.deepEqual(stalledSteps(tasks, { status: 'running', now }), []);
});

test('only a session in a turn has steps that can stall', () => {
  const now = 100 * MIN;
  const tasks = new Map([step('shot', 'mcp__playwright__browser_take_screenshot', now - 20 * MIN)]);
  assert.deepEqual(stalledSteps(tasks, { status: 'idle', now }), []);
  assert.deepEqual(stalledSteps(tasks, { status: 'requires_action', now }), []);
});

test('a message sent behind the step halves its limit; one sent before it does not', () => {
  const now = 100 * MIN, start = now - 2 * MIN;
  const tasks = new Map([step('shot', 'mcp__playwright__browser_evaluate', start)]);
  assert.deepEqual(stalledSteps(tasks, { status: 'running', queuedAt: start - MIN, now }), []);
  const out = stalledSteps(tasks, { status: 'running', queuedAt: start + 30000, now });
  assert.equal(out.length, 1);
  assert.equal(out[0].queued, true);
  assert.equal(out[0].overdue, false); // flagged early, but Docket only stops it past the full limit
});

test('a step that keeps reporting progress is not stalled', () => {
  const now = 100 * MIN;
  const tasks = new Map([step('agent', 'Agent', now - 60 * MIN, { seen: now - MIN })]);
  assert.deepEqual(stalledSteps(tasks, { status: 'running', now }), []);
});

test('the background commands that ended while a step was stuck are listed for the message', () => {
  const now = 100 * MIN, since = now - 30 * MIN;
  const tasks = new Map([
    ['srv', { id: 'srv', label: 'Test Docket on port 4401', background: true, status: 'stopped', start: now - 50 * MIN, end: now - 20 * MIN }],
    ['old', { id: 'old', label: 'Earlier build', background: true, status: 'completed', start: now - 90 * MIN, end: now - 80 * MIN }],
    ['fg', { id: 'fg', label: 'A foreground step', status: 'completed', start: now - 25 * MIN, end: now - 24 * MIN }],
  ]);
  const lines = endedDuring(tasks, since, now);
  assert.equal(lines.length, 1);
  assert.match(lines[0], /^Test Docket on port 4401: stopped after 30m 0s, at /);
});

// ---------- each job's sign of life is its own (#713) ----------
test('a silent job is let go even while the session keeps talking', () => {
  // A grep -r moved to the background that never writes a byte, beside a session that just replied: the
  // conversation changed a moment ago, but that is the session's life, not the job's.
  const { transcript, output, tasks } = stuckCommand();
  age(output, 20 * MIN); age(transcript, 0);
  apply(tasks, repairChanges(tasks, { transcript, scan: newScan(), since: Date.now() - 60 * MIN, held: true }));
  assert.equal(running(tasks), 0, 'the session talking does not keep a silent job alive');
  assert.match(tasks.get('toolu_w').progress, /^no sign of life for 20 min/);
});

test('a Monitor counts the conversation as its sign of life, since its events land there', () => {
  const at = new Date(Date.now() - 20 * MIN).toISOString();
  const { transcript } = project({ lines: [
    { type: 'assistant', timestamp: at, message: { content: [{ type: 'tool_use', id: 'toolu_m', name: 'Monitor', input: { command: 'gh run watch', description: 'Watch CI' } }] } },
  ] });
  const tasks = new Map();
  mergeTask(tasks, 'toolu_m', { taskId: 'bmon', tool: 'local_bash', label: 'Watch CI', background: true }, Date.now() - 20 * MIN);
  age(transcript, 1 * MIN); // an event arrived a minute ago
  apply(tasks, repairChanges(tasks, { transcript, scan: newScan(), since: Date.now() - 60 * MIN, held: true }));
  assert.equal(running(tasks), 1, 'a Monitor heard from a minute ago keeps the hold');
  age(transcript, 20 * MIN);
  apply(tasks, repairChanges(tasks, { transcript, scan: newScan(), since: Date.now() - 60 * MIN, held: true }));
  assert.equal(running(tasks), 0, 'and is let go once its events stop too');
});

test('which jobs count the conversation: Monitor calls and the monitor task types, nothing else', () => {
  for (const tool of ['Monitor', 'monitor_mcp', 'monitor_ws']) assert.equal(talksInTranscript({ id: 'x', tool }), true, tool);
  for (const tool of ['local_bash', 'local_agent', 'agent', 'Bash', 'task']) assert.equal(talksInTranscript({ id: 'x', tool }), false, tool);
  assert.equal(talksInTranscript({ id: 'toolu_m', tool: 'local_bash' }, new Set(['toolu_m'])), true, 'a local_bash job started by a Monitor call');
  // stuckChanges on its own: the same fresh conversation keeps a Monitor and lets a command go.
  const { transcript } = project({});
  const tasks = new Map();
  mergeTask(tasks, 'cmd', { tool: 'local_bash', label: 'grep -r' }, Date.now() - 20 * MIN);
  mergeTask(tasks, 'mon', { tool: 'monitor_mcp', label: 'Watch' }, Date.now() - 20 * MIN);
  assert.deepEqual(stuckChanges(tasks, { transcript }).map(([k]) => k), ['cmd']);
});

test('the running jobs, named with their age, for mark_turn and the parent report', () => {
  const tasks = new Map(), now = Date.now();
  mergeTask(tasks, 'toolu_g', { taskId: 'bgrep', tool: 'local_bash', label: 'grep -r over every repo' }, now - 22 * MIN);
  mergeTask(tasks, 'toolu_a', { taskId: 'amb', label: 'ambient', ambient: true }, now);
  mergeTask(tasks, 'toolu_d', { label: 'finished', status: 'completed' }, now);
  const jobs = runningJobs(tasks, now);
  assert.deepEqual(jobs, [{ id: 'toolu_g', taskId: 'bgrep', label: 'grep -r over every repo', minutes: 22 }]);
  assert.equal(jobText(jobs[0]), 'grep -r over every repo, 22 min');
});
