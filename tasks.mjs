// A session's jobs (background commands, subagents): how each SDK task message changes the list, and how
// the list is repaired from Claude's own files when messages were missed (an app restart starts a session
// with an empty list, and the runner does not replay what came before). Nothing here sends or shows
// anything: server.mjs applies the changes through upsertTask, so the page and the held turn follow.
import fs from 'node:fs';
import path from 'node:path';

const IDLE_MINUTES = 5; // a recovered agent that has written nothing for this long says so
// A job that holds a finished turn and has shown no sign of life for this long stops holding it (three
// times IDLE_MINUTES). Five quiet minutes is only worth a note on the row; letting go reports the turn to
// the parent, and quiet builds and waits often go that long with no output. Being early costs little: if
// the job does end later, its notice starts a new turn and that turn reports again. Being late is the bug.
export const STUCK_MINUTES = 3 * IDLE_MINUTES;

// The entry a message is about. task_started and task_notification carry tool_use_id, task_updated and
// task_progress may carry only task_id, so look under both before treating a task as unknown.
export function findTaskKey(tasks, toolUseId, taskId) {
  if (toolUseId && tasks.has(toolUseId)) return toolUseId;
  if (taskId) {
    for (const t of tasks.values()) if (t.taskId === taskId) return t.id;
    if (tasks.has(taskId)) return taskId;
  }
  return null;
}

// Add or change one entry. A new entry only gets a start time when it is running: an ending heard
// for a task never seen start has none, rather than a made-up one.
export function mergeTask(tasks, key, patch, now = Date.now()) {
  const old = tasks.get(key) || { id: key, status: 'running', ...(patch.status && patch.status !== 'running' ? {} : { start: now }) };
  const t = { ...old, ...patch };
  tasks.set(key, t);
  return t;
}

const STATUS = { killed: 'stopped' };

// The changes one system task_* message makes, as [key, patch] pairs (none for anything else).
export function taskChanges(tasks, m, now = Date.now()) {
  const known = findTaskKey(tasks, m.tool_use_id, m.task_id);
  switch (m.subtype) {
    case 'task_started':
      return [[known || m.tool_use_id || m.task_id, {
        taskId: m.task_id, label: m.description, tool: m.task_type || 'task',
        background: !!m.is_backgrounded, ambient: !!m.ambient, start: now, status: 'running', end: undefined, recovered: false,
      }]];
    case 'task_progress': // also a sign of life, for the stuck check in repairChanges
      return known ? [[known, { progress: m.summary || m.last_tool_name, usage: m.usage, seen: now }]] : [];
    case 'task_updated': {
      if (!known) return []; // nothing to update, and no blank row for it
      const p = m.patch || {};
      return [[known, {
        ...(p.status ? { status: STATUS[p.status] || p.status } : {}),
        ...(p.is_backgrounded !== undefined ? { background: p.is_backgrounded } : {}),
        ...(p.end_time ? { end: p.end_time } : {}),
      }]];
    }
    case 'task_notification': {
      const end = { status: STATUS[m.status] || m.status, end: now, summary: m.summary, progress: undefined }; // the row shows the ending, not the last step
      if (known) return [[known, end]];
      // Ended before Docket heard it start: one finished row named by its summary.
      return [[m.tool_use_id || m.task_id, { taskId: m.task_id, label: m.summary || 'Task', ...end }]];
    }
    default: return [];
  }
}

// ---------- repair from disk ----------
// For session <id> Claude keeps, under its project folder:
//   <id>.jsonl                               the conversation; a <task-notification> in it means a task ended
//   <id>/subagents/agent-<agentId>.meta.json one per subagent: description, toolUseId (written when it starts)
//   <id>/subagents/agent-<agentId>.jsonl     the subagent's own conversation (its last write shows it is alive)
// The conversation is read once and then only from where the last read stopped, so a repair every minute
// costs a few new lines.
export function newScan() { return { offset: 0, rest: '', ended: new Map(), commands: new Map(), agentCalls: new Set(), monitors: new Set() }; }

const NOTICE = /<task-notification>\s*<task-id>([^<]+)<\/task-id>\s*(?:<tool-use-id>([^<]+)<\/tool-use-id>)?[\s\S]*?<status>(\w+)<\/status>(?:\s*<summary>([^<]*)<\/summary>)?/g;

function readNew(file, scan) {
  let size;
  try { size = fs.statSync(file).size; } catch { return; }
  if (size < scan.offset) Object.assign(scan, newScan()); // rewritten: read it again
  if (size === scan.offset) return;
  const fd = fs.openSync(file, 'r');
  try {
    const buf = Buffer.alloc(size - scan.offset);
    fs.readSync(fd, buf, 0, buf.length, scan.offset);
    scan.offset = size;
    const lines = (scan.rest + buf.toString('utf8')).split('\n');
    scan.rest = lines.pop();
    for (const line of lines) readLine(line, scan);
  } finally { fs.closeSync(fd); }
}

const STOP_TOOLS = new Set(['TaskStop', 'KillShell', 'KillBash']);

function readLine(line, scan) {
  const notice = line.includes('<task-notification>'), command = line.includes('"run_in_background":true');
  const stop = line.includes('"name":"TaskStop"') || line.includes('"name":"Kill');
  const agent = line.includes('"name":"Agent"') || line.includes('"name":"Task"');
  const monitor = line.includes('"name":"Monitor"');
  const answer = line.includes('"tool_result"') && [...scan.commands.keys(), ...scan.agentCalls].some((id) => line.includes(id));
  if (!notice && !command && !stop && !agent && !monitor && !answer) return;
  let j; try { j = JSON.parse(line); } catch { return; }
  if (j.isSidechain) return;
  const at = Date.parse(j.timestamp) || 0;
  if (notice && (j.type === 'queue-operation' || j.type === 'user')) {
    const text = typeof j.content === 'string' ? j.content : typeof j.message?.content === 'string' ? j.message.content
      : (j.message?.content || []).map((b) => b.text || '').join('\n');
    for (const [, taskId, toolUseId, status, summary] of text.matchAll(NOTICE)) {
      const e = { taskId, toolUseId, status: STATUS[status] || status, summary: summary || '', at };
      const prev = scan.ended.get(taskId);
      if (!prev || prev.at <= at) { scan.ended.set(taskId, e); if (toolUseId) scan.ended.set(toolUseId, e); }
    }
  }
  if ((command || stop || agent || monitor) && j.type === 'assistant') {
    for (const b of j.message?.content || []) {
      if (b.type !== 'tool_use') continue;
      if (b.name === 'Agent' || b.name === 'Task') scan.agentCalls.add(b.id);
      if (b.name === 'Monitor') scan.monitors?.add(b.id); // its job reports as local_bash; only the call says it is a Monitor
      if (b.input?.run_in_background === true) {
        scan.commands.set(b.id, { tool: b.name, label: String(b.input.description || b.input.command || b.name).slice(0, 200), start: at });
      }
      // Stopping a job leaves no notice of its own, only this call naming it.
      const target = STOP_TOOLS.has(b.name) && (b.input?.task_id || b.input?.shell_id);
      if (target) scan.ended.set(target, { taskId: target, status: 'stopped', summary: '', at });
    }
  }
  if (answer && j.type === 'user') {
    for (const b of j.message?.content || []) {
      if (b.type !== 'tool_result') continue;
      const text = typeof b.content === 'string' ? b.content : (b.content || []).map((x) => x.text || '').join('\n');
      // A subagent the session waited for ends with this answer; one sent to the background answers at once.
      if (scan.agentCalls.delete(b.tool_use_id) && (b.is_error || !/^Async agent launched/.test(text))) {
        scan.ended.set(b.tool_use_id, { toolUseId: b.tool_use_id, status: b.is_error ? 'failed' : 'completed', summary: '', at });
      }
      // The answer to a background call: an error means it never started; otherwise it names the job's id.
      const c = scan.commands.get(b.tool_use_id);
      if (!c) continue;
      if (b.is_error) { scan.commands.delete(b.tool_use_id); continue; }
      c.taskId = text.match(/running in background with ID: (\w+)/)?.[1] || text.match(/agentId: (\w+)/)?.[1];
      c.output = text.match(/Output is being written to: (.+?\.output)/)?.[1]; // grows while the command prints
    }
  }
}

function readJson(file) { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; } }
const mtime = (file) => { try { return Math.floor(fs.statSync(file).mtimeMs); } catch { return 0; } };

// The last tool the agent called, from the end of its conversation file.
function lastTool(file) {
  let fd;
  try {
    const size = fs.statSync(file).size, n = Math.min(size, 256 * 1024);
    const buf = Buffer.alloc(n);
    fd = fs.openSync(file, 'r');
    fs.readSync(fd, buf, 0, n, size - n);
    const names = [...buf.toString('utf8').matchAll(/"type":"tool_use","id":"[^"]+","name":"([^"]+)"/g)];
    return names.length ? names[names.length - 1][1] : '';
  } catch { return ''; } finally { if (fd !== undefined) fs.closeSync(fd); }
}

const clock = (ms) => new Date(ms).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });

function agentProgress(file, now) {
  const last = mtime(file);
  if (!last) return 'recovered, progress unknown';
  const idle = Math.floor((now - last) / 60000);
  if (idle >= IDLE_MINUTES) return `no activity for ${idle} min (last at ${clock(last)})`;
  const tool = lastTool(file);
  return tool ? `working · last step: ${tool}` : 'working';
}

// The changes that bring the list in line with the files, as [key, patch] pairs.
//   transcript: the session's <id>.jsonl; scan: its newScan(), kept between repairs
//   since: when the session's current claude process started. A job started before then cannot still
//     be running (it went with the old process), so it is never brought back as running.
//   alive: false once the session's process is gone; its jobs that still show running become 'unknown'.
//   held: the session's turn ended while jobs still run, and waits for them; a job with no sign of life
//     for STUCK_MINUTES (see stuckChanges) then becomes 'unknown', so the turn can end.
export function repairChanges(tasks, { transcript, scan, since = 0, alive = true, held = false, now = Date.now() }) {
  const out = [];
  if (!alive) {
    for (const t of tasks.values()) if (t.status === 'running' && !t.ambient) out.push([t.id, { status: 'unknown', progress: 'the session stopped while this was running' }]);
    return out;
  }
  // Still marked running from before the current process started (a runner restart resumes the session
  // in a new process): whatever became of it, Docket can't know.
  for (const t of tasks.values()) {
    if (t.status === 'running' && !t.ambient && t.start && t.start < since) out.push([t.id, { status: 'unknown', progress: 'the session restarted while this was running' }]);
  }
  readNew(transcript, scan);
  const endOf = (toolUseId, taskId) => scan.ended.get(taskId) || scan.ended.get(toolUseId);
  const ending = (e) => ({ status: e.status, end: e.at || now, summary: e.summary || undefined, progress: undefined });
  const life = new Map(); // task key -> when its own file (agent log, command output) last changed

  // Subagents.
  const dir = path.join(transcript.replace(/\.jsonl$/, ''), 'subagents');
  let files = [];
  try { files = fs.readdirSync(dir).filter((f) => /^agent-.+\.meta\.json$/.test(f)); } catch {}
  const seen = new Set();
  for (const f of files) {
    const agentId = f.slice('agent-'.length, -'.meta.json'.length);
    const meta = readJson(path.join(dir, f));
    if (!meta?.toolUseId) continue;
    seen.add(meta.toolUseId);
    const key = findTaskKey(tasks, meta.toolUseId, agentId);
    const t = key && tasks.get(key);
    const started = mtime(path.join(dir, f)); // the meta file is written when the agent starts
    const e = endOf(meta.toolUseId, agentId);
    const ended = (e && (!t?.start || e.at >= t.start)) || meta.finished === true;
    const log = path.join(dir, `agent-${agentId}.jsonl`);
    if (key) life.set(key, mtime(log));
    if (!t) {
      if (started < since) continue; // from an earlier run of the session
      if (meta.parentAgentId || meta.spawnDepth > 1) continue; // started by another agent, whose row stands for it
      const base = { taskId: agentId, label: meta.description || 'Subagent', tool: 'agent', background: meta.requestShape === 'background', start: started, recovered: true };
      out.push([meta.toolUseId, !ended ? { ...base, status: 'running', progress: agentProgress(log, now) }
        : e ? { ...base, ...ending(e) } : { ...base, status: 'completed', end: mtime(log) || started }]);
    } else if (t.status === 'running') {
      if (e && (!t.start || e.at >= t.start)) out.push([key, ending(e)]);
      else if (meta.finished === true && t.recovered) out.push([key, { status: 'completed', end: mtime(log) || now, progress: undefined }]);
      else if (t.recovered) out.push([key, { progress: agentProgress(log, now) }]);
    }
  }

  // Background commands leave no file of their own: a run_in_background call with no ending notice.
  for (const [id, c] of scan.commands) {
    if (seen.has(id)) continue;
    const key = findTaskKey(tasks, id, c.taskId);
    const t = key && tasks.get(key);
    const e = scan.ended.get(id) || (c.taskId && scan.ended.get(c.taskId));
    if (key && c.output) life.set(key, mtime(c.output));
    if (!t) {
      if (c.start < since) continue;
      const base = { ...(c.taskId ? { taskId: c.taskId } : {}), tool: c.tool, label: c.label, background: true, start: c.start, recovered: true };
      out.push([id, e ? { ...base, ...ending(e) } : { ...base, status: 'running', progress: 'recovered, progress unknown' }]);
    } else if (t.status === 'running' && e && (!t.start || e.at >= t.start)) out.push([key, ending(e)]);
  }
  if (held) out.push(...stuckChanges(tasks, { life, transcript, monitors: scan.monitors, settled: new Set(out.filter(([, p]) => p.status).map(([k]) => k)), now }));
  return out;
}

// Jobs that hold the turn with no sign of life for STUCK_MINUTES: not started, heard from (task_progress),
// or written to (its own file) since then. Each job's sign of life is its own (#713): the session's
// conversation changes whenever the session itself replies, so counting it for every job let a silent
// command (a grep -r moved to the background, writing nothing) hold the turn for as long as the session
// kept talking. The conversation only counts for jobs whose output lands there (talksInTranscript).
// Without this a job whose ending was never heard holds the turn for as long as the process lives.
//   monitors: the tool_use ids of the session's Monitor calls (from the scan)
export function stuckChanges(tasks, { life = new Map(), transcript, monitors, settled = new Set(), now = Date.now() }) {
  const talked = transcript ? mtime(transcript) : 0;
  const out = [];
  for (const t of tasks.values()) {
    if (t.status !== 'running' || t.ambient || settled.has(t.id)) continue;
    const last = Math.max(t.start || 0, t.seen || 0, life.get(t.id) || 0, talksInTranscript(t, monitors) ? talked : 0);
    if (!last || now - last < STUCK_MINUTES * 60000) continue;
    const quiet = Math.floor((now - last) / 60000);
    out.push([t.id, { status: 'unknown', end: now, progress: `no sign of life for ${quiet} min (last at ${clock(last)}), so the session stopped waiting for it` }]);
  }
  return out;
}
// The jobs whose output lands in the session's own conversation, so a change to it is their sign of life:
// a Monitor (each event it sees arrives there as a message). Claude Code starts a Monitor tool's job as
// task_type local_bash, so it is known by the Monitor call it came from; its MCP and websocket monitors
// (task_type monitor_mcp, monitor_ws) work the same way. Everything else has its own file or nothing:
// background commands write their .output file, subagents their own log, and the rest only task_progress.
const MONITOR_TYPES = new Set(['Monitor', 'monitor_mcp', 'monitor_ws']);
export const talksInTranscript = (t, monitors) => MONITOR_TYPES.has(t.tool) || !!monitors?.has(t.id);

// The jobs still running, oldest first, as "label, N min" for a person or a session to read.
export function runningJobs(tasks, now = Date.now()) {
  return [...tasks.values()].filter((t) => t.status === 'running' && !t.ambient)
    .sort((a, b) => (a.start || now) - (b.start || now))
    .map((t) => ({ id: t.id, taskId: t.taskId || t.id, label: t.label || t.tool || 'Background job', minutes: t.start ? Math.max(0, Math.floor((now - t.start) / 60000)) : null }));
}
export const jobText = (j) => `${j.label}${j.minutes === null ? '' : `, ${j.minutes} min`}`;

// Marked done by hand from the Details panel: the person says it is over, whatever Docket last heard.
export const markedDone = (now = Date.now()) => ({ status: 'unknown', end: now, progress: 'marked done by hand, so the session stopped waiting for it' });

// ---------- a step stuck mid-turn ----------
// stuckChanges only looks at a turn that has ended. A foreground step (a browser call, a command the
// session waits on) can also stop answering mid-turn, and then the session sits there with the person's
// messages queued unread behind it (seen 2026-10-27: two browser calls froze for 29 minutes after the
// test server they drove ended at its 30 minute limit). Each kind of step gets its own limit: a browser
// step answers in seconds, a command has its own 10 minute ceiling, anything else gets STUCK_MINUTES.
const STALL_LIMITS = [[/^mcp__playwright__/, 3], [/^(Bash|PowerShell)$/, 11]];
const NEVER_STALLS = new Set(['Monitor']); // waits by design
export const stallLimit = (tool = '') => (STALL_LIMITS.find(([re]) => re.test(tool)) || [, STUCK_MINUTES])[1];

// The foreground steps of a session in the middle of a turn that have gone quiet past their limit, oldest
// first. A step counts from when it started or last reported progress (a subagent at work keeps reporting).
// It is flagged at its limit, or at half of it when the person sent a message after it started (they are
// waiting); `overdue` means past the full limit, when Docket may stop the turn (see server.mjs).
//   status: the session's status; only a session in a turn ('running') has steps that can stall.
//   queuedAt: when the person last sent a message, 0 for never.
export function stalledSteps(tasks, { status, queuedAt = 0, now = Date.now() }) {
  if (status !== 'running') return [];
  const out = [];
  for (const t of tasks.values()) {
    if (t.status !== 'running' || t.background || t.wantsBackground || t.ambient || NEVER_STALLS.has(t.tool)) continue;
    const since = Math.max(t.start || 0, t.seen || 0);
    if (!since) continue;
    const limit = stallLimit(t.tool), queued = queuedAt > (t.start || 0);
    const age = now - since;
    if (age < (queued ? limit / 2 : limit) * 60000) continue;
    out.push({ id: t.id, tool: t.tool, label: t.label, since, minutes: Math.floor(age / 60000), limit, queued, overdue: age >= limit * 60000 });
  }
  return out.sort((a, b) => a.since - b.since);
}

// The session's background jobs that ended while a stuck step ran, as short lines for the message that
// tells the session what happened ("Start test Docket on port 4401: stopped after 30m 0s, at 3:12 PM").
export function endedDuring(tasks, since, now = Date.now()) {
  const len = (ms) => `${Math.floor(ms / 60000)}m ${Math.floor((ms % 60000) / 1000)}s`;
  return [...tasks.values()]
    .filter((t) => t.background && t.status !== 'running' && t.end && t.end >= since && t.end <= now)
    .sort((a, b) => a.end - b.end)
    .map((t) => `${t.label || t.tool || 'a background job'}: ${t.status}${t.start ? ` after ${len(t.end - t.start)}` : ''}, at ${clock(t.end)}`);
}
