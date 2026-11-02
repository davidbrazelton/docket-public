// The 🔨 feedback button (#552): anyone using Docket can suggest a feature. The page sends the message, an optional
// name and what its browser can see; the app adds what is safe to say about Docket itself, and sends the report to
// the destination set on this computer (☰ > Settings > Feedback destination). There is no default destination.
// What may go out is listed here, field by field: anything not on a list is dropped, and nothing about sessions
// (their words, titles, folders), sign-ins, desk names or client names is ever read in, so it cannot leak.

// The screens the page may say it was on. Anything else becomes 'other'.
export const VIEWS = ['session', 'new-session', 'session-list', 'schedules', 'desk-inspector', 'file-preview', 'setup', 'dialog', 'other'];
export const DEVICES = ['desktop', 'tablet', 'phone'];
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

// What is safe to say about Docket on this computer. Reads only the switches, which brands have a home folder set
// (never the folder), and how many sessions are open and working (never which ones).
export function docketFacts({ version = '', commit = '', clients = [], live = [], state = {}, os = '' } = {}) {
  const brands = ['claude', 'grok', 'codex'].filter((b) => clients.some((c) => (b === 'claude' ? c.home : c[b + 'Home'])));
  const sessions = [...live].filter((s) => s && s.status !== 'ended');
  return {
    version: word(version, 20), commit: /^[0-9a-f]{4,40}$/i.test(commit) ? commit.slice(0, 12) : '',
    os: word(os, 20),
    desks: clients.length, remoteDesks: clients.filter((c) => c.remote).length,
    brands,
    features: {
      stopStuckSteps: state.stallStop !== false, continueAfterCrash: state.autoContinue !== false, pauseOnSleep: state.autoPause !== false,
      updates: state.updates?.mode === 'auto' ? 'automatic' : 'manual', remoteConnection: !!state.remoteControl?.on, paused: !!state.paused,
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

// The destination as saved on this computer: { url, key? }, or null when not set. Only https, or http to this
// computer for testing; the key is optional and only ever sent to that address.
export function cleanDestination(d) {
  if (!d || typeof d !== 'object') return null;
  let u; try { u = new URL(String(d.url || '').trim()); } catch { return null; }
  const here = /^(localhost|127\.0\.0\.1|\[::1\])$/.test(u.hostname);
  if (!(u.protocol === 'https:' || (u.protocol === 'http:' && here)) || u.username || u.password) return null;
  const key = typeof d.key === 'string' ? d.key.trim().slice(0, 500) : '';
  return { url: u.href, ...(key ? { key } : {}) };
}
// What the page may see of it: the address, and whether a key is set (never the key).
export const destinationInfo = (d) => (d ? { url: d.url, hasKey: !!d.key } : { url: '', hasKey: false });

const NO_NET = new Set(['ENOTFOUND', 'EAI_AGAIN', 'ENETUNREACH', 'ENETDOWN', 'EHOSTUNREACH']);
// Sends the report. Never says sent unless the destination answered with a 2xx:
// { ok: true, where, link? } | { ok: false, kind: 'unset' | 'offline' | 'unreachable' | 'refused', code?, message }
export async function sendReport(dest, report, { fetch: f = globalThis.fetch, timeoutMs = 15000 } = {}) {
  if (!dest) return { ok: false, kind: 'unset', message: 'Feedback is not set up on this computer yet, so nothing was sent. Whoever looks after Docket here sets where it goes in ☰ > Settings > Feedback destination.' };
  const host = new URL(dest.url).host;
  let r;
  try {
    r = await f(dest.url, { method: 'POST', headers: { 'content-type': 'application/json', ...(dest.key ? { authorization: `Bearer ${dest.key}` } : {}) },
      body: JSON.stringify(report), signal: AbortSignal.timeout(timeoutMs) });
  } catch (e) {
    const code = e?.cause?.code || e?.code || '';
    if (NO_NET.has(code)) return { ok: false, kind: 'offline', code, message: `Not sent: this computer could not reach ${host} (${code}: no network, or the address is wrong). Your message is kept here; press Send again when you are back online.` };
    const why = e?.name === 'TimeoutError' ? 'took too long to answer' : code === 'ECONNREFUSED' ? 'is not answering' : 'could not be reached';
    return { ok: false, kind: 'unreachable', code: code || e?.name || '', message: `Not sent: ${host} ${why}${code ? ` (${code})` : ''}. Your message is kept here; press Send again to retry.` };
  }
  let j = null; try { j = await r.json(); } catch {}
  if (!r.ok) {
    const said = j && typeof j.error === 'string' ? `: ${j.error.slice(0, 200)}` : '';
    return { ok: false, kind: 'refused', code: r.status, message: `Not sent: ${host} refused it with error ${r.status}${r.statusText ? ' ' + r.statusText : ''}${said}. Your message is kept here.` };
  }
  const link = j && typeof (j.html_url || j.url) === 'string' && /^https:\/\//.test(j.html_url || j.url) ? (j.html_url || j.url) : '';
  return { ok: true, where: host, ...(link ? { link } : {}) };
}
