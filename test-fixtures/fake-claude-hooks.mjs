#!/usr/bin/env node
// A stand-in for the Claude Code program the Claude library runs, for the tests (#1207): it speaks the library's
// stream-json and answers with what Claude Code sends when hooks act, as seen from the real one:
//   at start                a SessionStart hook that failed (exit code 1)
//   a message with BLOCKME  a UserPromptSubmit hook blocked it: the informational message, then a result with no turns
//   a message with DENYTOOL a PreToolUse hook denied a Bash call: the call, its error result, then a reply
//   a message with NOBYPASS a UserPromptSubmit hook that forbids Bypass permissions blocked it, only while the session
//                           is in that mode (as a company hook reading the hook input's permission_mode does, #1209)
//   a message with AUTODENY the Auto mode check turned down a Bash call (#1235): the call, its error result, a reply,
//                           and the denial listed on the turn's result
//   a message with SHOWARGS the --settings and --allowedTools it was started with, as JSON (#1262)
//   anything else           "got: <text>"
import readline from 'node:readline';
import { randomUUID } from 'node:crypto';

const args = process.argv.slice(2);
const at = args.indexOf('--session-id');
const sid = at >= 0 ? args[at + 1] : randomUUID();
// The mode the session started in (the library passes --permission-mode=<mode>); set_permission_mode changes it.
let mode = args.map((a, i) => a.startsWith('--permission-mode=') ? a.slice(18) : a === '--permission-mode' ? args[i + 1] : '').find(Boolean) || 'default';
const out = (m) => process.stdout.write(JSON.stringify({ session_id: sid, uuid: randomUUID(), ...m }) + '\n');
const hook = (event, name, extra) => {
  const hook_id = randomUUID();
  out({ type: 'system', subtype: 'hook_started', hook_id, hook_name: name, hook_event: event });
  out({ type: 'system', subtype: 'hook_response', hook_id, hook_name: name, hook_event: event, output: extra.stderr || extra.stdout || '', stdout: '', stderr: '', ...extra });
};
const result = (turns) => out({ type: 'result', subtype: 'success', is_error: false, duration_ms: 5, duration_api_ms: 0, num_turns: turns, result: '', stop_reason: null, total_cost_usd: 0, usage: { input_tokens: 0, output_tokens: 0 }, modelUsage: {}, permission_denials: [] });
const say = (text) => out({ type: 'assistant', parent_tool_use_id: null, message: { id: 'msg_' + randomUUID(), type: 'message', role: 'assistant', model: 'claude-test', content: [{ type: 'text', text }], stop_reason: null, usage: { input_tokens: 1, output_tokens: 1 } } });

let started = false;
readline.createInterface({ input: process.stdin }).on('line', (line) => {
  let m; try { m = JSON.parse(line); } catch { return; }
  if (m.type === 'control_request' && m.request?.subtype === 'set_permission_mode') mode = m.request.mode;
  if (m.type === 'control_request') { process.stdout.write(JSON.stringify({ type: 'control_response', response: { subtype: 'success', request_id: m.request_id, response: {} } }) + '\n'); return; }
  if (m.type !== 'user') return;
  if (!started) {
    started = true;
    hook('SessionStart', 'SessionStart:startup', { stderr: 'SessionStart check failed: proxy not reachable', exit_code: 1, outcome: 'error' });
    out({ type: 'system', subtype: 'init', cwd: process.cwd(), model: 'claude-test', tools: [], mcp_servers: [], slash_commands: [], skills: [] });
  }
  const c = m.message?.content;
  const text = typeof c === 'string' ? c : (c || []).filter((b) => b.type === 'text').map((b) => b.text).join('\n');
  if (text.includes('BLOCKME') || (text.includes('NOBYPASS') && mode === 'bypassPermissions')) {
    const reason = text.includes('BLOCKME') ? 'Prompts naming project BLOCKME are not allowed by policy XYZ-12' : 'Bypass permissions mode is not allowed by policy XYZ-7';
    hook('UserPromptSubmit', 'UserPromptSubmit', { stderr: reason, exit_code: 2, outcome: 'error' });
    out({ type: 'system', subtype: 'informational', level: 'warning', prevent_continuation: true,
      content: `UserPromptSubmit operation blocked by hook:\n[node "C:/company/hooks/guard.js"]: ${reason}\n\nOriginal prompt: ${text}`,
      prompt_submit_outcome: { kind: 'blocked_by_hook', prompt_kept: false, reason } });
    result(0);
    return;
  }
  if (text.includes('DENYTOOL')) {
    const id = 'toolu_' + randomUUID().replace(/-/g, '');
    out({ type: 'assistant', parent_tool_use_id: null, message: { id: 'msg_' + randomUUID(), type: 'message', role: 'assistant', model: 'claude-test', content: [{ type: 'tool_use', id, name: 'Bash', input: { command: 'echo hello' } }], stop_reason: null, usage: { input_tokens: 1, output_tokens: 1 } } });
    hook('PreToolUse', 'PreToolUse:Bash', { stdout: '{"hookSpecificOutput":{"permissionDecision":"deny"}}', exit_code: 0, outcome: 'success' });
    out({ type: 'user', parent_tool_use_id: null, message: { role: 'user', content: [{ type: 'tool_result', content: 'PreToolUse:Bash hook error: Bash is off by company policy', is_error: true, tool_use_id: id }] },
      tool_use_result: 'Error: PreToolUse:Bash hook error: Bash is off by company policy',
      tool_result_meta: [{ id, non_execution_kind: 'permission-rule', permission_decision: { decision: 'reject', source: 'hook', reason_type: 'hook' } }] });
    say('The command did not run: a hook turned it down.');
    result(1);
    return;
  }
  if (text.includes('AUTODENY')) {
    const id = 'toolu_' + randomUUID().replace(/-/g, '');
    out({ type: 'assistant', parent_tool_use_id: null, message: { id: 'msg_' + randomUUID(), type: 'message', role: 'assistant', model: 'claude-test', content: [{ type: 'tool_use', id, name: 'Bash', input: { command: 'kill 4410' } }], stop_reason: null, usage: { input_tokens: 1, output_tokens: 1 } } });
    const said = "Permission for this action was denied by the Claude Code auto mode classifier. Reason: [Interfere With Workloads]. If you have other tasks that don't depend on this action, continue working on those.";
    out({ type: 'system', subtype: 'permission_denied', tool_name: 'Bash', tool_use_id: id, decision_reason_type: 'classifier', decision_reason: 'Interfere With Workloads', message: said });
    out({ type: 'user', parent_tool_use_id: null, message: { role: 'user', content: [{ type: 'tool_result', content: said, is_error: true, tool_use_id: id }] },
      tool_use_result: 'Error: ' + said,
      tool_result_meta: [{ id, non_execution_kind: 'permission-rule', permission_decision: { decision: 'reject', source: 'session', reason_type: 'classifier' } }] });
    say('Auto mode turned that down, so I left the process running.');
    out({ type: 'result', subtype: 'success', is_error: false, duration_ms: 5, duration_api_ms: 0, num_turns: 1, result: '', stop_reason: null, total_cost_usd: 0, usage: { input_tokens: 0, output_tokens: 0 }, modelUsage: {}, permission_denials: [{ tool_name: 'Bash', tool_use_id: id, tool_input: { command: 'kill 4410' } }] });
    return;
  }
  if (text.includes('SHOWARGS')) {
    const arg = (name) => args.map((a, i) => a.startsWith(name + '=') ? a.slice(name.length + 1) : a === name ? args[i + 1] : '').find(Boolean) || null;
    say('args: ' + JSON.stringify({ settings: arg('--settings'), allowedTools: arg('--allowedTools') }));
    result(1);
    return;
  }
  say(`got: ${text}`);
  result(1);
});
