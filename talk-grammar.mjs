// Talk mode's words (#1105): what a heard sentence asks for, which desk or session a spoken name means, what to read
// aloud from a reply, and the words that prime the speech model. Nothing here touches the page or the microphone.
// No imports: the page loads this file too (GET /talk-grammar.mjs, from talk.mjs), so the rules are the ones tested here.

const NUMBERS = { zero: 0, one: 1, two: 2, to: 2, too: 2, three: 3, four: 4, for: 4, five: 5, six: 6, seven: 7, eight: 8, ate: 8, nine: 9, ten: 10,
  eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19, twenty: 20,
  thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90 };

// Lower case, punctuation gone, number words as digits, and "Q 7", "queue seven" or "cue 7" as q7.
export function normalize(text) {
  let t = ` ${String(text || '').toLowerCase().replace(/[’']/g, '').replace(/[^a-z0-9]+/g, ' ')} `;
  t = t.replace(/ (twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety) (one|two|three|four|five|six|seven|eight|nine) /g,
    (m, a, b) => ` ${NUMBERS[a] + NUMBERS[b]} `);
  const qWord = '(?:q|queue|cue|kyu|que|question)';
  t = t.replace(new RegExp(` ${qWord} ?(\\d+|${Object.keys(NUMBERS).join('|')}) `, 'g'), (m, n) => ` q${/\d/.test(n) ? n : NUMBERS[n]} `);
  t = t.replace(new RegExp(` ${qWord} ?(\\d+|${Object.keys(NUMBERS).join('|')}) `, 'g'), (m, n) => ` q${/\d/.test(n) ? n : NUMBERS[n]} `);
  return t.replace(/\s+/g, ' ').trim();
}

// The words the speech model may mishear for a command word, read as the command word.
const SOUNDS_LIKE = [[/^(?:sent|sand|cent|scent)$/, 'send'], [/^(?:merch|merged|merj)$/, 'merge'], [/^(?:reed|red)$/, 'read']];
const fixWord = (w) => { for (const [re, to] of SOUNDS_LIKE) if (re.test(w)) return to; return w; };

const YES = /^(?:yes|yeah|yep|yup|sure|ok|okay|confirm|confirmed|do it|go ahead|send|send it|yes send|yes send it|yes please|please do|correct|right)$/;
const NO = /^(?:no|nope|cancel|cancel that|cancel it|never mind|nevermind|forget it|dont|do not|abort|scratch that|clear|clear it)$/;

// The text after a dictation word, taken from what was heard (its own capitals and punctuation), not the normalized form.
function after(raw, words) {
  const re = new RegExp(`^\\W*(?:${words})\\b[\\s,:;.-]*`, 'i');
  const m = String(raw).match(re);
  if (!m) return '';
  const rest = String(raw).slice(m[0].length).trim();
  return rest ? rest[0].toUpperCase() + rest.slice(1) : '';
}
const DICTATE = 'tell (?:it|them|him|her|the session|claude)(?: that)?|reply(?: with)?|respond(?: with)?|answer(?: with)?|say|dictate|message|write';

// What a heard sentence asks for. ctx.pending: something waits on a spoken yes or cancel, so those words answer it
// first. Returns { kind, ... } (kind 'none' when it is not a command), with risky set on what needs a yes first.
export function parse(raw, ctx = {}) {
  const t = normalize(raw).split(' ').map(fixWord).join(' ');
  if (!t) return { kind: 'none', heard: '' };
  if (ctx.pending && YES.test(t)) return { kind: 'yes' };
  if (ctx.pending && NO.test(t)) return { kind: 'cancel' };
  let m;
  if (/^(?:stop|skip|quiet|hush|be quiet|shut up|stop reading|stop talking|enough|thats enough)$/.test(t)) return { kind: 'stop' };
  if (/^(?:stop|interrupt|halt|abort) (?:the |this )?(?:session|turn|work|it now)$|^interrupt(?: it)?$/.test(t)) return { kind: 'interrupt', risky: true };
  // On request (#1190): what talk mode heard (or the message waiting on send), and the replies not read aloud yet.
  if (/^(?:read back|readback|read it back|read that back|read back what (?:i said|you heard)|what did you hear|what did i say|say that again)$/.test(t)) return { kind: 'readBack' };
  if (/^(?:read unread|read the unread|read (?:the )?unread (?:ones|replies)|catch me up|catch up|read what i missed)$/.test(t)) return { kind: 'unread' };
  if (/^(?:read|read it|read that|read this|read the (?:reply|answer|last reply)|read again|read it again|read that again|repeat|repeat that|again|what did it say)$/.test(t)) return { kind: 'read' };
  // Dictation next: "tell it to merge" is a message, not a merge.
  const said = after(raw, DICTATE);
  if (new RegExp(`^(?:${DICTATE})\\b`).test(t) && said) return { kind: 'dictate', text: said };
  if ((m = t.match(/^q(\d+)(?: (.+))?$/))) {
    if (!m[2]) return { kind: 'none', heard: raw };
    // The answer as heard: as many of the last words heard as the answer has once normalized.
    const heardWords = String(raw).trim().split(/\s+/).filter((w) => /[a-z0-9]/i.test(w));
    return { kind: 'answer', n: Number(m[1]), text: heardWords.slice(-m[2].split(' ').length).join(' ') || m[2] };
  }
  // The autopilot (#1146): engaged or disengaged on a desk (the open one when none is named), and its report.
  const ap = t.replace(/\bauto pilot\b/g, 'autopilot'), AP = '(?:the )?autopilot';
  if (new RegExp(`^(?:what (?:did|has|have) ${AP} (?:do|done|answer|answered|been doing)(?: .*)?|${AP} (?:report|summary)|what did ${AP} do)$`).test(ap)) return { kind: 'pilotReport' };
  if ((m = ap.match(new RegExp(`^(?:(?:turn|switch|put) (on|off) ${AP}|(?:turn|switch|put) ${AP} (on|off)|(engage|disengage|enable|disable|start|stop) ${AP}|${AP} (on|off|engage|disengage|engaged|disengaged))(?: (?:(?:for|on|in|at) )?(?:the )?(.+?))?$`)))) {
    const on = /^(?:on|engage|engaged|enable|start)$/.test(m[1] || m[2] || m[3] || m[4]);
    const desk = (m[5] || '').replace(/ desk$/, '').trim();
    return { kind: 'pilot', on, desk: /^(?:this|here|this one|current|open)$/.test(desk) ? '' : desk, risky: true };
  }
  if (/^(?:send|send it|send that|send the message|send message)$/.test(t)) return { kind: 'send' };
  if (/^(?:cancel|cancel that|cancel it|never mind|nevermind|clear(?: (?:it|that|the box))?|scratch that|forget it)$/.test(t)) return { kind: 'cancel' };
  if (/^(?:merge|merge it|merge that|merge the (?:pull request|pr|branch)|please merge|go ahead and merge)$/.test(t)) return { kind: 'merge', risky: true };
  if (/^(?:archive|close) (?:this|it|this one|this session|the session|that one|that)$|^archive$/.test(t)) return { kind: 'archive', risky: true };
  if (/^(?:more|read more|go on|keep going|continue|continue reading|keep reading|and then|whats next|the rest|read the rest)$/.test(t)) return { kind: 'more' };
  if (/^(?:next|next waiting|next one waiting|next session|next session waiting(?: on me)?|next one|whats waiting|what is waiting|whats next waiting|waiting on me|next on me)$/.test(t)) return { kind: 'next' };
  if ((m = t.match(/^(?:scroll |page |go |go to the |go to |jump to (?:the )?|to the )?(up|down|top|bottom|start|end|beginning)(?: of (?:the )?(?:chat|page|session))?$/))
    && (m[1] === 'top' || m[1] === 'bottom' || m[1] === 'start' || m[1] === 'end' || m[1] === 'beginning' || /^(?:scroll|page)/.test(t))) {
    return { kind: 'scroll', dir: { start: 'top', beginning: 'top', end: 'bottom' }[m[1]] || m[1] };
  }
  if ((m = t.match(/^(?:start (?:a )?)?new session(?: (.*))?$/))) {
    let rest = m[1] || ''; const cs = (raw.match(/\b(?:called|named|titled)\b[\s,:]*(.*)$/i) || [])[1] || '';
    // "in the X group" (#1145), taken out first so the desk is what is left
    const groupM = rest.match(/(?:^| )(?:in|on|for|under) (?:the )?(.+?) group(?= called| named| titled| in | on | for |$)/);
    if (groupM) rest = rest.replace(groupM[0], '');
    const deskM = rest.match(/(?:^| )(?:in|on|for) (?:the )?(.+?)(?: desk)?(?= called| named| titled|$)/);
    return { kind: 'new', desk: deskM ? deskM[1].trim() : '', ...(groupM ? { group: groupM[1].trim() } : {}), title: cs.replace(/(?:\s+(?:in|on|for)\s+(?:the\s+)?\S+(?:\s+(?:desk|group))?)$/i, '').replace(/[.!?]+$/, '').trim(), risky: true };
  }
  if ((m = t.match(/^(?:(?:go to|switch to|change to|show|open|take me to) )?(?:the )?(.+?) desk$|^desk (.+)$/))) return { kind: 'desk', name: (m[1] || m[2]).trim() };
  if ((m = t.match(/^(?:open|show(?: me)?|go to|switch to|take me to|jump to|bring up|find)(?: up)? (.+)$/))) {
    const name = m[1].replace(/^the /, '').replace(/^(?:session|chat|one|conversation)(?: (?:about|called|named|on|for|with|titled))? ?/, '').replace(/^(?:about|called|named) /, '').replace(/ (?:session|one|chat)$/, '').trim();
    return name ? { kind: 'open', name } : { kind: 'none', heard: raw };
  }
  return { kind: 'none', heard: raw };
}

// ---------- where a sentence goes (#1148) ----------
// Talk mode does a sentence itself only when the whole of it is one of its screen commands. Everything else is a
// message for the open session (or the first message of a new one), which does the work with the tools it has.
const SCREEN = new Set(['yes', 'cancel', 'stop', 'send', 'readBack', 'unread', 'more', 'read', 'next', 'scroll', 'answer', 'merge', 'archive', 'interrupt', 'pilotReport']);
// a command with a spoken name in it, which may run on into a message; pilot: "autopilot on for X" (#1146), local with no name
const NAMED = new Set(['open', 'desk', 'new', 'pilot']);
const NAME_WORDS = 4;
// The sentences in what was heard: split on . ! ? ; and on "and then" / ", then".
export function clauses(text) {
  return String(text || '').split(/(?<=[.!?;])\s+|\s*,?\s+(?:and then|and after that|after that)\s+|,\s+then\s+/i)
    .map((s) => s.replace(/^[\s,]+|[\s.!?;,]+$/g, '')).filter((s) => /[a-z0-9]/i.test(s));
}
// "Tell it to use the second option" → "To use the second option": only "tell ..." is taken off; any other sentence
// goes as it was said ("write a test" keeps its "write").
const TELL = /^\W*tell (?:it|them|him|her|the session|claude)\b(?: that)?[\s,:;.-]*/i;
// Where a heard sentence goes. parsed: parse() of it. known(parsed): the name in an open / desk / new command fits a
// session, desk or group well. Returns { via: 'local' } to do parsed here, or { via: 'message', text }.
export function route(text, parsed, { known } = {}) {
  const k = parsed?.kind || 'none', said = String(text || '').trim();
  const message = () => {
    const m = said.match(TELL), rest = m ? said.slice(m[0].length).trim() : said;
    return { via: 'message', text: rest ? rest[0].toUpperCase() + rest.slice(1) : said };
  };
  if (SCREEN.has(k) || (k === 'pilot' && !parsed.desk)) return { via: 'local' };
  if (!NAMED.has(k) || clauses(said).length > 1) return message();
  if (known?.(parsed)) return { via: 'local' };
  const name = [parsed.name, parsed.desk, parsed.group, parsed.title].filter(Boolean).join(' ');
  const n = normalize(name).split(' ').filter(Boolean).length;
  return n <= NAME_WORDS && !/\b(?:and|then|but|so|because)\b/.test(normalize(name)) ? { via: 'local' } : message();
}

// ---------- names ----------
const STOP = new Set(['the', 'a', 'an', 'of', 'to', 'for', 'and', 'in', 'on', 'one', 'session', 'chat', 'about', 'called', 'named', 'desk', 'that', 'this', 'with', 'is', 'it']);
const words = (s) => normalize(s).split(' ').filter((w) => w && !STOP.has(w));
function lev(a, b) {
  if (a === b) return 0;
  const d = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let prev = d[0]; d[0] = i;
    for (let j = 1; j <= b.length; j++) { const t = d[j]; d[j] = Math.min(d[j] + 1, d[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1)); prev = t; }
  }
  return d[b.length];
}
const wordSim = (a, b) => (a === b ? 1 : (b.startsWith(a) && a.length >= 3) || (a.startsWith(b) && b.length >= 3) ? 0.85 : 1 - lev(a, b) / Math.max(a.length, b.length));

// How well a spoken name fits a label, 0 to 1: each spoken word's best fit among the label's words, averaged, and a
// little more when the words run together in the label ("relay fix" in "Relay fix for the proxy").
export function nameScore(spoken, label) {
  const q = words(spoken), l = words(label);
  if (!q.length || !l.length) return 0;
  const joined = l.join('');
  const per = q.map((w) => Math.max(...l.map((x) => wordSim(w, x)), joined.includes(w) && w.length >= 4 ? 0.8 : 0));
  let s = per.reduce((a, b) => a + b, 0) / q.length;
  if (normalize(label).includes(q.join(' '))) s = Math.min(1, s + 0.1);
  return s;
}

// The best fit for a spoken name among items ({ id, label }), or null when nothing fits well enough.
// close: the runner-up fits nearly as well, so the page says which one it took.
export function bestMatch(spoken, items, min = 0.62) {
  const scored = items.map((it) => ({ ...it, score: nameScore(spoken, it.label) })).filter((x) => x.score >= min).sort((a, b) => b.score - a.score);
  if (!scored.length) return null;
  return { ...scored[0], close: scored.length > 1 && scored[0].score - scored[1].score < 0.05 ? scored[1] : null };
}

// ---------- reading aloud ----------
// Numbers that are labels, read the way people say them (#1157): issue and pull request numbers in pairs ("eleven
// forty-six", "nine forty-two", "eleven oh five", "eleven hundred"; five digits or more one by one), versions part by
// part ("version one, two forty-three"), and a commit's hash as "a commit". Amounts, counts, times, money and Qn stay.
const ONES = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve',
  'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen'];
const TENS = ['', '', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety'];
const upTo99 = (n) => (n < 20 ? ONES[n] : TENS[Math.floor(n / 10)] + (n % 10 ? '-' + ONES[n % 10] : ''));
// The last two digits after a leading digit or pair: "forty-six", "oh five", or "hundred" for 00.
const tail = (d) => (d === '00' ? 'hundred' : d[0] === '0' ? `oh ${ONES[+d[1]]}` : upTo99(+d));
export function labelNumber(digits) {
  const d = String(digits);
  if (!/^\d+$/.test(d)) return d;
  if (d.length >= 5 || (d.length > 1 && d[0] === '0')) return [...d].map((x) => ONES[+x]).join(' ');
  if (d.length <= 2) return upTo99(+d);
  if (d.length === 3) return `${ONES[+d[0]]} ${tail(d.slice(1))}`;
  if (d.endsWith('000')) return `${ONES[+d[0]]} thousand`;
  return `${upTo99(+d.slice(0, 2))} ${tail(d.slice(2))}`;
}
export function sayNumbers(text) {
  const hash = '(?=[0-9a-f]*\\d)[0-9a-f]{7,40}';
  return String(text || '')
    .replace(new RegExp(`\\b(?:(?:the|a)\\s+)?commit\\s+\`?${hash}\`?(?![\\w-])`, 'gi'), 'a commit')
    .replace(new RegExp(`\`${hash}\``, 'g'), 'a commit')
    .replace(/\b(?:version\s+v?|v)(\d+(?:\.\d+)+)\b/gi, (m, v) => {
      const parts = v.split('.'); while (parts.length > 1 && /^0+$/.test(parts.at(-1))) parts.pop();
      return `version ${parts.map(labelNumber).join(', ')}`;
    })
    .replace(/\b(issues?|PRs?|pull requests?|builds?|sessions?)(\s+)#?(\d+)\b(?![.,:]\d)/gi, (m, w, sp, n) => `${w}${sp}${labelNumber(n)}`)
    .replace(/(?<![\w&#])#(\d+)\b/g, (m, n) => labelNumber(n));
}

// A reply as it reads aloud, from its plain text: code blocks, tables and links shortened, paths as their file name,
// markdown symbols gone. head: the first paragraph and every numbered question line; rest: everything else.
export function speakable(md) {
  const text = String(md || '').replace(/\r/g, '');
  const blocks = [];
  let cur = [], inCode = false, table = 0;
  const flush = () => { if (table) { blocks.push(`A table with ${Math.max(0, table - 2)} row${table - 2 === 1 ? '' : 's'}.`); table = 0; } if (cur.length) { blocks.push(cur.join(' ')); cur = []; } };
  for (const line of text.split('\n')) {
    if (/^\s*```/.test(line)) { if (!inCode) { flush(); blocks.push('Code block skipped.'); } inCode = !inCode; continue; }
    if (inCode) continue;
    if (/^\s*\|.*\|\s*$/.test(line)) { if (cur.length) { blocks.push(cur.join(' ')); cur = []; } table++; continue; }
    if (table) flush();
    if (!line.trim()) { flush(); continue; }
    if (/^\s*(?:[-*+]|\d+[.)])\s+/.test(line) || /^\s*#{1,6}\s/.test(line) || /^\s*\**Q\d+\b/.test(line)) { flush(); cur.push(line); flush(); continue; }
    cur.push(line);
  }
  flush();
  // Label numbers once links are gone, and before the backticks go, so a hash in them is still known.
  const clean = (s) => sayNumbers(s
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/https?:\/\/\S+/g, 'a link'))
    .replace(/`([^`]+)`/g, '$1')
    .replace(/(?:[A-Za-z]:)?(?:[\\/][\w.@~-]+)+[\\/]([\w.@-]+\.[A-Za-z0-9]{1,6})(?::\d+)?/g, '$1')
    .replace(/(?:^|\s)\.{0,2}\/(?:[\w.@-]+\/)+([\w.@-]+)/g, ' $1')
    .replace(/^\s*#{1,6}\s+/, '').replace(/^\s*>\s?/, '').replace(/^\s*(?:[-*+])\s+/, '')
    .replace(/\*\*|__|~~|(?<!\w)[*_](?!\s)|(?<!\s)[*_](?!\w)/g, '')
    .replace(/[|]/g, ' ').replace(/\s+/g, ' ').trim();
  const parts = blocks.map(clean).filter(Boolean);
  const isQ = (s) => /^Q\d+\b/.test(s);
  const firstIdx = parts.findIndex((p) => !isQ(p));
  const head = parts.filter((p, i) => i === firstIdx || isQ(p));
  const rest = parts.filter((p, i) => !(i === firstIdx || isQ(p)));
  return { head, rest };
}

// Read aloud's pieces for a voice that makes one piece at a time (#1147): each part split into sentences, so the first
// sound comes quickly and the next is made while one plays. A long sentence is cut at a comma before `max` letters, and
// pieces stay under `first` until that many letters are queued, since nothing plays until the first is made; but only
// at a comma: a sentence is never cut at a space to start sooner, which split "<title> | is done." (#1216), and only
// one over `max` is cut at a space. A short piece rides with the next sentence, in the same part or the next (a title
// read first), so it never plays alone and leaves a gap while the next is made.
// Whether the space at i sits inside a number said in words ("eleven fifty-four"), which is never cut.
const NUM_WORD = new RegExp(`^(?:${[...ONES, ...TENS.filter(Boolean), 'hundred', 'thousand', 'oh'].join('|')})(?:-\\w+)?[,.]?$`, 'i');
const numberWords = (s, i) => NUM_WORD.test(s.slice(s.lastIndexOf(' ', i - 1) + 1, i)) && NUM_WORD.test(s.slice(i + 1).split(' ')[0]);
export function sentences(parts, max = 240, first = 50) {
  const out = [];
  const lim = () => (out.join('').length < first ? first : max);
  let cur = '';
  for (const p of parts) {
    for (let s of String(p || '').split(/(?<=[.!?]["')\]]*)\s+/)) {
      s = s.trim(); if (!s) continue;
      if (cur && cur.length + 1 + s.length <= max) s = `${cur} ${s}`; else if (cur) out.push(cur);
      cur = '';
      while (s.length > lim()) {
        const n = lim();
        let i = s.lastIndexOf(', ', n - 1);
        if (i < n / 2) {
          if (s.length <= max) break;
          i = s.lastIndexOf(' ', max); while (i > 0 && numberWords(s, i)) i = s.lastIndexOf(' ', i - 1);
          if (i < 1) i = max;
        }
        out.push(s.slice(0, i + 1).trim()); s = s.slice(i + 1).trim();
      }
      if (s.length >= 25) out.push(s); else cur = s;
    }
  }
  if (cur) out.push(cur);
  return out.filter(Boolean);
}

// ---------- how much a spoken message is read back before it goes (#1190) ----------
// From quickest to most careful. Read it all is the default (what talk mode always did); Send at once is the old
// "Send what I say at once" switch (talk:sendNow). Merge, stop, archive, new session and a message that starts a new
// session keep their spoken yes whatever is picked here.
export const READBACKS = [
  ['now', 'Send at once'],
  ['pause', 'Send after a pause'],
  ['ask', "Ask, don't read"],
  ['start', 'Read the start'],
  ['all', 'Read it all'],
];
export const readbackOf = (v) => (READBACKS.some(([k]) => k === v) ? v : 'all');
export const PAUSE_MS = 3000;
export const START_WORDS = 8;
// The first n words of a message, with … when there were more.
export function firstWords(text, n = START_WORDS) {
  const w = String(text || '').trim().replace(/[.!?]+$/, '').split(/\s+/).filter(Boolean);
  return w.length > n ? `${w.slice(0, n).join(' ').replace(/[,;:]+$/, '')}…` : w.join(' ');
}
// What to do with a spoken message for the session called title: { send } sends it at once, { pause } sends it after
// PAUSE_MS unless cancelled, otherwise it waits on send or cancel. say is spoken, about shown in the talk line.
export function readback(mode, title, msg) {
  const said = String(msg || '').replace(/[.!?]+$/, '');
  switch (readbackOf(mode)) {
    case 'now': return { send: true, say: `Sent to ${title}.`, about: `Sent to ${title}.` };
    case 'pause': return { pause: true, say: `Sending to ${title}.`, about: `Sending to ${title} in ${PAUSE_MS / 1000} s: "${msg}". Say cancel to stop it, or send.` };
    case 'ask': return { say: `Send to ${title}?`, about: `Send to ${title}: "${msg}"? Say send or cancel.` };
    case 'start': return { say: `Send to ${title}: ${firstWords(said)}?`, about: `Send to ${title}: "${msg}"? Say send or cancel.` };
    default: return { say: `Send to ${title}: ${said}?`, about: `Send to ${title}: "${msg}"? Say send or cancel.` };
  }
}

// Said and shown when a read-back is cut short (send, cancel, the key or a click before it finished): who cuts it
// short is who wants a shorter one. Clicked, it opens the talk menu.
export const READBACK_TIP = 'Tip: choose a shorter read-back in the talk menu, under When I speak a message.';
// The first time Listen is turned on, the setting is named.
export const READBACK_NOTE = 'What you say is read back before it is sent. How much: the talk menu, under When I speak a message.';
// The replies "catch me up" reads: from the first not read aloud (readTo, how many were read) through the latest. With
// none read in this session yet, the last few.
export function unreadReplies(replies, readTo, few = 3) {
  const n = replies.length, from = Number.isInteger(readTo) ? Math.min(Math.max(readTo, 0), n) : Math.max(0, n - few);
  return replies.slice(from);
}

// ---------- Read aloud's levels (#1148) ----------
// What is spoken when a session finishes or needs you. Off: nothing at all, talk mode's answers included (#1177; it was
// called Chimes, and a stored 'chimes' reads as off; Docket's chimes follow ☰ > Sound on their own). Who and why: one line, "Relay
// fix is done". Open session: that, and the open session's reply read as before. With its sessions: that, and a line
// for each report from a session under the open one. Only the open session and the sessions under it get lines.
export const READ_LEVELS = [
  ['off', 'Off'],
  ['who', 'Who and why'],
  ['open', 'Open session'],
  ['family', 'With its sessions'],
];
export const readLevelOf = (v) => (READ_LEVELS.some(([k]) => k === v) ? v : 'off');
export const levelAtLeast = (level, k) => READ_LEVELS.findIndex(([x]) => x === readLevelOf(level)) >= READ_LEVELS.findIndex(([x]) => x === k);
// The open session itself, or a session under it (its children and theirs). parentOf(id) gives a parent id or null.
export function inFamily(id, openId, parentOf) {
  if (!id || !openId) return false;
  const seen = new Set();
  for (let x = id; x && !seen.has(x); x = parentOf(x)) { if (x === openId) return true; seen.add(x); }
  return false;
}
// Why a session needs you, from the page's reason (needLabel), as the five kinds a line can say (signin: #1253).
export const whyOf = (label) => (label === 'signin' ? 'signin' : label === 'question' ? 'question' : label === 'merge' ? 'merge' : label === 'card' || label === 'problem' ? 'waiting' : 'done');
// The open session's line when its turn ends (#1181), or '' for none: only when it needs you (needsYou) or the turn
// declared a label that leaves something for you (mark_turn question, merge, reply). A turn marked done, a quiet one
// (report_quiet) or one that declared nothing and does not need you gets no line; its reply may still be read.
// label: the row's need label, 'merge' only when the turn asked to merge (the page's needOf).
export const turnWhy = ({ label, needs = false, said = '', quiet = false }) =>
  quiet || said === 'done' || !(needs || ['question', 'merge', 'reply'].includes(said)) ? '' : whyOf(label);
const ONE = { signin: 'needs you to sign in', done: 'is done', question: 'has a question', waiting: 'is waiting on you', merge: 'wants to merge' };
const MANY = { signin: 'need you to sign in', done: 'are done', question: 'have a question', waiting: 'are waiting on you', merge: 'want to merge' };
const COUNT = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten'];
export const whoLine = ({ title, why, pr, site }) => `${String(title || 'A session').replace(/[.!?]+$/, '')} ${ONE[why] || ONE.done}${why === 'merge' && pr ? ` #${pr}` : ''}${why === 'signin' && site ? ` to ${site}` : ''}`;
const firstSentence = (t) => { const s = speakable(t).head[0] || ''; const m = s.match(/^.*?[.!?](?=\s|$)/); return (m ? m[0] : s).trim(); };
// Spoken lines follow the chimes' waits (#1148): lines that come within a few seconds of each other merge into one
// ("Three sessions are done"), and after a "done" line the family's other "done" lines stay quiet for a minute; a
// question, a wait or a merge skips that. The open session's own reply (level open and up) and reports (family) are
// always read. fixes (talk:lineFixes, on by default, #1177, #1258): the session being viewed gets no status line, as it gets no
// chime, and its reply starts with its title alone, not "is done" or "wants to merge". items: [{ id, title, why, pr,
// head, rest, report }], gathered over the merge wait; head/rest: the open
// session's reply (speakable), report: a report's text. Returns { parts, rest, doneAt } (rest: for "more").
export const LINE_MERGE_MS = 4000, LINE_QUIET_MS = 60000;
export function spokenLines(items, { level, now = Date.now(), doneAt = 0, fixes = false } = {}) {
  level = readLevelOf(level);
  if (level === 'off') return { parts: [], rest: [], doneAt };
  const byId = new Map();
  for (const it of items) { const was = byId.get(it.id) || {}; byId.set(it.id, { ...was, ...Object.fromEntries(Object.entries(it).filter(([, v]) => v !== undefined)) }); }
  const parts = [], groups = { signin: [], done: [], question: [], waiting: [], merge: [] };
  let rest = [], open = null;
  for (const it of byId.values()) {
    if (it.head && levelAtLeast(level, 'open')) { open = it; continue; }
    if (it.head && fixes) continue; // the session being viewed: no status line (#1177)
    if (it.report && levelAtLeast(level, 'family')) { const f = firstSentence(it.report); parts.push(f ? `${it.title || 'A session'}: ${f}` : whoLine(it)); continue; }
    (groups[it.why] || groups.done).push(it);
  }
  const quiet = now - doneAt < LINE_QUIET_MS;
  const lines = [];
  for (const why of ['signin', 'question', 'merge', 'waiting', 'done']) {
    const g = why === 'done' && quiet ? [] : groups[why];
    if (g.length === 1) lines.push(whoLine(g[0]));
    else if (g.length > 1) lines.push(`${COUNT[g.length] || g.length} sessions ${MANY[why]}`);
  }
  if (groups.done.length && !quiet) doneAt = now;
  if (open) { parts.unshift(fixes || !open.why ? `${String(open.title || 'A session').replace(/[.!?]+$/, '')}.` : `${whoLine(open)}.`, ...open.head); rest = open.rest || []; if (rest.length) parts.push('Say more for the rest.'); if (open.why === 'done') doneAt = now; }
  if (lines.length) parts.splice(open ? 1 + open.head.length : 0, 0, lines.join(', and ') + '.');
  return { parts, rest, doneAt };
}

// ---------- priming ----------
// The words the speech model is primed with: the command words, then desk names and session titles, newest first,
// cut to stay well inside the model's prompt (long prompts make it repeat them back on silence).
export const COMMAND_WORDS = 'Docket. Open, next waiting, scroll down, read it, read back, catch me up, more, stop, Q7 yes, tell it, send, cancel, merge, archive this one, new session, autopilot on, what did the autopilot do.';
export function primeText(desks = [], titles = [], max = 400) {
  let out = COMMAND_WORDS;
  const add = (label, list) => {
    const names = [...new Set(list.map((x) => String(x || '').replace(/\s+/g, ' ').trim()).filter((x) => x && x.length <= 60))];
    let part = '';
    for (const n of names) { const next = part ? `${part}, ${n}` : n; if (out.length + label.length + next.length + 3 > max) break; part = next; }
    if (part) out += ` ${label}: ${part}.`;
  };
  add('Desks', desks); add('Sessions', titles);
  return out;
}

// What is heard when the model hears nothing: Whisper answers silence and noise with a few stock phrases.
export const isNoise = (t) => !normalize(t) || /^(?:\[?\s*(?:blank_audio|silence|music|inaudible|no speech)\s*\]?|thank you|thanks for watching|you|bye)\.?$/i.test(String(t).trim().replace(/[()[\]]/g, ''));

// A line is worked out when a session settles, and spoken a few seconds later, or later still behind other items. Just
// before it is spoken each session in it is looked at again (#1177): one the user has acted on since (merged, answered,
// sent a message, archived, stopped), or that is working again, no longer needs you, or is muted, is left out; one that
// needs you for another reason now says that one. The open session's reply goes once that session works again; a
// report stays unless its session is gone. A sign-in line (#1260) goes once the sign-in no longer waits; every other
// line goes by how the turn stands (turnWhy, needsTurn), since an open sign-in has a line of its own. now(id): { needs,
// working, gone, muted, why, pr, site, turnWhy, needsTurn }. Returns { items, changed, dropped: [{ item, why }],
// redone: [{ item, why }] }, the whys in words for the timing log (talk-log.mjs).
export function recheck(items, now) {
  const out = [], dropped = [], redone = [];
  for (const it of items) {
    const n = now(it.id) || { gone: true }, signin = it.why === 'signin';
    const nWhy = signin ? n.why : n.turnWhy ?? n.why, needs = signin ? n.needs : n.needsTurn ?? n.needs;
    const why = n.gone ? 'archived or closed' : signin && n.why !== 'signin' ? 'signed in' : it.report ? '' : n.working ? 'working again' : n.muted ? 'muted' : it.head ? '' : !needs ? 'no longer needs you' : '';
    if (why) { dropped.push({ item: it, why }); continue; }
    if (!it.head && !it.report && (nWhy !== it.why || (n.pr || null) !== (it.pr || null) || (signin && (n.site || null) !== (it.site || null)))) {
      const now2 = { ...it, why: nWhy, pr: n.pr, site: nWhy === 'signin' ? n.site : undefined };
      redone.push({ item: it, why: whoLine(now2) }); out.push(now2); continue;
    }
    out.push(it);
  }
  return { items: out, changed: dropped.length + redone.length > 0, dropped, redone };
}
// The sessions the user just acted on, from a request the page sends (#1177): a message (and so a merge or a Q answer),
// an Allow or a form's answer, Stop, or Archive, or (#1260) a sign-in card's Sign in or Done, which name their session
// in the body. Their waiting lines go at once.
const ACTS = /^\/api\/sessions\/([^/?]+)\/(send|permission|interrupt|archive)(?:[/?]|$)/;
const SIGNIN_ACTS = /^\/api\/clients\/[^/?]+\/browser-(open|done)(?:[/?]|$)/;
export const signinAct = (path, body) => (body?.session && String(path || '').match(SIGNIN_ACTS)?.[1]) || '';
// What the user did, in the past tense, for the timing log (talk-log.mjs).
export function actName(path, body) {
  const si = signinAct(path, body);
  if (si) return si === 'open' ? 'opened the sign-in' : 'signed in';
  const m = body && String(path || '').match(ACTS);
  if (!m) return '';
  if (m[2] === 'send') return /^merge\b/i.test(String(body.text || '').trim()) ? 'merged' : /^Q\d+/i.test(String(body.text || '').trim()) ? 'answered' : 'sent a message';
  if (m[2] === 'permission') return body.answers || body.answer ? 'answered' : body.allow === false ? 'denied' : 'allowed';
  return m[2] === 'interrupt' ? 'stopped' : body.archived === false ? 'restored' : 'archived';
}
export function actedOn(path, body) {
  if (signinAct(path, body)) return [String(body.session)];
  const m = body && String(path || '').match(ACTS);
  if (!m) return [];
  return [decodeURIComponent(m[1]), ...(m[2] === 'archive' && body.archived !== false && Array.isArray(body.alsoIds) ? body.alsoIds : [])];
}
