// A session whose first start never reached Claude Code (#759): the rules, kept apart from the server so they can be tested.
// A start that cannot reach the runner is tried again for about a minute (a runner restart or an update takes seconds).
// Until Claude Code has a session's first message, Docket keeps that message in data/first-messages/<id>.json; when the
// session is picked up again with no conversation to resume, it starts afresh under the same id with that message.
import fs from 'node:fs';
import path from 'node:path';

// Waits between tries of a start, about a minute in all.
export const START_RETRY_MS = [1000, 2000, 4000, 8000, 15000, 30000];

// A request that never got an answer: undici's "fetch failed" (or the connection code under it). '' for any other error,
// such as one the runner answered with.
const NET_CODES = new Set(['ECONNREFUSED', 'ECONNRESET', 'EPIPE', 'ETIMEDOUT', 'UND_ERR_SOCKET', 'UND_ERR_CONNECT_TIMEOUT', 'UND_ERR_CLOSED']);
export function netError(err) {
  const code = err?.cause?.code || err?.code || '';
  if (NET_CODES.has(code)) return code;
  return err?.message === 'fetch failed' ? 'fetch failed' : '';
}
// Refused: the request cannot have got there, so even one that is not safe to repeat (a message) can be sent again.
export const refused = (err) => (err?.cause?.code || err?.code) === 'ECONNREFUSED';
// "fetch failed (ECONNREFUSED)", for the chat and the log.
export const netText = (err) => { const code = err?.cause?.code; return code && err.message !== code ? `${err.message} (${code})` : err?.message || String(err); };

// Runs fn, and again after each wait in delays while retryIf(err) holds. onRetry(err, try, wait) before each wait.
export async function withRetries(fn, { delays = START_RETRY_MS, retryIf = netError, onRetry = () => {}, sleep = (ms) => new Promise((r) => setTimeout(r, ms)) } = {}) {
  for (let i = 0; ; i++) {
    try { return await fn(i); }
    catch (err) {
      if (i >= delays.length || !retryIf(err)) throw err;
      onRetry(err, i + 1, delays[i]);
      await sleep(delays[i]);
    }
  }
}

// Claude Code's answer to a resume of an id it has no conversation for.
export const noConversation = (text) => /No conversation found with session ID/i.test(String(text || ''));

// How a Claude session starts: 'new' (sessionId), 'resume', or 'fresh' (sessionId again, for a session Docket knew
// whose conversation does not exist: its first message never reached Claude Code). Other brands keep their own rules.
export function startMode({ engine = 'claude', resumeId, hasTranscript, fresh = false }) {
  if (!resumeId) return 'new';
  if (engine !== 'claude') return 'resume';
  return fresh || !hasTranscript ? 'fresh' : 'resume';
}

// A message that only asks the session to carry on: the cut-off banner's Continue (index.html, cutContinue) or the
// automatic continue (cut-off.mjs, cutOffNote). Sent to a session started afresh it means nothing, so it is dropped.
export const CONTINUE_TEXT = 'Continue where you left off.';
export function continueNudge({ text = '', system = false, context = '' }) {
  if (String(text).trim().startsWith(CONTINUE_TEXT)) return true;
  return system && !String(text).trim() && /^\(From Docket: Docket stopped unexpectedly/.test(context);
}

// The first message to start afresh with: the one kept, else the first message the chat shows (its text only), else the
// last one sent to it. null when there is none.
export function firstMessage({ kept, events = [], last = null }) {
  if (kept?.message) return kept.message;
  const first = events.find((e) => e.k === 'user' && e.text);
  if (first) return { type: 'user', message: { role: 'user', content: [{ type: 'text', text: first.text }] }, parent_tool_use_id: null };
  return last || null;
}

// The reply text a parent's report quotes. A turn with no text says so in a line, rather than an empty report.
export function reportText(reply, { error = '' } = {}) {
  if (reply) return reply;
  return error ? `(No reply: the turn ended with an error: ${error})` : '(No reply text)';
}

// The kept first messages, one file each.
export function firstStore(dir) {
  const file = (id) => path.join(dir, `${id}.json`);
  return {
    has: (id) => fs.existsSync(file(id)),
    save(id, message) {
      if (fs.existsSync(file(id))) return false; // the first one stays
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(file(id) + '.tmp', JSON.stringify({ at: Date.now(), message }));
      fs.renameSync(file(id) + '.tmp', file(id));
      return true;
    },
    read: (id) => { try { return JSON.parse(fs.readFileSync(file(id), 'utf8')); } catch { return null; } },
    drop: (id) => { try { fs.unlinkSync(file(id)); return true; } catch { return false; } },
  };
}
