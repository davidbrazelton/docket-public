// A stand-in ACP agent for test/acp-engine.test.mjs: on each prompt it streams two pieces of text,
// asks permission for one tool call (through Grok's use_tool, for an MCP tool), and reports the
// tool's result as done or failed depending on the answer. It echoes the prompt's first text back.
//
// Run by Docket (test/cross-brand.test.mjs, PORTAL_GROK_EXE), it is given Docket's portal tools and acts like a
// Grok session instead: a line "CALL <tool> <json args>" in a prompt makes it call that tool the way Grok does
// (use_tool, asking permission first, then the tool through Docket), and every reply is "got: " and the prompt's
// text (Docket's standing rules left out), so a test reads what reached the session.
//
// With FAKE_ACP_MEMORY (a folder) it remembers each conversation there, as Grok does in its home, so a later
// process can pick it up again: FAKE_ACP_RESUME says how it offers that ("resume" for session/resume, "load" for
// session/load, which replays the conversation first, as REPLAY lines; anything else: neither). Its echo is
// then of the person's own text (Docket's notes left out), after "[rules] " when Docket's standing rules came with
// it, and followed by " | remembers: " and what it was told before. Run by Docket, it then answers this way, not by "got: ".
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
if (process.argv[2] === '--version') { process.stdout.write('grok 1.0.70 (fake) [stable]\n'); process.exit(0); } // the setup wizard's check
// `grok models`, Docket's sign-in check: signed in only with FAKE_ACP_SIGNED_IN, so other tests see a desk not signed in.
if (process.argv[2] === 'models') { process.stdout.write(process.env.FAKE_ACP_SIGNED_IN ? 'You are logged in with grok.com.\n' : 'You are not authenticated.\n'); process.exit(0); }
const MEMORY = process.env.FAKE_ACP_MEMORY, HOW = process.env.FAKE_ACP_RESUME;
const memoryFile = (sid) => path.join(MEMORY, `${sid}.json`);
const recall = (sid) => { try { return JSON.parse(fs.readFileSync(memoryFile(sid), 'utf8')); } catch { return null; } };
let sid = 'S1';
let buf = '';
const send = (m) => process.stdout.write(JSON.stringify({ jsonrpc: '2.0', ...m }) + '\n');
const update = (u) => send({ method: 'session/update', params: { sessionId: 'S1', update: u } });
let pending = null;
let portal = null; // Docket's tool address, when Docket started this agent
process.stdin.on('data', (d) => {
  buf += d;
  let n;
  while ((n = buf.indexOf('\n')) >= 0) {
    const m = JSON.parse(buf.slice(0, n)); buf = buf.slice(n + 1);
    // FAKE_ACP_QUIT names the request it quits on, with exit code 0, as an agent that dies quietly would.
    if (process.env.FAKE_ACP_QUIT && m.method === process.env.FAKE_ACP_QUIT) process.exit(0);
    if (m.method === 'initialize') send({ id: m.id, result: { protocolVersion: 1,
      agentCapabilities: { ...(MEMORY ? { loadSession: HOW === 'load', sessionCapabilities: HOW === 'resume' ? { resume: {} } : {} } : {}),
        ...(process.env.FAKE_ACP_HTTP ? { mcpCapabilities: { http: true } } : {}) } } }); // FAKE_ACP_HTTP: it takes MCP servers over HTTP
    else if (m.method === 'session/new') {
      if (process.env.FAKE_ACP_SEEN) fs.writeFileSync(process.env.FAKE_ACP_SEEN, JSON.stringify(m.params.mcpServers || [])); // the servers it was given
      const env = Object.fromEntries((m.params.mcpServers || []).find((s) => s.name === 'portal')?.env?.map((e) => [e.name, e.value]) || []);
      if (env.DOCKET_URL) portal = { url: env.DOCKET_URL, session: env.DOCKET_SESSION, token: env.DOCKET_TOKEN };
      if (MEMORY) { sid = 'S-' + randomUUID(); fs.mkdirSync(MEMORY, { recursive: true }); fs.writeFileSync(memoryFile(sid), '[]'); }
      send({ id: m.id, result: { sessionId: sid, models: { currentModelId: 'fake-1' } } });
    } else if (m.method === 'session/resume' || m.method === 'session/load') {
      const told = MEMORY && recall(m.params.sessionId);
      if (!told) { send({ id: m.id, error: { code: -32002, message: 'No such session' } }); continue; }
      sid = m.params.sessionId;
      if (m.method === 'session/load') for (const t of told) update({ sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'REPLAY ' + t } });
      send({ id: m.id, result: { models: { currentModelId: 'fake-1' } } });
    } else if (m.method === 'session/prompt' && portal && !MEMORY) docketTurn(m);
    else if (m.method === 'session/prompt') {
      let first = m.params.prompt[0]?.text || '';
      if (MEMORY) {
        first = m.params.prompt.map((b) => b.text || '').find((t) => !t.startsWith('(From Docket')) || '';
        const told = recall(sid) || [];
        fs.writeFileSync(memoryFile(sid), JSON.stringify([...told, first]));
        const rules = m.params.prompt.some((b) => b.text?.startsWith('(From Docket: your standing')) ? '[rules] ' : '';
        first = rules + first + ' | remembers: ' + (told.join(', ') || 'nothing');
      }
      update({ sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'Hel' } });
      update({ sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'lo' } });
      const rawInput = { tool_name: 'portal__present_file', tool_input: { paths: ['a.txt'] } };
      const toolCall = { toolCallId: 'T1', title: 'use_tool', rawInput, _meta: { 'x.ai/tool': { name: 'use_tool' } } };
      update({ sessionUpdate: 'tool_call', ...toolCall });
      pending = { prompt: m.id, first };
      send({ id: 900, method: 'session/request_permission', params: { sessionId: 'S1', toolCall: { ...toolCall, kind: 'other' },
        options: [{ optionId: 'yes', kind: 'allow_once' }, { optionId: 'always', kind: 'allow_always' }, { optionId: 'no', kind: 'reject_once' }] } });
    } else if (m.id === 900) {
      const picked = m.result.outcome.optionId;
      update({ sessionUpdate: 'tool_call_update', toolCallId: 'T1', status: picked === 'no' ? 'failed' : 'completed', content: [{ type: 'content', content: { type: 'text', text: 'picked ' + picked } }] });
      update({ sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'echo: ' + (MEMORY ? pending.first : pending.first.slice(0, 40)) } });
      send({ id: pending.prompt, result: { stopReason: 'end_turn' } });
    } else if (m.id >= 1000 && answers.has(m.id)) { answers.get(m.id)(m.result?.outcome?.optionId); answers.delete(m.id); }
  }
});

const answers = new Map(); // our permission request id -> what to do with the option picked
let nextAsk = 1000;
const ask = (toolCall) => new Promise((resolve) => {
  const id = nextAsk++;
  answers.set(id, resolve);
  send({ id, method: 'session/request_permission', params: { sessionId: 'S1', toolCall: { ...toolCall, kind: 'other' },
    options: [{ optionId: 'yes', kind: 'allow_once' }, { optionId: 'no', kind: 'reject_once' }] } });
});

async function docketTurn(m) {
  const text = m.params.prompt.map((b) => b.text || '').filter((t) => !t.startsWith('(From Docket: your standing')).join('\n');
  let said = 'got: ' + text;
  const slow = text.match(/^SLOW (\d+)$/m); // a line "SLOW <ms>" keeps the turn working that long
  if (slow) await new Promise((r) => setTimeout(r, +slow[1]));
  const call = text.match(/^CALL (\S+) (.*)$/m);
  if (/^You are Docket's autopilot/m.test(text)) said = await pilotRun(text);
  else if (call) {
    const [, tool, json] = call;
    const toolCall = { toolCallId: 'C' + nextAsk, title: 'use_tool', rawInput: { tool_name: tool, tool_input: JSON.parse(json) }, _meta: { 'x.ai/tool': { name: 'use_tool' } } };
    update({ sessionUpdate: 'tool_call', ...toolCall });
    const picked = await ask(toolCall);
    let out = 'refused';
    if (picked === 'yes') {
      const r = await fetch(portal.url + '/api/tools/call', { method: 'POST', headers: { 'content-type': 'application/json', 'x-docket-token': portal.token },
        body: JSON.stringify({ session: portal.session, name: tool.replace(/^portal__/, ''), args: JSON.parse(json) }) });
      out = (await r.json()).content?.map((c) => c.text).join('\n') || '';
    }
    update({ sessionUpdate: 'tool_call_update', toolCallId: toolCall.toolCallId, status: picked === 'yes' ? 'completed' : 'failed', content: [{ type: 'content', content: { type: 'text', text: out } }] });
    said = `called ${tool}: ${out}`;
  }
  update({ sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: said + ' [end of reply]' } }); // never ends on a question
  send({ id: m.id, result: { stopReason: 'end_turn' } });
}
// A pilot run's brief (#881): as a stand-in pilot it lists what it may answer and answers each permission prompt
// allow and each question form with its first options, then ends its turn. A line "PILOT_SLOW <ms>" in its brief (from
// the pilot notes) keeps the run going that long after it answered, so a test can bring in more while it is going.
async function pilotRun(text) {
  const tool = async (name, args) => {
    const r = await fetch(portal.url + '/api/tools/call', { method: 'POST', headers: { 'content-type': 'application/json', 'x-docket-token': portal.token },
      body: JSON.stringify({ session: portal.session, name, args }) });
    return (await r.json()).content?.map((c) => c.text).join('\n') || '';
  };
  const listed = await tool('pilot_pending', {});
  let items = [];
  try { items = JSON.parse(listed.split('\n\n')[0]); } catch {}
  const done = [];
  for (const i of items) {
    if (i.kind === 'permission') done.push(await tool('pilot_answer', { id: i.id, answer: 'allow' }));
    else if (i.kind === 'question') done.push(await tool('pilot_answer', { id: i.id, answer: 'answer', answers: Object.fromEntries(i.questions.map((q) => [q.question, q.options[0]])) }));
  }
  const slow = text.match(/^PILOT_SLOW (\d+)$/m);
  if (slow) await new Promise((r) => setTimeout(r, +slow[1]));
  return `pilot run: ${done.length} answered. ${done.join(' ')}`;
}
