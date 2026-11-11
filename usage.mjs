// Anonymous usage stats (#848): one small report a day of how much Docket is used, never what for. The app counts a
// few things as they happen (sessions started, plans made, pages opened) in state.usage, and a few times a day sends
// that day's counts with some totals read at send time (desks, groups, schedules, switches) to Docket's own counter
// (usage-worker/), which keeps one row per install per day. Nothing is sent until the person has answered the window
// that lists every field (index.html, showUsageStats). README.md, "Usage stats", lists every field too.
// Never sent: names, emails, folder paths, desk/group/session titles, prompts, costs, repo names. Off with
// DOCKET_NO_USAGE=1 or ☰ > Docket settings > Usage stats; off means nothing is counted or sent.
import { randomUUID } from 'node:crypto';

export const USAGE_URL = 'https://docket-usage.dbrazelton.workers.dev';
export const PAYLOAD_VERSION = 1;
export const BRANDS = ['claude', 'codex', 'grok'];
export const GEAR_KEYS = ['haiku', 'sonnet', 'opus', 'luna', 'sol', 'astra', 'fast', 'full'];
// What is counted as it happens. Anything else passed to count() is ignored.
export const COUNTS = ['sessions.claude', 'sessions.codex', 'sessions.grok', 'children', 'shiftSessions', 'plans', 'ask', 'handoff', 'pages.usage', 'pages.plans',
  ...GEAR_KEYS.map((g) => 'gears.' + g)];
export const SEND_EVERY_MS = 4 * 3600000;
export const SEND_TIMEOUT_MS = 5000;

// Every field sent, in the words the window about it and README.md use (a test checks README.md lists each one), and
// the part of the window it is listed under.
export const FIELD_GROUPS = [
  ['install', 'About this install'],
  ['day', 'Counts for the day'],
  ['totals', 'Totals on this computer'],
  ['settings', 'Settings'],
];
export const FIELDS = [
  ['id', 'a random install ID, made once on this computer and in nothing else Docket sends', 'install'],
  ['version', 'the Docket version', 'install'],
  ['platform', 'windows, mac or other', 'install'],
  ['firstSeen', 'the day this install first counted', 'install'],
  ['day', 'the day the counts are for (UTC)', 'install'],
  ['sessions', 'sessions started that day, by AI brand (claude, codex, grok)', 'day'],
  ['children', 'sessions started by another session', 'day'],
  ['shiftSessions', 'sessions started in Shift mode', 'day'],
  ['gears', 'how many times sessions shifted to each gear (haiku, sonnet, opus, ...)', 'day'],
  ['plans', 'plans made', 'day'],
  ['ask', 'questions asked of another desk', 'day'],
  ['handoff', 'pieces of work handed to another desk', 'day'],
  ['pages', 'times the Usage and Plans pages were opened', 'day'],
  ['desks', 'number of desks, in total and by AI brand', 'totals'],
  ['remoteDesks', 'number of remote desks', 'totals'],
  ['groups', 'number of groups', 'totals'],
  ['schedules', 'number of schedules', 'totals'],
  ['signinDesks', 'number of desks with private-browser sign-ins saved (not which sites)', 'totals'],
  ['remoteControl', 'whether Remote Control is on', 'settings'],
  ['updateMode', 'whether updates are taken by themselves (auto) or never checked (off)', 'settings'],
  ['theme', 'light, dark or system', 'settings'],
];
// Never sent, for the window and README.md.
export const NEVER = 'names, emails, folder or file paths, desk, group or session titles, prompts, chat or file contents, costs, repo names, the sites you sign in to';

const envOff = (v) => !!v && !/^(0|false|no|off)$/i.test(String(v).trim());
export const offByEnv = (env = process.env) => envOff(env.DOCKET_NO_USAGE);
export const usageOn = (state, env = process.env) => !offByEnv(env) && state.usage?.off !== true;
export const dayOf = (t = Date.now()) => new Date(t).toISOString().slice(0, 10); // UTC, the same day for every install

// state.usage, made on first use: { id, firstSeen, day, counts, last?: { day, counts } (the day before, not yet sent
// in full), noticeAt?, sentAt?, off? }. The id is random and only ever names this install's rows.
export function usageRecord(state, now = Date.now()) {
  const u = (state.usage ||= {});
  if (!/^[0-9a-f-]{36}$/.test(u.id || '')) u.id = randomUUID();
  u.firstSeen ||= dayOf(now);
  u.counts ||= {};
  const day = dayOf(now);
  if (u.day !== day) { // a new day: the old one's counts wait to be sent once more, in full
    if (u.day && Object.keys(u.counts).length) u.last = { day: u.day, counts: u.counts };
    u.day = day; u.counts = {};
  }
  return u;
}

// One more of key today. Nothing is kept while usage stats are off.
export function count(state, key, { env = process.env, now = Date.now(), n = 1 } = {}) {
  if (!COUNTS.includes(key) || !usageOn(state, env)) return false;
  const u = usageRecord(state, now);
  u.counts[key] = (u.counts[key] || 0) + n;
  return true;
}

export const platformName = (p = process.platform) => (p === 'win32' ? 'windows' : p === 'darwin' ? 'mac' : 'other');

// The totals read at send time, from what the app already has. Takes only counts and on/off, never a name or path.
// clients: the desk list; brandOf(client) its brand; groups: number of open groups; signinDesks: desks with
// private-browser sign-ins saved.
export function totals({ clients = [], brandOf = () => 'claude', groups = 0, schedules = 0, signinDesks = 0, state = {} }) {
  const desks = { total: clients.length };
  for (const b of BRANDS) desks[b] = clients.filter((c) => brandOf(c) === b).length;
  const theme = state.pageSettings?.theme;
  const minutes = state.updates?.minutes;
  return {
    desks, remoteDesks: clients.filter((c) => c.remote).length, groups, schedules, signinDesks,
    remoteControl: !!state.remoteControl?.on,
    updateMode: minutes === 0 ? 'off' : 'auto',
    theme: theme === 'light' || theme === 'dark' ? theme : 'system',
  };
}

// The exact body sent for one day.
export function payload({ u, day, counts, version, platform, totals: t }) {
  const c = (k) => counts[k] || 0;
  const gears = {};
  for (const g of GEAR_KEYS) if (c('gears.' + g)) gears[g] = c('gears.' + g);
  return {
    v: PAYLOAD_VERSION, id: u.id, version: String(version || '').slice(0, 20), platform, firstSeen: u.firstSeen, day,
    sessions: Object.fromEntries(BRANDS.map((b) => [b, c('sessions.' + b)])),
    children: c('children'), shiftSessions: c('shiftSessions'), gears,
    plans: c('plans'), ask: c('ask'), handoff: c('handoff'),
    pages: { usage: c('pages.usage'), plans: c('pages.plans') },
    ...t,
  };
}

// Whether a send is due: on, the person has answered the window that lists what is sent (noticeDone), and nothing sent
// in the last few hours (a day that ended unsent always is due).
export function sendDue(state, { env = process.env, now = Date.now() } = {}) {
  if (!usageOn(state, env)) return false;
  const u = state.usage;
  if (!u?.noticeDone) return false;
  return !!u.last || !u.sentAt || now - u.sentAt >= SEND_EVERY_MS || dayOf(u.sentAt) !== dayOf(now);
}

// Sends the bodies, quietly: a failure is left for the next try, and nothing waits longer than SEND_TIMEOUT_MS.
export async function send(url, body, { fetch: f = globalThis.fetch } = {}) {
  try {
    const r = await f(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(SEND_TIMEOUT_MS) });
    return r.ok;
  } catch { return false; }
}
