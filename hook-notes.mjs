// What Claude Code's hooks did that the person should see in a session's chat (#1207). The hooks come from the
// Claude settings the session loads, often a company's managed settings; Docket only shows what they did.
// The Claude library reports them as (seen with Claude Code's SDK 0.3.x):
// - a prompt a UserPromptSubmit hook blocked: a system "informational" message whose prompt_submit_outcome.kind is
//   blocked_by_hook, then a result with no error and no turns. Claude never got the message.
// - a tool call a PreToolUse hook denied: the tool's result, an error that reads "PreToolUse:Bash hook error: <reason>"
//   (its tool_result_meta says source hook).
// - any hook that exits 2 or fails: a hook_response with outcome error (only with includeHookEvents, which Docket sets;
//   SessionStart's always come).

const clip = (t, n = 1000) => { t = String(t || '').trim(); return t.length > n ? t.slice(0, n) + '…' : t; };

// A prompt a hook blocked: { event, reason, text } for the chat's error, or null. text's first line is what the row's
// problem tip shows.
export function promptBlock(m) {
  if (m?.type !== 'system' || m.subtype !== 'informational') return null;
  const outcome = m.prompt_submit_outcome, content = String(m.content || '');
  const said = content.match(/^(\w+) operation blocked by hook:?\s*([\s\S]*?)(?:\n\nOriginal prompt:[\s\S]*)?$/);
  if (outcome?.kind !== 'blocked_by_hook' && !said) return null;
  const event = said?.[1] || 'UserPromptSubmit';
  // The content names the hook's command first ("[node guard.js]: reason"); the outcome has the reason alone.
  const reason = clip(outcome?.reason || (said?.[2] || '').replace(/^\[[^\n]*?\]:\s*/, '')) || 'no reason given';
  return { event, reason, text: `A ${event} hook blocked this message: ${reason}\n\nThe hook is in the Claude Code settings this session loads (on a work computer, often set by your company), so Claude did not get the message. Change the message, or ask whoever set the hook.` };
}

// A tool call something refused before it ran (#1207 for hooks, #1235 for the rest): { source, reason, tag } from the
// call's result, or null when nothing refused it. tag is the line its step and the chat show. source is one of
//   hook       a PreToolUse hook denied it ("PreToolUse:Bash hook error: <reason>")
//   auto       the Auto mode check turned it down ("... denied by the Claude Code auto mode classifier. Reason: [..]")
//   rule       a deny rule in the settings ("Permission to use Bash with command rm x has been denied.")
//   dontAsk    the session is in Don't ask mode, which turns down whatever would ask
//   prompt     it needed a permission prompt that could not be shown ("... but you haven't granted it yet.")
//   person     the person turned down the prompt
//   autopilot  Docket's autopilot turned down the prompt
//   sandbox    the sandbox refused it (only when the result's meta says so: its error text is a command's own)
//   other      refused in some other way the meta or the text says
// The texts are Claude Code's own (seen in its 2.x program); meta is the user message's tool_result_meta entry for
// this call, which only a live message has: its permission_decision.reason_type (or source) names the source when
// present, and the text patterns do otherwise.
const META_SOURCE = { hook: 'hook', classifier: 'auto', rule: 'rule', mode: 'dontAsk', sandboxOverride: 'sandbox', permissionPromptTool: 'prompt' };
const TAGS = {
  hook: (r) => `Stopped by a hook: ${r}`,
  auto: (r) => `Turned down by Auto mode: ${r}`,
  rule: (r) => `Blocked by a settings rule: ${r}`,
  dontAsk: () => "Turned down: the session is in Don't ask mode",
  prompt: (r) => `Needed a permission that could not be asked for: ${r}`,
  person: () => 'Declined by you',
  autopilot: () => 'Declined by the autopilot',
  sandbox: (r) => `Blocked by the sandbox: ${r}`,
  other: (r) => `Refused: ${r}`,
};
function refusalText(text) {
  const t = String(text || '').replace(/^<tool_use_error>([\s\S]*?)<\/tool_use_error>$/, '$1').replace(/^Error: /, '').trim();
  let m;
  if ((m = t.match(/^(\w+)(?::\S+)? hook error:\s*([\s\S]*)$/))) return { source: 'hook', reason: m[2] };
  if ((m = t.match(/denied by the Claude Code auto mode classifier\. Reason: \[?([^\]\n]*?)\]?(?:\.\s|\.?$)/))) return { source: 'auto', reason: m[1] };
  if (/has been denied because Claude Code is running in don't ask mode/.test(t)) return { source: 'dontAsk', reason: "Don't ask mode" };
  if ((m = t.match(/^Permission to (use|edit|read|write to) ([\s\S]+?) has been denied(?: by your rule ([^\n]+?)(?:\.\s|\.?$)|[.:\s—-]|$)/))) return { source: 'rule', reason: m[3] || (m[1] === 'use' ? m[2] : `${m[1]} ${m[2]}`) };
  if ((m = t.match(/^Claude requested permissions to ([\s\S]+?), but you haven't granted it yet/))) return { source: 'prompt', reason: m[1].replace(/^use /, '') };
  if (/^The user doesn't want to (proceed with|take) this|^The user declined this\./.test(t)) return { source: 'person', reason: 'declined' };
  if (/^Docket's autopilot declined this/.test(t)) return { source: 'autopilot', reason: 'declined' };
  if ((m = t.match(/^Permission for this action (?:was|has been) denied\.(?: Reason: ([^\n]+?)(?:\.\s|\.?$))?/))) return { source: 'other', reason: m[1] || 'no reason given' };
  return null;
}
export function refusal(text, error, meta) {
  const pd = meta?.permission_decision;
  const metaSaid = pd?.decision && !/^(allow|accept|approve)/.test(pd.decision) ?(META_SOURCE[pd.reason_type] || META_SOURCE[pd.source] || 'other') : null;
  if (!error && !metaSaid) return null;
  const said = refusalText(text);
  if (!said && !metaSaid) return null;
  const source = metaSaid && metaSaid !== 'other' ? metaSaid : said?.source || metaSaid;
  const reason = clip(said?.reason || pd?.reason || String(text || '').split('\n')[0], source === 'hook' ? 600 : 200) || 'no reason given';
  return { source, reason, tag: TAGS[source](reason.split('\n')[0].slice(0, 160)) };
}
// Whether a refusal gets its own line in the chat: not one the person or the autopilot answered, whose card already
// says so.
export const refusalNoted = (r) => !!r && r.source !== 'person' && r.source !== 'autopilot';

// Whether a hook's block likely came from the session running in Bypass permissions, for the nudge to switch it to
// Auto (#1209). Company settings often forbid that mode, and their hooks then block every prompt made in it. Only a
// Claude session in bypass; a blocked prompt is enough, a denied tool call only when the hook's reason names the mode
// (a hook that turns down one command is about the command).
export function bypassBlocked({ engine = 'claude', mode, prompt = false, reason = '' }) {
  if (engine !== 'claude' || mode !== 'bypassPermissions') return false;
  return prompt || /bypass|permission[ _-]?mode|skip[ _-]?permissions/i.test(reason);
}

// A hook_response worth a line in the chat: { text } or null. A blocked prompt and a denied tool call are left out:
// promptBlock and refusal show those.
export function hookResponseNote(m) {
  if (m?.type !== 'system' || m.subtype !== 'hook_response' || m.outcome !== 'error') return null;
  const event = m.hook_event || String(m.hook_name || '').split(':')[0] || 'A';
  const name = m.hook_name || event;
  const said = clip(m.stderr || m.output || m.stdout);
  if (m.exit_code === 2) {
    if (event === 'UserPromptSubmit' || event === 'PreToolUse') return null;
    if (event === 'Stop' || event === 'SubagentStop') return { text: `A ${name} hook kept Claude working instead of ending the turn${said ? ': ' + said : ''}` };
    return { text: `A ${name} hook objected${said ? ': ' + said : ''}` };
  }
  return { text: `A ${name} hook failed${m.exit_code != null ? ` (exit code ${m.exit_code})` : ''}${said ? ': ' + said : ''}` };
}
