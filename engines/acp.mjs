// The ACP engine: drives an agent that speaks the Agent Client Protocol (https://agentclientprotocol.com)
// on its standard input and output, such as `grok agent stdio`, and turns what it says into the same
// messages the Claude library gives (streamed text, tool calls and results, the end of each turn), so
// the app and the page need nothing new. Its permission questions go through canUseTool like Claude's.
//
// Options, built by the app: command and args (the agent program), env, cwd, mcpServers (in ACP's
// list shape), rules (Docket's instructions, sent ahead of the first message and not shown in the
// chat), permissionMode (Docket's names), allowTools (tools allowed without asking, in any mode), effort, resume (the
// agent's own id for an earlier conversation to pick up).
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import path from 'node:path';

// Messages for the runner; close(err) ends the stream, with the error if there was one.
export class Queue {
  constructor() { this.items = []; this.waiters = []; this.closed = false; this.error = null; }
  push(v) { if (this.closed) return; const w = this.waiters.shift(); if (w) w.resolve({ value: v, done: false }); else this.items.push(v); }
  close(err) {
    if (this.closed) return;
    this.closed = true; this.error = err || null;
    for (const w of this.waiters.splice(0)) err ? w.reject(err) : w.resolve({ value: undefined, done: true });
  }
  [Symbol.asyncIterator]() {
    return { next: () => this.items.length ? Promise.resolve({ value: this.items.shift(), done: false })
      : this.closed ? (this.error ? Promise.reject(this.error) : Promise.resolve({ value: undefined, done: true }))
      : new Promise((resolve, reject) => this.waiters.push({ resolve, reject })) };
  }
}

// The tool's own name when the agent gives one (Grok: _meta["x.ai/tool"].name), else its title.
const toolName = (tc) => tc._meta?.['x.ai/tool']?.name || tc.title || 'tool';
const resultText = (u) => (u.content || []).map((c) => c.content?.text ?? (c.type === 'diff' ? `Changed ${c.path}` : '')).filter(Boolean).join('\n')
  || u.rawOutput?.output_for_prompt || '';

export function start({ options, input, canUseTool, stderr }) {
  const out = new Queue();
  let mode = options.permissionMode || 'default';
  let sessionId = null, nextId = 0, curText = null, lastText = '', closed = false, loading = false;
  const waiting = new Map(); // our request id -> { resolve, reject }
  const asks = new Map();    // the agent's permission request id -> AbortController
  const tools = new Map();   // tool call id -> true once its result is in
  const servers = (options.mcpServers || []).map((s) => s.name);
  // A tool call as the app knows tools. Grok calls MCP tools through its use_tool tool, so the tool it
  // calls is shown instead; an MCP tool (server__tool) is named the Claude way, mcp__server__tool.
  function shown(tc) {
    let name = toolName(tc), input = tc.rawInput || {};
    if (name === 'use_tool' && input.tool_name) { name = input.tool_name; input = input.tool_input || {}; }
    if (servers.some((s) => name.startsWith(s + '__'))) name = 'mcp__' + name;
    return { name, input };
  }
  const emit = (m) => out.push({ parent_tool_use_id: null, session_id: sessionId, ...m });

  const proc = spawn(options.command, options.args || [], { cwd: options.cwd, env: options.env, windowsHide: true });
  proc.stderr.on('data', (d) => stderr?.(String(d)));
  // 'close', not 'exit': by then everything it wrote has been read. It only stops by itself when something went
  // wrong, whatever its exit code, so that is always an error: a turn must never end in silence.
  const agentName = path.parse(options.command).name;
  proc.on('error', (err) => finish(err));
  proc.on('close', (code) => finish(closed ? null : new Error(`${agentName} stopped ${sessionId ? 'before it answered' : 'while starting'} (exit code ${code})`)));
  let buf = '';
  proc.stdout.on('data', (d) => {
    buf += d;
    let n;
    while ((n = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, n).trim(); buf = buf.slice(n + 1);
      if (!line) continue;
      let m; try { m = JSON.parse(line); } catch { continue; }
      onMessage(m);
    }
  });
  const write = (m) => { if (!proc.stdin.destroyed) proc.stdin.write(JSON.stringify({ jsonrpc: '2.0', ...m }) + '\n'); };
  const request = (method, params) => new Promise((resolve, reject) => { const id = ++nextId; waiting.set(id, { resolve, reject }); write({ id, method, params }); });
  // Starting has to finish in a set time: an agent that never answers would otherwise look like one still thinking.
  const START_MS = 120000;
  const starting = (method, params) => Promise.race([request(method, params), new Promise((_, reject) =>
    setTimeout(() => reject(new Error(`${agentName} did not start: no answer to ${method} in ${START_MS / 1000} seconds`)), START_MS).unref())]);

  function finish(err) {
    if (out.closed) return;
    for (const w of waiting.values()) w.reject(err || new Error('The agent stopped'));
    waiting.clear();
    for (const a of asks.values()) a.abort();
    out.close(err);
  }

  function onMessage(m) {
    if (m.method && m.id != null) {
      if (m.method === 'session/request_permission') return askPermission(m);
      return write({ id: m.id, error: { code: -32601, message: `Docket does not offer ${m.method}` } });
    }
    if (m.method === 'session/update') return loading ? undefined : onUpdate(m.params?.update || {});
    if (m.id != null && waiting.has(m.id)) {
      const w = waiting.get(m.id); waiting.delete(m.id);
      if (m.error) w.reject(new Error(m.error.message || 'The agent refused the request')); else w.resolve(m.result || {});
    }
  }

  // Streamed text: one block per run of text, ended by a tool call or the end of the turn.
  function textPiece(text) {
    if (!curText) {
      curText = { id: randomUUID(), text: '' };
      emit({ type: 'stream_event', event: { type: 'message_start', message: { id: curText.id } } });
      emit({ type: 'stream_event', event: { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } } });
    }
    curText.text += text;
    emit({ type: 'stream_event', event: { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text } } });
  }
  function endText() {
    if (!curText) return;
    emit({ type: 'assistant', message: { id: curText.id, role: 'assistant', content: [{ type: 'text', text: curText.text }] } });
    lastText = curText.text; curText = null;
  }
  function showTool(u) {
    tools.set(u.toolCallId, false);
    const { name, input } = shown(u);
    emit({ type: 'assistant', message: { id: randomUUID(), role: 'assistant', content: [{ type: 'tool_use', id: u.toolCallId, name, input }] } });
  }
  function onUpdate(u) {
    switch (u.sessionUpdate) {
      case 'agent_message_chunk': if (u.content?.type === 'text' && u.content.text) textPiece(u.content.text); return;
      case 'tool_call': endText(); showTool(u); return;
      case 'tool_call_update':
        if (!tools.has(u.toolCallId)) { endText(); showTool(u); }
        if ((u.status === 'completed' || u.status === 'failed') && !tools.get(u.toolCallId)) {
          tools.set(u.toolCallId, true);
          emit({ type: 'user', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: u.toolCallId, content: resultText(u), is_error: u.status === 'failed' }] } });
        }
        return;
      default: return;
    }
  }

  // The agent asks before a tool runs. Docket's permission mode decides here, so changing it
  // mid-session works on any agent: Bypass allows everything, Accept edits allows file edits, and
  // everything else asks the person through canUseTool (the Allow / Deny card).
  function askPermission(m) {
    const tc = m.params?.toolCall || {}, choices = m.params?.options || [];
    const pick = (kind) => choices.find((o) => o.kind === kind);
    const answer = (opt) => write({ id: m.id, result: { outcome: opt ? { outcome: 'selected', optionId: opt.optionId } : { outcome: 'cancelled' } } });
    const always = pick('allow_always'), once = pick('allow_once') || always, no = pick('reject_once') || pick('reject_always');
    const { name, input } = shown(tc);
    if (mode === 'bypassPermissions' || (mode === 'acceptEdits' && tc.kind === 'edit') || options.allowTools?.includes(name)) return answer(once);
    const ac = new AbortController();
    asks.set(m.id, ac);
    ac.signal.addEventListener('abort', () => { if (asks.delete(m.id)) answer(null); });
    Promise.resolve(canUseTool(name, input, { title: tc.title || '', suggestions: always ? [{ acpOption: always.optionId }] : undefined, signal: ac.signal }))
      .then((r) => { if (asks.delete(m.id)) answer(r?.behavior === 'allow' ? (r.updatedPermissions && always) || once : no); })
      .catch(() => { if (asks.delete(m.id)) answer(null); });
  }

  // The person's message in ACP's shape. Images are left out (the app also names the saved file in the text).
  function toPrompt(item, rules) {
    const c = item?.message?.content;
    const blocks = (typeof c === 'string' ? [{ type: 'text', text: c }] : c || []).filter((b) => b.type === 'text' && b.text).map((b) => ({ type: 'text', text: b.text }));
    if (rules) blocks.unshift({ type: 'text', text: `(From Docket: your standing instructions for this session, ahead of the user's first message. Follow them throughout; do not reply to them.)\n\n${rules}` });
    return blocks;
  }

  // The conversation: the earlier one picked up again when asked and the agent can (session/resume, which Grok
  // offers, or else session/load, whose replay of the old conversation is not shown, since Docket keeps its own
  // copy of the chat), otherwise a new one. resumed says which.
  async function open(caps) {
    const how = !options.resume ? null : caps.sessionCapabilities?.resume ? 'session/resume' : caps.loadSession ? 'session/load' : null;
    if (how) {
      loading = how === 'session/load';
      try { return { s: await starting(how, { sessionId: options.resume, cwd: options.cwd, mcpServers: options.mcpServers || [] }), resumed: true }; }
      catch (e) { if (out.closed) throw e; stderr?.(`${how} failed: ${e.message}\n`); }
      finally { loading = false; }
    }
    return { s: await starting('session/new', { cwd: options.cwd, mcpServers: options.mcpServers || [] }), resumed: false };
  }

  (async () => {
    try {
      const init = await starting('initialize', { protocolVersion: 1, clientCapabilities: { fs: { readTextFile: false, writeTextFile: false }, terminal: false } });
      const { s, resumed } = await open(init.agentCapabilities || {});
      sessionId = s.sessionId || options.resume;
      if (options.effort) await request('session/set_config_option', { sessionId, configId: 'reasoning_effort', value: options.effort }).catch(() => {});
      emit({ type: 'system', subtype: 'init', cwd: options.cwd, model: s.models?.currentModelId || '', mcp_servers: [], ...(options.resume ? { resumed } : {}) });
      let rules = resumed ? '' : options.rules || ''; // a conversation picked up again had them at its start
      for await (const item of input) {
        const prompt = toPrompt(item, rules); rules = '';
        const t0 = Date.now(); lastText = '';
        let res = null, error = null;
        try { res = await request('session/prompt', { sessionId, prompt }); } catch (e) { error = e; }
        endText();
        if (closed || out.closed) break;
        emit(error ? { type: 'result', subtype: 'error_during_execution', is_error: true, result: error.message, duration_ms: Date.now() - t0 }
          : { type: 'result', subtype: 'success', is_error: false, result: lastText, stop_reason: res?.stopReason, duration_ms: Date.now() - t0 });
      }
    } catch (e) { finish(e); close(); return; }
    close();
  })();

  function close() { closed = true; try { proc.stdin.end(); } catch {} proc.kill(); }
  return {
    [Symbol.asyncIterator]: () => out[Symbol.asyncIterator](),
    interrupt: async () => { if (sessionId) write({ method: 'session/cancel', params: { sessionId } }); for (const a of asks.values()) a.abort(); },
    setPermissionMode: async (m) => { mode = m; },
    setModel: async (m) => { await request('session/set_config_option', { sessionId, configId: 'model', value: m }); },
    applyFlagSettings: async () => { throw new Error('Not available for this kind of session'); },
    mcpServerStatus: async () => [],
    close,
  };
}
