// Whether a session waits on the person: the rules the app saves and reads back after a restart, kept apart from the server so they can be tested.

// Saved as state.sessions[id].waiting, so a restart keeps the orange dot. Unread and asking, or unread and idle with no
// background jobs, or unread and stopped by an error (stoppedNote): the runner may still hold that session, and an
// app restart brings it back idle, which must not read as seen.
export const savedWaiting = ({ unread, status, heldTurn, lastError }) =>
  !!(unread && (status === 'requires_action' || (status === 'idle' && !heldTurn) || (status === 'ended' && lastError)));

// A session the runner still holds after an app restart: unread again when it has a question open, was waiting before
// the restart and is not working now, or may not have had its message.
export const unreadAfterRestart = ({ asks, wasWaiting, busy, unsent }) => !!(asks || (wasWaiting && !busy) || unsent);

// Reading a session keeps the reason its row showed (state.sessions[id].readWhy), so Mark unread brings the same tag
// back (#771). keptReason: what to keep from { why, said } when it is read. markUnreadReason: the reason Mark unread
// gives it, the kept one or, with none kept, mark-unread itself.
export const keptReason = (why, said) => why ? { why, said: said || '' } : undefined;
export const markUnreadReason = (kept) => kept?.why ? { why: kept.why, said: kept.said || '' } : { why: 'mark-unread', said: '' };

// ---------- sessions Claude Desktop ran ----------
// Docket saves `waiting` only for sessions its own runner ran. A session Claude Desktop ran is judged from its
// conversation file instead: where its last turn ended, and whether that came after the person last opened it in
// Docket. No time limit: an old reply never opened stays orange until it is opened.

// Questions and plan approvals: Claude stopped to ask the person, so the turn is over even though a tool is open.
const ASKS = new Set(['AskUserQuestion', 'ExitPlanMode']);

// The end of a conversation file, as parsed lines oldest first: { at, waiting, why } when its last turn was written
// by Claude Desktop, else null (Docket's own replies, the terminal, or no reply yet). waiting is true when that turn
// finished ('reply'), asked something ('question'), or stopped with an error ('error'); false while it is still
// working or after the person wrote something since.
export function desktopTurn(msgs) {
  for (let i = msgs.length - 1; i >= 0; i--) {
    const m = msgs[i];
    if (!m || (m.type !== 'user' && m.type !== 'assistant') || m.isSidechain || m.isMeta) continue;
    if (m.type === 'user') return null; // the person (or a tool result) came last: nothing waits on them here
    if (m.entrypoint !== 'claude-desktop') return null;
    const at = Date.parse(m.timestamp) || 0;
    const c = m.message?.content;
    const blocks = Array.isArray(c) ? c : [];
    if (m.isApiErrorMessage || m.error) return { at, waiting: true, why: 'error' };
    if (blocks.some((b) => b?.type === 'tool_use' && ASKS.has(b.name))) return { at, waiting: true, why: 'question' };
    if (blocks.some((b) => b?.type === 'tool_use')) return { at, waiting: false, why: 'working' };
    if (!blocks.some((b) => b?.type === 'text') && typeof c !== 'string' && !m.message?.stop_reason) return { at, waiting: false, why: 'working' };
    return { at, waiting: true, why: 'reply' };
  }
  return null;
}

// Whether a Desktop session shows orange: its turn waits on the person and came after they last opened it in
// Docket (seenAt, saved by the page's seen action).
export const desktopWaiting = ({ turn, seenAt }) => !!(turn?.waiting && turn.at > (seenAt || 0));
