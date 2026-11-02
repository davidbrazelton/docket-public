// A stand-in for the codex program, for test/codex-engine.test.mjs and test/codex-docket.test.mjs.
//
// `fake-codex.mjs login status` exits 0 when <CODEX_HOME>/auth.json exists, else says "Not logged in" and exits 1.
// `fake-codex.mjs login --device-auth` prints a link and a code as Codex 0.163 does, then signs in (writes auth.json)
// after FAKE_CODEX_LOGIN_MS (default 300 ms).
//
// `fake-codex.mjs app-server` speaks the part of Codex's app-server protocol engines/codex.mjs uses. On each turn it
// streams "Hel", "lo", calls the MCP tool portal/present_file (asking first, as Codex does, by an elicitation), runs a
// command (asking first), and ends with "echo: " and the person's text: "[rules] " in front when Docket's
// developer instructions came with the conversation, and " | remembers: " and what it was told before after it.
// Conversations are kept in FAKE_CODEX_MEMORY (a folder), else in CODEX_HOME/fake-threads, so a later process can
// pick one up with thread/resume. Each thread also writes a usage log in CODEX_HOME/sessions as Codex does.
//
// Run by Docket (its portal tools come with the conversation's config), a message with a line "CALL <tool> <json
// args>" makes it ask, then call that Docket tool the way Codex does; the reply is then "called <tool>: <what the tool
// said>" instead of the echo. Docket's own notes in a message ("(From Docket: ...") are left out of the echo. Given
// Docket's ask_company tools instead (a "past" server), it asks, searches the past sessions for the person's text,
// and replies "searched: <what the tool said>".
//
// FAKE_CODEX_QUIT names a method it quits on, with exit code 0. FAKE_CODEX_FAIL makes every turn fail with that text.
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

const args = process.argv.slice(2);
const HOME = process.env.CODEX_HOME || path.join(process.cwd(), '.fake-codex');
if (args[0] === '--version') { process.stdout.write('codex-cli 0.163.0\n'); process.exit(0); } // the setup wizard's check
if (args[0] === 'login') {
  const auth = path.join(HOME, 'auth.json');
  if (args[1] === 'status') {
    if (fs.existsSync(auth)) { process.stderr.write('Logged in using ChatGPT\n'); process.exit(0); }
    process.stderr.write('Not logged in\n'); process.exit(1);
  }
  process.stdout.write('Welcome to Codex [v\x1b[90m0.163.0\x1b[0m]\n\nFollow these steps to sign in with ChatGPT using device code authorization:\n\n1. Open this link in your browser and sign in to your account\n   \x1b[94mhttps://auth.openai.com/codex/device\x1b[0m\n\n2. Enter this one-time code \x1b[90m(expires in 15 minutes)\x1b[0m\n   \x1b[94mAB12-CD3EF\x1b[0m\n');
  setTimeout(() => { fs.mkdirSync(HOME, { recursive: true }); fs.writeFileSync(auth, '{}'); process.exit(0); }, Number(process.env.FAKE_CODEX_LOGIN_MS || 300));
} else appServer();

function appServer() {
  const MEMORY = process.env.FAKE_CODEX_MEMORY || path.join(HOME, 'fake-threads');
  const memoryFile = (id) => path.join(MEMORY, `${id}.json`);
  const recall = (id) => { try { return JSON.parse(fs.readFileSync(memoryFile(id), 'utf8')); } catch { return null; } };
  let thread = null; // { id, rules, told, portal, log }
  let nextReq = 5000;
  const answers = new Map();
  const send = (m) => process.stdout.write(JSON.stringify(m) + '\n');
  const note = (method, params) => send({ method, params: { threadId: thread?.id, ...params } });
  const ask = (method, params) => new Promise((resolve) => { const id = nextReq++; answers.set(id, resolve); send({ id, method, params }); });
  const at = () => new Date().toISOString();
  const usageLine = (turnId) => JSON.stringify({ timestamp: at(), type: 'token_usage_record', payload: { response_id: randomUUID(), turn_id: turnId, usage: { input_tokens: 1000, cached_input_tokens: 0, cache_write_input_tokens: 0, output_tokens: 10, reasoning_output_tokens: 0 } } });

  function open(id, p, fresh) {
    const docket = (s) => s?.env?.DOCKET_URL ? { url: s.env.DOCKET_URL, session: s.env.DOCKET_SESSION, token: s.env.DOCKET_TOKEN } : null;
    thread = { id, rules: !!p.developerInstructions, told: fresh ? [] : recall(id).told, portal: docket(p.config?.mcp_servers?.portal), past: docket(p.config?.mcp_servers?.past) };
    fs.mkdirSync(MEMORY, { recursive: true });
    fs.writeFileSync(memoryFile(id), JSON.stringify({ told: thread.told }));
    const day = path.join(HOME, 'sessions', '2026', '10', '27');
    fs.mkdirSync(day, { recursive: true });
    thread.log = path.join(day, `rollout-2026-10-27T00-00-00-${id}.jsonl`);
    if (fresh) fs.writeFileSync(thread.log, JSON.stringify({ timestamp: at(), type: 'session_meta', payload: { id, session_id: id, cwd: p.cwd, timestamp: at() } }) + '\n');
    return { thread: { id }, model: 'fake-codex-1' };
  }

  async function turn(reqId, p) {
    const turnId = 'TURN-' + randomUUID();
    send({ id: reqId, result: { turn: { id: turnId, status: 'inProgress', items: [] } } });
    const text = (p.input || []).map((b) => b.text || '').filter((t) => !/^\((From Docket|Sent by)/.test(t)).join('\n');
    const done = (status, error) => {
      fs.appendFileSync(thread.log, JSON.stringify({ timestamp: at(), type: 'turn_context', payload: { turn_id: turnId, model: 'gpt-6-sol' } }) + '\n' + usageLine(turnId) + '\n');
      note('turn/completed', { turn: { id: turnId, status, items: [], error: error ? { message: error } : null } });
    };
    // Calls a Docket tool the way Codex does: asks first (an elicitation), then calls it through Docket.
    const callTool = async (where, server, tool, args) => {
      const item = { type: 'mcpToolCall', id: 'M' + nextReq, server, tool, status: 'inProgress', arguments: args };
      note('item/started', { turnId, item });
      const r = await ask('mcpServer/elicitation/request', { threadId: thread.id, turnId, serverName: server, mode: 'form', message: `Allow the ${server} MCP server to run tool "${tool}"?`,
        _meta: { codex_approval_kind: 'mcp_tool_call', tool_params: args }, requestedSchema: { type: 'object', properties: {} } });
      let out = 'refused';
      if (r.action === 'accept') {
        const res = await fetch(where.url + '/api/tools/call', { method: 'POST', headers: { 'content-type': 'application/json', 'x-docket-token': where.token },
          body: JSON.stringify({ session: where.session, name: tool, args }) });
        out = (await res.json()).content?.map((c) => c.text).join('\n') || '';
      }
      note('item/completed', { turnId, item: { ...item, status: r.action === 'accept' ? 'completed' : 'failed', result: { content: [{ type: 'text', text: out }] } } });
      return out;
    };
    const reply = (said) => { note('item/completed', { turnId, item: { type: 'agentMessage', id: 'A' + nextReq++, text: said } }); done('completed'); };
    if (process.env.FAKE_CODEX_FAIL) return done('failed', process.env.FAKE_CODEX_FAIL);
    const call = thread.portal && text.match(/^CALL (\S+) (.*)$/m);
    if (call) return reply(`called ${call[1]}: ${await callTool(thread.portal, 'portal', call[1], JSON.parse(call[2]))} [end of reply]`);
    if (thread.past) return reply(`searched: ${await callTool(thread.past, 'past', 'search_past_sessions', { words: text })}`);
    note('item/agentMessage/delta', { turnId, itemId: 'A1', delta: 'Hel' });
    note('item/agentMessage/delta', { turnId, itemId: 'A1', delta: 'lo' });
    note('item/completed', { turnId, item: { type: 'agentMessage', id: 'A1', text: 'Hello' } });
    const tool = { type: 'mcpToolCall', id: 'T1', server: 'portal', tool: 'present_file', status: 'inProgress', arguments: { paths: ['a.txt'] } };
    note('item/started', { turnId, item: tool });
    const r1 = await ask('mcpServer/elicitation/request', { threadId: thread.id, turnId, serverName: 'portal', mode: 'form', message: 'Allow the portal MCP server to run tool "present_file"?',
      _meta: { codex_approval_kind: 'mcp_tool_call', tool_params: { paths: ['a.txt'] } }, requestedSchema: { type: 'object', properties: {} } });
    note('item/completed', { turnId, item: { ...tool, status: r1.action === 'accept' ? 'completed' : 'failed', result: { content: [{ type: 'text', text: 'picked ' + r1.action + (r1._meta?.persist ? ' ' + r1._meta.persist : '') }] } } });
    const cmd = { type: 'commandExecution', id: 'X1', command: 'powershell.exe -Command "echo hi"', commandActions: [{ type: 'unknown', command: 'echo hi' }], status: 'inProgress' };
    note('item/started', { turnId, item: cmd });
    const r2 = await ask('item/commandExecution/requestApproval', { threadId: thread.id, turnId, itemId: 'X1', command: cmd.command, commandActions: cmd.commandActions });
    note('item/completed', { turnId, item: { ...cmd, status: r2.decision.startsWith('accept') ? 'completed' : 'declined', aggregatedOutput: r2.decision.startsWith('accept') ? 'hi' : null, exitCode: r2.decision.startsWith('accept') ? 0 : null } });
    const told = thread.told;
    thread.told = [...told, text];
    fs.writeFileSync(memoryFile(thread.id), JSON.stringify({ told: thread.told }));
    note('item/completed', { turnId, item: { type: 'agentMessage', id: 'A2', text: `echo: ${thread.rules ? '[rules] ' : ''}${text} | remembers: ${told.join(', ') || 'nothing'}` } });
    done('completed');
  }

  let buf = '';
  process.stdin.on('data', (d) => {
    buf += d;
    let n;
    while ((n = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, n).trim(); buf = buf.slice(n + 1);
      if (!line) continue;
      const m = JSON.parse(line);
      if (process.env.FAKE_CODEX_QUIT && m.method === process.env.FAKE_CODEX_QUIT) process.exit(0);
      if (m.id != null && !m.method && answers.has(m.id)) { answers.get(m.id)(m.result || {}); answers.delete(m.id); continue; }
      if (m.method === 'initialize') send({ id: m.id, result: { userAgent: 'fake', codexHome: HOME, platformFamily: 'windows', platformOs: 'windows' } });
      else if (m.method === 'thread/start') send({ id: m.id, result: open('TH-' + randomUUID(), m.params, true) });
      else if (m.method === 'thread/resume') {
        if (!recall(m.params.threadId)) send({ id: m.id, error: { code: -32600, message: `no rollout found for thread id ${m.params.threadId}` } });
        else send({ id: m.id, result: open(m.params.threadId, m.params, false) });
      } else if (m.method === 'turn/start') turn(m.id, m.params);
      else if (m.method === 'turn/interrupt') send({ id: m.id, result: {} });
      else if (m.id != null && m.method) send({ id: m.id, error: { code: -32601, message: 'not in the fake' } });
    }
  });
}
