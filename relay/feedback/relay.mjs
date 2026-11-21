// The feedback relay (#1035): Docket's Suggest a feature button posts here, and this files the GitHub Issue. It holds
// the only token (in the host's environment, never in Docket) and the limits nobody can get round from a computer:
// 3 a day per sender, counted both by address and by install ID (either one full blocks), and 30 a day from everyone.
// Kept free of the host's own modules so test/feedback-relay.test.mjs runs it with a pretend store and GitHub.
import { createHash } from 'node:crypto';

export const PER_SENDER = 3, PER_DAY = 30;
export const MAX_MESSAGE = 4000, MAX_NAME = 80, MAX_DETAILS = 3000;
export const LABEL = 'suggestion';

// Today in UTC, so every sender's day turns over at the same moment.
export const utcDay = (now = new Date()) => now.toISOString().slice(0, 10);
// Addresses are kept only as a hash salted with the day, so the store never holds one and yesterday's cannot be matched.
export const ipKey = (ip, day) => createHash('sha256').update(`${day}|${ip}`).digest('hex').slice(0, 24);

const reply = (status, body) => ({ status, body });
const refuse = (status, kind, message, extra = {}) => reply(status, { ok: false, kind, message, ...extra });

// What a report must look like: the message as typed (already cleaned by Docket), an optional name, the table of safe
// facts Docket builds, and the install ID. Anything else is dropped.
export function cleanRequest(b) {
  if (!b || typeof b !== 'object') return { error: 'The request was not a report.' };
  const message = typeof b.message === 'string' ? b.message.trim() : '';
  const name = typeof b.name === 'string' ? b.name.trim() : '';
  const details = typeof b.details === 'string' ? b.details.trim() : '';
  const install = typeof b.install === 'string' && /^[0-9a-f]{8}$/.test(b.install) ? b.install : '';
  if (!message) return { error: 'The message is empty.' };
  if (message.length > MAX_MESSAGE) return { error: `The message is longer than ${MAX_MESSAGE} characters; shorten it and send again.` };
  if (name.length > MAX_NAME) return { error: `The name is longer than ${MAX_NAME} characters.` };
  if (details.length > MAX_DETAILS) return { error: 'The details Docket adds are longer than expected.' };
  if (!install) return { error: 'The report has no install ID.' };
  return { message, name, details, install };
}

// The Issue as it is filed. Lines starting with @ or # would ping people or link issues in the private repo, so a
// mention loses its @ there.
export function issueFor({ message, name, details }) {
  const text = message.replace(/(^|\s)@(?=[\w-])/g, '$1');
  const first = text.split('\n')[0].trim();
  const title = 'Suggestion: ' + (first.length > 70 ? first.slice(0, 67).trimEnd() + '…' : first);
  return { title, body: `${text}\n\n— ${name || 'anonymous'}\n\n${details}\n`.replace(/\n{3,}$/, '\n'), labels: [LABEL] };
}

const GH_WHY = {
  401: 'the relay\'s GitHub token is not accepted (wrong, expired or cancelled)',
  403: 'the relay\'s GitHub token may not create issues there, or GitHub is limiting requests',
  404: 'the repo was not found, or the relay\'s GitHub token cannot see it',
  410: 'Issues are turned off in that repo',
  422: 'GitHub would not take the report as written',
};

// One send. store: { get(key) -> number|null, set(key, number) } (the host's key-value store); fetch: for GitHub.
// Answers { status, body }; body.ok is true only when GitHub answered 201 Created.
export async function handle({ method, body, ip, store, token, repo, fetch: f = globalThis.fetch, now = new Date(), timeoutMs = 15000 }) {
  if (method !== 'POST') return refuse(405, 'method', 'Send a report with POST.');
  if (!token || !/^[\w-]+\/[\w.-]+$/.test(repo || '')) return refuse(503, 'unset', 'The relay is not set up yet (no token or repo), so nothing was sent.');
  const r = cleanRequest(body);
  if (r.error) return refuse(400, 'invalid', r.error);
  const day = utcDay(now);
  const keys = { total: `${day}/total`, ip: `${day}/ip/${ipKey(ip || 'unknown', day)}`, install: `${day}/install/${r.install}` };
  const count = {};
  for (const [k, key] of Object.entries(keys)) count[k] = Number(await store.get(key)) || 0;
  if (count.total >= PER_DAY) return refuse(429, 'total', `Docket has already taken ${PER_DAY} suggestions from everyone today, the most it takes in a day. Send it again tomorrow (the day turns over at midnight UTC).`);
  if (count.ip >= PER_SENDER) return refuse(429, 'sender', `${PER_SENDER} suggestions have already come from this network today, the most one sender sends in a day. Send it again tomorrow (the day turns over at midnight UTC).`);
  if (count.install >= PER_SENDER) return refuse(429, 'install', `This Docket has already sent ${PER_SENDER} suggestions today, the most one sender sends in a day. Send it again tomorrow (the day turns over at midnight UTC).`);
  // Counted before GitHub is asked, so two sends at once cannot both slip under a limit; given back if it does not go.
  for (const [k, key] of Object.entries(keys)) await store.set(key, count[k] + 1);
  const giveBack = async () => { for (const [k, key] of Object.entries(keys)) await store.set(key, count[k]); };
  let res;
  try {
    res = await f(`https://api.github.com/repos/${repo}/issues`, {
      method: 'POST',
      headers: { accept: 'application/vnd.github+json', authorization: `Bearer ${token}`, 'content-type': 'application/json', 'user-agent': 'Docket-feedback-relay', 'x-github-api-version': '2022-11-28' },
      body: JSON.stringify(issueFor(r)), signal: AbortSignal.timeout(timeoutMs) });
  } catch (e) {
    await giveBack();
    return refuse(502, 'unreachable', `The relay could not reach GitHub (${e?.cause?.code || e?.name || 'error'}). Press Send again in a while.`);
  }
  let j = null; try { j = await res.json(); } catch {}
  if (res.status !== 201) {
    await giveBack();
    const said = j && typeof j.message === 'string' ? ` GitHub said: "${j.message.slice(0, 200)}".` : '';
    return refuse(502, 'refused', `GitHub refused it with error ${res.status}: ${GH_WHY[res.status] || 'GitHub did not create the Issue'}.${said}`, { code: res.status });
  }
  return reply(201, { ok: true, number: Number.isInteger(j?.number) ? j.number : null, left: Math.min(PER_SENDER - count.ip, PER_SENDER - count.install) - 1 });
}
