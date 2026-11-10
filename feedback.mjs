// The Suggest a feature button (#552, #563): anyone using Docket can suggest a feature. The page sends the message, an
// optional name and what its browser can see; the app adds what is safe to say about Docket itself, and files the
// report as a GitHub Issue in the repo set on this computer (☰ > Settings > Feedback destination), with the token set
// there. There is no default repo and no token in the code: until both are set on a computer, nothing is sent.
// What may go out is listed here, field by field: anything not on a list is dropped, and nothing about sessions
// (their words, titles, folders), sign-ins, desk names or client names is ever read in, so it cannot leak.
import { randomBytes } from 'node:crypto';

// The screens the page may say it was on. Anything else becomes 'other'.
export const VIEWS = ['session', 'new-session', 'session-list', 'schedules', 'desk-inspector', 'file-preview', 'setup', 'dialog', 'other'];
export const DEVICES = ['desktop', 'tablet', 'phone'];
// The most reports one install sends in a day, so a stuck button or a flood from one install stays small.
export const DAILY_LIMIT = 10;
const MAX_TEXT = 5000, MAX_NAME = 80, MAX_UA = 400;

const str = (v, max) => (typeof v === 'string' ? v.slice(0, max) : '');
const num = (v) => (Number.isFinite(v) && v >= 0 && v < 1e5 ? Math.round(v * 100) / 100 : null);
const size = (v) => (v && typeof v === 'object' && num(v.w) !== null && num(v.h) !== null ? { w: num(v.w), h: num(v.h) } : null);
// Short words only (no slashes, backslashes or colons), so a path or an address cannot ride along in a label.
const word = (v, max = 40) => (typeof v === 'string' && /^[\w .+()-]{1,}$/.test(v) ? v.slice(0, max) : '');

// The message, as typed, with the few things that must never go out reduced in place (the Hammer does the same for
// phone numbers): keys and tokens become [key removed], a phone number keeps its last four digits.
export function reduceText(s) {
  return String(s || '')
    .replace(/\b(sk-ant-[\w-]{8,}|sk-[A-Za-z0-9_-]{20,}|gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|xox[abprs]-[\w-]{10,}|AKIA[0-9A-Z]{16}|AIza[\w-]{30,})/g, '[key removed]')
    .replace(/(?<![\w-])(\+?1[\s.-]?)?\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?(\d{4})(?![\w-])/g, (_, _c, last) => `[phone ending ${last}]`);
}

// What the page's browser saw, kept to the listed fields.
export function cleanPageFacts(f = {}) {
  const b = f.browser && typeof f.browser === 'object' ? f.browser : {};
  return {
    view: VIEWS.includes(f.view) ? f.view : 'other',
    inGroup: f.inGroup === true,
    viewport: size(f.viewport), screen: size(f.screen), dpr: num(f.dpr),
    platform: word(f.platform), browser: { name: word(b.name), version: word(b.version, 20) },
    device: DEVICES.includes(f.device) ? f.device : '',
    ua: str(f.ua, MAX_UA).replace(/[^\x20-\x7e]/g, ''),
    tz: typeof f.tz === 'string' && /^[A-Za-z_]+(\/[A-Za-z0-9_+-]+){0,2}$|^UTC$/.test(f.tz) ? f.tz.slice(0, 40) : '',
    lang: typeof f.lang === 'string' && /^[A-Za-z]{2,3}(-[A-Za-z0-9]{2,8})*$/.test(f.lang) ? f.lang.slice(0, 20) : '',
    online: typeof f.online === 'boolean' ? f.online : null,
    theme: ['light', 'dark'].includes(f.theme) ? f.theme : '',
    at: typeof f.at === 'string' && !Number.isNaN(Date.parse(f.at)) ? new Date(f.at).toISOString() : '',
  };
}

// This install's ID: eight random letters and digits made once and saved, so reports from one install can be told
// apart (to spot a flood) without saying anything about the person or the computer.
export const isInstallId = (v) => typeof v === 'string' && /^[0-9a-f]{8}$/.test(v);
export function installId(state) {
  if (!isInstallId(state.installId)) state.installId = randomBytes(4).toString('hex');
  return state.installId;
}

// What is safe to say about Docket on this computer. Reads only the switches, which brands have a home folder set
// (never the folder), and how many sessions are open and working (never which ones).
export function docketFacts({ version = '', commit = '', clients = [], live = [], state = {}, os = '', install = '' } = {}) {
  const brands = ['claude', 'grok', 'codex'].filter((b) => clients.some((c) => (b === 'claude' ? c.home : c[b + 'Home'])));
  const sessions = [...live].filter((s) => s && s.status !== 'ended');
  return {
    version: word(version, 20), commit: /^[0-9a-f]{4,40}$/i.test(commit) ? commit.slice(0, 12) : '',
    install: isInstallId(install) ? install : '',
    os: word(os, 20),
    desks: clients.length, remoteDesks: clients.filter((c) => c.remote).length,
    brands,
    features: {
      stopStuckSteps: state.stallStop !== false, continueAfterCrash: state.autoContinue !== false, pauseOnSleep: state.autoPause !== false,
      remoteConnection: !!state.remoteControl?.on, paused: !!state.paused,
    },
    sessionsOpen: sessions.length, sessionsWorking: sessions.filter((s) => s.status === 'running').length,
  };
}

// The report as it goes out: the fields, and a title and body ready to become a GitHub Issue as they are.
export function buildReport({ description, name, page, docket }) {
  const text = reduceText(str(description, MAX_TEXT)).trim();
  const who = reduceText(str(name, MAX_NAME)).trim();
  const fields = { description: text, name: who, ...cleanPageFacts(page), ...docket };
  const first = text.split('\n')[0].trim();
  const title = 'Feedback: ' + (first.length > 70 ? first.slice(0, 67).trimEnd() + '…' : first);
  const row = (k, v) => `| ${k} | ${String(v ?? '').replace(/\|/g, '\\|').replace(/\n/g, ' ')} |`;
  const flat = (v) => (v && typeof v === 'object' ? (Array.isArray(v) ? v.join(', ') : Object.entries(v).map(([k, x]) => `${k}: ${x}`).join(', ')) : v);
  const body = `${text}\n\n— ${who || 'anonymous'}\n\n| Field | Value |\n|---|---|\n`
    + Object.entries(fields).filter(([k]) => k !== 'description' && k !== 'name').map(([k, v]) => row(k, flat(v))).join('\n') + '\n';
  return { title, body, fields };
}

// The destination as saved on this computer: { repo: 'owner/name', token }, or null when either is missing.
export function cleanDestination(d) {
  if (!d || typeof d !== 'object') return null;
  const repo = String(d.repo || '').trim().replace(/^https:\/\/github\.com\//, '').replace(/\.git$|\/$/g, '');
  const token = typeof d.token === 'string' ? d.token.trim() : '';
  if (!/^[A-Za-z0-9-]{1,39}\/[A-Za-z0-9._-]{1,100}$/.test(repo) || !/^[A-Za-z0-9_]{20,255}$/.test(token)) return null;
  return { repo, token };
}
// What the page may see of it: the repo, and whether a token is set (never the token).
export const destinationInfo = (d) => (d ? { repo: d.repo, hasToken: true } : { repo: '', hasToken: false });

// Today's count of reports sent from this install: { day: 'YYYY-MM-DD' (this computer's date), count }.
export const today = (now = new Date()) => `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
export const sentToday = (sent, day) => (sent && sent.day === day && Number.isInteger(sent.count) ? sent.count : 0);
export const limitReached = (sent, day, limit = DAILY_LIMIT) => sentToday(sent, day) >= limit;
export const countSend = (sent, day) => ({ day, count: sentToday(sent, day) + 1 });
export const limitMessage = (limit = DAILY_LIMIT) => `Not sent: this computer has already sent ${limit} reports today, the most it sends in one day. Your message is kept here; send it again tomorrow.`;

// What each refusal from GitHub most likely means, in plain words.
const GH_WHY = {
  401: 'the token is not accepted (wrong, expired or cancelled)',
  403: 'the token may not create issues there, or GitHub is limiting requests',
  404: 'the repo was not found, or the token cannot see it',
  410: 'Issues are turned off in that repo',
  422: 'GitHub would not take the report as written',
};
const NO_NET = new Set(['ENOTFOUND', 'EAI_AGAIN', 'ENETUNREACH', 'ENETDOWN', 'EHOSTUNREACH']);
// Files the report as an Issue. Never says sent unless GitHub answered 201 Created:
// { ok: true, where, link, number } | { ok: false, kind: 'unset' | 'offline' | 'unreachable' | 'refused', code?, message }
export async function sendReport(dest, report, { fetch: f = globalThis.fetch, timeoutMs = 15000 } = {}) {
  if (!dest) return { ok: false, kind: 'unset', message: 'Feedback is not set up on this computer yet, so nothing was sent. Whoever looks after Docket here sets where it goes in ☰ > Settings > Feedback destination.' };
  let r;
  try {
    r = await f(`https://api.github.com/repos/${dest.repo}/issues`, {
      method: 'POST',
      headers: { accept: 'application/vnd.github+json', authorization: `Bearer ${dest.token}`, 'content-type': 'application/json', 'user-agent': 'Docket-feedback', 'x-github-api-version': '2022-11-28' },
      body: JSON.stringify({ title: report.title, body: report.body }), signal: AbortSignal.timeout(timeoutMs) });
  } catch (e) {
    const code = e?.cause?.code || e?.code || '';
    if (NO_NET.has(code)) return { ok: false, kind: 'offline', code, message: `Not sent: this computer could not reach GitHub (${code}: no network). Your message is kept here; press Send again when you are back online.` };
    const why = e?.name === 'TimeoutError' ? 'took too long to answer' : 'could not be reached';
    return { ok: false, kind: 'unreachable', code: code || e?.name || '', message: `Not sent: GitHub ${why}${code ? ` (${code})` : ''}. Your message is kept here; press Send again to retry.` };
  }
  let j = null; try { j = await r.json(); } catch {}
  if (r.status !== 201) {
    const said = j && typeof j.message === 'string' ? ` GitHub said: "${j.message.slice(0, 200)}".` : '';
    const why = GH_WHY[r.status] || 'GitHub did not create the Issue';
    return { ok: false, kind: 'refused', code: r.status, message: `Not sent: error ${r.status}, ${why}.${said} Your message is kept here.` };
  }
  const link = j && typeof j.html_url === 'string' && /^https:\/\/github\.com\//.test(j.html_url) ? j.html_url : '';
  return { ok: true, where: `${dest.repo}${j?.number ? ` as Issue #${j.number}` : ''}`, ...(link ? { link } : {}), ...(j?.number ? { number: j.number } : {}) };
}
