// The Codex engine: drives OpenAI's `codex app-server` (JSON-RPC on its standard input and output, one
// message per line) and turns what it says into the same messages the Claude library gives, as engines/acp.mjs does
// for ACP agents. Codex's ACP wrapper (@zed-industries/codex-acp 0.16.0) was tried first: it runs on Windows, but
// it carries its own, older copy of Codex, and OpenAI refuses it ("requires a newer version of Codex"; every older
// model "is not supported when using Codex with a ChatGPT account"), checked 2026-10-27. app-server runs the Codex
// that is installed, so it keeps up with the desktop app's updates.
//
// Options, built by the app: command and args (the codex program and `app-server` with its -c settings), env, cwd,
// rules (Docket's instructions, Codex's "developer instructions", so nothing is sent as a hidden message),
// config (Codex settings for the conversation, such as mcp_servers), permissionMode (Docket's names), allowTools
// (tools allowed without asking, in any mode), denyOthers (every tool not on allowTools is refused without asking),
// sandbox, model, effort, resume (Codex's own id for an earlier conversation to pick up).
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { Queue } from './acp.mjs';

// How a Codex item shows as a tool call: its name and input as the page knows tools.
export function shownItem(item) {
  switch (item?.type) {
    case 'commandExecution': {
      const acts = item.commandActions || [];
      return { name: 'Shell', input: { command: acts.length === 1 && acts[0].command ? acts[0].command : item.command || '' } };
    }
    case 'fileChange': {
      const files = (item.changes || []).map((c) => c.path);
      return { name: 'Edit', input: { file_path: files.join(', '), ...(files.length > 1 ? { files } : {}) } };
    }
    case 'mcpToolCall': return { name: `mcp__${item.server}__${item.tool}`, input: item.arguments || {} };
    case 'dynamicToolCall': return { name: item.tool, input: item.arguments || {} };
    case 'webSearch': return { name: 'WebSearch', input: { query: item.query || item.action?.query || '' } };
    default: return null;
  }
}
// What a finished tool item gave back, and whether it failed.
export function itemResult(item) {
  switch (item.type) {
    case 'commandExecution': return { text: item.aggregatedOutput || (item.exitCode != null ? `Exit code ${item.exitCode}` : ''), error: item.status === 'failed' || item.status === 'declined' || (item.exitCode != null && item.exitCode !== 0) };
    case 'fileChange': return { text: (item.changes || []).map((c) => `${c.kind?.type || 'Changed'} ${c.path}`).join('\n'), error: item.status !== 'completed' };
    case 'mcpToolCall': return { text: item.error?.message || (item.result?.content || []).map((c) => c.text ?? `[${c.type}]`).join('\n'), error: item.status === 'failed' || !!item.error };
    case 'dynamicToolCall': return { text: (item.contentItems || []).map((c) => c.text ?? '').join('\n'), error: item.success === false };
    default: return { text: '', error: false };
  }
}

export function start({ options, input, canUseTool, stderr }) {
  const out = new Queue();
  let mode = options.permissionMode || 'default';
  let model = options.model || '';
  let threadId = null, turnId = null, nextId = 0, curText = null, lastText = '', closed = false;
  let turnDone = null; // resolves with the finished turn
  const waiting = new Map(); // our request id -> { resolve, reject }
  const asks = new Map();    // Codex's request id -> AbortController
  const items = new Map();   // tool item id -> { shown, done }
  const emit = (m) => out.push({ parent_tool_use_id: null, session_id: threadId, ...m });

  const proc = spawn(options.command, options.args || [], { cwd: options.cwd, env: options.env, windowsHide: true });
  proc.stderr.on('data', (d) => stderr?.(String(d)));
  // As in acp.mjs: any stop Docket did not ask for is an error, so a turn never ends in silence.
  proc.on('error', (err) => finish(err));
  proc.on('close', (code) => finish(closed ? null : new Error(`codex stopped ${threadId ? 'before it answered' : 'while starting'} (exit code ${code})`)));
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
  const write = (m) => { if (!proc.stdin.destroyed) proc.stdin.write(JSON.stringify(m) + '\n'); };
  const request = (method, params) => new Promise((resolve, reject) => { const id = ++nextId; waiting.set(id, { resolve, reject }); write({ id, method, params }); });
  const START_MS = 120000;
  const starting = (method, params) => Promise.race([request(method, params), new Promise((_, reject) =>
    setTimeout(() => reject(new Error(`codex did not start: no answer to ${method} in ${START_MS / 1000} seconds`)), START_MS).unref())]);

  function finish(err) {
    if (out.closed) return;
    for (const w of waiting.values()) w.reject(err || new Error('Codex stopped'));
    waiting.clear();
    for (const a of asks.values()) a.abort();
    turnDone?.(null);
    out.close(err);
  }

  function onMessage(m) {
    if (m.method && m.id != null) return onRequest(m);
    if (m.method) return onNotice(m.method, m.params || {});
    if (m.id != null && waiting.has(m.id)) {
      const w = waiting.get(m.id); waiting.delete(m.id);
      if (m.error) w.reject(new Error(m.error.message || 'Codex refused the request')); else w.resolve(m.result || {});
    }
  }

  // Streamed text: one block per Codex message; a new message or a tool call ends the one before.
  function textPiece(itemId, text) {
    if (curText && curText.item !== itemId) endText();
    if (!curText) {
      curText = { id: randomUUID(), item: itemId, text: '' };
      emit({ type: 'stream_event', event: { type: 'message_start', message: { id: curText.id } } });
      emit({ type: 'stream_event', event: { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } } });
    }
    curText.text += text;
    emit({ type: 'stream_event', event: { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text } } });
  }
  function endText() {
    if (!curText) return;
    if (curText.text) emit({ type: 'assistant', message: { id: curText.id, role: 'assistant', content: [{ type: 'text', text: curText.text }] } });
    lastText = curText.text || lastText; curText = null;
  }
  function showItem(item) {
    if (items.has(item.id)) return items.get(item.id);
    const shown = shownItem(item);
    if (!shown) return null;
    endText();
    const rec = { shown, done: false };
    items.set(item.id, rec);
    emit({ type: 'assistant', message: { id: randomUUID(), role: 'assistant', content: [{ type: 'tool_use', id: item.id, name: shown.name, input: shown.input }] } });
    return rec;
  }

  function onNotice(method, p) {
    if (p.threadId && threadId && p.threadId !== threadId) return; // a sub-agent's thread: not shown
    switch (method) {
      case 'item/agentMessage/delta': if (p.delta) textPiece(p.itemId, p.delta); return;
      case 'item/started': showItem(p.item); return;
      case 'item/completed': {
        const item = p.item || {};
        if (item.type === 'agentMessage') {
          // A message whose pieces did not all come (or none did) is shown whole.
          if (curText?.item === item.id) { if (item.text && item.text !== curText.text) curText.text = item.text; endText(); }
          else if (item.text) { endText(); curText = { id: randomUUID(), item: item.id, text: item.text }; endText(); }
          return;
        }
        const rec = showItem(item);
        if (!rec || rec.done) return;
        rec.done = true;
        const r = itemResult(item);
        emit({ type: 'user', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: item.id, content: r.text, is_error: r.error }] } });
        return;
      }
      case 'turn/completed': if (p.turn?.id === turnId || !turnId) turnDone?.(p.turn || {}); return;
      default: return;
    }
  }

  // Codex asks before a command, a file change or a tool from an MCP server. Docket's permission mode decides here,
  // as in acp.mjs, so changing it mid-session works: Bypass allows everything, Accept edits allows file changes, and
  // the rest asks the person through canUseTool (the Allow / Deny card).
  function onRequest(m) {
    const p = m.params || {};
    let kind = null, shown = null;
    if (m.method === 'item/commandExecution/requestApproval') {
      kind = 'command';
      shown = items.get(p.itemId)?.shown || shownItem({ type: 'commandExecution', command: p.command, commandActions: p.commandActions });
    } else if (m.method === 'item/fileChange/requestApproval') {
      kind = 'edit';
      shown = items.get(p.itemId)?.shown || { name: 'Edit', input: { file_path: p.grantRoot || '' } };
    } else if (m.method === 'mcpServer/elicitation/request' && p._meta?.codex_approval_kind === 'mcp_tool_call') {
      kind = 'mcp';
      const tool = String(p.message || '').match(/run tool "([^"]+)"/)?.[1] || p._meta?.tool_name || 'tool';
      shown = { name: `mcp__${p.serverName}__${tool}`, input: p._meta?.tool_params || {} };
    }
    if (!kind) return write({ id: m.id, error: { code: -32601, message: `Docket does not offer ${m.method}` } });
    const answer = (allow, always) => write({ id: m.id, result: kind === 'mcp'
      ? { action: allow ? 'accept' : 'decline', content: allow ? {} : null, _meta: allow && always ? { persist: 'session' } : null }
      : { decision: allow ? (always ? 'acceptForSession' : 'accept') : 'decline' } });
    const allowed = options.allowTools?.includes(shown.name);
    if (options.denyOthers && !allowed) return answer(false);
    if (mode === 'bypassPermissions' || (mode === 'acceptEdits' && kind === 'edit') || allowed) return answer(true);
    const ac = new AbortController();
    asks.set(m.id, ac);
    ac.signal.addEventListener('abort', () => { if (asks.delete(m.id)) write({ id: m.id, result: kind === 'mcp' ? { action: 'cancel', content: null, _meta: null } : { decision: 'cancel' } }); });
    Promise.resolve(canUseTool(shown.name, shown.input, { title: p.reason || '', suggestions: [{ codex: 'session' }], signal: ac.signal }))
      .then((r) => { if (asks.delete(m.id)) answer(r?.behavior === 'allow', !!r?.updatedPermissions); })
      .catch(() => { if (asks.delete(m.id)) answer(false); });
  }

  // The person's message in Codex's shape. Images are left out (the app also names the saved file in the text).
  function toInput(item) {
    const c = item?.message?.content;
    return (typeof c === 'string' ? [{ type: 'text', text: c }] : c || []).filter((b) => b.type === 'text' && b.text).map((b) => ({ type: 'text', text: b.text, text_elements: [] }));
  }

  (async () => {
    try {
      await starting('initialize', { clientInfo: { name: 'docket', title: 'Docket', version: '1' }, capabilities: { experimentalApi: false, requestAttestation: false } });
      write({ method: 'initialized' });
      // Docket answers every question itself, so Codex asks before anything it does not trust (approvalPolicy
      // "untrusted") and the sandbox is Docket's, not Codex's: full access unless the app asks for less.
      const params = { cwd: options.cwd, approvalPolicy: 'untrusted', sandbox: options.sandbox || 'danger-full-access',
        ...(options.rules ? { developerInstructions: options.rules } : {}), ...(model ? { model } : {}), ...(options.config ? { config: options.config } : {}) };
      // The earlier conversation picked up again when asked; one Codex no longer has starts a new one. resumed says which.
      let t = null, resumed = false;
      if (options.resume) {
        try { t = await starting('thread/resume', { threadId: options.resume, ...params, excludeTurns: true }); resumed = true; }
        catch (e) { if (out.closed) throw e; stderr?.(`thread/resume failed: ${e.message}\n`); }
      }
      t ||= await starting('thread/start', params);
      threadId = t.thread?.id;
      emit({ type: 'system', subtype: 'init', cwd: options.cwd, model: t.model || '', mcp_servers: [], ...(options.resume ? { resumed } : {}) });
      for await (const item of input) {
        const t0 = Date.now(); lastText = '';
        const done = new Promise((r) => { turnDone = r; });
        let turn = null, error = null;
        try {
          const r = await request('turn/start', { threadId, input: toInput(item), ...(model ? { model } : {}), ...(options.effort ? { effort: options.effort } : {}) });
          turnId = r.turn?.id || null;
          turn = await done;
        } catch (e) { error = e; }
        turnId = null; turnDone = null;
        endText();
        if (closed || out.closed) break;
        if (!error && turn?.status === 'failed') error = new Error(turn.error?.message || 'Codex could not finish this turn');
        emit(error ? { type: 'result', subtype: 'error_during_execution', is_error: true, result: error.message, duration_ms: Date.now() - t0 }
          : { type: 'result', subtype: 'success', is_error: false, result: lastText, stop_reason: turn?.status, duration_ms: Date.now() - t0 });
      }
    } catch (e) { finish(e); close(); return; }
    close();
  })();

  function close() { closed = true; try { proc.stdin.end(); } catch {} proc.kill(); }
  return {
    [Symbol.asyncIterator]: () => out[Symbol.asyncIterator](),
    interrupt: async () => { if (threadId && turnId) await request('turn/interrupt', { threadId, turnId }).catch(() => {}); for (const a of asks.values()) a.abort(); },
    setPermissionMode: async (m) => { mode = m; },
    setModel: async (m) => { model = m; }, // used from the next message on
    applyFlagSettings: async () => { throw new Error('Not available for this kind of session'); },
    mcpServerStatus: async () => [],
    close,
  };
}
