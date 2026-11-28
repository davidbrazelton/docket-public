// Hands-free Talk (#1228): say the wake name, then the message, and it goes to the session whose question was read
// aloud last. The pure parts, so test/talk-wake.test.mjs tries them on any computer: the wake name heard at the start
// of what Whisper wrote (method A), openWakeWord's rolling features (method B, its models handed in), the speech
// segments the voice activity detector marks out, which session a message goes to, the 30-minute auto-off, and the
// words of the read-back. The page part is talk-hands.mjs; the models run in talk-wake-worker.mjs.
import { normalize, bestMatch, parse } from './talk-grammar.mjs';

export const WAKE_DEFAULT = 'Docket';
export const IDLE_OFF_MS = 30 * 60e3; // no wake name for this long and hands-free turns itself off
export const SEND_PAUSE_MS = 3000; // the read-back's wait before it sends, unless "cancel"
// The segments: speech starts after START_FRAMES frames of it, ends after END_SILENCE_MS of quiet; method A looks at the
// first CHECK_MS; after a wake name alone, the message may start up to AFTER_WAKE_MS later; nothing runs past MAX_MS.
export const SEG = { on: 0.5, off: 0.35, startFrames: 3, endSilence: 1500, check: 2000, max: 30000 };
export const AFTER_WAKE_MS = 6000, PRE_ROLL_MS = 400;
export const METHODS = [['a', 'Whisper check (A)', 'Any name works. The speech model checks the first two seconds of what you say.'],
  ['b', 'Wake-word model (B)', 'openWakeWord, a small model trained on one phrase. Quicker and lighter, but only for the phrases it has a model for.'],
  ['both', 'Both', 'Either one wakes it, and the log shows which.']];
export const MODES = [['live', 'Send what I say'], ['compare', 'Compare only: never sends']];
export const methodOf = (v) => (METHODS.some(([k]) => k === v) ? v : 'a');
export const modeOf = (v) => (MODES.some(([k]) => k === v) ? v : 'compare');
// openWakeWord's pre-trained models (release v0.5.1). Their makers license them for non-commercial use only (CC BY-NC-SA
// 4.0); a model you train yourself is yours. Each is one fixed phrase.
export const OWW_MODELS = [['hey_jarvis_v0.1', 'Hey Jarvis'], ['hey_mycroft_v0.1', 'Hey Mycroft'], ['alexa_v0.1', 'Alexa'], ['hey_rhasspy_v0.1', 'Hey Rhasspy']];
export const OWW_THRESHOLD = 0.5;

// A wake name as typed in settings: one to three words of letters, at most 24 characters; anything else is the default.
export function cleanWakeName(s) {
  const t = String(s ?? '').replace(/[^\p{L}\s'-]/gu, ' ').replace(/\s+/g, ' ').trim();
  return t && t.length <= 24 && t.split(' ').length <= 3 ? t : WAKE_DEFAULT;
}
// A computer's name in the read-back ("Desk sending to ..."): a few words, or '' for none.
export const cleanComputer = (s) => String(s ?? '').replace(/[^\p{L}\p{N}\s'-]/gu, ' ').replace(/\s+/g, ' ').trim().slice(0, 24);

// ---------- method A: the wake name at the start of what Whisper wrote ----------
// How a word sounds, roughly: c/ck/q as k, a soft c as s, ph as f, z as s, each run of vowels as one a, doubled
// letters once. Worked out a word at a time, so "doc it" and "dock it" come out as "docket" does.
function soundKey(w) {
  return w.toLowerCase().replace(/[^a-z]/g, '').replace(/ck/g, 'k').replace(/c(?=[eiy])/g, 's').replace(/[cq]/g, 'k').replace(/ph/g, 'f')
    .replace(/z/g, 's').replace(/x/g, 'ks').replace(/[aeiouy]+/g, 'a').replace(/(.)\1+/g, '$1');
}
function lev(a, b) {
  const d = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let prev = d[0]; d[0] = i;
    for (let j = 1; j <= b.length; j++) { const t = d[j]; d[j] = Math.min(d[j] + 1, d[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1)); prev = t; }
  }
  return d[b.length];
}
const keySim = (a, b) => (!a || !b ? 0 : 1 - lev(a, b) / Math.max(a.length, b.length));
// Words said before a wake name that do not count against it.
const FILLER = new Set(['hey', 'hi', 'ok', 'okay', 'um', 'uh', 'er', 'so', 'oh', 'yo', 'hello']);
export const WAKE_MIN = 0.8;
// Whether text starts with the wake name: { hit, score (0 to 1), heard (the words taken as it), rest (what follows, as
// written, first letter in capitals) }. "Docket, tell it yes", "Doc it. Tell it yes", "Hey locket, yes" all hit for
// Docket; the rest is the message.
export function matchWake(text, wake = WAKE_DEFAULT, min = WAKE_MIN) {
  const raw = String(text ?? ''), want = normalize(wake).split(' ').filter(Boolean);
  const none = { hit: false, score: 0, heard: '', rest: raw.trim() };
  if (!want.length) return none;
  const wantKey = want.map(soundKey).join('');
  // the words as written, each with where it ends, so the rest keeps its own capitals and punctuation
  const toks = [...raw.matchAll(/\S+/g)].map((m) => ({ words: normalize(m[0]).split(' ').filter(Boolean), end: m.index + m[0].length })).filter((t) => t.words.length);
  let best = { score: 0 };
  for (const skip of [0, 1]) {
    if (skip && !(toks[0] && toks[0].words.length === 1 && FILLER.has(toks[0].words[0]))) continue;
    for (let n = 1; n <= Math.min(want.length + 2, 5) && skip + n <= toks.length; n++) {
      const ws = toks.slice(skip, skip + n).flatMap((t) => t.words);
      const score = keySim(ws.map(soundKey).join(''), wantKey) - (skip ? 0.02 : 0);
      if (score > best.score) best = { score, heard: ws.join(' '), end: toks[skip + n - 1].end };
    }
  }
  if (best.score < min) return { ...none, score: Math.max(0, +best.score.toFixed(2)) };
  const rest = raw.slice(best.end).replace(/^[\s,.:;!?-]+/, '').trim();
  return { hit: true, score: +best.score.toFixed(2), heard: best.heard, rest: rest ? rest[0].toUpperCase() + rest.slice(1) : '' };
}
// "<wake name>, stop": the one thing heard while Read aloud speaks (its own voice may say the wake name).
export function wakeStop(text, wake) {
  const m = matchWake(text, wake);
  return m.hit && parse(m.rest).kind === 'stop';
}

// ---------- method B: openWakeWord's rolling features ----------
// Audio in 80 ms chunks (1280 samples at 16 kHz) goes through three models: a mel spectrogram (8 frames of 32 bands a
// chunk, worked out with 3 frames of the chunk before), a speech embedding of the last 76 frames (96 numbers), and the
// wake model over the last 16 embeddings, a score from 0 to 1. Their predictors are handed in, so the same buffering
// runs here under test and in the worker: mel(Float32Array) → { data, frames }, embed(Float32Array 76×32) →
// Float32Array(96), wake(Float32Array 16×96) → number. Audio is -1 to 1; the models want the 16-bit range.
export const OWW = { chunk: 1280, extra: 480, bins: 32, window: 76, feats: 16, keepMel: 200, keepFeat: 40, warmup: 5 };
export function newWakeStream(models) {
  return { models, pend: new Float32Array(0), tail: new Float32Array(0), mel: Array.from({ length: OWW.window }, () => new Float32Array(OWW.bins).fill(1)), feat: [], scores: 0 };
}
// Feeds audio in; returns the scores of the chunks it completed (none until 16 embeddings are in, and the first
// OWW.warmup after that count as 0, as openWakeWord does).
export async function pushWake(w, audio) {
  const all = new Float32Array(w.pend.length + audio.length); all.set(w.pend); all.set(audio, w.pend.length);
  const out = [];
  let o = 0;
  for (; o + OWW.chunk <= all.length; o += OWW.chunk) {
    const chunk = all.subarray(o, o + OWW.chunk), input = new Float32Array(w.tail.length + OWW.chunk);
    input.set(w.tail); for (let i = 0; i < OWW.chunk; i++) input[w.tail.length + i] = chunk[i] * 32767;
    w.tail = input.slice(-OWW.extra);
    const m = await w.models.mel(input);
    for (let f = 0; f < m.frames; f++) { const row = new Float32Array(OWW.bins); for (let b = 0; b < OWW.bins; b++) row[b] = m.data[f * OWW.bins + b] / 10 + 2; w.mel.push(row); }
    if (w.mel.length > OWW.keepMel) w.mel.splice(0, w.mel.length - OWW.keepMel);
    const win = new Float32Array(OWW.window * OWW.bins);
    w.mel.slice(-OWW.window).forEach((r, i) => win.set(r, i * OWW.bins));
    w.feat.push(await w.models.embed(win));
    if (w.feat.length > OWW.keepFeat) w.feat.shift();
    if (w.feat.length < OWW.feats) continue;
    const x = new Float32Array(OWW.feats * 96);
    w.feat.slice(-OWW.feats).forEach((f, i) => x.set(f, i * 96));
    const s = await w.models.wake(x);
    out.push(w.scores++ < OWW.warmup ? 0 : s);
  }
  w.pend = all.slice(o);
  return out;
}
// A fixed-size framer for the voice activity detector (512 samples at 16 kHz): chunks of any size in, whole frames out.
export function newFramer(size) { return { size, buf: new Float32Array(0) }; }
export function frames(f, audio) {
  const all = new Float32Array(f.buf.length + audio.length); all.set(f.buf); all.set(audio, f.buf.length);
  const out = []; let o = 0;
  for (; o + f.size <= all.length; o += f.size) out.push(all.slice(o, o + f.size));
  f.buf = all.slice(o);
  return out;
}

// ---------- the speech segments ----------
// The voice activity detector's chance of speech for each 32 ms frame goes in; out come the moments that matter:
// 'start' (speech began, at the first of its frames), 'check' (CHECK_MS of it so far: time for method A), 'end'
// (END_SILENCE_MS of quiet after it, or MAX_MS in all). Times are ms since the stream began.
export function newSegmenter(o = {}) { return { o: { ...SEG, ...o }, t: 0, speech: false, run: 0, start: -1, last: -1, checked: false }; }
export function feedSegment(s, p, frameMs = 32) {
  const ev = [], o = s.o, at = s.t; s.t += frameMs;
  if (!s.speech) {
    s.run = p >= o.on ? s.run + 1 : 0;
    if (s.run >= o.startFrames) { s.speech = true; s.start = at - (o.startFrames - 1) * frameMs; s.last = at; s.checked = false; ev.push({ kind: 'start', at: s.start }); }
    return ev;
  }
  if (p >= o.off) s.last = at;
  if (!s.checked && at - s.start >= o.check) { s.checked = true; ev.push({ kind: 'check', at, start: s.start }); }
  const quiet = at - s.last >= o.endSilence, long = at - s.start >= o.max;
  if (quiet || long) {
    if (!s.checked) ev.push({ kind: 'check', at, start: s.start });
    ev.push({ kind: 'end', at, start: s.start, speechEnd: s.last + frameMs, why: quiet ? 'quiet' : 'long' });
    s.speech = false; s.run = 0; s.start = -1; s.checked = false;
  }
  return ev;
}

// ---------- where the message goes ----------
// The session whose question was read aloud last (still listed), not the open one; a session named at the start
// ("tell relay fix yes", "ask the proxy session to rerun it") instead; with neither, the open session. Returns { target:
// { id, title, desk } | null, text, why: 'named' | 'asked' | 'open' | '' }. sessions: [{ id, title, desk }].
const TELL_IT = /^\W*tell (?:it|them|him|her|the session|claude)\b(?: that)?[\s,:;.-]*/i;
const NAMED = /^\W*(?:tell|ask|message|for)\s+(?:the\s+)?/i;
const NOT_NAMES = /^(?:it|them|him|her|claude|me|you|us)$/i;
export function chooseTarget(msg, { lastAsked = null, current = null, sessions = [], sure = 0.8 } = {}) {
  let text = String(msg ?? '').trim();
  const up = (t) => (t ? t[0].toUpperCase() + t.slice(1) : t);
  const m = text.match(NAMED);
  if (m && !TELL_IT.test(text)) {
    const words = text.slice(m[0].length).split(/\s+/);
    let best = null;
    for (let n = Math.min(5, words.length - 1); n >= 1; n--) {
      const name = words.slice(0, n).join(' ').replace(/[,:;.]+$/, '').replace(/\s+(?:session|chat)$/i, '');
      if (NOT_NAMES.test(name) || /\s(?:that|to|it|is|and|the|a|i|we|you|please)$/i.test(name)) continue; // a name never ends on these
      const hit = bestMatch(name, sessions.map((s) => ({ ...s, label: s.title })), sure);
      if (hit && (!best || hit.score > best.hit.score)) best = { hit, n };
    }
    if (best) {
      const rest = words.slice(best.n).join(' ').replace(/^(?:session|chat)\b\s*/i, '').replace(/^[\s,:;.-]*(?:that|to)?\s+/i, '').replace(/^[\s,:;.-]+/, '');
      const { id, title, desk } = best.hit;
      return { target: { id, title, desk }, text: up(rest.trim()), why: 'named' };
    }
  }
  text = up(text.replace(TELL_IT, '').trim());
  const asked = lastAsked && sessions.find((s) => s.id === lastAsked.id);
  if (asked) return { target: { id: asked.id, title: asked.title, desk: asked.desk }, text, why: 'asked' };
  if (current) return { target: { id: current.id, title: current.title, desk: current.desk }, text, why: 'open' };
  return { target: null, text, why: '' };
}

// The read-back: "Sending to Relay fix: yes, the second option.", with this computer's name in front when more than one
// Docket listens in the room ("Desk sending to ..."), so a wrong wake is caught before it sends. compare: what it would
// have sent, in comparison mode.
export function handsReadback({ title, text, computer = '', many = false, compare = false, method = '' }) {
  const t = String(title || 'Untitled').replace(/[.!?]+$/, ''), who = many && computer ? `${computer} ` : '';
  const said = String(text).replace(/[.!?]+$/, '');
  if (compare) return { say: `${who ? `${computer}: ` : ''}heard you${method ? ` by ${method.toUpperCase()}` : ''}. Would send to ${t}: ${said}.`, about: `Compare only (${method.toUpperCase() || 'A'}): would send to ${t}: "${text}". Say yes if that was you, or cancel.` };
  return { say: `${who ? `${who}sending` : 'Sending'} to ${t}: ${said}.`, about: `${who ? `${computer} sending` : 'Sending'} to ${t} in ${SEND_PAUSE_MS / 1000} s: "${text}". Say cancel to stop it, or send.` };
}

// ---------- the auto-off ----------
// Hands-free stays on while the wake name is heard at least every IDLE_OFF_MS; then it turns itself off. Locking the
// screen does not stop it (the one exception to #1173), so this is what ends a forgotten one.
export const newIdle = (now = Date.now()) => ({ since: now });
export const touchIdle = (idle, now = Date.now()) => { idle.since = now; return idle; };
export const idleLeft = (idle, now = Date.now(), ms = IDLE_OFF_MS) => Math.max(0, idle.since + ms - now);
export const idleDue = (idle, now = Date.now(), ms = IDLE_OFF_MS) => idleLeft(idle, now, ms) === 0;
