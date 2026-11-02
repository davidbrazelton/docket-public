// The offer to switch a Claude company to the 1-hour prompt cache.
// Claude's prompt cache is its short-term memory of a session: it ends 5 minutes (or 1 hour) after each reply,
// and the next reply after that re-reads the whole conversation at full price. Docket reads each company's
// recent replies to see which length its sessions run on, and how often a reply came after a pause that
// 5 minutes forgot but 1 hour would have kept.
import fs from 'node:fs';

// When to ask again after Not now: these cache misses reach this share of replies over the last
// `days` days, with at least `minReplies` replies. One place to change them.
export const CACHE_OFFER = { missShare: 0.2, minReplies: 20, days: 7, laterDays: 30 };
const FIVE_MIN = 5 * 60000, HOUR = 60 * 60000;

// One session file's main replies, oldest first: { at, ttl } (ttl 3600 or 300 when the reply wrote the cache, else
// null). Read in steps: only what was added since the last look, so a long session is not read again each time.
const files = new Map(); // file -> { offset, replies, lastId }
export function fileReplies(file) {
  let size; try { size = fs.statSync(file).size; } catch { files.delete(file); return []; }
  let hit = files.get(file);
  if (!hit || size < hit.offset) hit = { offset: 0, replies: [], lastId: null };
  if (size > hit.offset) {
    const buf = Buffer.alloc(size - hit.offset);
    const fd = fs.openSync(file, 'r');
    try { fs.readSync(fd, buf, 0, buf.length, hit.offset); } finally { fs.closeSync(fd); }
    const end = buf.lastIndexOf(10); // up to the last whole line; the rest is read next time
    if (end >= 0) {
      for (const line of buf.subarray(0, end).toString('utf8').split('\n')) {
        if (!line.includes('"assistant"') || !line.includes('"usage"')) continue;
        let e; try { e = JSON.parse(line); } catch { continue; }
        if (e.type !== 'assistant' || e.isSidechain || !e.message?.usage) continue;
        // One reply is written as a line per part, all with the same message id: count it once.
        const id = e.message.id || null;
        if (id && id === hit.lastId) continue;
        hit.lastId = id;
        const cc = e.message.usage.cache_creation || {};
        const at = Date.parse(e.timestamp) || 0;
        if (at) hit.replies.push({ at, ttl: cc.ephemeral_1h_input_tokens > 0 ? 3600 : cc.ephemeral_5m_input_tokens > 0 ? 300 : null });
      }
      hit.offset += end + 1;
    }
  }
  files.set(file, hit);
  return hit.replies;
}

// Over the last `days` days of a company's sessions (a list of reply lists, one per session): how many replies,
// how many came 5 to 60 minutes after the reply before them (missed on 5 minutes, kept on 1 hour; a longer
// break misses on either), and the cache length of the latest reply that wrote one.
export function tally(sessions, now = Date.now(), days = CACHE_OFFER.days) {
  const from = now - days * 864e5;
  let replies = 0, misses = 0, ttl = null, ttlAt = 0;
  for (const list of sessions) {
    for (let i = 0; i < list.length; i++) {
      const r = list[i];
      if (r.at < from) continue;
      replies++;
      const gap = i ? r.at - list[i - 1].at : 0;
      if (gap > FIVE_MIN && gap < HOUR) misses++;
      if (r.ttl && r.at >= ttlAt) { ttl = r.ttl; ttlAt = r.at; }
    }
  }
  return { replies, misses, share: replies ? misses / replies : 0, ttl };
}

// Whether to show the card: null, 'first' (no answer yet), or 'measured' (asked before, and the misses are now
// high enough). setting: the company's saved promptCacheTtl; answer: { answer: 'yes'|'later'|'never', at }.
export function offerKind({ setting, answer, t, now = Date.now(), o = CACHE_OFFER }) {
  if (setting) return null;            // a length was picked for this company (1 hour, or set by hand)
  if (t.ttl !== 300) return null;      // its sessions already keep 1 hour, or none ran lately
  if (answer?.answer === 'never') return null;
  if (!answer) return 'first';
  // Not now, or 1 hour later switched back to automatic: wait, then ask only when the measure says so.
  if (now - (answer.at || 0) < o.laterDays * 864e5) return null;
  return t.replies >= o.minReplies && t.share >= o.missShare ? 'measured' : null;
}
