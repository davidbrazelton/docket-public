// The autopilot (#821): a pilot session that answers what waits on the person, under rules the person keeps on this
// computer. This file holds the rules, kept apart from the server so they can be tested: what kinds of item there are,
// the answers each takes, the hard stops a permission prompt can hit, and whether the pilot may give an answer.

// Each kind of item waiting on the person, with the answers it takes. The first answer that only says no (decline)
// is what the rules' "deny" still lets the pilot give.
export const KINDS = {
  permission: { answers: ['allow', 'always', 'deny'], decline: 'deny', what: 'a permission prompt (Allow / Always allow / Deny)' },
  question: { answers: ['answer', 'skip'], decline: 'skip', what: 'a question form (answers by question text, or skip to have it asked in the chat)' },
  plan: { answers: ['allow', 'deny'], decline: 'deny', what: 'a plan waiting for approval (ExitPlanMode)' },
  offer: { answers: ['new', 'here'], decline: 'here', what: 'a New session / Do it here card' },
  card: { answers: ['start', 'dismiss'], decline: 'dismiss', what: 'a suggested session card (Start / Dismiss)' },
  handoff: { answers: ['continue', 'here'], decline: 'here', what: 'a handoff card (Continue in new session / Keep going here)' },
  inbox: { answers: ['start', 'dismiss'], decline: 'dismiss', what: 'work another desk handed over (Start / Dismiss)' },
  cross: { answers: ['send', 'stop'], decline: 'stop', what: "a Send / Don't send card for ask_desk or propose_to_desk" },
  merge: { answers: ['merge'], decline: null, what: 'an open pull request waiting for the person to say merge' },
  signin: { answers: ['dismiss'], decline: 'dismiss', what: 'a private browser sign-in the session needs' },
  remote: { answers: ['allow', 'deny'], decline: 'deny', what: 'another computer asking to use a desk here (Remote Desks)' },
};

// Hard stops: stay with the person unless the rules file names them, whatever the kind's own rule says.
export const STOPS = {
  merge: 'merging a pull request or pushing to the main branch',
  money: 'spending or moving money',
  secrets: 'reading or handing over passwords, tokens or keys',
  signin: 'signing in',
  delete: 'deleting files, branches or data',
  outside: 'sending to an outside service (email, chat, GitHub, the web)',
  remote: 'letting another desk or computer in',
};

// The kinds that take judgment (#917): the pilot learns them first, by suggesting and watching the person's answers.
export const JUDGMENT = ['question', 'plan', 'offer', 'card', 'handoff'];
// The kinds a suggestion can be shown on (on the card, with Accept) and so learned; suggest on any other kind
// counts as ask. Permission prompts are allowed by default, but a person may set them to suggest too.
export const LEARNS = ['permission', ...JUDGMENT];
const SUGGESTS = new Set(LEARNS);
// Safe defaults: the pilot answers permission prompts, and suggests for the judgment kinds until the person lets it
// answer them (I got this); every other kind waits for the person. Every hard stop waits for the person.
// RULES_VERSION: written in the rules file, 2 once the judgment kinds default to suggest (upgradeRules).
export const RULES_VERSION = 2;
export const DEFAULT_RULES = {
  kinds: { permission: 'allow', question: 'suggest', plan: 'suggest', offer: 'suggest', card: 'suggest', handoff: 'suggest', inbox: 'ask', cross: 'ask', merge: 'ask', signin: 'ask', remote: 'ask' },
  stops: Object.fromEntries(Object.keys(STOPS).map((k) => [k, 'ask'])),
  desks: {},
};
const LEVELS = new Set(['allow', 'deny', 'suggest', 'ask']);
// A rules file written before #917 holds the old defaults for the judgment kinds: those (and only those, so a level
// the person chose stays) become suggest, once. Returns { rules, changed } (rules: the file's object, upgraded).
const OLD_DEFAULTS = { question: 'allow', plan: 'ask', offer: 'allow', card: 'ask', handoff: 'ask' };
export function upgradeRules(raw) {
  if (!raw || typeof raw !== 'object' || raw.version >= RULES_VERSION) return { rules: raw, changed: false };
  const kinds = { ...(raw.kinds || {}) };
  for (const k of JUDGMENT) if (kinds[k] === undefined || kinds[k] === OLD_DEFAULTS[k]) kinds[k] = 'suggest';
  return { rules: { ...raw, version: RULES_VERSION, kinds }, changed: true };
}

// The rules file as read (any shape) made safe: unknown kinds, stops and levels are dropped, and what is missing
// takes the default. desks: per-desk kinds and stops laid over the rest.
export function cleanRules(raw) {
  const pick = (o, keys) => Object.fromEntries(Object.entries(o && typeof o === 'object' ? o : {})
    .filter(([k, v]) => keys.includes(k) && LEVELS.has(v)));
  const kinds = Object.keys(KINDS), stops = Object.keys(STOPS);
  const desks = {};
  for (const [id, d] of Object.entries(raw?.desks && typeof raw.desks === 'object' ? raw.desks : {})) {
    desks[id] = { kinds: pick(d?.kinds, kinds), stops: pick(d?.stops, stops) };
  }
  return { kinds: { ...DEFAULT_RULES.kinds, ...pick(raw?.kinds, kinds) }, stops: { ...DEFAULT_RULES.stops, ...pick(raw?.stops, stops) }, desks };
}

// What a permission prompt touches, from its tool and input: the hard stops it hits.
const SHELL = /^(Bash|PowerShell|BashOutput|mcp__.*__(shell|exec|run_command|terminal)\w*)$/i;
const RULES_BY_TEXT = [
  ['merge', /\bgh\s+pr\s+merge\b|\bgit\s+push\b[^\n;|&]*\b(master|main)\b|\bgit\s+merge\b/i],
  ['delete', /(^|[\s;&|(])(rm|rmdir|rd|del|erase|Remove-Item|ri|shred|unlink)(\s|$)|\bgit\s+(clean|reset\s+--hard|branch\s+-[dD]\b|push\b[^\n;|&]*(--delete|\s:))|\bgh\s+\w+\s+delete\b|\bDROP\s+(TABLE|DATABASE)\b|\bDELETE\s+FROM\b|--force\b|\bpush\s+-f\b|\bgit\s+worktree\s+remove\b/i],
  ['secrets', /\b(passw(or)?d|secret|api[_-]?key|private[_-]?key|credential|auth\s+token|access[_-]?token|bearer)\b|\.env\b|\.pem\b|\bid_(rsa|ed25519)\b|\bGH_TOKEN\b|\bgh\s+auth\s+token\b/i],
  ['money', /\b(payment|purchase|checkout|invoice|refund|charge|billing|stripe|paypal|subscribe|subscription|buy)\b/i],
  ['outside', /\bgit\s+push\b|\bgh\s+(pr|issue|release|repo|gist)\s+(create|comment|edit|close|reopen|review|merge|delete)\b|\bgh\s+api\b[^\n]*(-X|--method)\s*(POST|PUT|PATCH|DELETE)\b|\bcurl\b[^\n]*(-X\s*(POST|PUT|PATCH|DELETE)|\s(-d|--data\S*|-F|--form)\s)|\bInvoke-(RestMethod|WebRequest)\b[^\n]*-Method\s+(Post|Put|Patch|Delete)\b|\bnpm\s+publish\b|\bscp\b|\bsftp\b/i],
];
const RULES_BY_TOOL = [
  ['merge', /merge/i],
  ['delete', /delete|trash|remove|recycle|drop|purge|destroy/i],
  ['secrets', /secret|password|credential|token|auth/i],
  ['money', /pay|purchase|checkout|invoice|refund|charge|billing|order|ads?_/i],
  ['signin', /needs_signin|sign_?in|login/i],
  ['outside', /send|post|reply|forward|publish|share|upload|comment|message|create|update|schedule|invite|respond|add_|draft/i],
];
export function permissionStops(tool = '', input = {}) {
  const hit = new Set();
  const text = SHELL.test(tool) ? String(input?.command ?? '') : '';
  for (const [stop, re] of RULES_BY_TEXT) if (text && re.test(text)) hit.add(stop);
  // Connected services: Docket's own tools and the private browser stay in, everything else is outside.
  const service = /^mcp__/.test(tool) && !/^mcp__(portal|playwright)__/.test(tool);
  if (service) for (const [stop, re] of RULES_BY_TOOL) if (re.test(tool.split('__').slice(2).join('__'))) hit.add(stop);
  if (/^mcp__portal__(recycle|remove_folder_later)$/.test(tool)) hit.add('delete');
  if (/^mcp__portal__(needs_signin)$/.test(tool)) hit.add('signin');
  if (/^mcp__portal__(ask_desk|propose_to_desk|ask_company|propose_to_company)$/.test(tool)) hit.add('remote');
  if (/^(WebFetch|WebSearch)$/.test(tool) && /^(POST|PUT|PATCH|DELETE)$/i.test(String(input?.method || ''))) hit.add('outside');
  // A file written or read where secrets live.
  const file = String(input?.file_path ?? input?.path ?? '');
  if (file && /(^|[\\/])(\.env[^\\/]*|[^\\/]*\.pem|id_(rsa|ed25519)[^\\/]*|credentials[^\\/]*|[^\\/]*secret[^\\/]*)$/i.test(file)) hit.add('secrets');
  return [...hit];
}

// The hard stops an item hits, by kind (a permission prompt by what it touches).
export function itemStops(item) {
  switch (item.kind) {
    case 'merge': return ['merge'];
    case 'signin': return ['signin'];
    case 'cross': case 'remote': return ['remote'];
    case 'inbox': return ['remote', 'money']; // runs on, and bills to, the desk it was handed to
    case 'permission': case 'plan': return permissionStops(item.tool, item.input);
    default: return [];
  }
}

// The pilot never approves itself: what a pilot run raised (its own session, a card it made) stays with the person.
export const OWN_RUN = 'raised by a pilot run itself';

// ---------- per desk (#973) ----------
// Enabled (state.pilot.on, ☰ > Docket settings > Autopilot) shows the controls and lets Docket learn from the person's
// answers on every desk; engaged (state.pilot.engaged: desk -> since when) is what lets it act on a desk. Only a desk
// with a brand signed in can be engaged, since its runs are its own sessions, billed there.

// The desks the 🤖 drop-down's quick actions engage. quick: others (all but the desk open now, here), all, or none.
// desks: [{ id, signedIn }]; one with no brand signed in is never engaged. Returns the ids.
export function quickEngaged(quick, desks, here) {
  if (quick === 'none') return [];
  return (desks || []).filter((d) => d.signedIn && (quick === 'all' || (quick === 'others' && d.id !== here))).map((d) => d.id);
}

// The keys the page's activity marks an item by (#942, #965, widened in #973): the item itself (a question form being
// filled in), and the person typing in, or otherwise using, the session it waits in. While any of them is recent the
// pilot holds back there.
export const busyKeys = (item) => [item.id, ...(item.session ? [`typing:${item.session}`, `active:${item.session}`] : [])];

// One line for a desk in the 🤖 drop-down: what the rules let the pilot do there, "answers prompts, suggests for forms,
// plans". rules: cleaned or raw. Kinds that wait for the person are left out.
const SHORT = { permission: 'prompts', question: 'forms', plan: 'plans', offer: 'offers', card: 'cards', handoff: 'handoffs' };
export function deskStatus(rules, desk) {
  const r = cleanRules(rules), d = r.desks[desk] || { kinds: {} };
  const by = { allow: [], suggest: [] };
  for (const k of LEARNS) by[d.kinds[k] || r.kinds[k]]?.push(SHORT[k]);
  return [by.allow.length ? `answers ${by.allow.join(', ')}` : '', by.suggest.length ? `suggests for ${by.suggest.join(', ')}` : ''].filter(Boolean).join(', ') || 'leaves everything to you';
}

// The one-time move to per desk (#973) for a computer that used the autopilot before: state.pilot as saved, and the
// sessions. on stays as enabled, with no desk engaged (a note says to engage it from 🤖); the Autopilot desk's
// sessions are archived and the desk leaves the desk list (its folders stay on disk); the "Runs on" brand and the run
// fallbacks go. Runs on the desks themselves are left as they are. Returns { pilot, archive: [session ids], dropDesk:
// the old desk's id or null, changed }; run again on its own result it changes nothing.
export function migratePilot(pilot, sessions = {}) {
  if (!pilot || typeof pilot !== 'object' || pilot.perDesk) return { pilot, archive: [], dropDesk: null, changed: false };
  const { desk, brand, gear, session, runAt, fallback, ...keep } = pilot;
  const archive = desk ? Object.entries(sessions || {}).filter(([, r]) => r && r.client === desk && !r.archived).map(([id]) => id) : [];
  // going: a run of the old desk going at the upgrade is dropped (its session is archived); runs on a desk stay.
  const going = Object.fromEntries(Object.entries(keep.going || {}).filter(([, r]) => r && r.host !== desk || !desk));
  return { pilot: { ...keep, on: !!keep.on, going, engaged: {}, perDesk: true, ...(keep.on ? { movedNote: true } : {}) }, archive, dropDesk: desk || null, changed: true };
}

// The level the rules give an item: its desk's rule for its kind over the general one, then any hard stop it hits
// that the rules do not name as allow or deny pulls it back to ask. Returns { level, stops, why }.
// ownRun: (item) => whether a pilot run raised it; that stays with the person, whatever the rules say.
export function ruleFor(rules, item, ownRun) {
  if (typeof ownRun === 'function' && ownRun(item)) return { level: 'ask', stops: itemStops(item), why: OWN_RUN };
  const r = cleanRules(rules), desk = r.desks[item.desk] || { kinds: {}, stops: {} };
  const kind = desk.kinds[item.kind] || r.kinds[item.kind] || 'ask';
  const stops = itemStops(item);
  let level = kind === 'suggest' && !SUGGESTS.has(item.kind) ? 'ask' : kind, why = `the rules say ${kind} for ${item.kind}`;
  for (const st of stops) {
    const s = desk.stops[st] || r.stops[st];
    // A hard stop only lets the pilot in as far as the rules name it: allow lets the kind's rule stand, deny lets
    // it decline at most, and anything else (ask, or not named) keeps it with the person.
    if (s === 'ask' || !s) return { level: 'ask', stops, why: `hard stop: ${STOPS[st]}` };
    if (s === 'deny' && level === 'allow') { level = 'deny'; why = `hard stop: ${STOPS[st]} (the rules let the pilot decline it only)`; }
  }
  return { level, stops, why };
}

// The stricter of two levels (allow, then deny, then suggest, then ask).
const RANK = { allow: 0, deny: 1, suggest: 2, ask: 3 };
export const stricter = (a, b) => {
  const x = a in RANK ? a : 'ask', y = b in RANK ? b : 'ask';
  return RANK[x] >= RANK[y] ? x : y;
};

// Whether the pilot may give this answer to this item. Returns { ok, why }. floor: a level it may go no further than
// (suggest while the person is busy there, #942); the stricter of that and these rules counts. ownRun: as ruleFor.
export function mayAnswer(rules, item, answer, floor, ownRun) {
  const k = KINDS[item.kind];
  if (!k) return { ok: false, why: `Unknown kind ${item.kind}.` };
  if (!k.answers.includes(answer)) return { ok: false, why: `"${answer}" is not an answer to ${item.kind}; use one of: ${k.answers.join(', ')}.` };
  let { level, why } = ruleFor(rules, item, ownRun);
  if (floor && stricter(floor, level) !== level) { level = stricter(floor, level); why = `held back to ${level} for now`; }
  if (level === 'allow') return { ok: true, why };
  if (level === 'deny') return answer === k.decline ? { ok: true, why } : { ok: false, why: `${why}: the pilot may only answer ${k.decline}. It stays with the person.` };
  if (level === 'suggest') return { ok: false, why: `${why}: the pilot only suggests an answer for it (pilot_suggest), and the person picks.` };
  return { ok: false, why: `${why}: it stays with the person.` };
}
// Whether the pilot may suggest this answer for this item (#917): only where the rules say suggest. Returns { ok, why }.
export function maySuggest(rules, item, answer, floor, ownRun) {
  const k = KINDS[item.kind];
  if (!k) return { ok: false, why: `Unknown kind ${item.kind}.` };
  if (!k.answers.includes(answer)) return { ok: false, why: `"${answer}" is not an answer to ${item.kind}; use one of: ${k.answers.join(', ')}.` };
  let { level, why } = ruleFor(rules, item, ownRun);
  if (floor) level = stricter(floor, level);
  if (level === 'suggest') return { ok: true, why };
  return { ok: false, why: level === 'ask' ? `${why}: it stays with the person, with no suggestion.` : `The rules say ${level} for it: answer it with pilot_answer instead.` };
}

// One answer the pilot gave, or tried to, as a line in its log.
// run: the pilot run that answered (#881), its session id. suggest: the run only suggested this answer (#917).
export const logLine = ({ at = Date.now(), item, answer, ok, why, run, suggest }) => ({
  at, id: item.id, kind: item.kind, desk: item.desk, session: item.session || null, title: item.title || '', what: item.what || '', answer, ok, why,
  ...(run ? { run } : {}), ...(suggest ? { suggest: true } : {}),
});
// A run starting or ending, as a line in the pilot's log (#881): kind run, answer started or ended, what says why.
// desk: the desk whose items the run judges, and the desk it runs on (#914, #973).
export const runLine = ({ at = Date.now(), run, desk, answer, what = '', brand, gear }) => ({ at, kind: 'run', run, ...(desk ? { desk } : {}),
  answer, what, ok: true, ...(brand ? { brand, gear } : {}) });

// ---------- runs (#881, one per desk since #914) ----------
// The pilot keeps no long conversation: it works in short runs. When something it may act on comes in, Docket waits a
// short delay so items close together go in one batch, then starts a fresh session for them. Each run is for one
// desk's items only: a batch with items from several desks becomes one run per desk, and each desk has at most one run
// at a time; what arrives during a desk's run goes to that desk's next. The run answers what it can and ends, and is
// archived after a week. What the pilot must remember lives in files each run reads: the rules, the log and the
// desk's pilot notes, each run given only its own desk's.

// What to do next, from what waits now. items: waitingOnPerson's list (may: allow | deny | ask). offered: ids a run
// was already given (or saw in pilot_pending), never offered again. running: a run is going. since: when the
// first item of the next batch was seen (null: none yet). Returns { act: 'idle' } (nothing for the pilot),
// { act: 'busy', items } (they wait for the run going now to end), { act: 'wait', ms } (the batch is still filling:
// since starts now when it was null) or { act: 'start', items } (start a run with these).
export function runStep({ items = [], offered = new Set(), running = false, since = null, now = Date.now(), delay = 10000 }) {
  const fresh = items.filter((i) => i.may !== 'ask' && !offered.has(i.id));
  if (!fresh.length) return { act: 'idle' };
  if (running) return { act: 'busy', items: fresh };
  if (since === null) return { act: 'wait', ms: delay };
  if (now - since < delay) return { act: 'wait', ms: delay - (now - since) };
  return { act: 'start', items: fresh };
}
// runStep for each desk with something fresh (#914): one batch, and one run at a time, per desk. going: the desks with a
// run going (or starting). since: desk -> when its batch began. Returns [{ desk, act, items | ms }], in the order the
// desks' items came.
export function runSteps({ items = [], offered = new Set(), going = new Set(), since = new Map(), now = Date.now(), delay = 10000 }) {
  const desks = [...new Set(items.filter((i) => i.may !== 'ask' && !offered.has(i.id)).map((i) => i.desk))];
  return desks.map((desk) => ({ desk, ...runStep({ items: items.filter((i) => i.desk === desk), offered, running: going.has(desk),
    since: since.has(desk) ? since.get(desk) : null, now, delay }) }));
}

// Whether a run is done: its session ended or is gone, or its turn finished with nothing left (nothing asked of the
// person, no job still running). s: the live session, or null; tasks: its jobs still running; at: when the run
// started. Returns '' while it is still working, else why it ended.
export function runDone(s, { tasks = 0, maxMs = 30 * 60000, now = Date.now(), at = now } = {}) {
  if (!s || s.status === 'ended') return 'its session ended';
  if (now - at > maxMs) return `it ran more than ${Math.round(maxMs / 60000)} minutes`;
  const turned = (s.events || []).some((e) => e.k === 'result');
  if (turned && s.status === 'idle' && !s.pendingAsks?.size && !s.reloading && !tasks) return 'its turn ended';
  return '';
}

// Where a desk's run goes (#914, #973): always a session of that desk, on its default brand (or another it has signed
// in), billed there, on that brand's top gear, since every run judges (a lower gear once made a call the person
// disagreed with). gears: GEARS from gears.mjs, cheapest first.
export const topGear = (brand, gears) => gears[brand].at(-1).key;

// Finished runs stay a week, so the person can read what they did, and are archived after that. sessions:
// state.sessions (a run is marked pilotRun, #914). going: the ids of the runs going now. Returns the ids to archive now.
export const RUN_KEEP_MS = 7 * 24 * 3600000;
export function runsToArchive(sessions, going = [], now = Date.now()) {
  const running = new Set(typeof going === 'string' ? [going] : going || []);
  return Object.entries(sessions || {}).filter(([id, r]) => r && r.pilotRun && !r.archived && !running.has(id)
    && Number.isFinite(r.createdAt) && now - r.createdAt > RUN_KEEP_MS).map(([id]) => id);
}

// What the autopilot is doing, for the quiet animation on the desks' 🤖 and the one in the top bar (indicators): off
// (disabled, or no desk engaged), idle, waking (a batch is filling before a run starts) or working (a run is going).
export function pilotState({ flying, running, filling }) {
  if (!flying) return 'off';
  if (running) return 'working';
  return filling ? 'waking' : 'idle';
}

// ---------- learning first (#917) ----------
// For the judgment kinds the pilot starts by suggesting: a run records the answer it would give (pilot_suggest), the
// card shows it with Accept, and Docket logs the person's own answer beside it. Each run's brief carries those past
// answers. Once the last suggestions for a kind on a desk agree with the person, Docket offers "I got this", which
// lets the pilot answer that kind there; a miss after that ("Not my pick") drops it back to suggest.

// An answer as given: { answer, answers } (answers: a question form's picks, keyed by question text).
// Whether two answers are the same: the same answer, and for a question form the same picks (a multi-select's
// labels in any order).
export function sameAnswer(a, b) {
  if (!a || !b || a.answer !== b.answer) return false;
  if (a.answer !== 'answer') return true;
  const norm = (o) => Object.fromEntries(Object.entries(o && typeof o === 'object' ? o : {})
    .map(([q, v]) => [String(q).trim(), String(v).split(',').map((x) => x.trim()).filter(Boolean).sort().join(', ')]));
  const x = norm(a.answers), y = norm(b.answers), keys = Object.keys(y);
  return keys.length > 0 && keys.length === Object.keys(x).length && keys.every((q) => x[q] === y[q]);
}
// What an answer reads as on a card: "Allow", "New session", or a question form's picks.
const LABELS = { allow: 'Allow', always: 'Always allow', deny: 'Deny', skip: 'Skip the form', new: 'New session', start: 'Start', dismiss: 'Dismiss', continue: 'Continue in new session', send: 'Send', stop: "Don't send", merge: 'Merge' };
export function answerLabel(kind, { answer, answers } = {}) {
  if (answer === 'answer') return Object.values(answers || {}).join(' · ') || 'Answer';
  if (answer === 'here') return kind === 'handoff' ? 'Keep going here' : 'Do it here';
  return LABELS[answer] || String(answer || '');
}

// One line of the learning log: the item, what the pilot suggested (null: none) and what the person answered.
// how: user (the person answered, or pressed Accept), or miss (the person marked an answer the pilot gave as not theirs).
export const learnLine = ({ at = Date.now(), item, suggested = null, user = null, how = 'user' }) => ({
  at, id: item.id, kind: item.kind, desk: item.desk, session: item.session || null, what: item.what || item.title || '',
  suggested: suggested ? { answer: suggested.answer, ...(suggested.answers ? { answers: suggested.answers } : {}) } : null,
  user: user ? { answer: user.answer, ...(user.answers ? { answers: user.answers } : {}) } : null,
  match: how === 'miss' ? false : suggested && user ? sameAnswer(suggested, user) : null, how,
});

// What the person's past sessions say about a kind on a desk (#920, pilot-history.mjs): lines with source: history,
// which have no suggestion to compare (match: null), so they never count as matches. When at least min of them give
// the same answer at least rate of the time, they lean that way. A question form's picks differ question by question,
// so its history only goes in the brief. Returns { answer, agree, total } or null.
export const HISTORY = { min: 10, rate: 0.9, n: 3 };
export function historyLean(lines, desk, kind, h = HISTORY) {
  if (kind === 'question') return null;
  const past = (lines || []).filter((l) => l.source === 'history' && l.desk === desk && l.kind === kind && l.user?.answer);
  if (past.length < h.min) return null;
  const counts = {};
  for (const l of past) counts[l.user.answer] = (counts[l.user.answer] || 0) + 1;
  const [answer, agree] = Object.entries(counts).sort((a, b) => b[1] - a[1])[0];
  return agree / past.length >= h.rate ? { answer, agree, total: past.length } : null;
}
// How sure the pilot can be of a kind on a desk: of the last n lines with a suggestion to compare (oldest first in
// lines), how many matched. ready: at least need of them, at least rate matched, and the last recent all matched, so a
// miss holds it back until the person has seen it right again. need is n, or h.n (never below recent) when the
// person's past sessions lean one way and every live answer so far gave that same answer: history can shorten the
// wait, but only live matches make it ready.
export const LEARN = { n: 10, rate: 0.9, recent: 3 };
// Train on a kind on a desk from its Autopilot tab (#974, #1004) starts its count over: only the lines after the
// last reset line (how: reset) count.
export const resetLine = ({ at = Date.now(), desk, kind }) => ({ at, desk, kind, how: 'reset', match: null });
// Suggest on a kind that answers (#1004) only pauses it: its count is kept, and a hold line lets Answer be picked again
// until a reset or a miss comes after it (held).
export const holdLine = ({ at = Date.now(), desk, kind }) => ({ at, desk, kind, how: 'hold', match: null });
const held = (lines, desk, kind) => (lines || []).findLast((l) => l.desk === desk && l.kind === kind && ['hold', 'reset', 'miss'].includes(l.how))?.how === 'hold';
const sinceReset = (lines, desk, kind) => {
  const mine = (lines || []).filter((l) => l.desk === desk && l.kind === kind);
  const i = mine.findLastIndex((l) => l.how === 'reset');
  return i < 0 ? mine : mine.slice(i + 1);
};
export function confidence(lines, desk, kind, o = LEARN, h = HISTORY) {
  const last = sinceReset(lines, desk, kind).filter((l) => typeof l.match === 'boolean').slice(-o.n);
  const matched = last.filter((l) => l.match).length;
  const lean = historyLean(lines, desk, kind, h);
  const need = lean && last.length && last.every((l) => l.user?.answer === lean.answer) ? Math.max(o.recent, h.n, 1) : o.n;
  const ready = last.length >= need && matched / last.length >= o.rate && last.slice(-o.recent).every((l) => l.match);
  return { ready, matched, total: last.length, need, history: lean ? lean.total : 0 };
}
// The kinds on desks the pilot may now offer to take over: where the rules say suggest and it is ready.
// Returns [{ desk, kind, matched, total, history }]
// (history: how many past answers shortened the wait, 0 when none did).
export function promotable(lines, rules, o = LEARN) {
  const r = cleanRules(rules), seen = new Set(), out = [];
  for (const l of lines || []) {
    const key = `${l.desk}\n${l.kind}`;
    if (seen.has(key) || !SUGGESTS.has(l.kind)) continue;
    seen.add(key);
    if ((r.desks[l.desk]?.kinds[l.kind] || r.kinds[l.kind]) !== 'suggest') continue;
    const c = confidence(lines, l.desk, l.kind, o);
    if (c.ready) out.push({ desk: l.desk, kind: l.kind, matched: c.matched, total: c.total, history: c.need < o.n ? c.history : 0 });
  }
  return out;
}
// The rules file's object with one desk's level for one kind set: allow when the person says "I got this", suggest
// again after a miss. Everything else in it is kept as it was.
export function setDeskLevel(raw, desk, kind, level) {
  const r = raw && typeof raw === 'object' ? JSON.parse(JSON.stringify(raw)) : JSON.parse(JSON.stringify(DEFAULT_RULES));
  r.desks = r.desks && typeof r.desks === 'object' ? r.desks : {};
  const d = r.desks[desk] = r.desks[desk] && typeof r.desks[desk] === 'object' ? r.desks[desk] : {};
  d.kinds = { ...(d.kinds || {}), [kind]: level };
  return r;
}
// The person's own past answers for the kinds and desks of these items, for a run's brief: the live ones newest first,
// at most n of each, then at most nHistory from their past sessions (#920), the most like these items first, marked
// as such. Permission prompts are included where the run is to suggest for them. deskName: id -> its name.
// Returns lines of text.
const words = (t) => new Set(String(t || '').toLowerCase().match(/[a-z0-9_#.-]{3,}/g) || []);
export function pastAnswers(lines, items, deskName = (d) => d, n = 6, nHistory = 4) {
  const out = [];
  const asked = items.filter((i) => JUDGMENT.includes(i.kind) || (i.kind === 'permission' && i.may === 'suggest'));
  for (const key of new Set(asked.map((i) => `${i.desk}\n${i.kind}`))) {
    const [desk, kind] = key.split('\n');
    const these = asked.filter((i) => i.desk === desk && i.kind === kind);
    const mine = (lines || []).filter((l) => l.desk === desk && l.kind === kind && (l.user || l.how === 'miss'));
    const line = (l, them, you = '') => `- ${new Date(l.at).toISOString().slice(0, 10)} ${kind} on ${deskName(desk)}${l.source === 'history' ? ' (past session)' : ''}: "${String(l.what).slice(0, 100)}": ${them}${you}`;
    for (const l of mine.filter((x) => x.source !== 'history').slice(-n).reverse()) {
      const them = l.how === 'miss' ? `the pilot answered ${answerLabel(kind, l.suggested)} and the user marked it as not their pick` : `the user picked ${answerLabel(kind, l.user)}`;
      out.push(line(l, them, l.how === 'miss' || !l.suggested ? '' : ` (you suggested ${answerLabel(kind, l.suggested)}: ${l.match ? 'matched' : 'missed'})`));
    }
    const want = words(these.map((i) => i.what).join(' ')), tools = new Set(these.map((i) => i.tool).filter(Boolean));
    const score = (l) => (l.tool && tools.has(l.tool) ? 3 : 0) + [...words(l.what)].filter((w) => want.has(w)).length;
    const past = mine.filter((x) => x.source === 'history').map((l, i) => ({ l, s: score(l), i })).sort((a, b) => b.s - a.s || b.i - a.i).slice(0, nHistory);
    for (const { l } of past) out.push(line(l, `the user picked ${answerLabel(kind, l.user)}`));
  }
  return out;
}

// ---------- a desk's Autopilot tab (#974) ----------
// What it handles there: one row per kind it learns, with the level the rules give it on that desk (allow: it answers;
// suggest: it is learning; anything else: it leaves it to the person), how far it has got, and whether Answer has been
// earned (ready). Returns [{ kind, level, matched, total, need, ready }].
export function deskKinds(rules, lines, desk, o = LEARN) {
  const r = cleanRules(rules), d = r.desks[desk] || { kinds: {} };
  return LEARNS.map((kind) => {
    const level = d.kinds[kind] || r.kinds[kind], c = confidence(lines, desk, kind, o);
    return { kind, level, matched: c.matched, total: c.total, need: c.need, ready: c.ready, held: level !== 'allow' && held(lines, desk, kind) };
  });
}
// Choosing Suggest, Answer or Train for a kind on a desk, from its tab: Answer once earned (the same as "I got this"),
// when it answers already, or when Suggest only paused it (held); Suggest and Train from anything. Returns the error,
// or ''.
export function kindChoiceRefusal(row, level) {
  if (!row) return 'The autopilot does not learn that kind.';
  if (level !== 'allow' && level !== 'suggest' && level !== 'train') return 'Pick Suggest, Answer or Train.';
  if (level === 'allow' && row.level !== 'allow' && !row.ready && !row.held) return `The autopilot has not earned that yet: ${row.matched} of the last ${row.total} matched, and it needs ${row.need}.`;
  return '';
}
// The offer to engage (#974): the desks not engaged where something has waited at least ms that the pilot could take
// (its rules do not keep it with the person). items: waitingOnPerson's list; seen: id -> when it was first seen;
// engaged: desk -> since. Returns [{ desk, count }], most waiting first.
export const OFFER_MS = 10 * 60000;
export function offerDesks(items, seen, engaged = {}, now = Date.now(), ms = OFFER_MS) {
  const n = {};
  for (const i of items || []) {
    if (!i.desk || Object.hasOwn(engaged, i.desk) || i.may === 'ask' || now - (seen.get(i.id) ?? now) < ms) continue;
    n[i.desk] = (n[i.desk] || 0) + 1;
  }
  return Object.entries(n).map(([desk, count]) => ({ desk, count })).sort((a, b) => b.count - a.count);
}
// A desk's runs by day, newest first: [{ day: 'YYYY-MM-DD', cost, runs }], each day's cost the sum of its runs'.
// runs: [{ at, cost, ... }]. day: a time's local day.
export function runsByDay(runs, day = (t) => { const d = new Date(t); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; }) {
  const out = new Map();
  for (const r of [...(runs || [])].sort((a, b) => b.at - a.at)) {
    const k = day(r.at), d = out.get(k) || out.set(k, { day: k, cost: 0, runs: [] }).get(k);
    d.cost = Math.round((d.cost + (r.cost || 0)) * 1e4) / 1e4; d.runs.push(r);
  }
  return [...out.values()];
}

// ---------- one desk's run, kept apart from every other desk (#914) ----------
// Only what belongs to desk: a run is given its own desk's items, log lines and learning lines, never another desk's.
// The open cards (proposals, handoffs) and sign-in needs that wait on the person, from sessions not archived (#984):
// an archived session's row shows nothing, so a card left open in it is nothing anyone can answer, and it must not
// count toward the offer to engage or a run. archived(desk, sessionId) says which sessions are archived.
export function openWaiting({ proposals = [], handoffs = [], sessions = {}, archived = () => false }) {
  const shown = (desk, id) => !id || !archived(desk, id);
  return {
    proposals: proposals.filter((p) => p.ev.state === 'open' && shown(p.client, p.parentId)),
    handoffs: handoffs.filter((h) => h.ev.state === 'open' && shown(h.client, h.sessionId)),
    signins: Object.entries(sessions).filter(([id, rec]) => rec?.needsSignin && rec.client && shown(rec.client, id)),
  };
}
export const ofDesk = (list, desk) => (list || []).filter((x) => x && x.desk === desk);
const cut = (s, n) => { const t = String(s ?? ''); return t.length > n ? t.slice(0, n - 1) + '…' : t; };

// The brief a run starts with (#881): what to do in this one turn, the items it was started for, and what it must
// remember, every part of it the one desk's (whatever else is passed in is left out here). The shared log files are
// not named, so a run has no path to the other desks' lines. b: { desk, deskName, items, notes, notesFile, log (the
// pilot log, newest first), learn (the learning log), rulesFile, screen (screen control is on for the desk) }.
export function runBrief(b) {
  const desk = b.desk, name = b.deskName || desk, items = ofDesk(b.items, desk);
  const when = (t) => new Date(t).toISOString().slice(0, 16).replace('T', ' ');
  const last = ofDesk(b.log, desk).filter((l) => l.kind !== 'run').slice(0, 12)
    .map((l) => `- ${when(l.at)} ${l.kind}: ${l.answer}${l.ok ? '' : ` (refused: ${cut(l.why, 80)})`} - ${cut(l.what || l.title, 80)}`);
  const past = pastAnswers(ofDesk(b.learn, desk), items, () => name);
  return `You are Docket's autopilot on this computer, in one short run for the desk ${name}. This run is a session of ${name}, on its own sign-in, and its cost is billed there. It sees and answers ${name}'s items only, and everything below is ${name}'s alone: never look for another desk's sessions, files or notes. Docket started this session for the items below and ends it as soon as your turn ends, so do it all in this one turn, then stop. The next run is a fresh session: it knows only your notes and the log.

1. Call mcp__portal__pilot_pending for the list as it is now (it may have changed since).
2. Answer with mcp__portal__pilot_answer only what it marks may: allow (or decline what it marks deny). Leave everything marked ask for the user, including anything a pilot run raised itself. Docket checks its rules again on every answer.
3. For what it marks may: suggest, do not answer: you are still learning how the user answers those. Call mcp__portal__pilot_suggest with the answer you would give (for a question form, the option for each question) and a few words of why. The user sees it on the card and picks. Base it on the user's own past answers below, more than on your own taste.
${b.screen ? '' : "Screen control is off for this desk, and you never turn it on yourself. When a job needs the screen, say so in your reply: the user turns it on for this desk in ☰ > Desks.\n"}4. When the next run for ${name} should know something (a short to-do, or how the user wants a kind of thing answered), add it with mcp__portal__pilot_notes. Keep the notes short.

End with a line or two: what you answered, what you suggested, and what you left for the user.

Items this run was started for:
${items.map((i) => `- ${i.id} (${i.kind}: ${cut(i.what, 100)}; may: ${i.may})`).join('\n')}

Your notes for ${name} (${b.notesFile}):
${String(b.notes || '').trim() || '(none yet)'}

Your last answers on ${name}:
${last.join('\n') || '(none yet)'}

The user's own past answers on ${name} to items like these. Those marked (past session) were read from their sessions before the autopilot watched; when they disagree with the newer ones, go with the newer:
${past.join('\n') || '(none yet)'}

The rules (allow, deny or ask, per kind and per desk) are in ${b.rulesFile}; only the user changes them.`;
}
