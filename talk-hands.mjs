// Hands-free Talk (#1228), experimental: with it on, the microphone stays open and a voice activity detector listens
// for speech; say the wake name ("Docket, tell it yes, the second option"), hear a chime, and what follows goes to the
// session whose question was read aloud last, read back first ("Sending to Relay fix: ...") and sent after 3 seconds
// unless you say "cancel". Two ways to hear the wake name, side by side so they can be compared: A, Whisper on the
// first two seconds of each stretch of speech (any name works), and B, an openWakeWord model (one phrase a model).
// Comparison mode never sends: it logs each wake, the words heard (never audio) and whether you said yes or cancel.
// Everything runs on this computer: the detector and openWakeWord in talk-wake-worker.mjs, Whisper in talk-worker.mjs.
// The pure parts are in talk-wake.mjs and talk-wake-log.mjs; talk.mjs hands this file `T`, the few things it needs.
// Only the tab holding the 'docket-talk' lock listens, and it keeps listening while the screen is locked (the one
// exception to #1173) until 30 minutes pass without the wake name.
import { micAudio } from './talk-mic.mjs';
import { parse, isNoise } from './talk-grammar.mjs';
import { matchWake, newSegmenter, feedSegment, newIdle, touchIdle, idleDue, idleLeft, AFTER_WAKE_MS, PRE_ROLL_MS, OWW_MODELS, OWW_THRESHOLD, methodOf, modeOf, cleanWakeName } from './talk-wake.mjs';
import { wakeRow, listenRow } from './talk-wake-log.mjs';

const RATE = 16000, RING_S = 40, LOG_EVERY = 10 * 60e3, BATCH = 512;
const TAP = `registerProcessor('hands-tap', class extends AudioWorkletProcessor {
  process(inputs) { const ch = inputs[0] && inputs[0][0]; if (ch) this.port.postMessage(ch.slice(0)); return true; }
});`;
let T = null;
const h = {
  on: false, cfg: null, stream: null, ctx: null, worker: null, ready: false, err: '',
  ring: new Float32Array(RATE * RING_S), n: 0, batch: [], batchN: 0, // the last RING_S seconds of sound, and what waits to go to the worker
  seg: null, cur: null, bN: 0, bAt: -1e9, // the speech segment going on, and openWakeWord's chunks so far
  state: 'idle', wake: null, // idle (waiting for the wake name), woke (taking the message), busy (working it out), pending (read back, waiting to send)
  idle: null, use: null, tick: null, jobs: 0,
};
export const handsState = () => ({ on: h.on, state: h.state, ready: h.ready, err: h.err, cfg: h.cfg, wake: h.wake && { first: h.wake.first } });
export const handsOn = () => h.on;
// The user is speaking, or what they said is being worked out: a read-back's send waits for it (it may be "cancel").
export const handsBusy = () => h.on && (!!h.cur || h.jobs > 0);

const ran = () => (!h.cfg ? [] : { a: ['a'], b: ['b'], both: ['a', 'b'] }[methodOf(h.cfg.method)].filter((m) => m === 'a' || !!h.cfg.modelB));
const runs = (m) => ran().includes(m);
const bName = () => h.cfg?.models?.find((x) => x.id === h.cfg.modelB)?.label || OWW_MODELS.find(([id]) => id === h.cfg?.modelB)?.[1] || '';
// The phrases method A listens for: the wake name, and B's phrase while B runs too, so the two can be compared fairly.
const phrases = () => [cleanWakeName(h.cfg?.wake), ...(runs('b') && bName() ? [bName()] : [])];
function heardWake(text) {
  let best = { hit: false, score: 0, rest: String(text || '').trim() };
  for (const p of phrases()) { const m = matchWake(text, p); if ((m.hit && !best.hit) || (m.hit === best.hit && m.score > best.score)) best = { ...m, phrase: p }; }
  return best;
}
export const wakeWord = () => (runs('a') || !bName() ? cleanWakeName(h.cfg?.wake) : bName());

// ---------- on and off ----------
export async function handsStart(on) {
  if (on === h.on) return;
  if (!on) return stop();
  h.on = true; h.err = ''; T.draw();
  try { h.cfg = await T.page.handsConfig(); } catch (err) { h.err = `Could not read the hands-free settings: ${err.message}`; h.on = false; T.draw(); return; }
  try {
    if (!navigator.mediaDevices?.getUserMedia) throw new Error('no mediaDevices');
    h.stream = await navigator.mediaDevices.getUserMedia({ audio: micAudio(T.get('mic', '')) });
    if (!h.on) { h.stream.getTracks().forEach((t) => t.stop()); h.stream = null; return; }
    const ctx = h.ctx = new AudioContext({ sampleRate: RATE });
    const url = URL.createObjectURL(new Blob([TAP], { type: 'text/javascript' }));
    await ctx.audioWorklet.addModule(url); URL.revokeObjectURL(url);
    const tap = new AudioWorkletNode(ctx, 'hands-tap');
    tap.port.onmessage = ({ data }) => heardSound(data);
    ctx.createMediaStreamSource(h.stream).connect(tap);
  } catch (err) { stop(); T.micFailed(err); return; }
  h.worker = new Worker(new URL('./talk-wake-worker.mjs', import.meta.url), { type: 'module' });
  h.worker.onmessage = ({ data }) => fromWorker(data);
  h.worker.postMessage({ t: 'load', b: runs('b') ? h.cfg.modelB : '' });
  if (runs('a')) T.loadModel();
  Object.assign(h, { ready: false, n: 0, batch: [], batchN: 0, seg: newSegmenter(), cur: null, bN: 0, bAt: -1e9, state: 'idle', wake: null, idle: newIdle() });
  h.use = { at: Date.now(), vadMs: 0, bMs: 0, aMs: 0, aRuns: 0 };
  h.tick = setInterval(tick, 15000);
  T.draw();
}
function stop(why = '') {
  const was = h.on;
  if (h.wake) done(h.state === 'pending' ? 'cancelled' : 'empty');
  h.on = false;
  h.stream?.getTracks().forEach((t) => t.stop()); h.ctx?.close().catch(() => {}); h.worker?.terminate();
  clearInterval(h.tick);
  if (was && h.use) logListen();
  Object.assign(h, { stream: null, ctx: null, worker: null, ready: false, tick: null, cur: null, state: 'idle', wake: null, use: null });
  T.draw();
  if (why) T.offBy(why);
}
// Settings saved while it listens: start again with them.
export async function handsRestart() { if (!h.on) return; stop(); await handsStart(true); }
function tick() {
  if (!h.on) return;
  if (idleDue(h.idle)) { stop('idle'); return; }
  if (Date.now() - h.use.at >= LOG_EVERY) logListen();
  T.draw();
}
export const handsLeft = () => (h.on && h.idle ? idleLeft(h.idle) : 0);
function logListen() {
  const u = h.use, now = Date.now();
  if (now - u.at > 5000) T.page.logWake(listenRow({ at: u.at, minutes: (now - u.at) / 60e3, ran: ran(), vadMs: u.vadMs, bMs: u.bMs, aMs: u.aMs, aRuns: u.aRuns, aDevice: T.device() }));
  h.use = { at: now, vadMs: 0, bMs: 0, aMs: 0, aRuns: 0 };
}

// ---------- the sound: kept for RING_S seconds, and sent on to the worker ----------
function heardSound(chunk) {
  if (!h.on) return;
  const r = h.ring, at = h.n % r.length;
  if (at + chunk.length <= r.length) r.set(chunk, at); else { const k = r.length - at; r.set(chunk.subarray(0, k), at); r.set(chunk.subarray(k), 0); }
  h.n += chunk.length;
  h.batch.push(chunk); h.batchN += chunk.length;
  if (h.batchN < BATCH) return;
  const out = new Float32Array(h.batchN); let o = 0; for (const c of h.batch) { out.set(c, o); o += c.length; }
  h.batch = []; h.batchN = 0;
  h.worker?.postMessage({ t: 'audio', audio: out }, [out.buffer]);
}
// The sound between two times (ms since it began listening), as far as the ring still has it.
function sound(fromMs, toMs) {
  const r = h.ring, from = Math.max(h.n - r.length, Math.max(0, Math.round(fromMs * 16))), to = Math.min(h.n, Math.round(toMs * 16));
  const out = new Float32Array(Math.max(0, to - from));
  for (let i = 0; i < out.length; i++) out[i] = r[(from + i) % r.length];
  return out;
}
function fromWorker(d) {
  if (!h.on) return;
  if (d.t === 'ready') { h.ready = true; T.draw(); return; }
  if (d.t === 'error') { h.err = d.error; T.line({ about: `Hands-free could not start its listening: ${d.error}`, kind: 'bad' }); stop(); return; }
  if (d.t !== 'heard') return;
  h.use.vadMs += d.ms.vad; h.use.bMs += d.ms.b;
  for (const s of d.b) {
    h.bN++;
    if (h.cur) h.cur.bBest = Math.max(h.cur.bBest, s);
    const at = h.bN * 80;
    if (s >= OWW_THRESHOLD && at - h.bAt > 2000) { h.bAt = at; wokeB(s); }
  }
  for (const p of d.vad) for (const ev of feedSegment(h.seg, p)) segment(ev);
}

// ---------- speech segments ----------
function segment(ev) {
  if (ev.kind === 'start') {
    h.cur = { start: ev.at, bBest: 0, aP: null, a: null };
    if (h.state === 'woke' && h.wake.waitNext) { h.wake.waitNext = false; clearTimeout(h.wake.waitTimer); h.wake.cmd = h.cur; }
    return;
  }
  const c = h.cur; if (!c) return;
  if (ev.kind === 'check') {
    // A looks at each stretch of speech while it waits for the wake name, at the one B woke on (to compare), and while
    // Read aloud speaks (only "<wake name>, stop" counts then).
    const want = (runs('a') && h.state === 'idle') || (runs('a') && h.wake?.seg === c) || (h.state === 'idle' && T.speakingNow());
    if (want && !T.recording()) c.aP = checkA(c, ev.at);
    return;
  }
  if (ev.kind === 'end') { h.cur = null; c.end = ev.speechEnd; ended(c); }
}
const job = async (p) => { h.jobs++; try { return await p; } finally { h.jobs--; } };
async function hear(audio) {
  const r = await job(T.transcribe(audio));
  h.use.aMs += r.ms || 0; h.use.aRuns++;
  return r;
}
async function checkA(c, at) {
  let r; try { r = await hear(sound(c.start - PRE_ROLL_MS, Math.min(at, c.start + 2400))); } catch { return; }
  if (!h.on) return;
  const m = heardWake(r.text);
  c.a = { hit: m.hit, score: m.score, words: r.text, ms: r.ms, device: T.device() };
  if (T.speakingNow() && h.state === 'idle') { // Read aloud is talking: only "<wake name>, stop"
    if (m.hit && parse(m.rest).kind === 'stop') { T.stopSpeaking(); touchIdle(h.idle); h.wake = { first: 'a', seg: c, ran: ran(), bScore: 0 }; done('stopped'); T.line({ heard: r.text, about: 'Stopped reading.' }); }
    return;
  }
  if (m.hit && runs('a') && h.state === 'idle') woke('a', c);
}
function wokeB(score) {
  if (h.state !== 'idle' || T.speakingNow() || T.recording()) return;
  woke('b', h.cur, score);
}
function woke(first, c, bScore = 0) {
  h.state = 'woke'; touchIdle(h.idle);
  h.wake = { first, seg: c, cmd: null, ran: ran(), bScore, at: Date.now(), waitNext: !c };
  if (!c) h.wake.waitTimer = setTimeout(nothingSaid, AFTER_WAKE_MS);
  T.chime();
  T.line({ heard: '', about: `Heard ${first === 'b' ? bName() : wakeWord()}. Listening…` });
  T.draw();
}
function nothingSaid() { if (h.state === 'woke' && !h.cur && h.wake?.waitNext) { T.line({ about: 'Heard the wake name, then nothing.' }); done('empty'); } }
async function ended(c) {
  await c.aP;
  if (!h.on) return;
  if (h.state === 'woke' && (h.wake.seg === c || h.wake.cmd === c)) return message(c);
  if (h.state === 'pending') return answer(c);
}
// The message: the whole segment worked out, the wake name taken off the front. The wake name alone waits for the
// message, up to AFTER_WAKE_MS.
async function message(c) {
  h.state = 'busy'; T.draw();
  let r; try { r = await hear(sound(c.start - PRE_ROLL_MS, c.end + 200)); } catch (err) { T.line({ about: `Could not work out the words: ${err.message}`, kind: 'bad' }); return done('empty'); }
  if (!h.on || !h.wake) return;
  const m = heardWake(r.text), rest = m.hit ? m.rest : r.text.trim();
  if (h.wake.seg === c && !h.wake.seg.a) h.wake.seg.a = { hit: m.hit, score: m.score, words: r.text, ms: r.ms, device: T.device() };
  if (!rest || isNoise(rest)) {
    if (h.wake.seg === c) { h.state = 'woke'; h.wake.waitNext = true; h.wake.waitTimer = setTimeout(nothingSaid, AFTER_WAKE_MS); T.line({ heard: r.text, about: 'Say the message.' }); T.draw(); return; }
    T.line({ heard: r.text, about: 'Heard nothing after the wake name.' });
    return done('empty');
  }
  h.state = 'pending'; T.draw();
  Promise.resolve(T.handsHeard(rest, { compare: modeOf(h.cfg.mode) === 'compare', method: h.wake.first, many: many(), computer: h.cfg.computer || h.cfg.hostname || '', done }))
    .catch((err) => { T.line({ about: `Hands-free could not do it: ${err.message}`, kind: 'bad' }); done('cancelled'); });
}
// While a read-back waits to send, yes, send and cancel are heard without the wake name.
async function answer(c) {
  let r; try { r = await hear(sound(c.start - PRE_ROLL_MS, c.end + 200)); } catch { return; }
  if (!h.on || h.state !== 'pending') return;
  const m = heardWake(r.text), text = m.hit ? m.rest : r.text;
  const k = parse(text, { pending: true }).kind;
  if (k === 'yes' || k === 'cancel' || k === 'readBack') T.heard(text);
}
const many = () => !!h.cfg?.others || T.page.remoteComputers?.().length > 0;
// What came of the wake, for the comparison log; then it waits for the wake name again.
function done(outcome, target = '') {
  const w = h.wake; if (!w) return;
  clearTimeout(w.waitTimer);
  const seg = w.seg || w.cmd, bBest = Math.max(w.bScore, seg?.bBest || 0);
  T.page.logWake(wakeRow({ mode: modeOf(h.cfg?.mode), ran: w.ran, first: w.first, a: w.ran.includes('a') ? seg?.a || null : null,
    b: w.ran.includes('b') ? { hit: bBest >= OWW_THRESHOLD, score: bBest } : null, outcome, target }));
  h.wake = null; h.state = 'idle';
  T.draw();
}
export function start(api) { T = api; }
