// Carrying on a session whose turn failed because its desk's sign-in ran out (#719): the rules, kept apart from the
// server so they can be tested. Modelled on cut-off.mjs. Once the desk is signed in again, each such session gets one
// automatic try per sign-in, one at a time; anything that makes it unclear what the person wants leaves it to them.

export const RECENT_MS = 12 * 3600_000; // older failures wait for the person
export const MAX_TEXT = 20_000; // a longer last message is not kept in the saved state; the session is told to continue instead

// What the failed turn was: { text } is the message that started it, to send again when the turn stopped before doing
// anything; { midTurn: true } when it had already replied or used a tool, or was not started by a message (a report,
// a continue), so it is told to carry on rather than given the message twice. events: the chat up to the failure.
export function failedTurn(events) {
  const all = events || [];
  let start = all.length;
  while (start > 0 && all[start - 1].k !== 'result') start--;
  const turn = all.slice(start);
  const i = turn.findIndex((e) => e.k === 'user');
  const text = i < 0 ? '' : String(turn[i].text || '').trim();
  const did = i >= 0 && turn.slice(i + 1).some((e) => e.k === 'tool' || e.k === 'text');
  if (!text || did || text.length > MAX_TEXT) return { midTurn: true, text: '' };
  return { midTurn: false, text };
}

// The saved mark (state.sessions[id].signinFail). tried: the turn that failed was Docket's own automatic try after a
// sign-in, so it waits for the person's next sign-in rather than looping.
export const newSigninFail = ({ events, tried = false, now = Date.now() }) => ({ at: now, ...failedTurn(events), ...(tried ? { tried: true } : {}) });

// Whether a Claude transcript (the text of its .jsonl, or its end) holds a message sent after at: from another app
// (Claude desktop, the CLI) or anything else. Only a user entry with something other than tool results counts: Claude
// writes its own bookkeeping lines when its process ends (resting), so the file's time says nothing.
export function messagedSince(jsonl, at) {
  for (const line of String(jsonl || '').split(/\r?\n/)) {
    if (!line.includes('"user"')) continue;
    let e; try { e = JSON.parse(line); } catch { continue; }
    if (e.type !== 'user' || e.isMeta || !(Date.parse(e.timestamp) > at)) continue;
    const c = e.message?.content;
    if (typeof c === 'string' ? c.trim() : Array.isArray(c) && c.some((b) => b?.type !== 'tool_result')) return true;
  }
  return false;
}

// Whether Docket carries the session on by itself, and if not, why (for the log). how: 'user' when the person signed
// in (the Sign in flow, its check), 'seen' when Docket noticed it (the periodic recheck, another turn on that desk
// getting through). messaged: its transcript holds a message sent since the failure (messagedSince). working: it is
// already in a turn.
export function signinResumeCheck({ on, rec, how = 'seen', messaged = false, now = Date.now(), paused = false, archived = false, working = false }) {
  const f = rec?.signinFail;
  if (!f) return { go: false, why: 'it did not fail on its sign-in' };
  if (!on) return { go: false, why: 'the desk\'s "Resume sessions after signing in again" is off' };
  if (archived) return { go: false, why: 'it is archived' };
  if (paused) return { go: false, why: 'Docket is paused' };
  if (now - (f.at || 0) > RECENT_MS) return { go: false, why: 'the failure was more than 12 hours ago' };
  if (working) return { go: false, why: 'it is already working again' };
  if (messaged) return { go: false, why: 'it was sent something after the failure (another app may have it)' };
  if (f.tried && how !== 'user') return { go: false, why: 'it already had its one automatic try and failed on the sign-in again, so it waits for the next sign-in' };
  return { go: true };
}
// Guards whose answer does not change with a later sign-in: the mark is dropped. Others (paused, already tried) keep it.
export const dropsMark = (why) => !/paused|waits for the next sign-in/.test(why || '');

export const SIGNIN_NOTE = 'The sign-in ran out during this turn; Docket continued it once you signed in again';
export function signinNote(f) {
  const when = new Date(f.at).toLocaleString();
  return f.midTurn
    ? `(From Docket: this session's turn stopped at about ${when} because its desk's sign-in ran out (the API refused its credentials). The user has signed in again, so Docket has continued it by itself. The last step may or may not have finished: check what state things are in before redoing anything, then carry on with the work.)`
    : `(From Docket: this message first reached the session at about ${when}, when its desk's sign-in had run out, so the turn failed before it started. The user has signed in again, and Docket has sent it again by itself.)`;
}
