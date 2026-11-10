// What counts as the person touching a session, read back from its saved conversation (#617): the ✦ Needs attention
// list keeps a session it was touched lately, and touches were only recorded from 1.123.0 on, so each desk's are
// filled in once from the transcripts. Pure, so test/touches.test.mjs runs it on its own.

// Who a message read back from a saved transcript came from, told by the lines Docket's sendToSession adds:
// 'session' (another session wrote it), 'brief' (a brief Docket wrote or brought in: work handed over from another
// desk, a scheduled task's prompt, a session one of Docket's own cards started (#867)), 'docket' (only Docket's or
// Claude Code's own lines), or '' (the person typed it).
export const DOCKET_BLOCK = /^(\(From Docket:|\(From the session portal:|<session-report>|\(Sent by the session|<task-notification>)/;
export const SESSION_BLOCK = /^(\(Sent by the session|\(From Docket: This session was started by the session|\(From Docket: this session continues the work)/;
export const SCHEDULED_RUN = /^\(From Docket: this session runs the scheduled task/;
export const BRIEF_BLOCK = /^\(From Docket: (this work was handed over from the desk|this session runs the scheduled task|the user chose to convert this desk's plans|the user started this session from Docket's setup check card)/;
export function messageFrom(texts, images) {
  if (texts.some((t) => SESSION_BLOCK.test(t))) return 'session';
  if (texts.some((t) => BRIEF_BLOCK.test(t))) return 'brief';
  return !images && texts.every((t) => !t.trim() || DOCKET_BLOCK.test(t)) ? 'docket' : '';
}
// Lines Claude Code writes as the user's that no one typed: its notes around a command's output, a stop pressed
// mid-turn, and the reminders it adds. A command typed in a terminal (<command-name>) does count.
const CLAUDE_LINE = /^(<local-command-|<system-reminder>|<user-prompt-submit-hook>|\[Request interrupted by user|Caveat: The messages below were generated)/;

// Whether one transcript entry is a message the person typed: a Claude transcript line, or a line of the chat Docket
// keeps for Grok and Codex (its msg). Tool results, side chains, Claude Code's own lines, compact summaries, and
// messages from other sessions or from Docket (work from another desk among them) are not.
export function typedByUser(entry) {
  const m = userMessage(entry);
  return !!m && !CLAUDE_LINE.test(m.texts.join('\n').trim()) && messageFrom(m.texts, m.images) === '';
}
// A transcript entry's texts and image count when it is a message someone sent (not a tool result, side chain,
// compact summary or empty line), or null.
function userMessage(entry) {
  if (!entry || entry.type !== 'user' || entry.isMeta || entry.isSidechain || entry.isCompactSummary || entry.isVisibleInTranscriptOnly) return null;
  if (entry.parent_tool_use_id || entry.toolUseResult) return null;
  const c = entry.message?.content;
  const blocks = typeof c === 'string' ? [{ type: 'text', text: c }] : Array.isArray(c) ? c : [];
  if (blocks.some((b) => b.type === 'tool_result')) return null;
  const texts = blocks.filter((b) => b.type === 'text').map((b) => String(b.text || ''));
  const images = blocks.filter((b) => b.type === 'image').length;
  return texts.join('').trim() || images ? { texts, images } : null;
}

// The time of the last message the person typed in one saved conversation (UTC ms), or 0. lines: the file's text
// split in lines, each a Claude transcript entry ({ timestamp }) or a kept chat line ({ at, msg }).
// A scheduled run's first message is the schedule's prompt, not typed, so `scheduled` skips it: one sent with
// Docket's note (SCHEDULED_RUN, #867) is not typed anyway, one from before it looks typed.
export function lastTyped(lines, { scheduled = false } = {}) {
  let last = 0, skip = scheduled;
  for (const line of lines) {
    if (!line.includes('"user"')) continue;
    let o; try { o = JSON.parse(line); } catch { continue; }
    const entry = o.msg || o;
    const typed = typedByUser(entry);
    if (skip && (typed || userMessage(entry)?.texts.some((t) => SCHEDULED_RUN.test(t)))) { skip = false; continue; }
    if (!typed) continue;
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
