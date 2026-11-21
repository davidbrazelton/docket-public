// Talk mode × the autopilot (#1146): which waiting sessions the autopilot is about to take, so "next waiting" passes
// them, and the words for "what did the autopilot do", from its log. No model and nothing touches the page: the app
// (server.mjs) calls both and the page reads out what it gets back. No imports: the page loads this file too
// (GET /talk-pilot.mjs, from talk.mjs) for withPilot.

// The waiting items the autopilot will take now: on a desk where it is engaged and a run is pending or running
// (active: the desks waking or working), and that its rules let it answer itself (allow, or deny: it still gives the
// answer). One it would only suggest, that waits for the person, or that the person is busy with stays theirs.
// items: waitingOnPerson()'s list. Returns the sessions whose every waiting item it takes: those "next" skips.
export function pilotTakes(items = [], { engaged = {}, active = new Set() } = {}) {
  const mine = new Map(); // session -> whether every item there is the pilot's
  for (const i of items) {
    if (!i.session) continue;
    const takes = Object.hasOwn(engaged, i.desk) && active.has(i.desk) && (i.may === 'allow' || i.may === 'deny') && !i.busy;
    mine.set(i.session, (mine.get(i.session) ?? true) && takes);
  }
  return [...mine].filter(([, all]) => all).map(([s]) => s);
}

const NOUNS = { permission: ['permission prompt', 'permission prompts'], question: ['question form', 'question forms'], plan: ['plan', 'plans'],
  offer: ['new-session offer', 'new-session offers'], card: ['suggested session', 'suggested sessions'], handoff: ['handoff', 'handoffs'],
  inbox: ['handed-over item', 'handed-over items'], cross: ['message to another desk', 'messages to other desks'], merge: ['merge', 'merges'],
  signin: ['sign-in', 'sign-ins'], remote: ['remote desk request', 'remote desk requests'] };
const WORDS = ['no', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten'];
const num = (n) => WORDS[n] || String(n);
const count = (n, kind) => `${num(n)} ${(NOUNS[kind] || [kind, kind + 's'])[n === 1 ? 0 : 1]}`;
const listOf = (xs) => (xs.length < 2 ? xs.join('') : `${xs.slice(0, -1).join(', ')} and ${xs.at(-1)}`);
const cap = (s) => s[0].toUpperCase() + s.slice(1);
// What "next waiting" adds when it passed sessions the autopilot is taking: "Two more are with the autopilot."
export const withPilot = (n) => (n > 0 ? `${cap(num(n))} more ${n === 1 ? 'is' : 'are'} with the autopilot.` : '');
const clip = (s, n = 120) => { s = String(s || '').replace(/\s+/g, ' ').trim(); return s.length > n ? s.slice(0, n - 1) + '…' : s; };

// "What did the autopilot do": the pilot log's lines for one desk since a point, as reads aloud. head: what it
// answered, by kind, and what it left for you and in which sessions; rest ("say more"): each item it left, then each
// it answered. lines: the log, any order; waiting: what waits on the person on the desk now and stays with them.
// title(session): a session's title. Returns { head, rest, answered, left, at } (at: the newest line read).
export function pilotReport(lines = [], { desk, deskName = 'this desk', since = 0, engaged = false, waiting = 0, title = () => '' } = {}) {
  const mine = lines.filter((l) => l && l.desk === desk && l.kind !== 'run' && l.at > since).sort((a, b) => a.at - b.at);
  const answered = mine.filter((l) => l.ok && !l.suggest), left = mine.filter((l) => !l.ok || l.suggest);
  const name = (l) => clip(title(l.session) || l.title || 'a session', 60);
  const kinds = (xs) => { const n = new Map(); for (const l of xs) n.set(l.kind, (n.get(l.kind) || 0) + 1); return [...n].map(([k, c]) => count(c, k)); };
  const head = [];
  if (!answered.length && !left.length) head.push(`The autopilot has done nothing on ${deskName} since you last asked.${engaged ? '' : ' It is not engaged there.'}`);
  else {
    head.push(answered.length ? `On ${deskName} the autopilot answered ${listOf(kinds(answered))}.` : `On ${deskName} the autopilot answered nothing.`);
    if (left.length) {
      const where = [...new Set(left.map(name))];
      head.push(`It left ${num(left.length)} for you, in ${listOf(where.slice(0, 3))}${where.length > 3 ? ` and ${num(where.length - 3)} more` : ''}.`);
    }
  }
  if (waiting) head.push(`${waiting === 1 ? 'One item waits' : `${cap(num(waiting))} items wait`} on you there now.`);
  const rest = [
    ...left.map((l) => `Left for you in ${name(l)}: ${clip(l.what)}.${l.suggest ? ` It suggests ${clip(String(l.answer || '').replace(/^suggested /, ''), 80)}.` : l.why ? ` ${cap(clip(l.why, 100))}.` : ''}`),
    // a question form's answer already names its questions ("answered Q1: Which colour?: Red")
    ...answered.map((l) => `Answered in ${name(l)}: ${/^answered /.test(l.answer) ? clip(l.answer.slice(9), 160) : `${clip(l.what)}: ${clip(l.answer, 80)}`}.`),
  ].map((s) => s.replace(/\.\./g, '.').replace(/…\./g, '…'));
  return { head, rest, answered: answered.length, left: left.length, at: mine.at(-1)?.at || since };
}
