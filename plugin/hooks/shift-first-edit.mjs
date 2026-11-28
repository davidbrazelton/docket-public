// PreToolUse hook: Docket raises a Shift session to its top gear before the first file edit or git commit.
// A Docket hook: a company turns it off with "shift-first-edit" in docketHooks.off.
//
// The hook only asks the app (DOCKET_URL, with this session's DOCKET_SESSION and DOCKET_HOOK_TOKEN, which Docket
// puts in the session's environment); the app decides (shift-up.mjs) and changes the model. When it did, this call
// was chosen on the lower gear, so it is turned down with a reason that says to make it again: the next step runs
// on the top gear, and that step makes the edit or commit. Any failure (the app restarting, no answer in time)
// lets the call run, so this hook never stops work.
//
// Grok runs this hook too (grok-home.mjs); its input carries Grok's own tool names as well as Claude's.

import { pathToFileURL } from 'node:url';
import { isOff } from './off.mjs';
import { workKind } from '../../shift-up.mjs';

export const NAME = 'shift-first-edit';
const WAIT_MS = 8000;

// The answer Claude Code and Grok read, for the app's reply: null lets the call run.
export function hookOutput(reply) {
  if (!reply?.deny) return null;
  return { hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: reply.deny } };
}

async function main() {
  if (isOff(NAME) || !process.env.DOCKET_URL || !process.env.DOCKET_SESSION) return;
  let raw = '';
  for await (const chunk of process.stdin) raw += chunk;
  let input;
  try { input = JSON.parse(raw); } catch { return; }
  const tool = input.tool_name, args = input.tool_input || {};
  if (!workKind(tool, args)) return; // nothing that needs the top gear: no need to ask
  try {
    const r = await fetch(`${process.env.DOCKET_URL}/api/hooks/shift-up`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-docket-token': process.env.DOCKET_HOOK_TOKEN || '' },
      body: JSON.stringify({ session: process.env.DOCKET_SESSION, tool, input: args, toolUseId: input.tool_use_id || '', subagent: !!input.agent_id }),
      signal: AbortSignal.timeout(WAIT_MS),
    });
    const out = r.ok ? hookOutput(await r.json()) : null;
    if (out) process.stdout.write(JSON.stringify(out));
  } catch {}
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) await main();
