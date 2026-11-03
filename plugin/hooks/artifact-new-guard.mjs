// PreToolUse hook for Claude Code's Artifact tool (turned on in Docket's sessions by CLAUDE_CODE_ARTIFACT=1).
// A Docket hook: a company turns it off with "artifact-new-guard" in docketHooks.off.
//
// A session may update an artifact that already exists (a publish with its url), as a monthly report does, but
// a new artifact page is made only when the person picks a file and uses Publish as artifact on Docket's Files
// list. So a publish without a url, and quickstart (which makes a new artifact), are turned down. Listing,
// reading, opening, pinning and deleting are left alone. Docket's own publish run does not load this plugin.

import { pathToFileURL } from 'node:url';
import { isOff } from './off.mjs';

export const NAME = 'artifact-new-guard';

// What the hook answers for one Artifact call: null to let it run, else Claude's hookSpecificOutput.
export function check(input) {
  const inp = input || {};
  const action = String(inp.action || 'publish');
  const makesNew = action === 'quickstart' || (action === 'publish' && !String(inp.url || '').trim());
  if (!makesNew) return null;
  return {
    hookEventName: 'PreToolUse',
    permissionDecision: 'deny',
    permissionDecisionReason:
      'In Docket a new artifact page is made only by the person: they pick the file in Docket\'s Files list and use ' +
      '"Publish as artifact" on it. Updating an artifact that already exists (publish with its url) is allowed. ' +
      'So write the page to a file, tell the person it is ready to publish from the Files list, and do not try ' +
      'another way to publish or host it.',
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (isOff(NAME)) process.exit(0);
  let raw = '';
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', (c) => (raw += c));
  process.stdin.on('end', () => {
    let input;
    try { input = JSON.parse(raw); } catch { process.exit(0); }
    if (input.tool_name !== 'Artifact') process.exit(0);
    const out = check(input.tool_input);
    if (out) process.stdout.write(JSON.stringify({ hookSpecificOutput: out }));
  });
}
