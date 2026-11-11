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

// Safe defaults: the pilot answers permission prompts and question forms, and New session / Do it here; every other
// kind waits for the person. Every hard stop waits for the person.
export const DEFAULT_RULES = {
  kinds: { permission: 'allow', question: 'allow', plan: 'ask', offer: 'allow', card: 'ask', handoff: 'ask', inbox: 'ask', cross: 'ask', merge: 'ask', signin: 'ask', remote: 'ask' },
  stops: Object.fromEntries(Object.keys(STOPS).map((k) => [k, 'ask'])),
  desks: {},
};
const LEVELS = new Set(['allow', 'deny', 'ask']);

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

// The autopilot's own desk (#875): the pilot is a desk of its own, so its judgment, bill, sign-ins and files are
// that desk's and no working desk's. What waits on that desk stays with the person, so the pilot never approves itself.
export const OWN_DESK = "on the autopilot's own desk";
export const PILOT_DESK_NAME = 'Autopilot';

// The desk entry Docket makes the first time the switch goes on, filled in the way ☰ > Desks > Add a desk fills a new
// one: working folder <claude root>\<Name>, Claude home <claude root>\<Name>\claude-home (made empty), Grok home
// <grok root>\<Name>, Grok as the brand its sessions start on. roots: the server's homeRoots(). clients: the desks
// there are now; a name or folder one of them uses is passed over for Autopilot 2, 3 and so on.
export function pilotDeskEntry(roots, clients = []) {
  const sep = roots.sep || '\\';
  const norm = (p) => String(p || '').replace(/[\\/]+/g, '/').replace(/\/$/, '').toLowerCase();
  const inside = (p) => norm(p) === norm(roots.docket) || norm(p).startsWith(norm(roots.docket) + '/');
  const names = new Set(clients.map((c) => String(c.name || '').trim().toLowerCase()));
  const used = new Set(clients.flatMap((c) => [c.home, c.grokHome, c.codexHome, c.folder]).filter(Boolean).map(norm));
  for (let n = 1; ; n++) {
    const name = n === 1 ? PILOT_DESK_NAME : `${PILOT_DESK_NAME} ${n}`;
    // Never inside Docket's own folder (it holds the sign-in): <Name>-desk then, as Add a desk does.
    const at = (root, ...rest) => { const p = [root, name, ...rest].join(sep); return inside(p) ? [root, `${name}-desk`, ...rest].join(sep) : p; };
    const e = { name, folder: at(roots.claude), home: at(roots.claude, 'claude-home'), grokHome: at(roots.grok || [roots.claude, 'grok_home'].join(sep)), defaultEngine: 'grok' };
    if (!names.has(name.toLowerCase()) && ![e.folder, e.home, e.grokHome].some((p) => used.has(norm(p)))) return e;
  }
}

// Why this session may not be the pilot, or '' when it may: only a session of the autopilot's desk can be.
// session: { id, desk, deskName } (desk: its desk id). pilotDesk: { id, name }, or null when none is set yet.
export function pilotSessionRefusal(session, pilotDesk) {
  if (!session) return '';
  if (!pilotDesk) return "The autopilot has no desk yet. Turn it on once, and Docket makes the Autopilot desk and starts the pilot there, or pick a desk and Save desk first.";
  if (session.desk !== pilotDesk.id) return `That session is on the desk ${session.deskName || session.desk || '(unknown)'}. The pilot must be a session of the autopilot's own desk, ${pilotDesk.name}, so that its sign-ins, bill, memory and files are that desk's and not a working desk's. Start one on ${pilotDesk.name}, or bind another desk as the autopilot's.`;
  return '';
}

// The level the rules give an item: its desk's rule for its kind over the general one, then any hard stop it hits
// that the rules do not name as allow or deny pulls it back to ask. Returns { level, stops, why }.
// pilotDesk: the autopilot's own desk id; what waits there stays with the person, whatever the rules say.
export function ruleFor(rules, item, pilotDesk) {
  if (pilotDesk && item.desk === pilotDesk && !item.there) return { level: 'ask', stops: itemStops(item), why: OWN_DESK };
  const r = cleanRules(rules), desk = r.desks[item.desk] || { kinds: {}, stops: {} };
  const kind = desk.kinds[item.kind] || r.kinds[item.kind] || 'ask';
  const stops = itemStops(item);
  let level = kind, why = `the rules say ${kind} for ${item.kind}`;
  for (const st of stops) {
    const s = desk.stops[st] || r.stops[st];
    // A hard stop only lets the pilot in as far as the rules name it: allow lets the kind's rule stand, deny lets
    // it decline at most, and anything else (ask, or not named) keeps it with the person.
    if (s === 'ask' || !s) return { level: 'ask', stops, why: `hard stop: ${STOPS[st]}` };
    if (s === 'deny' && level === 'allow') { level = 'deny'; why = `hard stop: ${STOPS[st]} (the rules let the pilot decline it only)`; }
  }
  return { level, stops, why };
}

// The stricter of two levels (allow, then deny, then ask).
const RANK = { allow: 0, deny: 1, ask: 2 };
export const stricter = (a, b) => {
  const x = a in RANK ? a : 'ask', y = b in RANK ? b : 'ask';
  return RANK[x] >= RANK[y] ? x : y;
};

// Whether the pilot may give this answer to this item. Returns { ok, why }. floor: the level another computer's
// rules gave it (an item on a remote desk, #827); the stricter of that and these rules counts. pilotDesk: as ruleFor.
export function mayAnswer(rules, item, answer, floor, pilotDesk) {
  const k = KINDS[item.kind];
  if (!k) return { ok: false, why: `Unknown kind ${item.kind}.` };
  if (!k.answers.includes(answer)) return { ok: false, why: `"${answer}" is not an answer to ${item.kind}; use one of: ${k.answers.join(', ')}.` };
  let { level, why } = ruleFor(rules, item, pilotDesk);
  if (floor && stricter(floor, level) !== level) { level = stricter(floor, level); why = `the rules on the computer with the desk say ${level} for it`; }
  if (level === 'allow') return { ok: true, why };
  if (level === 'deny') return answer === k.decline ? { ok: true, why } : { ok: false, why: `${why}: the pilot may only answer ${k.decline}. It stays with the person.` };
  return { ok: false, why: `${why}: it stays with the person.` };
}

// One answer the pilot gave, or tried to, as a line in its log.
// from: the computer whose pilot answered with a pilot key (#827), when not this one's. run: the pilot run that
// answered (#881), its session id.
export const logLine = ({ at = Date.now(), item, answer, ok, why, from, run }) => ({
  at, id: item.id, kind: item.kind, desk: item.desk, session: item.session || null, title: item.title || '', what: item.what || '', answer, ok, why,
  ...(from ? { from } : {}), ...(run ? { run } : {}),
});
// A run starting or ending, as a line in the pilot's log (#881): kind run, answer started or ended, what says why.
export const runLine = ({ at = Date.now(), run, answer, what = '', brand, gear }) => ({ at, kind: 'run', run, answer, what, ok: true, ...(brand ? { brand, gear } : {}) });

// ---------- runs (#881) ----------
// The pilot keeps no long conversation: it works in short runs. When something it may act on comes in, Docket waits a
// short delay so items close together go in one batch, then starts a fresh session on the autopilot's desk for them.
// The run answers what it can and ends, and is archived. At most one run at a time: what arrives during a run goes to
// the next. What the pilot must remember lives in files each run reads: the rules, the log and the pilot notes.

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

// The pilot's brand and starting gear (☰ > Docket settings > Autopilot). saved: { brand, gear } as kept. gears:
// GEARS from gears.mjs. Default: Claude on its lowest gear, so cheap triage shifts up to the top gear only to judge.
// A gear the brand has no gear by that key for is its lowest. Returns { brand, gear } (gear: a gear key).
export const PILOT_DEFAULT_BRAND = 'claude';
export function pilotSetting(saved, gears) {
  const brand = gears[saved?.brand] ? saved.brand : PILOT_DEFAULT_BRAND;
  const list = gears[brand];
  const gear = list.some((g) => g.key === saved?.gear) ? saved.gear : list[0].key;
  return { brand, gear };
}
// Why this brand and gear can't be saved for the pilot, or '' when they can. offered: [{ brand, signedIn }] the
// brands the autopilot's desk has set up (name: the brand's name, for the message).
export function pilotSettingRefusal({ brand, gear }, offered, gears) {
  if (!gears[brand]) return `${brand} is not a brand Docket knows.`;
  const o = offered.find((x) => x.brand === brand), name = o?.name || brand;
  if (!o) return `The autopilot's desk does not use ${name}. Tick it for that desk in ☰ > Desks first.`;
  if (!o.signedIn) return `The autopilot's desk is not signed in to ${name}. Sign it in beside it in ☰ > Desks first.`;
  if (gear !== undefined && !gears[brand].some((g) => g.key === gear)) return `${gear} is not a gear of ${name}. Its gears: ${gears[brand].map((g) => g.key).join(', ')}.`;
  return '';
}
