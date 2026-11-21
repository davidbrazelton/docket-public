// Queue mode: the rules, kept apart from the server so they can be tested (#1064).
// At most N sessions work at once, with one limit on battery and another plugged in. sendToSession in server.mjs asks
// queueGate when a message would start a turn; a held message waits in state.queue.items until pumpQueue finds a free
// slot. A running turn is never stopped: only the start of a new one waits.

export const QUEUE_DEFAULTS = { on: false, battery: 1, plugged: 6, autoBattery: false }; // battery 1: at 2-3 working on battery the app already lags 0.5-3.5 s (#1068)
const MAX_LIMIT = 50;

const limitOf = (v, d) => { const n = Math.round(Number(v)); return Number.isFinite(n) && n >= 1 ? Math.min(n, MAX_LIMIT) : d; };
// The saved setting, put right: { on, battery, plugged, autoBattery }, each limit a whole number from 1 to 50.
// autoBattery: queue mode is on while on battery whatever `on` says (#1067); `on` stays the person's own setting.
export function queueSettings(v = {}) {
  return { on: !!v?.on, battery: limitOf(v?.battery, QUEUE_DEFAULTS.battery), plugged: limitOf(v?.plugged, QUEUE_DEFAULTS.plugged), autoBattery: !!v?.autoBattery };
}

// Whether queue mode is on now: the person's setting, or on battery with "turn on automatically on battery".
export const queueOnNow = (cfg, onBattery = null) => { const c = queueSettings(cfg); return c.on || (c.autoBattery && onBattery === true); };

// How many may work at once now: Infinity while queue mode is off. onBattery null (not known yet) counts as plugged in.
// cap: a lower limit the load monitor sets while the computer is under strain (queueLoad in server.mjs), or none.
export function queueLimit(cfg, { onBattery = null, cap = null } = {}) {
  const c = queueSettings(cfg);
  if (!queueOnNow(c, onBattery)) return Infinity;
  const n = onBattery ? c.battery : c.plugged;
  return cap >= 1 ? Math.min(n, Math.round(cap)) : n;
}

// A session holds a slot only while its turn is really working. Waiting on the person (a permission prompt, a question
// form: status requires_action), on a wait_until call (inWait), or between turns while its children work (idle) holds
// none, so a parent and the child it waits on can never block each other. Background commands left running after the
// turn ended (heldTurn) hold none either: a test server would otherwise keep a slot all day.
export const holdsSlot = (s) => s.status === 'running' && !s.inWait && !s.resting;

// Whether a message to this session would start a new turn. One that is working, or waiting on the person mid-turn,
// takes the message into the turn it already has, so it goes straight through.
export const startsTurn = (s) => !!s.resting || !['running', 'requires_action'].includes(s.status);

// Priority: 0 what the person typed (or pressed) or the session open on a page, 1 a session marked "always run",
// 2 everything else. Within a rank, first in, first out.
export const itemRank = (item, { isOpen = () => false, isAlways = () => false } = {}) =>
  item.person || isOpen(item.id) ? 0 : isAlways(item.id) ? 1 : 2;

// The queued sessions in the order they will start: each session once, at its best rank and earliest message.
export function queueOrder(items, opts = {}) {
  const by = new Map();
  for (const it of items) {
    const r = itemRank(it, opts), cur = by.get(it.id);
    if (!cur) by.set(it.id, { id: it.id, client: it.client, rank: r, at: it.at });
    else { cur.rank = Math.min(cur.rank, r); cur.at = Math.min(cur.at, it.at); }
  }
  return [...by.values()].sort((a, b) => a.rank - b.rank || a.at - b.at);
}

// Each queued session's place in line, from 1: the row's "queued #k".
export const queuePositions = (items, opts = {}) => new Map(queueOrder(items, opts).map((x, i) => [x.id, i + 1]));

// Should this message wait? Only when queue mode is on and it would start a turn. A session that already has messages
// waiting queues the new one behind them, so its messages keep their order; pumpQueue then decides at once whether a
// slot is free, in priority order, so a message that can start now does.
export function queueGate({ limit, session, waiting = false }) {
  if (limit === Infinity) return waiting ? 'queue' : 'send'; // turned off with some still queued: they go first, in order
  if (!startsTurn(session)) return 'send';
  return 'queue';
}

// Which queued sessions to start now. sessions: id -> live session (or missing when it is not live: it is started
// again to take its message, so it needs a slot). A queued session that started a turn by itself meanwhile (a
// background command ended) gets its messages at once without taking a slot, since it is working anyway.
export function nextToStart(items, { limit, sessions = new Map(), paused = false, isOpen, isAlways } = {}) {
  if (paused || !items.length) return [];
  let free = limit - [...sessions.values()].filter(holdsSlot).length;
  const out = [];
  for (const x of queueOrder(items, { isOpen, isAlways })) {
    const s = sessions.get(x.id);
    if (s && !startsTurn(s)) { out.push(x.id); continue; }
    if (free <= 0) continue;
    out.push(x.id); free--;
  }
  return out;
}

// One message to queue: what sendToSession was given, with who it is for and when it came.
export function queueItem(s, msg, at = Date.now()) {
  const { text = '', attachments = [], context = '', system = false, from = '', byPerson = false, report = false, news = '', reported = [] } = msg;
  return { id: s.id, client: s.client, at, person: (!system && !from) || !!byPerson, text, attachments, context, system, from, byPerson, report, news, reported };
}

// The note in the chat when a message waits, and the line the row's tag explains.
export const queuedNote = ({ working, limit, onBattery }) =>
  `Queued: ${working} session${working === 1 ? '' : 's'} working, the most queue mode allows ${onBattery ? 'on battery' : 'plugged in'} (${limit}). It starts when one finishes. Change the limits in ☰ > Docket settings > Queue mode`;
