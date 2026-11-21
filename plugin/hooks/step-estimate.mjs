// PreToolUse hook: before a command the session has run before in this repo, Docket tells it how long that usually
// takes (#847), so it picks sensible timeouts and waits. A Docket hook: a company turns it off with "step-estimate"
// in docketHooks.off.
//
// The hook only asks the app (DOCKET_URL, with this session's DOCKET_SESSION and DOCKET_HOOK_TOKEN); the app keeps the
// step history (step-times.mjs) and answers with a note only for steps that usually take over 15 seconds. Any failure
// (the app restarting, no answer in time) says nothing, so this hook never stops work.

import { pathToFileURL } from 'node:url';
import { isOff } from './off.mjs';

export const NAME = 'step-estimate';
const WAIT_MS = 3000;

// The answer Claude Code reads, for the app's reply: null says nothing.
export function hookOutput(reply) {
  if (!reply?.note) return null;
  return { hookSpecificOutput: { hookEventName: 'PreToolUse', additionalContext: reply.note } };
}

async function main() {
  if (isOff(NAME) || !process.env.DOCKET_URL || !process.env.DOCKET_SESSION) return;
  let raw = '';
  for await (const chunk of process.stdin) raw += chunk;
  let input;
  try { input = JSON.parse(raw); } catch { return; }
  const command = input.tool_input?.command;
  if (!command) return;
  try {
    const r = await fetch(`${process.env.DOCKET_URL}/api/hooks/step-estimate`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-docket-token': process.env.DOCKET_HOOK_TOKEN || '' },
      body: JSON.stringify({ session: process.env.DOCKET_SESSION, command, cwd: input.cwd || '' }),
      signal: AbortSignal.timeout(WAIT_MS),
    });
    const out = r.ok ? hookOutput(await r.json()) : null;
    if (out) process.stdout.write(JSON.stringify(out));
  } catch {}
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) await main();
