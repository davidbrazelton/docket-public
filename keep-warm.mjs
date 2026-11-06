// Keeping a waiting parent's prompt cache warm (#734). A parent woken after its 1-hour prompt cache ran out
// re-reads its whole conversation at the write price: about $0.62 on the first call at a typical 89k-token
// context, against $0.03 warm. While it waits on a child still working, Docket sends it a tiny turn a few minutes
// before the cache would end: it reads the cache (2-3 cents) and starts the hour again. The turn is hidden from the
// chat, marks nobody, and is not a report, so it counts toward nothing. It pays off when it saves one cold wake per
// 20 or so pings, so it stops after maxHours in one wait, and only big contexts (minTokens) are worth it.
// An idle session with no child working is kept warm too (#747), but only while its last real reply (not a ping) is
// under idleHours old. In Oct-Nov 2026, of 860 idle stretches at 50k+ on the 1-hour cache, 133 were resumed between
// 52 minutes and 1.9 hours, and one ping at 52 minutes caught them all: $67 of rewrites saved for $20 of pings. A
// second ping (cache to 2.8 hours) caught 19 more for $17 more pings, about even, and every later one lost money. So
// idleHours 1 sends that one ping, which keeps the cache until about 1 hour 52 minutes after the last reply.

// One place to change them. afterMin: minutes after the last reply when the ping goes; windowMin: how long after
// that it may still go (past the hour the cache is gone, and a ping would only write it again).
export const KEEP_WARM = { afterMin: 52, windowMin: 6, minTokens: 50000, maxHours: 6, idleHours: 1, checkSec: 60 };

// The words that mark the ping, in the message and so in the saved transcript, where the chat leaves it out.
export const PING_MARK = '[keep-warm]';
export const PING_TEXT = `(From Docket: ${PING_MARK} keeping your prompt cache warm. Reply with only the word ok, and call no tools.)`;

// Whether to ping a session now. lastReplyAt: its last reply, a ping's included (when the cache was last used);
// realReplyAt: its last reply that was not a ping. working: its child sessions still working. warmSince: when this
// wait's first ping went (null before one). Returns { ping, warmSince }: warmSince is kept only while a child works,
// so the next wait gets its own maxHours.
export function keepWarmDue({ engine = 'claude', status, resting = false, paused = false, busy = false, cacheTtl, tokens = 0, lastReplyAt = 0, realReplyAt = lastReplyAt, working = 0, warmSince = null, now = Date.now(), cfg = KEEP_WARM } = {}) {
  const no = { ping: false, warmSince: working ? warmSince : null };
  if ((engine || 'claude') !== 'claude' || status !== 'idle' || resting || paused || busy) return no;
  if (cacheTtl !== 3600 || tokens < cfg.minTokens || !lastReplyAt) return no;
  const age = now - lastReplyAt;
  if (age < cfg.afterMin * 60000 || age > (cfg.afterMin + cfg.windowMin) * 60000) return no;
  if (!working) return { ping: !!cfg.idleHours && now - (realReplyAt || lastReplyAt) <= cfg.idleHours * 3600000, warmSince: null };
  if (warmSince && now - warmSince > cfg.maxHours * 3600000) return no;
  return { ping: true, warmSince: warmSince || now };
}

// A session's last real reply when Docket did not see it (the app restarted since): the file's last reply, unless
// that was the ping sent at pingAt, whose own last real reply was afterMin before it.
export const realReplyFrom = ({ lastReplyAt = 0, pingAt = 0, cfg = KEEP_WARM }) => (pingAt && lastReplyAt >= pingAt ? pingAt - cfg.afterMin * 60000 : lastReplyAt);

// Whether a saved user message is a keep-warm ping (its text blocks hold the mark).
export function isPing(msg) {
  if (msg?.type !== 'user') return false;
  const c = msg.message?.content;
  const texts = typeof c === 'string' ? [c] : Array.isArray(c) ? c.filter((b) => b.type === 'text').map((b) => b.text || '') : [];
  return texts.some((t) => t.includes(PING_MARK));
}
