// Keeping a waiting parent's prompt cache warm (#734). A parent woken after its 1-hour prompt cache ran out
// re-reads its whole conversation at the write price: about $0.62 on the first call at a typical 89k-token
// context, against $0.03 warm. While it waits on a child still working, Docket sends it a tiny turn a few minutes
// before the cache would end: it reads the cache (2-3 cents) and starts the hour again. The turn is hidden from the
// chat, marks nobody, and is not a report, so it counts toward nothing. It pays off when it saves one cold wake per
// 20 or so pings, so it stops after maxHours in one wait, and only big contexts (minTokens) are worth it.

// One place to change them. afterMin: minutes after the last reply when the ping goes; windowMin: how long after
// that it may still go (past the hour the cache is gone, and a ping would only write it again).
export const KEEP_WARM = { afterMin: 52, windowMin: 6, minTokens: 50000, maxHours: 6, checkSec: 60 };

// The words that mark the ping, in the message and so in the saved transcript, where the chat leaves it out.
export const PING_MARK = '[keep-warm]';
export const PING_TEXT = `(From Docket: ${PING_MARK} keeping your prompt cache warm while sessions you started work. Reply with only the word ok, and call no tools.)`;

// Whether to ping a session now. working: its child sessions still working. warmSince: when this wait's first
// ping went (null before one). Returns { ping, warmSince }: warmSince is dropped once no child works, so the next
// wait gets its own maxHours.
export function keepWarmDue({ engine = 'claude', status, resting = false, paused = false, busy = false, cacheTtl, tokens = 0, lastReplyAt = 0, working = 0, warmSince = null, now = Date.now(), cfg = KEEP_WARM } = {}) {
  if (!working) return { ping: false, warmSince: null };
  const no = { ping: false, warmSince };
  if ((engine || 'claude') !== 'claude' || status !== 'idle' || resting || paused || busy) return no;
  if (cacheTtl !== 3600 || tokens < cfg.minTokens || !lastReplyAt) return no;
  const age = now - lastReplyAt;
  if (age < cfg.afterMin * 60000 || age > (cfg.afterMin + cfg.windowMin) * 60000) return no;
  if (warmSince && now - warmSince > cfg.maxHours * 3600000) return no;
  return { ping: true, warmSince: warmSince || now };
}

// Whether a saved user message is a keep-warm ping (its text blocks hold the mark).
export function isPing(msg) {
  if (msg?.type !== 'user') return false;
  const c = msg.message?.content;
  const texts = typeof c === 'string' ? [c] : Array.isArray(c) ? c.filter((b) => b.type === 'text').map((b) => b.text || '') : [];
  return texts.some((t) => t.includes(PING_MARK));
}
