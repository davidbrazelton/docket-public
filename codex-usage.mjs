// Codex (OpenAI's coding agent) usage rows. Reads Codex's own session files and turns
// them into the same per-day rows as costs.mjs, with Brand 'codex', so the Usage page and the
// CSV count Codex beside Claude. Codex sessions run in its desktop app or a terminal count too.
//
// What the files hold (checked against Codex 0.125 to 0.163):
//  - <home>/sessions/YYYY/MM/DD/rollout-<time>-<id>.jsonl.zst, zstd (Node 24's zlib reads it); a
//    session still being written is plain .jsonl. <home> is CODEX_HOME, else ~/.codex.
//  - the first line, session_meta, has the session's id, its working folder (cwd) and, for a
//    sub-agent, the parent's session_id and parent_thread_id. A sub-agent (the automatic approval
//    reviewer, "guardian") has its own file; its calls are only there, so files are grouped by
//    session_id and its calls become 'agent' rows.
//  - token_usage_record (0.155 and later) is one line per model call, keyed by response_id. Older
//    files only have event_msg/token_count, whose last_token_usage is the one call (info can be null).
//    token_count shows zero for a compaction call, so token_usage_record wins when both are there.
//  - OpenAI's input_tokens includes the cached part and output_tokens includes reasoning, as billed.
//  - the model is on turn_context, matched by turn_id. A compacted line names its call
//    (compaction_response_id), which is logged like any other, so nothing is estimated.
//  - a resumed session keeps writing to its first file, so rows are dated by each call's own time.
//  - session_index.jsonl holds titles (thread_name); auth.json the sign-in (email in the id_token).
//  - lines added and removed: each file edit is an apply_patch call (a custom_tool_call whose input is the
//    patch, or a function_call or shell call carrying it), counted by its + and - lines once per call_id; a call
//    whose patch_apply_end says it failed is not counted. A deleted file's lines are not in the patch, so they are not
//    counted as removed. (Written from Codex's patch format, not yet checked against a real Codex log.)
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import { loadPrices, priceReply, dayRows } from './costs.mjs';

export const defaultCodexHome = () => process.env.CODEX_HOME || path.join(os.homedir(), '.codex');

function readText(file) {
  const buf = fs.readFileSync(file);
  return (file.endsWith('.zst') ? zlib.zstdDecompressSync(buf) : buf).toString('utf8');
}
function* lines(text) {
  for (const line of text.split('\n')) { if (!line) continue; try { yield JSON.parse(line); } catch {} }
}

// Every rollout file under a home, newest folders last.
function rolloutFiles(home) {
  const out = [];
  const walk = (dir, depth) => {
    let names = []; try { names = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const d of names) {
      const p = path.join(dir, d.name);
      if (d.isDirectory() && depth < 3) walk(p, depth + 1);
      else if (d.isFile() && /^rollout-.*\.jsonl(\.zst)?$/.test(d.name)) out.push(p);
    }
  };
  walk(path.join(home, 'sessions'), 0);
  return out.sort();
}

// A file's session_meta, kept until the file changes (a sweep reads only the first line of new files).
const metaCache = new Map(); // file -> { size, meta }
function fileMeta(file) {
  let size = 0; try { size = fs.statSync(file).size; } catch { return null; }
  const hit = metaCache.get(file);
  if (hit && hit.size === size) return hit.meta;
  let meta = null;
  try {
    const text = readText(file);
    const first = text.slice(0, text.indexOf('\n') > 0 ? text.indexOf('\n') : text.length);
    const p = JSON.parse(first).payload || {};
    meta = { sessionId: p.session_id || p.id, threadId: p.id, cwd: p.cwd || '', subagent: !!p.parent_thread_id || typeof p.source === 'object',
      started: Date.parse(p.timestamp) || 0 };
  } catch {}
  metaCache.set(file, { size, meta });
  return meta;
}

function titles(home) {
  const out = new Map();
  try { for (const e of lines(fs.readFileSync(path.join(home, 'session_index.jsonl'), 'utf8'))) if (e.id && e.thread_name) out.set(e.id, e.thread_name); } catch {}
  return out;
}

// Codex sessions in one home: session id -> { id, files (its own first), cwd, title, sig }.
export function codexSessions(home) {
  const byId = new Map();
  for (const f of rolloutFiles(home)) {
    const m = fileMeta(f);
    if (!m?.sessionId) continue;
    const s = byId.get(m.sessionId) || { id: m.sessionId, files: [], cwd: '', started: 0, sizes: [] };
    if (m.subagent) s.files.push(f); else { s.files.unshift(f); s.cwd = m.cwd; s.started = m.started; }
    s.cwd ||= m.cwd;
    byId.set(m.sessionId, s);
  }
  const names = titles(home);
  for (const s of byId.values()) {
    s.title = names.get(s.id) || '';
    s.sig = s.files.map((f) => { try { return fs.statSync(f).size; } catch { return 0; } }).join(',');
  }
  return byId;
}

// The account a home is signed in with, as the Usage page's Account filter shows it.
export function codexAccount(home) {
  try {
    const a = JSON.parse(fs.readFileSync(path.join(home, 'auth.json'), 'utf8'));
    if (a.tokens?.id_token) {
      const claims = JSON.parse(Buffer.from(a.tokens.id_token.split('.')[1], 'base64url').toString('utf8'));
      if (claims.email) return `chatgpt:${claims.email}`;
    }
    if (a.OPENAI_API_KEY) return 'openai (API key)';
  } catch {}
  return 'chatgpt (sign-in unknown)';
}

// One reply per model call, in the shape costs.mjs prices: Anthropic's usage names, with
// OpenAI's cached input as a cache read and its cache writes as the shorter cache write.
function asReply(u, model, at, subagent, key) {
  const cached = u.cached_input_tokens || 0, write = u.cache_write_input_tokens || 0;
  return { key, model, at, subagent, brand: 'codex', tools: new Map(), bedrock: false, global: false,
    usage: { input_tokens: Math.max(0, (u.input_tokens || 0) - cached - write), output_tokens: u.output_tokens || 0,
      cache_read_input_tokens: cached, cache_creation_input_tokens: write, reasoning_output_tokens: u.reasoning_output_tokens || 0 } };
}

// The patch text of an apply_patch call, or '' when the line is not one.
function patchOf(p) {
  if (p.name === 'apply_patch' && typeof p.input === 'string') return p.input;
  if (p.type !== 'function_call' && p.type !== 'local_shell_call') return '';
  let a = p.arguments ?? p.action ?? {};
  if (typeof a === 'string') { try { a = JSON.parse(a); } catch { return ''; } }
  if (p.name === 'apply_patch') return typeof a.input === 'string' ? a.input : typeof a.patch === 'string' ? a.patch : '';
  const cmd = Array.isArray(a.command) ? a.command : [];
  return cmd[0] === 'apply_patch' && typeof cmd[1] === 'string' ? cmd[1] : '';
}
// Lines added and removed by a patch in Codex's format: "*** ..." lines are headers, the rest are +, - or context.
export function patchLines(patch) {
  let added = 0, removed = 0;
  for (const l of String(patch).split('\n')) { if (l.startsWith('***')) continue; if (l[0] === '+') added++; else if (l[0] === '-') removed++; }
  return { added, removed };
}

// turns: task_started to task_complete (or turn_aborted) in the main file; a turn with no end runs to its last line.
// edits: { at, added, removed } per apply_patch call, from every file.
export function readCodexSession(files) {
  const replies = new Map(); // response id -> reply (a forked file may copy lines)
  const compactions = [];
  const turns = [];
  const patches = new Map(), failed = new Set(); // call id -> edit
  files.forEach((file, fileIndex) => {
    let text = ''; try { text = readText(file); } catch { return; }
    const subagent = fileIndex > 0;
    const models = new Map(); let model = '';
    let hasRecords = text.includes('"token_usage_record"');
    let pendingTools = [];
    const compactIds = new Set();
    let n = 0, lastTotal = '', turn = null;
    for (const e of lines(text)) {
      const p = e.payload || {};
      const at = Date.parse(e.timestamp) || 0;
      if (!subagent && at) {
        if (e.type === 'event_msg' && p.type === 'task_started') { turn = { start: at, end: at }; turns.push(turn); }
        else if (turn) { turn.end = Math.max(turn.end, at); if (e.type === 'event_msg' && (p.type === 'task_complete' || p.type === 'turn_aborted')) turn = null; }
      }
      if (e.type === 'response_item') {
        const patch = patchOf(p);
        const id = p.call_id || p.id || `${path.basename(file)}:${at}`;
        if (patch && !patches.has(id)) { const n = patchLines(patch); if (n.added || n.removed) patches.set(id, { at, ...n }); }
      } else if (e.type === 'event_msg' && p.type === 'patch_apply_end' && p.success === false && p.call_id) failed.add(p.call_id);
      if (e.type === 'turn_context' && p.model) { model = p.model; if (p.turn_id) models.set(p.turn_id, p.model); }
      else if (e.type === 'response_item' && /(^|_)(function|custom_tool|local_shell|web_search)_call$/.test(p.type || '')) pendingTools.push(p.call_id || p.id || `t${n++}`);
      else if (e.type === 'compacted') { if (!subagent) compactions.push({ at }); if (p.compaction_response_id) compactIds.add(p.compaction_response_id); }
      else if (e.type === 'token_usage_record' && hasRecords && p.usage) {
        const key = p.response_id || `${file}:${e.ordinal ?? n++}`;
        if (replies.has(key)) continue;
        const r = asReply(p.usage, models.get(p.turn_id) || model, at, subagent, key);
        for (const t of pendingTools) r.tools.set(t, { name: 'tool', file: null });
        pendingTools = [];
        replies.set(key, r);
      } else if (!hasRecords && e.type === 'event_msg' && p.type === 'token_count' && p.info?.last_token_usage) {
        const total = JSON.stringify(p.info.total_token_usage || {});
        if (total === lastTotal) continue; // the same count sent twice
        lastTotal = total;
        const key = `${path.basename(file)}:${n++}`;
        const r = asReply(p.info.last_token_usage, model, at, subagent, key);
        for (const t of pendingTools) r.tools.set(t, { name: 'tool', file: null });
        pendingTools = [];
        replies.set(key, r);
      }
    }
    for (const id of compactIds) { const r = replies.get(id); if (r) r.compaction = true; }
  });
  const edits = [...patches].filter(([id]) => !failed.has(id)).map(([, e]) => e);
  return { replies: [...replies.values()].sort((a, b) => a.at - b.at), compactions, turns: turns.filter((t) => t.end > t.start), edits };
}

// The per-day rows for one Codex session, in costs.mjs's columns.
// appWaits: [start, end] of each prompt Docket showed this session.
// billed: the account's label, or { connection } from connection.mjs.
export function codexRows(client, session, pricingFile, title, billed, appWaits = []) {
  const prices = loadPrices(pricingFile);
  const { replies, compactions, turns, edits } = readCodexSession(session.files);
  const priced = replies.map((r) => priceReply(r, prices));
  const agents = session.files.length - 1;
  return dayRows(client, session.id, title || session.title, priced, compactions, agents, prices, typeof billed === 'string' ? { subscription: billed } : billed || {}, { turns, waits: appWaits }, edits);
}
