// What a child session's finished turn means for the session that started it. A child that
// ended its turn asking the user something is waiting on the user, not reporting a result, so its
// parent gets a quiet note instead of being woken (a woken parent repeats or answers the question).

// Lines at the end of a reply that come after the question and say nothing about it: the
// "Terms used" footer, a horizontal rule, a closing code fence.
const TRAILER = /^((>\s*)?\*?_?terms used:.*|[-*_]{3,}|```)$/i;
const LIST = /^\s*([-*+]|\d+[.)])\s+/;

// True when the reply's last paragraph asks a question. A last paragraph that is a list (the
// options under a numbered question) counts together with the paragraph or item above it, so
// "1. **Which one?**" followed by its option bullets still reads as a question.
export function endsAsking(text) {
  const paras = String(text || '').replace(/\r/g, '').split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);
  while (paras.length && paras.at(-1).split('\n').every((l) => TRAILER.test(l.trim()))) paras.pop();
  const tail = [];
  for (let i = paras.length - 1; i >= 0 && tail.length < 6; i--) {
    tail.unshift(paras[i]);
    if (!paras[i].split('\n').every((l) => LIST.test(l) || /^\s+\S/.test(l))) break; // reached plain prose
  }
  return tail.join('\n').split('\n').some((l) => /\?\s*$/.test(l.trim().replace(/[*_`)"'”’\]]+$/, '')));
}

// The words that open a list of what happens next ("Next steps:", "**What is left**", "## Still to do").
const NEXT_LEAD = /\b(next steps?|what happens (now|next)|what('s| is) (left|next)|still (to do|open|left)|left (to do|for you)|waiting on you|your (turn|move))\b/i;
// An item that speaks to the user: "Say merge and I will merge…", "Tell me which…", "Answer…".
const ASKS_USER = /^\s*(?:[-*+]|\d+[.)])\s+[*_]*(say|tell me|answer|reply|choose|pick|decide|approve|confirm)\b/i;

// True when the reply's last paragraph is a list of next steps: a numbered or bulleted list
// opened by a "Next steps" line (in the same paragraph or the one above it), or one with an item
// that asks the user to say or choose something. A list of what was done ("Done:\n- Fixed it") is not.
export function endsWithNextSteps(text) {
  const paras = String(text || '').replace(/\r/g, '').split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);
  while (paras.length && paras.at(-1).split('\n').every((l) => TRAILER.test(l.trim()))) paras.pop();
  const isItem = (l) => LIST.test(l) || /^\s+\S/.test(l);
  // The list may run over several paragraphs (items spaced apart); gather it back to where it starts.
  let i = paras.length - 1;
  const items = [];
  while (i >= 0 && paras[i].split('\n').every(isItem)) { items.unshift(...paras[i].split('\n')); i--; }
  let lead = i >= 0 ? paras[i].split('\n').at(-1) : '';
  if (!items.length && i >= 0) { // "Next steps:" then the list, with no blank line between
    const lines = paras[i].split('\n'), first = lines.findIndex(isItem);
    if (first < 1 || !lines.slice(first).every(isItem)) return false;
    items.push(...lines.slice(first)); lead = lines[first - 1];
  }
  if (!items.length) return false;
  return NEXT_LEAD.test(lead) || items.some((l) => ASKS_USER.test(l));
}

// A reply that leaves the user something to do: it ends by asking, or ends with a next-steps list.
export const endsWaiting = (text) => endsAsking(text) || endsWithNextSteps(text);

// Whether a child that just finished a turn is waiting on the user: a question form or permission
// ask still open, or a reply that ends by asking the user something. A next-steps list does not
// count here: a child that ends its report with one still wakes its parent, which checks the result.
export function waitingOnUser(child, reply) {
  return !!(child.pendingAsks?.size || endsAsking(reply));
}

// Whether a session's latest reply is still waiting on the user's answer. `msgs` are its
// messages, oldest first (Claude transcript lines or kept-chat messages): true when the last reply
// is waiting (endsWaiting) and nothing was sent to the session after it. Tool results and
// Claude Code's own command and reminder lines are not messages.
export function awaitingAnswer(msgs) {
  for (let i = msgs.length - 1; i >= 0; i--) {
    const m = msgs[i];
    if (!m || m.isSidechain || m.parent_tool_use_id) continue;
    const c = m.message?.content;
    const blocks = typeof c === 'string' ? [{ type: 'text', text: c }] : Array.isArray(c) ? c : [];
    if (m.type === 'user') {
      const said = blocks.filter((b) => b.type === 'text' || b.type === 'image').map((b) => b.text || '[image]').join('\n').trim();
      if (said && !/^<(command-|local-command|system-reminder)/.test(said)) return false;
    } else if (m.type === 'assistant') {
      const t = blocks.filter((b) => b.type === 'text' && b.text).at(-1);
      if (t) return endsWaiting(t.text);
    }
  }
  return false;
}

// Why a parent may not close and archive a session with close_session, or '' when it may.
// `rec` is the session's saved record, `live` its running session (if any), `reply` its latest reply.
// Only the session that started it may, never while it works, and never while it waits on the user:
// an open ask, a question, or a next-steps list, since those are left for the user to act on.
export function closeRefusal({ callerId, rec, live, reply, busy }) {
  if (!rec || rec.reportsTo !== callerId) return 'it is not a session you started (only your own child sessions can be closed this way)';
  if (rec.archived) return 'it is already archived';
  if (busy) return 'it is still working; wait for its report';
  if (live?.pendingAsks?.size || endsWaiting(reply)) return 'its last reply is waiting on the user; leave it for them';
  return '';
}

// Who hears about a session's finished turn. `reportsTo` is the session that started it (or
// that set_parent put it under); `replyTo` is the session that last sent it work with send_to_session
// when that was not its parent. The sender gets the report (woken for it, or a quiet note when the
// turn ends waiting on the user); the parent only gets a note that the work it did not send
// is done. replyTo is used up by a finished turn, and kept while the turn waits on the user, so the
// sender still hears when the work is finished.
export function reportRoute({ reportsTo, replyTo, waiting }) {
  const sent = !!replyTo && replyTo !== reportsTo;
  const to = sent ? replyTo : reportsTo || null;
  return { to, waiting: !!waiting, sent, noteTo: sent && !waiting ? reportsTo || null : null, clearReplyTo: !!replyTo && !waiting };
}
