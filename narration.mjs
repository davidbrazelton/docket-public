// Reply text that Claude Code saves as a thinking block (#842): text written before a tool call can come back as a
// 'thinking' block holding a shortened copy, told apart from real thinking only by its signature, whose base64 header
// names the kind ('narration' against 'thinking'). Pure, so test/narration.test.mjs runs it on its own.
export function isNarration(b) {
  if (b?.type !== 'thinking' || typeof b.signature !== 'string') return false;
  try { return Buffer.from(b.signature.slice(0, 64), 'base64').toString('latin1').includes('narration'); } catch { return false; }
}
export function narrationText(b) {
  return isNarration(b) && b.thinking?.trim() ? b.thinking.trim() : '';
}

// A turn whose answer was saved only as a shortened or empty narration block (#863): it has a narration that is empty or
// longer than the final reply (the text after its last tool call), and that reply is short (under 200 characters, or one
// question or "waiting on you" line). Only a narration after the turn's last working tool counts (#1159): one written
// before mark_turn and the other closing tools can hold the answer, while one before a Bash or Monitor call is a
// progress line, and a short closing reply such as "Waiting for the runs." after it is complete.
// blocks: the content blocks of the turn's assistant messages, in order. No model call.
export const THIN_SHORT = 200;
const CLOSING = /^(ToolSearch|mcp__portal__(mark_turn|report_quiet|present_file|rename_session|suggest_title))$/;
export function thinTurn(blocks) {
  let work = -1, last = -1;
  blocks.forEach((b, i) => { if (b.type === 'tool_use') { last = i; if (!CLOSING.test(b.name)) work = i; } });
  const nars = blocks.slice(work + 1).filter(isNarration).map((b) => (b.thinking || '').trim());
  if (!nars.length) return false;
  const reply = blocks.slice(last + 1).filter((b) => b.type === 'text').map((b) => b.text || '').join('\n').trim();
  const oneAsk = !reply.includes('\n') && (/\?$/.test(reply) || /\bwaiting (on|for) (you|your)\b/i.test(reply));
  if (reply.length >= THIN_SHORT && !oneAsk) return false;
  return nars.some((n) => !n || n.length > reply.length);
}

// Added to the next message after a flagged turn, so the session writes its answer again where the user can read it.
export const THIN_NOTE = '(From Docket: part of your last reply was not saved: Claude Code kept only a shortened or empty copy of it, so the user saw just its last line. Write that answer again in full in your reply to this message, before anything else.)';
