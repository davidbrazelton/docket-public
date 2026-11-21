// Docket does the checks (#749). A 30-day study of the transcripts found sessions spending up to $352 a month on
// checks a program could do: sleep-and-look loops, `gh pr view`, `git status`, port checks, get_session_report.
// Each re-reads the whole context (median 89k tokens) to learn one fact. Two things here take that over:
//   wait_until: Docket waits on a condition itself and answers with one line, with no model calls while it waits.
//   the state line: one line on the notes Docket already sends (reports, notices) with the session's branch, its
//     pull request and its children, so the session need not ask for them again.
// A held tool call spends no tokens (no request is open while it runs), but it keeps the session in its turn: the
// person's messages and the session reports wait behind it, Docket's stall stop ends quiet steps at 15 minutes, and
// tools-helper.mjs's fetch gives up at 5 minutes and sends the call again. So a wait is answered inside the call
// only for inlineSec; past that the call returns at once and the answer comes later as a (From Docket: ...) note.
import net from 'node:net';

// One place to change them. inlineSec: how long the call itself waits; every: seconds between looks, per kind;
// noChecksSec: a pull request with no checks at all after this long has none coming.
export const WAITS = { inlineSec: 60, defaultMinutes: 30, maxMinutes: 720, noChecksSec: 120, every: { pr: 60, checks: 30, port: 2, session: 3 } };

export const CONDITIONS = ['pr_merged', 'pr_closed', 'pr_checks', 'port', 'session_idle', 'session_done', 'session_waiting'];
export const kindOf = (condition) => condition.startsWith('pr_') ? 'pr' : condition === 'port' ? 'port' : 'session';
const everySec = (c) => c.condition === 'pr_checks' ? WAITS.every.checks : WAITS.every[kindOf(c.condition)];

// A pull request given as a number (in the session's own repository) or a GitHub URL, as { repo, number }; repo ''
// when it is only a number and no repo was given (the caller fills in the folder's).
export function parsePr(pr, repo = '') {
  const s = String(pr ?? '').trim();
  const u = s.match(/github\.com\/([\w.-]+\/[\w.-]+)\/pull\/(\d+)/i);
  if (u) return { repo: u[1], number: Number(u[2]) };
  const n = s.match(/^#?(\d+)$/);
  return n ? { repo: String(repo || '').trim(), number: Number(n[1]) } : null;
}

// A wait as asked, checked and tidied: { condition, minutes, ... } or { error }.
export function parseWait(a = {}) {
  const condition = a.condition;
  if (!CONDITIONS.includes(condition)) return { error: `condition must be one of ${CONDITIONS.join(', ')}` };
  const minutes = Math.min(WAITS.maxMinutes, Math.max(1, Number(a.minutes) || WAITS.defaultMinutes));
  const kind = kindOf(condition);
  if (kind === 'pr') {
    const p = parsePr(a.pr, a.repo);
    if (!p) return { error: 'give pr as a number or a GitHub pull request URL' };
    if (p.repo && !/^[\w.-]+\/[\w.-]+$/.test(p.repo)) return { error: 'repo must be owner/name' };
    return { condition, minutes, ...p };
  }
  if (kind === 'port') {
    const port = Number(a.port);
    if (!Number.isInteger(port) || port < 1 || port > 65535) return { error: 'give port as a number from 1 to 65535' };
    const host = String(a.host || 'localhost').trim();
    if (!/^(localhost|127\.0\.0\.1|::1|\[::1\])$/i.test(host)) return { error: 'only a port on this computer (localhost) can be waited on' };
    return { condition, minutes, port, host };
  }
  const session = String(a.session || '').trim();
  if (!session) return { error: 'give session: the id of the session to wait on' };
  return { condition, minutes, session };
}

// What is waited for, in a few words.
export function waitWhat(c) {
  if (c.condition === 'port') return `port ${c.port} to answer`;
  if (kindOf(c.condition) === 'pr') return `pull request #${c.number} ${{ pr_merged: 'to be merged', pr_closed: 'to be merged or closed', pr_checks: 'checks to finish' }[c.condition]}`;
  const who = c.title ? `"${c.title}"` : c.session;
  return `session ${who} ${{ session_idle: 'to finish its turn', session_done: 'to be done', session_waiting: 'to wait on the user' }[c.condition]}`;
}

// A pull request's checks from GitHub's statusCheckRollup state: pass, fail, pending, or '' for no checks.
export function checksOf(rollup) {
  const s = String(rollup?.state || rollup || '').toUpperCase();
  return s === 'SUCCESS' ? 'pass' : s === 'FAILURE' || s === 'ERROR' ? 'fail' : s === 'PENDING' || s === 'EXPECTED' ? 'pending' : '';
}

// Whether a pull request wait is over. d: { state: OPEN | MERGED | CLOSED, checks }; elapsedMs: since the wait began.
// Returns { met, line }: the line says where it stands, met or not.
export function prVerdict(c, d, elapsedMs = 0) {
  const n = `Pull request #${c.number}${c.repo ? ` (${c.repo})` : ''}`;
  if (!d) return { met: true, error: true, line: `${n} was not found, or GitHub would not show it to this desk's sign-in.` };
  const checks = d.checks ? `, checks ${{ pass: 'passed', fail: 'failed', pending: 'still running' }[d.checks]}` : '';
  if (d.state === 'MERGED') return { met: true, line: `${n} was merged${checks}.` };
  if (d.state === 'CLOSED') return { met: true, line: `${n} was closed without merging${checks}.` };
  if (c.condition !== 'pr_checks') return { met: false, line: `${n} is still open${checks}.` };
  if (d.checks === 'pass' || d.checks === 'fail') return { met: true, line: `${n} checks ${d.checks === 'pass' ? 'passed' : 'failed'}; it is open.` };
  if (!d.checks && elapsedMs >= WAITS.noChecksSec * 1000) return { met: true, line: `${n} has no checks; it is open.` };
  return { met: false, line: `${n} is open, checks ${d.checks ? 'still running' : 'not started'}.` };
}

// Whether a session wait is over. st: the session's state as the session list counts it (working, waiting, done),
// 'gone' when there is no such session. Waiting on the user also ends a wait for it to be done only if asked for idle.
export function sessionVerdict(c, st) {
  const who = c.title ? `Session "${c.title}"` : `Session ${c.session}`;
  if (st === 'gone') return { met: true, error: true, line: `${who} was not found on this desk.` };
  if (st === 'working') return { met: false, line: `${who} is still working.` };
  const now = st === 'waiting' ? `${who} finished its turn and is waiting on the user.` : `${who} finished its turn and is done.`;
  if (c.condition === 'session_done' && st !== 'done') return { met: false, line: `${who} is waiting on the user, not done yet.` };
  return { met: true, line: now };
}

export const portVerdict = (c, open) => open ? { met: true, line: `Port ${c.port} answers.` } : { met: false, line: `Port ${c.port} does not answer yet.` };

// The line when the time runs out: the wait's last look.
export const timeoutLine = (c, last) => `Time ran out after ${c.minutes} min waiting for ${waitWhat(c)}. ${last || ''}`.trim();

// When to look next after a look at `now` (ms).
export const nextLook = (c, now) => now + everySec(c) * 1000;

// Whether something on this computer answers on the port: a TCP connection, tried on IPv4 and IPv6.
export async function portAnswers(port, host = 'localhost', ms = 1500) {
  const hosts = /^localhost$/i.test(host) ? ['127.0.0.1', '::1'] : [host.replace(/^\[|\]$/g, '')];
  for (const h of hosts) {
    const ok = await new Promise((resolve) => {
      const sock = net.connect({ host: h, port });
      const done = (v) => { sock.destroy(); resolve(v); };
      sock.setTimeout(ms, () => done(false));
      sock.once('connect', () => done(true));
      sock.once('error', () => done(false));
    });
    if (ok) return true;
  }
  return false;
}

// The wait inside the call: look until met or `ms` has gone. look() returns a verdict; sleep is for the tests.
export async function waitInline(c, look, { ms = WAITS.inlineSec * 1000, now = () => Date.now(), sleep = (t) => new Promise((r) => setTimeout(r, t)) } = {}) {
  const start = now();
  for (;;) {
    const v = await look(now() - start);
    if (v.met) return v;
    const next = nextLook(c, now());
    if (next - start > ms) return v;
    await sleep(Math.max(0, next - now()));
  }
}

// ---------- the state line ----------
// One line, at most about 200 characters, on the notes Docket sends a session: its branch, the pull request from
// that branch, the sessions under it still working or waiting on the user, and the number its next question to the
// user takes (question, questions.mjs, #928). A part left out means there is none. at: when the branch and pull
// request were read (the children are read as the note goes).
const PR_WORDS = { open: 'open', conflict: 'open with conflicts', merged: 'merged', closed: 'closed', unknown: 'state unknown' };
const clock = (ms) => new Date(ms).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
const cut = (s, n) => s.length > n ? s.slice(0, n - 1) + '…' : s;

// The pull request worth naming for a branch: an open one first, else the newest.
export function branchPr(prs = [], branch = '') {
  const mine = prs.filter((p) => !branch || !p.branch || p.branch === branch);
  return mine.find((p) => p.status === 'open' || p.status === 'conflict') || mine.slice().sort((a, b) => (b.number || 0) - (a.number || 0))[0] || null;
}

export function stateLine({ branch = '', pr = null, kids = [], question = '', at = Date.now(), max = 200 } = {}) {
  const parts = [];
  if (branch) parts.push(`branch ${cut(branch, 40)}`);
  if (pr) parts.push(`PR #${pr.number} ${pr.draft && pr.status === 'open' ? 'draft' : PR_WORDS[pr.status] || pr.status}${pr.checks ? `, checks ${pr.checks}` : ''}`);
  const working = kids.filter((k) => k.state === 'working'), waiting = kids.filter((k) => k.state === 'waiting');
  const group = (list, word, n) => list.length ? `${list.length} ${word}${n ? ` (${list.slice(0, 3).map((k) => `"${cut(k.title || 'Session', n)}"`).join(', ')}${list.length > 3 ? ', …' : ''})` : ''}` : '';
  const kidsPart = (n) => [group(working, 'working', n), group(waiting, 'waiting on the user', n)].filter(Boolean).join(', ');
  if (!parts.length && !kids.length && !question) return '';
  const make = (n) => `(Docket state at ${clock(at)}: ${[...parts, ...(kids.length ? [`sessions under you: ${kidsPart(n)}`] : []), ...(question ? [question] : [])].join('; ')}.)`;
  for (const n of [24, 14, 0]) { const line = make(n); if (line.length <= max) return line; }
  return make(0).slice(0, max - 2) + '…)';
}
