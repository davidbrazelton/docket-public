// What a session took in, in order (its Timeline), and what a company's Claude profile has installed
// (its profile page). Both only read: the session's record file in <home>/projects, and the profile folder.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { LAYERS, GROK_COMPAT, readGrokCompat } from './switches.mjs';

// ---------- the Timeline: one session's record file, entry by entry ----------
// Categories, in the order the filter shows them. Hooks that ran without printing anything leave
// no line in the record, so the Timeline cannot show them (the profile page lists every hook).
export const TIMELINE_CATS = [
  ['messages', 'Messages'], ['instructions', 'Instructions'], ['docket', 'Docket additions'], ['memory', 'Memory'],
  ['hooks', 'Hooks'], ['skills', 'Skills and commands'], ['context', 'Session context'],
  ['files', 'Tools: files'], ['commands', 'Tools: commands'], ['web', 'Tools: web and browser'],
  ['sessions', 'Tools: agents and sessions'], ['tools', 'Tools: other'], ['reminders', 'Reminders'],
];
const SKIP_TYPES = new Set(['queue-operation', 'last-prompt', 'custom-title', 'ai-title', 'atis-latch', 'agent-name', 'pr-link', 'mode',
  'api-request', 'api-request-shape', 'api-request-blob', 'file-history-snapshot', 'file-history-delta', 'cost-state', 'frame-link',
  'artifact-comment-monitor', 'artifact-autoreact-ledger', 'bridge-session', 'summary']);
const SKIP_ATTACH = new Set(['deferred_tools_record', 'thinking_drop', 'thinking_stripped', 'batching_reminder_sent']);
const CONTEXT_ATTACH = { environment: 'Environment (folder, platform, git)', model: 'Model', date: 'Today\'s date', session_context: 'Account context',
  auto_mode: 'Permission mode', credential_org: 'Organization', remote_session_change: 'Commit and pull request wording', command_permissions: 'Command permissions',
  deferred_tools_delta: 'Tools that load on request', agent_listing_delta: 'Agents Claude can start', mcp_instructions_delta: 'Instructions from connected services',
  file: 'File attached to a message', pdf_reference: 'PDF attached to a message' };
const FILE_TOOLS = new Set(['Read', 'Write', 'Edit', 'MultiEdit', 'NotebookEdit', 'Glob', 'Grep', 'LS']);
const COMMAND_TOOLS = new Set(['Bash', 'PowerShell', 'Monitor', 'BashOutput', 'KillShell', 'KillBash', 'TaskStop', 'TaskOutput']);
const WEB_TOOLS = new Set(['WebFetch', 'WebSearch']);
const SESSION_TOOLS = new Set(['Agent', 'Task', 'Workflow', 'SendMessage']);
function toolCat(name) {
  if (FILE_TOOLS.has(name)) return 'files';
  if (COMMAND_TOOLS.has(name)) return 'commands';
  if (WEB_TOOLS.has(name) || /^mcp__(playwright|claude-in-chrome)__/.test(name)) return 'web';
  if (SESSION_TOOLS.has(name) || name.startsWith('mcp__portal__')) return 'sessions';
  return 'tools';
}
const textOf = (c) => typeof c === 'string' ? c : Array.isArray(c) ? c.map((x) => typeof x === 'string' ? x : x.type === 'text' ? x.text : x.type === 'image' ? '[image]' : x.type === 'tool_reference' ? `[tool ${x.tool_name}]` : '').filter(Boolean).join('\n') : c == null ? '' : JSON.stringify(c, null, 2);
const short = (t, n = 140) => { const s = String(t || '').replace(/\s+/g, ' ').trim(); return s.length > n ? s.slice(0, n - 1) + '…' : s; };
const rendered = (o) => Array.isArray(o.rendered) ? o.rendered.map((r) => r.content || '').join('\n') : '';
function toolDetail(name, inp = {}) {
  return inp.file_path || inp.notebook_path || inp.command || inp.pattern || inp.url || inp.query || inp.description || inp.skill || inp.prompt || inp.title || '';
}

const timelineCache = new Map(); // file -> the reading so far (see sessionTimeline)
// docket: [{ name, text, path? }] the texts Docket adds to every session, to pick them out of the system prompt.
// memoryRoot: the profile's projects folder, so reads of memory files count as memory.
// Record files only grow, so each call reads just what was written since the last one. An entry keeps its
// number (n, its place in the file) for good, and v says when it was added or last changed, so a page
// holding everything up to some v asks only for what is newer. Show them ordered by at, then n.
export function sessionTimeline(file, { docket = [], memoryRoot = '' } = {}) {
  const st = fs.statSync(file);
  const key = docket.map((d) => d.text.length).join(',') + '|' + memoryRoot;
  let c = timelineCache.get(file);
  if (!c || c.key !== key || st.size < c.pos) {
    c = { key, gen: Math.random().toString(36).slice(2), pos: 0, v: 0, last: 0, entries: [], counts: {}, tools: new Map(), hooks: new Map(), lastPrompt: '', texts: {} };
    timelineCache.delete(file); timelineCache.set(file, c);
    if (timelineCache.size > 20) timelineCache.delete(timelineCache.keys().next().value);
  }
  if (st.size > c.pos) {
    const fd = fs.openSync(file, 'r');
    const buf = Buffer.alloc(st.size - c.pos);
    try { fs.readSync(fd, buf, 0, buf.length, c.pos); } finally { fs.closeSync(fd); }
    const end = buf.lastIndexOf(10) + 1; // stop before a line still being written; the next call starts there
    c.pos += end;
    if (end) readTimelineLines(c, buf.subarray(0, end).toString('utf8').split('\n'), docket, memoryRoot.toLowerCase());
  }
  return c;
}
function readTimelineLines(c, lines, docket, memDir) {
  const { entries, tools, hooks } = c; // tools: tool_use id -> entry; hooks: toolUseID|hookName -> hook entry, so the context it added joins it
  // Entries are written slightly out of order (the first message lands just before the instructions read
  // for it), so the page sorts them by time; one with no time takes the time of the one before it.
  const add = (e) => {
    e.n = entries.length; e.v = ++c.v; e.size = (e.text || '').length;
    if (e.at) c.last = e.at; else e.at = c.last || null;
    c.counts[e.cat] = (c.counts[e.cat] || 0) + 1; entries.push(e); return e;
  };
  const touch = (e) => { e.v = ++c.v; };
  for (const line of lines) {
    if (!line) continue;
    let o; try { o = JSON.parse(line); } catch { continue; }
    if (o.isSidechain || SKIP_TYPES.has(o.type)) continue;
    const at = o.timestamp ? Date.parse(o.timestamp) : null;
    if (o.type === 'attachment' && o.attachment) {
      const a = o.attachment, t = a.type;
      if (SKIP_ATTACH.has(t)) continue;
      if (t === 'prompt_snapshot') { // the whole system prompt, written again whenever it changes
        const parts = (a.systemPrompt || []).filter((x) => typeof x === 'string' && !x.startsWith('<total_tokens>') && x !== '__SYSTEM_PROMPT_DYNAMIC_BOUNDARY__');
        const sig = parts.join('\n');
        if (sig === c.lastPrompt) continue;
        const again = !!c.lastPrompt; c.lastPrompt = sig;
        const di = parts.findIndex((x) => x.includes('You are running inside Docket'));
        const own = parts.filter((_, i) => i !== di).join('\n\n');
        add({ at, cat: 'instructions', title: again ? 'Claude Code\'s own instructions (changed)' : 'Claude Code\'s own instructions', detail: 'the system prompt Claude Code writes itself', text: own });
        if (di >= 0) {
          let rest = parts[di];
          const found = [];
          for (const d of docket) { const i = rest.indexOf(d.text); if (d.text && i >= 0) { found.push({ i, d }); rest = rest.slice(0, i) + rest.slice(i + d.text.length); } }
          found.sort((x, y) => x.i - y.i);
          for (const { d } of found) add({ at, cat: 'docket', title: d.name, detail: d.path || 'built into Docket', path: d.path, text: d.text });
          rest = rest.trim();
          if (rest) add({ at, cat: 'docket', title: 'Docket additions that no longer match a file', detail: 'the prompts changed since this session started', text: rest });
        }
        continue;
      }
      if (t === 'instructions') {
        for (const f of a.files || []) {
          const mem = f.type === 'AutoMem';
          const imported = !mem && !/(^|[\\/])CLAUDE(\.local)?\.md$/i.test(f.path || '');
          add({ at, cat: mem ? 'memory' : 'instructions', path: f.path, text: f.content || '',
            title: mem ? 'Memory index' : imported ? `${path.basename(f.path)} (pulled in by @)` : `CLAUDE.md (${f.type === 'Project' ? 'folder' : f.type === 'User' ? 'this desk' : f.type})`, detail: f.path });
        }
        continue;
      }
      if (t === 'nested_memory') { add({ at, cat: 'instructions', title: 'CLAUDE.md read on entering a folder', detail: a.path, path: a.path, text: a.content?.content || '' }); continue; }
      if (t === 'output_style_instructions') { add({ at, cat: 'instructions', title: `Output style: ${a.style?.name || ''}`, detail: 'how replies are written', text: a.style?.prompt || '' }); continue; }
      if (t === 'skill_listing') { add({ at, cat: 'skills', title: 'List of skills Claude can load', detail: `${(a.content || '').split('\n').filter((l) => l.startsWith('- ')).length} skills`, text: a.content || '' }); continue; }
      if (t === 'dynamic_skill') { add({ at, cat: 'skills', title: 'Skills found in a folder', detail: `${(a.skillNames || []).join(', ')} in ${a.displayPath || a.skillDir}`, text: rendered(o) || JSON.stringify(a, null, 2) }); continue; }
      if (t === 'invoked_skills') { for (const sk of a.skills || []) add({ at, cat: 'skills', title: `Skill kept after compacting: ${sk.name}`, detail: sk.path, text: sk.content || '' }); continue; }
      if (t.startsWith('hook_')) {
        const k = `${a.toolUseID}|${a.hookName}`;
        const prev = hooks.get(k);
        if (t === 'hook_additional_context' && prev) { prev.added = textOf(a.content); prev.text += `\n\nAdded for Claude to read:\n${prev.added}`; prev.size = prev.text.length; touch(prev); continue; }
        const label = { hook_success: 'ran', hook_additional_context: 'added context', hook_system_message: 'showed a message', hook_non_blocking_error: 'failed (kept going)',
          hook_blocking_error: 'blocked', hook_cancelled: 'timed out', hook_stopped_continuation: 'stopped the turn' }[t] || t.replace(/^hook_/, '').replace(/_/g, ' ');
        const out = [a.command && `Command: ${a.command}`, a.exitCode !== undefined && `Exit code: ${a.exitCode}`, a.stdout && `Output:\n${a.stdout}`, a.stderr && `Errors:\n${a.stderr}`,
          a.blockingError && `Blocked: ${textOf(a.blockingError.blockingError || a.blockingError)}`, a.content && t !== 'hook_success' && textOf(a.content)].filter(Boolean).join('\n\n');
        const e = add({ at, cat: 'hooks', title: `${a.hookName || a.hookEvent || 'Hook'} ${label}`, detail: a.command || short(textOf(a.content)), text: out || JSON.stringify(a, null, 2),
          durationMs: a.durationMs, bad: /error|blocked|timed out|stopped/.test(label) });
        if (t === 'hook_success' || t === 'hook_non_blocking_error') hooks.set(k, e);
        continue;
      }
      if (CONTEXT_ATTACH[t]) {
        const det = t === 'model' ? a.identity?.marketingName : t === 'date' ? a.date : t === 'mcp_instructions_delta' ? (a.addedNames || []).join(', ')
          : t === 'deferred_tools_delta' ? `${(a.addedNames || []).length} added` : t === 'agent_listing_delta' ? (a.addedTypes || []).join(', ') : t === 'file' ? a.filename : '';
        const body = rendered(o) || (t === 'mcp_instructions_delta' ? (a.addedBlocks || []).join('\n\n') : t === 'agent_listing_delta' ? (a.addedLines || []).join('\n')
          : t === 'deferred_tools_delta' ? (a.addedNames || []).join('\n') : t === 'model' ? a.text : t === 'file' ? textOf(a.content?.file?.content ?? a.content) : JSON.stringify(a, null, 2));
        add({ at, cat: 'context', title: CONTEXT_ATTACH[t], detail: det || '', text: body || '' });
        continue;
      }
      if (t === 'queued_command') {
        const note = a.commandMode === 'task-notification';
        add({ at, cat: note ? 'reminders' : 'messages', title: note ? 'Background task finished' : 'You (sent while Claude was working)', text: textOf(a.prompt), detail: short(textOf(a.prompt)), mark: !note });
        continue;
      }
      const titles = { total_tokens_reminder: 'Tokens left', output_style: 'Output style reminder', task_reminder: 'Task list reminder', edited_text_file: 'A file changed',
        compact_file_reference: 'File kept after compacting', silent_turn_reminder: 'Reminder to tell you what it is doing', date_change: 'The date changed',
        read_truncation_notice: 'A file was cut short', plan_mode: 'Plan mode', plan_mode_exit: 'Left plan mode', auto_mode_exit: 'Left auto mode', task_status: 'Task status', plan_file_reference: 'Plan file' };
      const body = rendered(o) || a.text || a.snippet || (t === 'output_style' ? `${a.style} output style is active.` : JSON.stringify(a, null, 2));
      add({ at, cat: 'reminders', title: titles[t] || t.replace(/_/g, ' '), detail: a.filename || a.style || short(a.text || ''), text: body });
      continue;
    }
    if (o.type === 'system') {
      if (o.subtype === 'stop_hook_summary') {
        const cmds = (o.hookInfos || []).map((h) => h.command).filter((c) => c && c !== 'callback');
        if (!cmds.length && !(o.hookErrors || []).length && !o.preventedContinuation) continue; // only Docket's own callbacks ran
        add({ at, cat: 'hooks', title: `Stop hooks ran (${o.hookCount || cmds.length})`, detail: cmds.join(' · '), bad: !!(o.hookErrors || []).length || o.preventedContinuation,
          text: [cmds.length && `Commands:\n${cmds.join('\n')}`, (o.hookErrors || []).length && `Errors:\n${o.hookErrors.map(textOf).join('\n')}`,
            (o.hookAdditionalContext || []).length && `Added:\n${o.hookAdditionalContext.map(textOf).join('\n')}`, o.preventedContinuation && `Kept Claude going: ${o.stopReason || ''}`].filter(Boolean).join('\n\n') });
        continue;
      }
      if (o.subtype === 'compact_boundary') { add({ at, cat: 'messages', title: 'Conversation compacted', detail: 'older messages were summarised to make room', text: '', mark: true }); continue; }
      if (o.subtype === 'local_command') { add({ at, cat: 'skills', title: 'Command output', detail: short(o.content), text: o.content || '' }); continue; }
      if (o.subtype === 'api_error') { add({ at, cat: 'reminders', title: 'Error from Claude\'s servers, retried', detail: short(o.error?.message || o.content || ''), text: JSON.stringify(o.error || o, null, 2), bad: true }); continue; }
      continue;
    }
    if (o.type === 'user' && o.message) {
      const content = o.message.content;
      const items = typeof content === 'string' ? [{ type: 'text', text: content }] : Array.isArray(content) ? content : [];
      for (const it of items) {
        if (it.type === 'tool_result') {
          const e = tools.get(it.tool_use_id);
          if (!e) continue;
          const r = textOf(it.content);
          e.result = r; e.text += `\n\nResult${it.is_error ? ' (error)' : ''}:\n${r}`; e.size = r.length; e.bad = !!it.is_error;
          if (at && e.at) e.durationMs = at - e.at;
          touch(e);
          continue;
        }
        if (it.type !== 'text') continue;
        const txt = it.text || '';
        const cmd = txt.match(/<command-name>([^<]*)<\/command-name>/);
        if (o.isMeta && o.sourceToolUseID && /^Base directory for this skill/.test(txt)) {
          const sk = tools.get(o.sourceToolUseID);
          add({ at, cat: 'skills', title: `Skill loaded: ${sk?.skill || txt.match(/skills[\\/]([^\\/\s]+)/)?.[1] || ''}`, detail: txt.match(/^Base directory for this skill: (.*)/)?.[1] || '', text: txt });
        } else if (cmd) {
          const args = txt.match(/<command-args>([^<]*)<\/command-args>/)?.[1] || '';
          add({ at, cat: 'skills', title: `Slash command ${cmd[1]}`, detail: args, text: txt });
        } else if (/^<local-command-std(out|err)>/.test(txt)) {
          add({ at, cat: 'skills', title: 'Command output', detail: short(txt.replace(/<\/?local-command-std(out|err)>/g, '')), text: txt });
        } else if (/<session-report>/.test(txt)) {
          add({ at, cat: 'docket', title: 'Report from a session this one started', detail: short(txt.replace(/<\/?session-report>/g, '')), text: txt });
        } else if (/^\((From Docket|From the session portal)[:)]/.test(txt)) {
          add({ at, cat: 'docket', title: 'Note from Docket with your message', detail: short(txt), text: txt });
        } else if (o.isMeta || /^<(task-notification|system-reminder)>/.test(txt)) {
          add({ at, cat: 'reminders', title: /^<task-notification>/.test(txt) ? 'Background task finished' : 'Added by Claude Code', detail: short(txt), text: txt });
        } else {
          add({ at, cat: 'messages', title: 'You', detail: short(txt), text: txt, mark: true });
        }
      }
      continue;
    }
    if (o.type === 'assistant' && o.message) {
      const mid = o.message.id;
      for (const it of o.message.content || []) {
        // The chat names a reply's text blocks <message id>:<count>; counting the same way lets the page match them.
        const k = it.type === 'text' && it.text && mid ? (c.texts[mid] = (c.texts[mid] ?? -1) + 1) : null;
        if (it.type === 'text' && it.text?.trim()) add({ at, cat: 'messages', title: 'Claude', detail: short(it.text), text: it.text, mark: true, claude: true, textId: k === null ? undefined : `${mid}:${k}` });
        if (it.type !== 'tool_use') continue;
        const inp = it.input || {};
        let cat = toolCat(it.name);
        const fp = String(inp.file_path || '').toLowerCase();
        if (FILE_TOOLS.has(it.name) && memDir && fp.startsWith(memDir) && /[\\/]memory[\\/]/.test(fp)) cat = 'memory';
        if (it.name === 'Skill') cat = 'skills';
        const e = add({ at, cat, title: it.name === 'Skill' ? `Skill called: ${inp.skill}` : cat === 'memory' ? `Memory ${it.name === 'Read' ? 'read' : 'saved'}: ${path.basename(fp)}` : it.name,
          tool: it.name, toolId: it.id, detail: short(toolDetail(it.name, inp), 200), text: `Input:\n${JSON.stringify(inp, null, 2)}`, skill: inp.skill });
        e.size = 0; // a tool call adds its result to what Claude reads; set when the result arrives
        tools.set(it.id, e);
      }
    }
  }
}

// ---------- the profile page: what one company's Claude home has installed ----------
const readText = (f) => { try { return fs.readFileSync(f, 'utf8'); } catch { return null; } };
const readJson = (f) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return null; } };
const isDir = (d) => { try { return fs.statSync(d).isDirectory(); } catch { return false; } };
const listDir = (d) => { try { return fs.readdirSync(d); } catch { return []; } };
const sizeOf = (f) => { try { return fs.statSync(f).size; } catch { return 0; } };
function frontmatter(text) {
  const m = String(text || '').match(/^---\r?\n([\s\S]*?)\r?\n---/);
  const out = {};
  if (m) for (const l of m[1].split(/\r?\n/)) { const kv = l.match(/^(\w[\w-]*):\s*(.*)$/); if (kv) out[kv[1]] = kv[2].replace(/^["']|["']$/g, ''); }
  return out;
}
// CLAUDE.md and every file it pulls in with @path (and those files' own @paths), in reading order.
function instructionTree(file, label, seen = new Set(), depth = 0) {
  const full = path.resolve(file);
  if (seen.has(full.toLowerCase()) || depth > 5) return [];
  const text = readText(full);
  if (text === null) return [];
  seen.add(full.toLowerCase());
  const out = [{ name: depth ? path.basename(full) : label, detail: full, path: full, size: text.length, depth, note: depth ? 'pulled in by @' : '' }];
  const body = text.replace(/```[\s\S]*?```/g, '').replace(/`[^`\n]*`/g, '');
  for (const m of body.matchAll(/(?:^|\s)@((?:~|\.{1,2}|[A-Za-z]:)?[\\/]?[^\s]+)/g)) {
    let p = m[1].replace(/[),.;:]+$/, '');
    if (!/[\\/.]/.test(p)) continue; // @mentions of people, not files
    p = p.startsWith('~') ? path.join(os.homedir(), p.slice(1)) : path.isAbsolute(p) ? path.resolve(p) : path.resolve(path.dirname(full), p);
    out.push(...instructionTree(p, '', seen, depth + 1));
  }
  return out;
}
const HOOK_ORDER = ['SessionStart', 'UserPromptSubmit', 'PreModelRequest', 'PostModelRequest', 'PreToolUse', 'PermissionRequest', 'PostToolUse', 'PostToolUseFailure', 'Notification', 'SubagentStart', 'SubagentStop', 'Stop', 'Interrupt', 'PreCompact', 'PostCompact', 'SessionEnd'];
const HOOK_WHEN = { SessionStart: 'When a session starts or resumes', UserPromptSubmit: 'Each time a message is sent', PreToolUse: 'Before a tool runs (can block it)',
  PermissionRequest: 'When Claude asks permission', PostToolUse: 'After a tool runs', PostToolUseFailure: 'After a tool fails', Notification: 'When Claude Code sends a notification',
  SubagentStart: 'When an agent starts', SubagentStop: 'When an agent finishes', Stop: 'When Claude finishes a reply', PreCompact: 'Before the conversation is compacted', SessionEnd: 'When a session ends',
  PreModelRequest: 'Before each request to the model', PostModelRequest: 'After each answer from the model', Interrupt: 'When a reply is stopped', PostCompact: 'After the conversation is compacted' };
// The moment, in the words of the brand whose hook it is.
const hookWhen = (ev, who = 'Claude') => (HOOK_WHEN[ev] || ev).replace(/Claude( Code)?/g, who);
const SCRIPT_RE = /(?:[A-Za-z]:)?[\\/][^\s"'`;|&<>]+\.(?:mjs|cjs|js|ts|py|ps1|sh|cmd|bat)\b/g;

// Hooks in Claude's shape ({ Event: [{ matcher, hooks: [{ type, command, timeout, statusMessage }] }] }) from each source
// ([hooks, label, file]), grouped by the moment they run, in the order they run. Codex (hooks.json and [hooks] in
// config.toml) and Grok (hooks/*.json and [[hooks.*]] in config.toml) write theirs in the same shape.
function hookGroups(sources, item, who = 'Claude') {
  const byEvent = new Map();
  for (const [hooks, source, sourcePath] of sources) for (const [ev, groups] of Object.entries(hooks || {})) for (const g of Array.isArray(groups) ? groups : []) for (const h of g?.hooks || []) {
    if (!byEvent.has(ev)) byEvent.set(ev, []);
    const command = (process.platform === 'win32' && h.commandWindows) || h.command;
    const cmd = command || h.prompt || h.url || (h.server && `${h.server} ${h.tool || ''}`.trim()) || h.type;
    const scripts = [...new Set((String(command || '').match(SCRIPT_RE) || []).map((p) => path.resolve(p)).filter((p) => fs.existsSync(p)))];
    byEvent.get(ev).push(item({ name: g.matcher ? `Only for: ${g.matcher}` : 'Every time', detail: cmd, code: true, path: sourcePath, size: 0,
      note: [source, h.timeout && `stops after ${h.timeout}s`, h.statusMessage && `shows "${h.statusMessage}"`, h.type !== 'command' && h.type].filter(Boolean).join(' · '),
      links: scripts.map((p) => item({ name: path.basename(p), path: p })) }));
  }
  const evs = [...byEvent.keys()].sort((a, b) => ((HOOK_ORDER.indexOf(a) + 1) || 99) - ((HOOK_ORDER.indexOf(b) + 1) || 99));
  return evs.map((ev) => ({ title: `${hookWhen(ev, who)} (${ev})`, items: byEvent.get(ev) }));
}

// ---------- the skills one session can use, for the / pick list in the chat box ----------
// Claude Code writes the full list once (skill_listing, isInitial) and later only what was added, plus
// dynamic_skill when it finds a skills folder. Record files only grow, so each call reads just the new part.
const skillCache = new Map(); // file -> { pos, rest, map: name -> description }
export function sessionSkills(file) {
  let c = skillCache.get(file);
  const size = sizeOf(file);
  if (!c || size < c.pos) { c = { pos: 0, rest: '', map: new Map() }; skillCache.set(file, c); }
  if (size > c.pos) {
    let text = '';
    try { const fd = fs.openSync(file, 'r'); const buf = Buffer.alloc(size - c.pos); fs.readSync(fd, buf, 0, buf.length, c.pos); fs.closeSync(fd); text = buf.toString('utf8'); } catch { return [...c.map].map(([name, detail]) => ({ name, detail })); }
    c.pos = size;
    const lines = (c.rest + text).split('\n');
    c.rest = lines.pop(); // a line still being written
    for (const line of lines) {
      if (!line.includes('"skill_listing"') && !line.includes('"dynamic_skill"')) continue;
      let o; try { o = JSON.parse(line); } catch { continue; }
      const a = o.attachment;
      if (a?.type === 'skill_listing') {
        if (a.isInitial) c.map.clear();
        const desc = new Map();
        for (const l of String(a.content || '').split('\n')) { const m = l.match(/^- ([^:\s]+(?::[^:\s]+)?):\s*(.*)$/); if (m && !desc.has(m[1])) desc.set(m[1], m[2]); }
        for (const n of a.names?.length ? a.names : [...desc.keys()]) c.map.set(n, short(desc.get(n) || '', 200));
      } else if (a?.type === 'dynamic_skill') {
        for (const n of a.skillNames || []) if (!c.map.has(n)) c.map.set(n, short(frontmatter(readText(path.join(a.skillDir || '', n, 'SKILL.md'))).description || '', 200));
      }
    }
  }
  return [...c.map].map(([name, detail]) => ({ name, detail }));
}

// Lists what the profile has. Every item with a path can be opened (its text) from the page; paths are the allowlist.
// extras: { docket: [{ name, text, path?, note }], docketTools: [names], latest: file of the newest session record,
// brands: the brands the desk has on (brandsOf), by default Claude and each brand whose home the desk has }
export function buildProfile(client, { isDefaultHome, docket = [], docketTools = [], docketMcp = [], docketHooks = [], latestFile, brands = ['claude', 'grok', 'codex'].filter((b) => b === 'claude' || client[b + 'Home']), grokHookFile } = {}) {
  const home = client.home, folder = client.folder || home;
  const allowed = new Set();
  const item = (o) => { if (o.path) { o.path = path.resolve(o.path); allowed.add(o.path.toLowerCase()); if (o.size === undefined) o.size = sizeOf(o.path); } return o; };
  const sections = [];

  // settings files, in the order Claude Code applies them
  const settingFiles = [
    [path.join(home, 'settings.json'), 'desk settings'], [path.join(home, 'settings.local.json'), 'desk settings (this computer)'],
    [path.join(folder, '.claude', 'settings.json'), 'desk folder settings'], [path.join(folder, '.claude', 'settings.local.json'), 'desk folder settings (this computer)'],
  ].map(([f, label]) => ({ f, label, j: readJson(f) })).filter((x) => x.j);

  // plugins installed in the profile, with what each brings
  const installed = readJson(path.join(home, 'plugins', 'installed_plugins.json'));
  const enabled = Object.assign({}, ...settingFiles.map((s) => s.j.enabledPlugins || {}));
  const plugins = [];
  for (const [key, list] of Object.entries(installed?.plugins || {})) {
    const inst = (Array.isArray(list) ? list : [list])[0] || {};
    // The checkbox writes <home>/settings.json; a layer after it that also names the plugin wins over it.
    const over = settingFiles.filter((s) => s.f !== path.join(home, 'settings.json') && s.j.enabledPlugins?.[key] !== undefined).map((s) => s.label);
    plugins.push({ key, dir: inst.installPath, version: inst.version, on: enabled[key] !== false, over });
  }

  // Hooks
  const hookSources = settingFiles.map((s) => [s.j.hooks, s.label, s.f]);
  for (const p of plugins) if (p.dir) { const f = path.join(p.dir, 'hooks', 'hooks.json'); const j = readJson(f); if (j) hookSources.push([j.hooks || j, `plugin ${p.key}${p.on ? '' : ' (off)'}`, f]); }
  sections.push({ id: 'hooks', title: 'Hooks', note: 'Commands Claude Code runs by itself at set moments. Sessions in other folders also run that folder\'s own .claude/settings.json hooks.',
    groups: hookGroups(hookSources, item) });

  // Instructions
  const inst = [];
  inst.push(...instructionTree(path.join(home, 'CLAUDE.md'), 'CLAUDE.md (every session on this desk)').map(item));
  for (const [f, l] of [[path.join(folder, 'CLAUDE.md'), 'CLAUDE.md in the desk folder'], [path.join(folder, '.claude', 'CLAUDE.md'), '.claude/CLAUDE.md in the desk folder'], [path.join(folder, 'CLAUDE.local.md'), 'CLAUDE.local.md in the desk folder']])
    inst.push(...instructionTree(f, l).map(item));
  const styleSetting = settingFiles.map((s) => s.j.outputStyle).filter(Boolean).pop() || 'Default';
  const styles = [];
  for (const d of [path.join(home, 'output-styles'), path.join(folder, '.claude', 'output-styles')]) for (const n of listDir(d).filter((n) => n.endsWith('.md'))) {
    const f = path.join(d, n), fm = frontmatter(readText(f));
    const name = fm.name || n.replace(/\.md$/, '');
    styles.push(item({ name, detail: fm.description || '', path: f, badge: name.toLowerCase() === styleSetting.toLowerCase() ? 'in use' : '' }));
  }
  for (const b of ['Default', 'Explanatory', 'Learning']) styles.push({ name: b, detail: 'built into Claude Code', badge: b.toLowerCase() === styleSetting.toLowerCase() ? 'in use' : '' });
  sections.push({ id: 'instructions', title: 'Instructions', note: 'Read at the start of every session. A session working in another folder also reads that folder\'s CLAUDE.md files.',
    groups: [{ title: 'CLAUDE.md and what it pulls in', items: inst.length ? inst : [{ name: 'No CLAUDE.md on this desk', detail: path.join(home, 'CLAUDE.md') }] }, { title: 'Output styles', items: styles }] });

  // Memory: one memory folder per working folder Claude has been used in
  const memGroups = [];
  const projects = path.join(home, 'projects');
  for (const p of listDir(projects)) {
    const md = path.join(projects, p, 'memory');
    if (!isDir(md)) continue;
    const files = listDir(md).filter((n) => n.endsWith('.md'));
    if (!files.length) continue;
    const items = files.sort((a, b) => (b === 'MEMORY.md') - (a === 'MEMORY.md') || a.localeCompare(b)).map((n) => {
      const f = path.join(md, n), fm = n === 'MEMORY.md' ? {} : frontmatter(readText(f));
      return item({ name: n === 'MEMORY.md' ? 'MEMORY.md (the index, loaded every session)' : fm.name || n, detail: n === 'MEMORY.md' ? '' : fm.description || '', path: f, badge: fm.type || '' });
    });
    memGroups.push({ title: `Sessions working in ${folderOf(path.join(projects, p)) || p}`, items });
  }
  sections.push({ id: 'memory', title: 'Memory', note: 'Facts Claude saved for later. Each working folder has its own; its index loads at the start of every session there.',
    groups: memGroups.length ? memGroups : [{ title: '', items: [{ name: 'No memory saved yet', detail: projects }] }] });

  // Skills, commands, agents, plugins
  const skills = [];
  const skillDir = (d, src, prefix = '') => { for (const n of listDir(d)) { const f = path.join(d, n, 'SKILL.md'); if (!fs.existsSync(f)) continue; const fm = frontmatter(readText(f)); skills.push(item({ name: prefix + (fm.name || n), detail: fm.description || '', path: f, note: src })); } };
  skillDir(path.join(home, 'skills'), 'made on this desk');
  for (const b of listDir(path.join(home, 'skills', 'synced'))) if (!b.startsWith('.')) skillDir(path.join(home, 'skills', 'synced', b), 'shared by the claude.ai organization', 'anthropic-skills:');
  skillDir(path.join(folder, '.claude', 'skills'), 'in the desk folder');
  for (const p of plugins) if (p.dir) skillDir(path.join(p.dir, 'skills'), `plugin ${p.key}${p.on ? '' : ' (off)'}`, p.key.split('@')[0] + ':');
  const mdList = (dirs) => dirs.flatMap(([d, src]) => listDir(d).filter((n) => n.endsWith('.md')).map((n) => { const f = path.join(d, n), fm = frontmatter(readText(f)); return item({ name: fm.name || n.replace(/\.md$/, ''), detail: fm.description || '', path: f, note: src }); }));
  const commands = mdList([[path.join(home, 'commands'), 'made on this desk'], [path.join(folder, '.claude', 'commands'), 'in the desk folder'], ...plugins.filter((p) => p.dir).map((p) => [path.join(p.dir, 'commands'), `plugin ${p.key}`])]);
  for (const c of commands) c.name = '/' + c.name;
  const agents = mdList([[path.join(home, 'agents'), 'made on this desk'], [path.join(folder, '.claude', 'agents'), 'in the desk folder'], ...plugins.filter((p) => p.dir).map((p) => [path.join(p.dir, 'agents'), `plugin ${p.key}`])]);
  const pluginItems = plugins.map((p) => item({ name: p.key, size: 0, detail: p.dir || '', badge: p.on ? 'on' : 'off', note: p.version ? `version ${p.version}` : '',
    toggle: { kind: 'plugin', key: p.key, on: p.on, note: `covers all of its hooks, skills, commands, agents and services${p.over.length ? `; also set in ${p.over.join(', ')}, which wins` : ''}` }, path: p.dir && fs.existsSync(path.join(p.dir, '.claude-plugin', 'plugin.json')) ? path.join(p.dir, '.claude-plugin', 'plugin.json') : undefined }));
  sections.push({ id: 'skills', title: 'Skills, commands, agents and plugins', note: 'Skills load when a task needs them; commands run when you type /name; agents are helpers Claude can start.',
    groups: [{ title: 'Skills', items: skills }, { title: 'Slash commands', items: commands }, { title: 'Agents', items: agents }, { title: 'Plugins', items: pluginItems }] });

  // Connected services (MCP servers). Only names and how they start: never their keys or headers.
  const cfgFile = isDefaultHome ? path.join(os.homedir(), '.claude.json') : path.join(home, '.claude.json');
  const cfg = readJson(cfgFile) || {};
  const srv = (name, s, where, p) => item({ name, detail: s.url || [s.command, ...(s.args || [])].filter(Boolean).join(' '), badge: s.type || (s.url ? 'http' : 'command'), note: where, path: p, size: 0 });
  const mcp = [];
  for (const [n, s] of Object.entries(cfg.mcpServers || {})) mcp.push(srv(n, s, 'this desk (all folders)'));
  const norm = (p) => path.resolve(p).toLowerCase();
  for (const [k, v] of Object.entries(cfg.projects || {})) if (norm(k) === norm(folder)) for (const [n, s] of Object.entries(v.mcpServers || {})) mcp.push(srv(n, s, 'desk folder only'));
  const mcpJson = path.join(folder, '.mcp.json');
  for (const [n, s] of Object.entries(readJson(mcpJson)?.mcpServers || {})) mcp.push(srv(n, s, 'desk folder .mcp.json', mcpJson));
  for (const p of plugins) if (p.dir) { const f = path.join(p.dir, '.mcp.json'); for (const [n, s] of Object.entries(readJson(f)?.mcpServers || {})) mcp.push(srv(n, s, `plugin ${p.key}`, f)); }
  const connectors = (cfg.claudeAiMcpEverConnected || []).map((n) => ({ name: n, key: n.startsWith('claude.ai ') ? n : `claude.ai ${n}`, detail: 'connected through claude.ai', note: 'used on this desk before' }));
  const own = docketMcp.map((d) => ({ name: d.name, detail: d.detail, badge: 'command', note: d.note, docket: true }));
  // A profile in its own folder reads <home>/.claude.json, not ~/.claude.json, so servers added in the
  // terminal (claude mcp add) on the standard profile do not reach this company's sessions.
  const groups = [{ title: 'Set up on this computer', items: mcp.length ? mcp : [{ name: 'None set up', detail: cfgFile }] }, { title: 'claude.ai connectors', items: connectors },
    { title: 'Added by Docket to every session', items: own }];
  if (!isDefaultHome) {
    const mine = new Set(mcp.map((m) => m.name));
    const missing = Object.entries(readJson(path.join(os.homedir(), '.claude.json'))?.mcpServers || {}).filter(([n]) => !mine.has(n))
      .map(([n, s]) => ({ name: n, detail: s.url || [s.command, ...(s.args || [])].filter(Boolean).join(' '), badge: 'not on this desk', missing: true }));
    if (missing.length) groups.push({ title: 'In ~/.claude.json but not on this desk', note: `The terminal on the standard Claude home has these; this desk's sessions do not, because its Claude home is ${home}. Add one with claude mcp add while CLAUDE_CONFIG_DIR is set to that folder if this desk needs it.`, items: missing });
  }
  for (const it of [...mcp, ...own]) it.key ||= it.name;
  sections.push({ id: 'mcp', title: 'Connected services', note: 'Outside tools Claude can use (MCP servers). Check connections runs claude mcp list for this desk and marks each one connected, failed or waiting for a sign-in. Docket\'s own two are not part of that check; an open session shows all of its servers, Docket\'s included, in its Details panel.',
    check: true, groups });

  // Claude Code's own defaults, as the newest session in this profile saw them
  const def = latestFile ? defaultsFrom(latestFile, skills, agents) : null;
  const perms = Object.assign({}, ...settingFiles.map((s) => s.j.permissions || {}));
  const settingsItems = settingFiles.map((s) => item({ name: s.label, detail: s.f, path: s.f, size: 0,
    note: [s.j.model && `model ${s.j.model}`, s.j.outputStyle && `style ${s.j.outputStyle}`, s.j.env && `sets ${Object.keys(s.j.env).join(', ')}`].filter(Boolean).join(' · ') }));
  if (perms.allow?.length || perms.deny?.length || perms.additionalDirectories?.length) settingsItems.push({ name: 'Permissions', detail: [perms.allow?.length && `allowed: ${perms.allow.join(', ')}`, perms.deny?.length && `refused: ${perms.deny.join(', ')}`, perms.additionalDirectories?.length && `extra folders: ${perms.additionalDirectories.join(', ')}`].filter(Boolean).join(' · ') });
  sections.push({ id: 'defaults', title: 'Claude Code\'s own defaults', note: def ? `What Claude Code adds without any setup, as the newest session on this desk saw it (${new Date(def.at).toLocaleString()}).` : 'No session on this desk yet, so the built-in lists are not known.',
    groups: [{ title: 'Settings files', items: settingsItems }, ...(def ? def.groups : [])] });

  // Docket's additions
  const dk = docket.map((d) => item({ name: d.name, detail: d.note || '', path: d.path, size: d.text.length, text: d.path ? undefined : d.text }));
  sections.push({ id: 'docket', title: 'Docket\'s additions', note: 'What Docket adds to every session it starts, on top of the desk\'s own setup.',
    groups: [{ title: 'Instructions', items: dk }, { title: 'Tools Docket gives every session', items: docketTools.map((t) => ({ name: t.name, detail: t.description || '' })) },
      { title: 'Hooks (the Docket plugin, plugin/ in the Docket folder)', items: docketHooks.map((h) => ({ name: h.name, detail: h.detail || h.command,
        note: [`${HOOK_WHEN[h.event] || h.event} (${h.event})`, h.matcher && `only for: ${h.matcher}`, 'Claude sessions',
          h.off ? 'turned off for this desk' : h.ownCopy ? 'skipped: this desk\'s settings already run it' : 'on'].filter(Boolean).join(' · '),
        toggle: { kind: 'docket-hook', key: h.name, on: !h.off, note: 'Claude and Grok sessions' } })) },
      { title: 'How Docket starts a session', items: [{ name: 'Desk\'s Claude home', detail: isDefaultHome ? 'the standard ~/.claude (CLAUDE_CONFIG_DIR not set)' : `CLAUDE_CONFIG_DIR=${home}` },
        { name: 'Permission mode', detail: 'Bypass permissions unless the session is set otherwise' },
        ...(fs.existsSync(path.join(home, 'gh-config')) ? [{ name: 'GitHub sign-in', detail: `GH_CONFIG_DIR=${path.join(home, 'gh-config')}` }] : []),
        ...(client.awsProfile ? [{ name: 'Amazon Bedrock', detail: `AWS_PROFILE=${client.awsProfile}` }] : [])] }] });

  // Switches: whole settings layers, and what Grok takes from Claude. A single hook in a settings file is never
  // switched here: Claude has no flag for one hook, and a repo's hooks are committed.
  const layers = client.settingSources || LAYERS;
  const layerItems = [
    ['user', 'User settings', 'this desk\'s settings.json: its hooks, plugins, permissions and model'],
    ['project', 'Project settings', 'each working folder\'s .claude/settings.json'],
    ['local', 'Local settings', 'each working folder\'s .claude/settings.local.json'],
  ].map(([k, name, detail]) => ({ name, detail, toggle: { kind: 'layer', key: k, on: layers.includes(k), note: k === 'project' ? 'off also leaves out every CLAUDE.md' : '' } }));
  // The plan system (#180): a choice of three. A plan folder (#180 step 3) is a folder of markdown checklist plans
  // another system keeps: Docket shows it read-only, so its two boxes (the folder, and the optional marker file
  // pattern for which session holds which plan) show only when it is chosen.
  const plan = client.planSystem || '';
  const planOptions = [['docket', 'Docket\'s plans'], ['folder', 'A plan folder, read-only'], ['none', 'None']];
  const pf = client.planFolder || {};
  const folderItems = plan !== 'folder' ? [] : [
    { name: 'Plan folder', detail: 'the folder of markdown checklist plans (- [ ] lines), read with every folder under it, shortcut folders too. Docket never writes there',
      input: { kind: 'plan-folder', key: 'path', value: pf.path || '', placeholder: 'C:\\notes\\Projects', note: pf.path ? '' : 'not set yet' } },
    { name: 'Marker files', detail: 'optional: the files in which the other system notes which session holds which plan, with * for the start of the session id (each holds state= and plan= lines). A name alone is looked for in this desk\'s Claude home',
      input: { kind: 'plan-folder', key: 'marker', value: pf.marker || '', placeholder: '.notes-plan-*', note: '' } }];
  const switchGroups = [{ title: 'Plans', brand: null, note: 'Docket\'s own plan system: a session can keep a plan of tasks for a larger piece of work, hand the tasks to child sessions, and follow them in the Plan section. Its instructions are prompts/optional/plans.md, for every brand. A plan folder: another system keeps the plans, and Docket only shows them.',
    items: [{ name: 'Plan system', detail: 'Docket\'s plans: sessions get the plan tools and instructions, and the Plan section shows each plan. A plan folder: Docket shows the plans in a folder another system keeps (read-only, no plan tools or instructions). None: no plans',
      toggle: { kind: 'plans', key: 'plans', value: ['folder', 'docket'].includes(plan) ? plan : 'none', options: planOptions, note: plan ? '' : 'not chosen yet' } }, ...folderItems] },
    { title: 'How sessions split work', brand: null, note: 'Docket\'s instructions in prompts/optional/split-work.md, for every brand. Off: a session still starts another when the user asks for one.',
    items: [{ name: 'Send work to child sessions', detail: 'a session the user started sends real work (a build, a fix) to its own child session on its own, and stays free to talk',
      toggle: { kind: 'split', key: 'split', on: client.splitWork !== false, note: '' } }] },
    { title: 'When a running session\'s config changes', note: 'A Claude session loads its plugins, hooks, connected services and settings when it starts, so Docket restarts it, with the same conversation, to take a change in: never mid-turn or while its background commands run. A changed CLAUDE.md needs no restart: the session is told to read it again with its next message.',
      items: [{ name: 'Reload', detail: 'Automatic: at the session\'s next idle moment, before its next message. Ask: the session shows "config changed" until you press Reload or Reload all',
        toggle: { kind: 'reload', key: 'reload', value: client.configReload === 'ask' ? 'ask' : 'auto', options: [['auto', 'Automatic'], ['ask', 'Ask']], note: '' } }] },
    { title: 'Settings layers Claude sessions load', note: 'Docket passes these when it starts a Claude session (settingSources); no file changes.', items: layerItems }];
  if (client.grokHome) {
    const cfg = path.join(client.grokHome, 'config.toml'), now = readGrokCompat(readText(cfg));
    const what = { hooks: 'Claude\'s hooks (settings.json)', rules: 'Claude\'s rules (CLAUDE.md)', skills: 'Claude\'s skills', agents: 'Claude\'s agents', mcps: 'Claude\'s connected services', sessions: 'Claude\'s past sessions' };
    switchGroups.push({ title: 'What Grok sessions take from Claude', brand: 'grok', note: `[compat.claude] in ${cfg}. Only that one key changes; the rest of the file stays as it is.`,
      items: GROK_COMPAT.map((k) => item({ name: k, detail: what[k], path: fs.existsSync(cfg) ? cfg : undefined, size: 0,
        toggle: { kind: 'grok', key: k, on: now[k] !== false, note: now[k] === undefined ? 'not set: Grok\'s default' : '' } })) });
  }
  sections.push({ id: 'switches', title: 'Switches', note: 'Each change applies to sessions started after it; open sessions keep what they started with until they reload (see When a running session\'s config changes). Plugins and Docket\'s hooks have their checkboxes in their own sections.',
    groups: switchGroups });


  // Codex and Grok: each brand the desk has on adds its own groups to the same sections, after Claude's.
  // Every group says whose it is (brand); Docket's instructions and tools reach every brand, so they have none.
  for (const s of sections) for (const g of s.groups) if (g.brand === undefined) g.brand = s.id === 'docket' && /^(Instructions|Tools)/.test(g.title) ? null : 'claude';
  const more = brands.map((b) => b === 'codex' && client.codexHome ? codexProfile(client.codexHome, folder, item)
    : b === 'grok' && client.grokHome ? grokProfile(client.grokHome, folder, item, { docketHooks, hookFile: grokHookFile }) : null).filter(Boolean);
  for (const b of more) for (const s of sections) s.groups.push(...(b[s.id] || []));
  for (const s of sections) s.groups = s.groups.filter((g) => g.brand === null || brands.includes(g.brand));
  const shown = sections.filter((s) => s.groups.length);
  for (const s of shown) s.count = s.groups.reduce((n, g) => n + g.items.filter((i) => !i.notRead && !/^No |^None /.test(i.name)).length, 0);
  return { client: { id: client.id, name: client.name, home, folder, brands: brands.filter((b) => b === 'claude' || client[b + 'Home']) }, sections: shown, allowed };
}

// ---------- Codex and Grok: what their homes give a session, in the same sections as Claude's ----------
// A small TOML reader, enough for config.toml: tables, arrays of tables ([[hooks.PreToolUse]]), dotted and quoted
// names, strings, numbers, booleans, dates and times (kept as written), arrays and inline tables. null when the text
// is not TOML it can read.
export function parseToml(src) {
  const t = String(src ?? '').replace(/^\uFEFF/, '');
  const root = {};
  let i = 0;
  const fail = (m) => { throw new Error(m); };
  const ws = () => { while (t[i] === ' ' || t[i] === '\t') i++; };
  const blank = () => { for (;;) { ws(); if (t[i] === '#') while (i < t.length && t[i] !== '\n') i++; if (t[i] === '\r' || t[i] === '\n') i++; else return; } };
  const eol = () => { ws(); if (t[i] === '#') while (i < t.length && t[i] !== '\n') i++; if (t[i] === '\r') i++; if (i < t.length && t[i] !== '\n') fail('expected the end of the line'); i++; };
  const ESC = { b: '\b', t: '\t', n: '\n', f: '\f', r: '\r', e: '\x1b', '"': '"', '\\': '\\' };
  const unescape = (s) => s.replace(/\\(u[0-9a-fA-F]{4}|U[0-9a-fA-F]{8}|.)/g, (m, c) => c.length > 1 ? String.fromCodePoint(parseInt(c.slice(1), 16)) : ESC[c] ?? c);
  const str = () => {
    const q = t[i];
    if (t.startsWith(q.repeat(3), i)) {
      i += 3; if (t[i] === '\r') i++; if (t[i] === '\n') i++;
      const end = t.indexOf(q.repeat(3), i); if (end < 0) fail('unclosed string');
      let body = t.slice(i, end); i = end + 3;
      while (t[i] === q) { body += q; i++; }
      return q === "'" ? body : unescape(body.replace(/\\[ \t]*\r?\n\s*/g, ''));
    }
    const start = ++i;
    if (q === "'") { const end = t.indexOf("'", i); if (end < 0 || t.slice(i, end).includes('\n')) fail('unclosed string'); i = end + 1; return t.slice(start, end); }
    while (i < t.length && t[i] !== '"' && t[i] !== '\n') i += t[i] === '\\' ? 2 : 1;
    if (t[i] !== '"') fail('unclosed string');
    return unescape(t.slice(start, i++));
  };
  const BARE = /[A-Za-z0-9_-]+/y;
  const keyPart = () => { ws(); if (t[i] === '"' || t[i] === "'") return str(); BARE.lastIndex = i; const m = BARE.exec(t); if (!m) fail('expected a name'); i += m[0].length; return m[0]; };
  const keyPath = () => { const k = [keyPart()]; for (;;) { ws(); if (t[i] !== '.') return k; i++; k.push(keyPart()); } };
  const put = (o, keys, v) => {
    for (const k of keys.slice(0, -1)) { if (o[k] === undefined) o[k] = {}; o = o[k]; if (typeof o !== 'object' || o === null || Array.isArray(o)) fail('a name used twice'); }
    o[keys[keys.length - 1]] = v;
  };
  const DATE = /\d{4}-\d{2}-\d{2}(?:[T ]\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:\d{2})?)?|\d{2}:\d{2}:\d{2}(?:\.\d+)?/y;
  const ATOM = /[^\s,\]}#]+/y;
  const value = () => {
    ws();
    const c = t[i];
    if (c === '"' || c === "'") return str();
    if (c === '[') {
      i++; const arr = [];
      for (;;) { blank(); if (t[i] === ']') { i++; return arr; } arr.push(value()); blank(); if (t[i] === ',') { i++; continue; } if (t[i] === ']') { i++; return arr; } fail('expected , or ]'); }
    }
    if (c === '{') {
      i++; const o = {}; blank(); if (t[i] === '}') { i++; return o; }
      for (;;) { const k = keyPath(); ws(); if (t[i] !== '=') fail('expected ='); i++; put(o, k, value()); blank(); if (t[i] === ',') { i++; blank(); continue; } if (t[i] === '}') { i++; return o; } fail('expected , or }'); }
    }
    DATE.lastIndex = i; let m = DATE.exec(t);
    if (m) { i += m[0].length; return m[0]; }
    ATOM.lastIndex = i; m = ATOM.exec(t);
    if (!m) fail('expected a value');
    i += m[0].length;
    const w = m[0], n = w.replace(/_/g, '');
    if (w === 'true' || w === 'false') return w === 'true';
    if (/^[+-]?(\d+(\.\d+)?([eE][+-]?\d+)?|0x[0-9a-fA-F]+|0o[0-7]+|0b[01]+)$/.test(n)) return Number(n.replace(/^\+/, ''));
    if (/^[+-]?(inf|nan)$/.test(w)) return w.endsWith('nan') ? NaN : w.startsWith('-') ? -Infinity : Infinity;
    fail('unknown value');
  };
  const tableAt = (keys, many) => {
    let o = root;
    keys.forEach((k, n) => {
      if (n === keys.length - 1 && many) { if (o[k] === undefined) o[k] = []; if (!Array.isArray(o[k])) fail('a name used twice'); const x = {}; o[k].push(x); o = x; return; }
      if (o[k] === undefined) o[k] = {};
      o = Array.isArray(o[k]) ? o[k][o[k].length - 1] : o[k];
      if (typeof o !== 'object' || o === null) fail('a name used twice');
    });
    return o;
  };
  try {
    let cur = root;
    for (;;) {
      blank();
      if (i >= t.length) return root;
      if (t[i] === '[') {
        const many = t[i + 1] === '['; i += many ? 2 : 1;
        const k = keyPath(); ws();
        if (!t.startsWith(many ? ']]' : ']', i)) fail('expected ]');
        i += many ? 2 : 1; cur = tableAt(k, many); eol(); continue;
      }
      const k = keyPath(); ws();
      if (t[i] !== '=') fail('expected =');
      i++; put(cur, k, value()); eol();
    }
  } catch { return null; }
}

// What these readers do not know yet shows as a row saying so, never a guess.
const notRead = (detail) => ({ name: 'Not read yet', detail, notRead: true });
const none = (name, detail) => ({ name, detail });
const toml = (f) => { const text = readText(f); if (text === null) return { j: null, bad: false }; const j = parseToml(text); return { j, bad: !j }; };
const tomlRow = (f, label, r, item) => r.bad ? item({ name: `${label} could not be read`, detail: 'Not TOML this page can read; open it to see it', path: f }) : null;
// Skill folders (<name>/SKILL.md), and .md files (commands, agents, prompts), with what each says about itself.
const skillItems = (d, note, item, prefix = '') => listDir(d).map((n) => path.join(d, n, 'SKILL.md')).filter((f) => fs.existsSync(f)).map((f) => {
  const fm = frontmatter(readText(f));
  return item({ name: prefix + (fm.name || path.basename(path.dirname(f))), detail: fm.description || '', path: f, note });
});
const mdItems = (d, note, item, prefix = '') => listDir(d).filter((n) => n.endsWith('.md')).map((n) => {
  const f = path.join(d, n), fm = frontmatter(readText(f));
  return item({ name: prefix + (fm.name || n.replace(/\.md$/, '')), detail: fm.description || '', path: f, note });
});
// The files of a memory folder and of the folders in it, one level down, the index (MEMORY.md) first.
const memoryItems = (d, item) => listDir(d).flatMap((n) => isDir(path.join(d, n)) ? listDir(path.join(d, n)).map((m) => path.join(n, m)) : [n])
  .filter((n) => !isDir(path.join(d, n)) && !path.basename(n).startsWith('.'))
  .sort((a, b) => (b === 'MEMORY.md') - (a === 'MEMORY.md') || a.localeCompare(b))
  .map((n) => { const f = path.join(d, n), fm = /\.md$/i.test(n) ? frontmatter(readText(f)) : {}; return item({ name: fm.name || n, detail: fm.description || '', path: f, badge: fm.type || '' }); });
// [mcp_servers.<name>] tables: names and how each starts, never their env, headers or keys.
const tomlServers = (servers, note, f, item) => Object.entries(servers && typeof servers === 'object' ? servers : {}).map(([n, s]) => item({ name: n,
  detail: s?.url || [s?.command, ...(Array.isArray(s?.args) ? s.args : [])].filter(Boolean).join(' '), badge: s?.url ? 'http' : 'command',
  note: [note, s?.enabled === false && 'turned off'].filter(Boolean).join(' · '), path: f, size: 0 }));
// The instruction file a folder gives Codex: AGENTS.override.md when there is one (it is read instead), else AGENTS.md.
function agentsFiles(dir, where, item) {
  const over = path.join(dir, 'AGENTS.override.md'), main = path.join(dir, 'AGENTS.md'), hasOver = fs.existsSync(over);
  const out = [];
  if (hasOver) out.push(item({ name: `AGENTS.override.md ${where}`, detail: over, path: over, badge: 'in use' }));
  if (fs.existsSync(main)) out.push(item({ name: `AGENTS.md ${where}`, detail: main, path: main, ...(hasOver ? { badge: 'not read', note: 'AGENTS.override.md beside it is read instead' } : {}) }));
  return out;
}

// A desk's Codex home (codexHome, CODEX_HOME). Where Codex looks, as read in Codex's own code (github.com/openai/codex,
// codex-rs, 2026-11-02): hooks in <home>/hooks.json and the [hooks] tables of <home>/config.toml, in Claude's shape,
// plus a trusted folder's .codex/hooks.json and .codex/config.toml, and each plugin's hooks/hooks.json; MCP servers in
// [mcp_servers.<name>]; plugins in [plugins."<name>@<marketplace>"] (enabled = true or false), installed under
// <home>/plugins/cache/<marketplace>/<name>/<version>; skills in <home>/skills, ~/.agents/skills and the folder's
// .agents/skills; memory in <home>/memories. Returns { section id: [groups] }, every group marked brand: 'codex'.
export function codexProfile(home, folder, item) {
  const cfgFile = path.join(home, 'config.toml'), cfg = toml(cfgFile), c = cfg.j || {};
  const projDir = path.join(folder, '.codex'), projFile = path.join(projDir, 'config.toml'), proj = toml(projFile), pc = proj.j || {};
  const plugins = Object.entries(c.plugins && typeof c.plugins === 'object' ? c.plugins : {}).map(([id, v]) => {
    const [name, market] = id.split('@');
    const base = path.join(home, 'plugins', 'cache', market || '', name);
    const version = market ? listDir(base).filter((n) => isDir(path.join(base, n))).sort().pop() : '';
    return { id, on: v?.enabled !== false, dir: version ? path.join(base, version) : '', version };
  });
  const off = (p) => p.on ? '' : ' (off)';
  const g = (title, items, empty) => ({ title, brand: 'codex', items: items.length ? items : empty ? [empty] : [] });

  // Hooks
  const hooksJson = path.join(home, 'hooks.json'), projHooks = path.join(projDir, 'hooks.json');
  const sources = [[readJson(hooksJson)?.hooks, 'hooks.json in the Codex home', hooksJson], [c.hooks, 'config.toml in the Codex home', cfgFile],
    [readJson(projHooks)?.hooks, '.codex/hooks.json in the desk folder', projHooks], [pc.hooks, '.codex/config.toml in the desk folder', projFile]];
  for (const p of plugins) if (p.dir) { const f = path.join(p.dir, 'hooks', 'hooks.json'); const j = readJson(f); if (j) sources.push([j.hooks || j, `plugin ${p.id}${off(p)}`, f]); }
  const hookGs = hookGroups(sources, item, 'Codex').map((x) => ({ ...x, brand: 'codex' }));
  const extra = [tomlRow(cfgFile, 'config.toml', cfg, item), tomlRow(projFile, '.codex/config.toml in the desk folder', proj, item),
    c.features?.hooks === false && { name: 'Hooks turned off', detail: '[features] hooks = false in config.toml', badge: 'off' }].filter(Boolean);
  const hooks = [...(hookGs.length ? hookGs : [g('', [], none('No hooks in this Codex home', hooksJson))]), ...extra.map((r) => g('', [r]))];

  // Instructions
  const inst = [...agentsFiles(home, '(every Codex session in this desk)', item), ...agentsFiles(folder, 'in the desk folder', item)];
  const rules = listDir(path.join(home, 'rules')).filter((n) => n.endsWith('.rules')).map((n) => item({ name: n, detail: 'which commands Codex may run without asking', path: path.join(home, 'rules', n) }));
  const instructions = [g('AGENTS.md', inst, none('No AGENTS.md in this Codex home', path.join(home, 'AGENTS.md'))), ...(rules.length ? [g('Command rules (rules/ in the Codex home)', rules)] : [])];

  // Connected services
  const mcp = [g('Set up for Codex', [...tomlServers(c.mcp_servers, 'Codex home config.toml', cfgFile, item), ...tomlServers(pc.mcp_servers, '.codex/config.toml in the desk folder', projFile, item)],
    none('None set up', cfgFile))];

  // Skills, prompts, plugins
  const skills = [...skillItems(path.join(home, 'skills'), 'made in this Codex home', item), ...skillItems(path.join(home, 'skills', '.system'), 'comes with Codex', item),
    ...skillItems(path.join(os.homedir(), '.agents', 'skills'), 'in ~/.agents/skills (every Codex home)', item), ...skillItems(path.join(folder, '.agents', 'skills'), 'in the desk folder', item),
    ...plugins.filter((p) => p.dir).flatMap((p) => skillItems(path.join(p.dir, 'skills'), `plugin ${p.id}${off(p)}`, item, p.id.split('@')[0] + ':'))];
  const prompts = mdItems(path.join(home, 'prompts'), 'made in this Codex home', item, '/prompts:');
  const pluginItems = plugins.map((p) => {
    const manifest = p.dir && path.join(p.dir, '.codex-plugin', 'plugin.json');
    return item({ name: p.id, size: 0, detail: p.dir || 'not found under plugins/cache in the Codex home', badge: p.on ? 'on' : 'off', note: p.version ? `version ${p.version}` : '', path: manifest && fs.existsSync(manifest) ? manifest : undefined });
  });
  const skillGs = [g('Skills', skills, none('No skills', path.join(home, 'skills'))), ...(prompts.length ? [g('Prompts (type /prompts:name)', prompts)] : []), ...(pluginItems.length ? [g('Plugins', pluginItems)] : [])];

  // Memory
  const memDir = path.join(home, 'memories');
  const memory = [g('Codex memories (memories/ in the Codex home)', memoryItems(memDir, item), none('No memory saved yet', memDir))];

  return { hooks, instructions, mcp, skills: skillGs, memory,
    docket: [g('How Docket starts a Codex session', [{ name: 'Codex home', detail: `CODEX_HOME=${home}` }, { name: 'Docket hooks', detail: 'not given to Codex sessions yet' }])] };
}

// A desk's Grok home (grokHome, GROK_HOME). Where Grok looks, as far as Docket has checked (grok-home.mjs, copy-company.mjs,
// and the Grok README): rules in <home>/AGENTS.md and <home>/rules/, and the folder's AGENTS.md; hooks in
// [[hooks.<Event>]] tables of <home>/config.toml and every <home>/hooks/*.json, in Claude's shape, added up across
// layers, plus a trusted folder's .grok/hooks/; MCP servers in [mcp_servers.<name>]; skills, commands, agents and
// prompts folders; memory in memory/ and memories/. Grok plugins are not read yet. Its [compat.claude] switches have their
// checkboxes in the Switches section, so they are not listed again here.
// docketHooks: the Docket plugin's hooks, which Docket writes to <home>/hooks/<hookFile> before each Grok session.
export function grokProfile(home, folder, item, { docketHooks = [], hookFile = 'docket.json' } = {}) {
  const cfgFile = path.join(home, 'config.toml'), cfg = toml(cfgFile), c = cfg.j || {};
  const g = (title, items, empty) => ({ title, brand: 'grok', items: items.length ? items : empty ? [empty] : [] });

  // Hooks
  const sources = [[c.hooks, 'config.toml in the Grok home', cfgFile]];
  const hookDir = path.join(home, 'hooks'), projHooks = path.join(folder, '.grok', 'hooks');
  for (const n of listDir(hookDir).filter((n) => n.endsWith('.json') && n !== hookFile).sort()) { const f = path.join(hookDir, n), j = readJson(f); if (j) sources.push([j.hooks || j, `hooks/${n} in the Grok home`, f]); }
  for (const n of listDir(projHooks).filter((n) => n.endsWith('.json')).sort()) { const f = path.join(projHooks, n), j = readJson(f); if (j) sources.push([j.hooks || j, `.grok/hooks/${n} in the desk folder (trusted folders only)`, f]); }
  const hookGs = hookGroups(sources, item, 'Grok').map((x) => ({ ...x, brand: 'grok' }));
  const hooks = [...(hookGs.length ? hookGs : [g('', [], none('No hooks of this Grok home\'s own', hookDir))]), ...[tomlRow(cfgFile, 'config.toml', cfg, item)].filter(Boolean).map((r) => g('', [r]))];

  // Instructions
  const agentsMd = [[path.join(home, 'AGENTS.md'), 'AGENTS.md (every Grok session in this desk)'], [path.join(folder, 'AGENTS.md'), 'AGENTS.md in the desk folder']]
    .filter(([f]) => fs.existsSync(f)).map(([f, name]) => item({ name, detail: f, path: f }));
  const rules = listDir(path.join(home, 'rules')).filter((n) => !isDir(path.join(home, 'rules', n))).sort().map((n) => item({ name: n, detail: 'rules/ in the Grok home', path: path.join(home, 'rules', n) }));
  const instructions = [g('AGENTS.md and rules', [...agentsMd, ...rules], none('No AGENTS.md or rules in this Grok home', path.join(home, 'AGENTS.md')))];

  // Connected services
  const mcp = [g('Set up for Grok', tomlServers(c.mcp_servers, 'Grok home config.toml', cfgFile, item), none('None set up', cfgFile))];

  // Skills, commands, agents, prompts, plugins
  const skills = [g('Skills', skillItems(path.join(home, 'skills'), 'made in this Grok home', item), none('No skills', path.join(home, 'skills'))),
    ...[['commands', 'Commands'], ['agents', 'Agents'], ['prompts', 'Prompts']].map(([d, title]) => g(title, mdItems(path.join(home, d), 'made in this Grok home', item, d === 'commands' ? '/' : ''))).filter((x) => x.items.length),
    g('Plugins', [notRead('Grok plugins: where Grok keeps them has not been checked')])];

  // Memory
  const mem = ['memory', 'memories'].flatMap((d) => memoryItems(path.join(home, d), item).map((it) => ({ ...it, note: `${d}/ in the Grok home` })));
  const memory = [g('Grok memory (memory/ and memories/ in the Grok home)', mem, none('No memory saved yet', path.join(home, 'memory')))];

  // Docket's additions: its hook file, rewritten before each Grok session
  const file = path.join(hookDir, hookFile);
  const own = docketHooks.map((h) => item({ name: h.name, detail: h.detail || h.command, path: fs.existsSync(file) ? file : undefined, size: 0,
    note: [`${hookWhen(h.event, 'Grok')} (${h.event})`, h.matcher && `only for: ${h.matcher}`, 'Grok sessions', h.off ? 'turned off for this desk (Desks screen)' : 'on'].filter(Boolean).join(' · ') }));
  const docket = [g(`Hooks (hooks/${hookFile} in the Grok home, written before each Grok session)`, own, none('No Docket hooks', file)),
    g('How Docket starts a Grok session', [{ name: 'Grok home', detail: `GROK_HOME=${home}` }])];

  return { hooks, instructions, mcp, skills, memory, docket };
}

// claude mcp list prints one line per server: "<name>: <url or command> - ✔ Connected" (or "✘ Failed to connect — why",
// "! Needs authentication"). Without a terminal the marks are √ and ×, so the status comes from the words.
// Returns [{ name, target, status: connected | failed | needs-auth | other, text }].
export function parseMcpList(out) {
  const servers = [];
  for (const line of String(out || '').split(/\r?\n/)) {
    const m = line.match(/^(.+?): (.*) - (\S) (.+)$/);
    if (!m || /^[\w\s]$/.test(m[3])) continue;
    const text = m[4].trim();
    const status = /^connected/i.test(text) ? 'connected' : /^failed/i.test(text) ? 'failed' : /auth/i.test(text) ? 'needs-auth' : 'other';
    servers.push({ name: m[1].trim(), target: m[2].trim(), status, text });
  }
  return servers;
}

// The newest record's lists of skills, agents and tools that load on request; what is not on disk is built in.
function defaultsFrom(file, skills, agents) {
  let skillList = '', agentLines = [], deferred = [], prompt = null, at = 0;
  // read only the start of the file: these come in the first few entries
  let text = '';
  try { const fd = fs.openSync(file, 'r'); const buf = Buffer.alloc(Math.min(sizeOf(file), 4e6)); fs.readSync(fd, buf, 0, buf.length, 0); fs.closeSync(fd); text = buf.toString('utf8'); } catch { return null; }
  for (const line of text.split('\n')) {
    let o; try { o = JSON.parse(line); } catch { continue; }
    const a = o.attachment; if (!a) continue;
    at ||= Date.parse(o.timestamp || '') || 0;
    if (a.type === 'skill_listing' && !skillList) skillList = a.content || '';
    if (a.type === 'agent_listing_delta') agentLines.push(...(a.addedLines || []));
    if (a.type === 'deferred_tools_delta') deferred.push(...(a.addedNames || []));
    if (a.type === 'prompt_snapshot' && !prompt) prompt = (a.systemPrompt || []).filter((x) => typeof x === 'string' && !x.includes('You are running inside Docket') && x !== '__SYSTEM_PROMPT_DYNAMIC_BOUNDARY__').join('\n\n');
  }
  const mine = new Set(skills.map((s) => s.name.toLowerCase()));
  const builtSkills = skillList.split('\n').filter((l) => l.startsWith('- ')).map((l) => { const m = l.slice(2).match(/^([^:]+(?::[^:\s]+)?):\s*(.*)$/); return m ? { name: m[1], detail: short(m[2], 220) } : null; })
    .filter((s) => s && !mine.has(s.name.toLowerCase()));
  const myAgents = new Set(agents.map((a) => a.name.toLowerCase()));
  const builtAgents = agentLines.map((l) => { const m = l.replace(/^- /, '').match(/^([^:]+):\s*(.*)$/); return m ? { name: m[1], detail: short(m[2], 220) } : null; }).filter((a) => a && !myAgents.has(a.name.toLowerCase()));
  const tools = deferred.filter((n) => !n.startsWith('mcp__'));
  return { at, groups: [
    { title: 'Claude Code\'s own instructions', items: prompt ? [{ name: 'The system prompt Claude Code writes', detail: 'rules for tools, safety, git, replies', size: prompt.length, text: prompt }] : [] },
    { title: 'Built-in skills', items: builtSkills }, { title: 'Built-in agents', items: builtAgents },
    { title: 'Tools that load on request', items: tools.map((n) => ({ name: n, detail: '' })) },
  ].filter((g) => g.items.length) };
}

// A projects/<name> folder's real working folder, from the cwd of its newest record.
function folderOf(dir) {
  const files = listDir(dir).filter((n) => n.endsWith('.jsonl'));
  for (const n of files.slice(-3).reverse()) {
    try {
      const fd = fs.openSync(path.join(dir, n), 'r'); const buf = Buffer.alloc(65536); const len = fs.readSync(fd, buf, 0, buf.length, 0); fs.closeSync(fd);
      const m = buf.toString('utf8', 0, len).match(/"cwd":"((?:[^"\\]|\\.)*)"/);
      if (m) return JSON.parse(`"${m[1]}"`);
    } catch {}
  }
  return '';
}
