// What counts as the person touching a session, read back from its saved conversation (#617): the ✦ Needs attention
// list keeps a session it was touched lately, and touches were only recorded from 1.123.0 on, so each desk's are
// filled in once from the transcripts. Pure, so test/touches.test.mjs runs it on its own.

// Who a message read back from a saved transcript came from, told by the lines Docket's sendToSession adds:
// 'session' (another session wrote it), 'docket' (only Docket's or Claude Code's own lines), or '' (the person typed it).
export const DOCKET_BLOCK = /^(\(From Docket:|\(From the session portal:|<session-report>|\(Sent by the session|<task-notification>)/;
export const SESSION_BLOCK = /^(\(Sent by the session|\(From Docket: This session was started by the session|\(From Docket: this session continues the work)/;
export function messageFrom(texts, images) {
  if (texts.some((t) => SESSION_BLOCK.test(t))) return 'session';
  return !images && texts.every((t) => !t.trim() || DOCKET_BLOCK.test(t)) ? 'docket' : '';
}
// Lines Claude Code writes as the user's that no one typed: its notes around a command's output, a stop pressed
// mid-turn, and the reminders it adds. A command typed in a terminal (<command-name>) does count. Work handed
// over from another desk was written there, not here.
const CLAUDE_LINE = /^(<local-command-|<system-reminder>|<user-prompt-submit-hook>|\[Request interrupted by user|Caveat: The messages below were generated)/;
const OTHER_DESK = /^\(From Docket: this work was handed over from the desk/;

// Whether one transcript entry is a message the person typed: a Claude transcript line, or a line of the chat Docket
// keeps for Grok and Codex (its msg). Tool results, side chains, Claude Code's own lines, compact summaries, and
// messages from other sessions or from Docket are not.
export function typedByUser(entry) {
  if (!entry || entry.type !== 'user' || entry.isMeta || entry.isSidechain || entry.isCompactSummary || entry.isVisibleInTranscriptOnly) return false;
  if (entry.parent_tool_use_id || entry.toolUseResult) return false;
  const c = entry.message?.content;
  const blocks = typeof c === 'string' ? [{ type: 'text', text: c }] : Array.isArray(c) ? c : [];
  if (blocks.some((b) => b.type === 'tool_result')) return false;
  const texts = blocks.filter((b) => b.type === 'text').map((b) => String(b.text || ''));
  const images = blocks.filter((b) => b.type === 'image').length;
  if (!texts.join('').trim() && !images) return false;
  if (CLAUDE_LINE.test(texts.join('\n').trim()) || texts.some((t) => OTHER_DESK.test(t))) return false;
  return messageFrom(texts, images) === '';
}

// The time of the last message the person typed in one saved conversation (UTC ms), or 0. lines: the file's text
// split in lines, each a Claude transcript entry ({ timestamp }) or a kept chat line ({ at, msg }).
// A scheduled run's first message is the schedule's prompt, not typed, so `scheduled` skips it.
export function lastTyped(lines, { scheduled = false } = {}) {
  let last = 0, skip = scheduled;
  for (const line of lines) {
    if (!line.includes('"user"')) continue;
    let o; try { o = JSON.parse(line); } catch { continue; }
    const entry = o.msg || o;
    if (!typedByUser(entry)) continue;
    if (skip) { skip = false; continue; }
    const at = o.msg ? o.at : Date.parse(o.timestamp);
    if (at > last) last = at;
  }
  return last;
}

// Touch times found in the transcripts merged into the ones recorded: the later of the two for each session, and
// none older than `days`. Returns a new map; `found` is session id -> time.
export function mergeTouches(recorded, found, now, days) {
  const out = { ...(recorded || {}) };
  for (const [id, at] of Object.entries(found || {})) if (at && !(out[id] >= at)) out[id] = at;
  for (const [id, at] of Object.entries(out)) if (!(now - at <= days * 864e5)) delete out[id];
  return out;
}
