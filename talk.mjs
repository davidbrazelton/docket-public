// Talk mode (#1105): hold a key (or the 🎙 button), say a command or a message, and Docket does it; replies in the open
// session are read aloud. Speech-to-text runs on this computer (talk-worker.mjs), screen commands are matched here
// (talk-grammar.mjs), and the voice runs on this computer too (Kokoro in talk-voice-worker.mjs, #1147). Anything that is not a screen command goes to the
// open session as text, as if typed, and the session does the work with its own tools (#1148). Audio never leaves
// the page.
// Only one Docket tab listens and speaks: the one holding the 'docket-talk' lock. Pop-outs never load this file.
// index.html passes in `page`, the few things talk mode does to the page (open a session, send, scroll...), so this
// file has no other reach into it.
import { parse, route, bestMatch, speakable, sentences, sayNumbers, primeText, isNoise, READ_LEVELS, readLevelOf, READBACKS, readbackOf, readback, PAUSE_MS, READBACK_TIP, READBACK_NOTE, unreadReplies, levelAtLeast, inFamily, whyOf, turnWhy, spokenLines, LINE_MERGE_MS, recheck, actedOn, actName, signinAct } from './talk-grammar.mjs';
import { newRecord, stamp, actOn, dropRec, logRow, rowWords, fixDo } from './talk-log.mjs';
import { withPilot } from './talk-pilot.mjs';
import { newQueue, add, next, clear, skip, waiting, upcoming, lock, drop } from './talk-queue.mjs';
import { micAudio, micKind, micLine, micChecks, micSteps } from './talk-mic.mjs';
import { sinkFor, soundChecks, soundSteps, virtualDevice, WAKE, wakeNoise, leadLeft } from './talk-sound.mjs';
import { start as handsInit, handsStart, handsOn, handsBusy, handsState, handsLeft, handsRestart, wakeWord } from './talk-hands.mjs';
import { chooseTarget, handsReadback, cleanWakeName, SEND_PAUSE_MS, METHODS, MODES, OWW_MODELS, WAKE_DEFAULT, methodOf, modeOf } from './talk-wake.mjs';
import { statWords, wakeWords } from './talk-wake-log.mjs';

const keys = () => [['ControlRight', 'Right Ctrl'], ['AltRight', page.talkKey[0] === 'AltRight' ? 'Right Option' : 'Right Alt'], ['ShiftRight', 'Right Shift'], ['F8', 'F8'], ['F9', 'F9']];
// MB downloaded once, from the model files talk-worker.mjs picks (on the processor alone it takes one size down)
const SIZES = { base: { webgpu: 165, wasm: 41 }, small: { webgpu: 410, wasm: 77 } };
// Kokoro's English voices graded C or better by its makers, best first (the rest sound flat). VOICE_MB: its download.
const KOKORO = [['af_heart', 'Heart', 'US', 'female'], ['af_bella', 'Bella', 'US', 'female'], ['af_nicole', 'Nicole', 'US', 'female'],
  ['bf_emma', 'Emma', 'UK', 'female'], ['am_michael', 'Michael', 'US', 'male'], ['am_fenrir', 'Fenrir', 'US', 'male'], ['am_puck', 'Puck', 'US', 'male'],
  ['af_aoede', 'Aoede', 'US', 'female'], ['af_kore', 'Kore', 'US', 'female'], ['af_sarah', 'Sarah', 'US', 'female'], ['bm_george', 'George', 'UK', 'male'],
  ['bm_fable', 'Fable', 'UK', 'male'], ['af_alloy', 'Alloy', 'US', 'female'], ['af_nova', 'Nova', 'US', 'female'], ['bf_isabella', 'Isabella', 'UK', 'female'], ['af_sky', 'Sky', 'US', 'female']];
const VOICE_MB = { webgpu: 326, wasm: 92 };
const isKokoro = (v) => KOKORO.some(([id]) => id === v);

let page, $;
const st = {
  listen: false, level: 'off', locked: false, lockAsked: false, releaseLock: null, micAt: 0, said: [],
  worker: null, model: null, loadP: null, ready: false, device: '', loadMs: 0, bytes: 0,
  speaking: null, speakRun: 0, testCopy: false, // what is talking now (#1148)
  screenLocked: false, // the computer's screen is locked: Read aloud is silent and the microphone stays shut (#1173)
  q: newQueue(), playing: null, played: [], // the speech queue and the piece being said (#1161)
  rec: null, pending: null, lastHeard: '', reading: null, seq: 0, wants: new Map(),
  lines: { items: [], timer: null, doneAt: 0 }, // spoken lines waiting to merge (#1148)
  recs: new Set(), // Read aloud's timing records not finished yet (#1177, talk-log.mjs)
  stats: [],
  // the natural voice (#1147): its worker, how far its download is, and what is playing
  tts: { worker: null, loadP: null, ready: false, failed: '', device: '', pace: 0, ms: 0, bytes: 0, loaded: 0, total: 0, seq: 0, wants: new Map(), ahead: null, ctx: null, node: null, ended: null, awake: null, awakeAt: 0, sleepT: 0, dlAt: 0, ring: false },
  voiceStats: [],
  micErr: null, micRun: 0, micTest: null, // the last microphone failure, and Microphone help's test recording (#1224)
  sndAudio: null, sndPlayed: undefined, // the help's voice sample playing, and how its last test tone or sample went (#1226)
  lastAsked: null, // the session whose question was read aloud last: where a hands-free message goes (#1228)
};
const set = (k, v) => page.store.set('talk:' + k, v);
const get = (k, d) => page.store.get('talk:' + k, d);
// The three fixes for stale lines (#1177): look again just before speaking, the user's action cancels, no status line
// for the session being viewed. On by default since the timing log showed they help (#1258): talk:lineFixes, no menu
// item; to troubleshoot, talk.setLineFixes(false) from the console. The log records what each did, or with them off,
// what each would have done.
export const fixesOn = (g = get) => g('lineFixes', true) !== false;
// The key's default is the page's for this computer (platform part of index.html): Right Ctrl, or Right Option on a Mac.
export const settings = () => ({ key: get('key', page.talkKey[0]), model: get('model', 'base'), device: get('device', 'auto'), voice: get('voice', '') || 'af_heart', rate: get('rate', 1.1), readback: readbackOf(get('readback', 'all')) });
const keyName = () => (keys().find(([k]) => k === settings().key) || [, page.talkKey[1]])[1];

// ---------- the engine: transcribe(audio) → text ----------
// One function, so another engine (the Web Speech API, or #1081's server-side Whisper) can stand in for this one.
function worker() {
  if (st.worker) return st.worker;
  st.worker = new Worker(new URL('./talk-worker.mjs', import.meta.url), { type: 'module' });
  st.worker.onmessage = ({ data }) => {
    if (data.t === 'progress') showLoading(data.loaded, data.total);
    else if (data.t === 'ready') { st.ready = true; st.device = data.device; st.loadMs = data.ms; st.bytes = data.bytes; st.loadDone?.(); showIdle(); }
    else if (data.t === 'text' || data.t === 'error') {
      const w = st.wants.get(data.id);
      if (data.t === 'error' && !w) { st.loadFail?.(new Error(data.error)); return; }
      st.wants.delete(data.id);
      if (data.t === 'text') w?.ok(data); else w?.no(new Error(data.error));
    }
  };
  return st.worker;
}
export function loadModel() {
  const { model, device } = settings();
  if (st.loadP && st.model === model + device) return st.loadP;
  st.model = model + device; st.ready = false;
  st.loadP = new Promise((ok, no) => { st.loadDone = ok; st.loadFail = (e) => { st.loadP = null; no(e); }; });
  st.loadP.catch((e) => line({ about: `The speech model did not load: ${e.message}`, kind: 'bad' }));
  worker().postMessage({ t: 'load', model, device });
  return st.loadP;
}
export async function transcribe(audio) {
  await loadModel();
  const id = ++st.seq;
  const prompt = primeText(page.desks().map((d) => d.name), page.sessions().map((s) => s.title));
  return new Promise((ok, no) => { st.wants.set(id, { ok, no }); worker().postMessage({ t: 'transcribe', id, audio, prompt }, [audio.buffer]); });
}

// ---------- the microphone: open only while the key or button is held ----------
const WORKLET = `registerProcessor('talk-tap', class extends AudioWorkletProcessor {
  process(inputs) { const ch = inputs[0] && inputs[0][0]; if (ch) this.port.postMessage(ch.slice(0)); return true; }
});`;
async function startRec() {
  if (st.rec || st.screenLocked) return;
  if (cutShort(st.pending)) st.pending.cut = true; // a read-back cut off by the key (#1190)
  stopSpeaking(); // the key cuts Docket off
  const rec = st.rec = { chunks: [], at: performance.now(), firstAt: 0, stopped: false, peak: 0 };
  showListening(0);
  try {
    if (!navigator.mediaDevices?.getUserMedia) throw new Error('no mediaDevices');
    const stream = await navigator.mediaDevices.getUserMedia({ audio: micAudio(get('mic', '')) });
    rec.stream = stream;
    if (rec.stopped) { stream.getTracks().forEach((t) => t.stop()); return; }
    const ctx = rec.ctx = new AudioContext({ sampleRate: 16000 });
    const url = URL.createObjectURL(new Blob([WORKLET], { type: 'text/javascript' }));
    await ctx.audioWorklet.addModule(url); URL.revokeObjectURL(url);
    const src = ctx.createMediaStreamSource(stream), tap = new AudioWorkletNode(ctx, 'talk-tap');
    tap.port.onmessage = ({ data }) => {
      if (rec.stopped) return;
      if (!rec.firstAt) rec.firstAt = performance.now();
      rec.chunks.push(data);
      let sum = 0; for (let i = 0; i < data.length; i++) sum += data[i] * data[i];
      const level = Math.min(1, Math.sqrt(sum / data.length) * 6); rec.peak = Math.max(rec.peak, level);
      showListening(level);
    };
    src.connect(tap);
  } catch (err) {
    st.rec = null; closeRec(rec); showIdle();
    micFailed(err);
  }
}
// A microphone that would not open (#1224): the cause in plain words, with the Microphone help link beside it.
const micPage = () => ({ secure: window.isSecureContext !== false, hasMedia: !!navigator.mediaDevices?.getUserMedia });
function micFailed(err) {
  const kind = micKind(err, micPage());
  st.micErr = { kind, name: err?.name || '', message: err?.message || '', at: Date.now() };
  line({ about: micLine(kind, err), kind: 'bad', help: true });
}
// Asks for the microphone once and lets it go: Turn on in the setup wizard, while the press still counts as the
// person's own. A failure shows in the talk line like a held key's would.
export async function askMic() {
  try {
    if (!navigator.mediaDevices?.getUserMedia) throw new Error('no mediaDevices');
    (await navigator.mediaDevices.getUserMedia({ audio: micAudio(get('mic', '')) })).getTracks().forEach((t) => t.stop());
    return true;
  } catch (err) { micFailed(err); return false; }
}
function closeRec(rec) {
  rec.stopped = true;
  rec.stream?.getTracks().forEach((t) => t.stop());
  rec.ctx?.close().catch(() => {});
}
async function stopRec(keep = true) {
  const rec = st.rec; if (!rec) return;
  st.rec = null;
  await new Promise((r) => setTimeout(r, 120)); // the last words still in the pipe
  closeRec(rec); showIdle();
  const releasedAt = performance.now() - 120;
  const n = rec.chunks.reduce((a, c) => a + c.length, 0);
  if (!keep || n < 16000 * 0.3 || rec.peak < 0.02) { showIdle(keep && n ? 'Heard nothing. Hold the key while you speak.' : ''); return; }
  const audio = new Float32Array(n); let o = 0; for (const c of rec.chunks) { audio.set(c, o); o += c.length; }
  line({ heard: '…', about: st.ready ? 'Working out the words…' : 'Getting the speech model ready…' });
  try {
    const r = await transcribe(audio);
    st.micAt = Date.now(); // heard through this tab's microphone: its prompts may be spoken
    const textAt = performance.now();
    const stat = { device: st.device, seconds: +(n / 16000).toFixed(2), pressToAudio: Math.round((rec.firstAt || releasedAt) - rec.at), releaseToText: Math.round(textAt - releasedAt), transcribe: r.ms, text: r.text };
    await heard(r.text, stat);
    stat.textToAction = Math.round(performance.now() - textAt);
    st.stats.push(stat); if (st.stats.length > 50) st.stats.shift();
  } catch (err) { line({ about: `Could not work out the words: ${err.message}`, kind: 'bad' }); }
}

// ---------- what was heard, and doing it ----------
// A sentence that is one screen command, whole, is done here at once (talk-grammar.mjs says which). Anything else goes
// to the open session as a message, or starts a new session with it, and the session does the work (#1148).
export async function heard(text, stat = {}) {
  if (isNoise(text)) { st.lastHeard = text; showIdle('Heard nothing. Hold the key while you speak.'); return; }
  const c = parse(text, { pending: !!st.pending });
  if (c.kind !== 'readBack') st.lastHeard = text; // "read back" says the sentence before it
  const r = route(text, c, { known });
  stat.kind = r.via === 'local' ? c.kind : 'message';
  if (r.via === 'message') return message(r.text, text);
  await act(c, text);
}
const titleOf = (s) => s?.title || 'Untitled';
const deskItems = () => page.desks().map((d) => ({ id: d.id, label: d.name, groups: d.groups || [] }));
function findSession(name) {
  const here = page.sessions(), all = page.sessions(true);
  return bestMatch(name, here.map((s) => ({ id: s.id, label: titleOf(s), desk: s.client })))
    || bestMatch(name, all.map((s) => ({ id: s.id, label: titleOf(s), desk: s.client })));
}
// Where a new session goes: { desk, group } matched from spoken names, or { why } when one is not found.
function newWhere(deskName, groupName) {
  const desks = deskItems();
  const desk = deskName ? bestMatch(deskName, desks) : desks.find((d) => d.id === page.deskId()) || null;
  if (deskName && !desk) return { why: `No desk called "${deskName}".` };
  const groups = (desk?.groups || []).map((g) => ({ id: g.id, label: g.name }));
  const group = groupName ? bestMatch(groupName, groups) : null;
  if (groupName && !group) return { why: `No group called "${groupName}" on the ${desk?.label || page.deskName()} desk.` };
  return { desk, group };
}
async function startNew({ desk, group }, title, message) {
  await page.startDraft({ desk: desk?.id, group: group?.id, title });
  if (!message) return '';
  await page.send(message);
  return page.current() ? '' : 'The new session did not start.';
}
// A spoken name that fits this well keeps "open X" or "go to the X desk" a command even when it is long.
const SURE = 0.8;
function known(c) {
  if (c.kind === 'open') return (findSession(c.name)?.score || 0) >= SURE;
  if (c.kind === 'desk') return (bestMatch(c.name, deskItems())?.score || 0) >= SURE;
  if (c.kind === 'pilot') return (bestMatch(c.desk, deskItems())?.score || 0) >= SURE;
  return false;
}
// Something that waits on a spoken yes (or send) or cancel, shown in the talk line and read back.
function confirm(text, about, run, say) { dropPending()?.onCancel?.(); const p = st.pending = { about, run }; line({ heard: text, about, confirm: true }); speak([say || about], { tag: p }); }
// A message's read-back still being said, or waiting to be (the tag speak() put on it), or cut off by the key.
const stillSaying = (p) => st.playing?.item?.tag === p || (st.q.cur?.tag === p && st.q.cur.i < st.q.cur.parts.length) || st.q.waiting.some((w) => w.tag === p);
const cutShort = (p) => !!p?.readBack && (p.cut || stillSaying(p));
function showTip() { if (st.listen) { $('talkTip').hidden = false; $('talkLine').hidden = false; } speak([READBACK_TIP]); }
// What waits is dropped: its pause (#1190) ends with it.
function dropPending() { const p = st.pending; st.pending = null; if (p?.timer) clearTimeout(p.timer); return p; }
// A message for the open session, read back as "When I speak a message" says (#1190): sent at once; sent after a
// pause unless cancelled; or put in the typing box to wait on send or cancel, read back not at all, its start, or whole.
async function deliver(text, msg, cur) {
  const r = readback(settings().readback, titleOf(cur), msg);
  const run = async () => { if (page.box() === msg) page.box(''); await page.send(msg); line({ about: `Sent to ${titleOf(cur)}.` }); };
  if (r.send) { await page.send(msg); line({ heard: text, about: r.about }); speak([r.say]); return; }
  page.box(msg);
  confirm(text, r.about, run, r.say);
  const p = st.pending; p.filled = msg; p.readBack = true;
  if (!r.pause) return;
  // Held while the user is speaking or what they said is still being worked out: it may be "cancel". A box changed
  // by hand in the meantime is left alone.
  const due = () => {
    if (st.pending !== p) return;
    if (st.rec || st.wants.size || handsBusy()) { p.timer = setTimeout(due, 300); return; }
    dropPending();
    if (page.box() !== msg) { line({ about: 'Not sent: the typing box changed.' }); return; }
    run();
  };
  p.due = due; p.timer = setTimeout(due, PAUSE_MS);
}
// What was said, for the open session (deliver). With no session open it starts a new one on this desk, in the group
// the draft has picked, after a yes.
async function message(msg, text) {
  const cur = page.current(), said = msg.replace(/[.!?]+$/, '');
  if (!cur) {
    const g = page.draftGroup(), where = `${page.deskName()}${g ? `, group ${g.name}` : ''}`;
    return confirm(text, `New session in ${where}: "${msg}"? Say yes or cancel.`, async () => {
      const why = await startNew({ desk: null, group: g }, '', msg);
      line({ about: why || `Started a new session in ${where}.`, kind: why ? 'bad' : '' });
    }, `New session in ${where}: ${said}?`);
  }
  return deliver(text, msg, cur);
}

async function act(c, text) {
  const cur = page.current();
  const ask = (about, run, say) => confirm(text, about, run, say);
  switch (c.kind) {
    case 'yes': {
      const cut = cutShort(st.pending), p = dropPending(); if (!p) return; line({ heard: text, about: `Doing it: ${p.about.replace(/\? Say .*$|\. Say cancel .*$/, '').replace(/ in \d+ s:/, ':')}` }); await p.run();
      if (cut) showTip(); return;
    }
    case 'cancel': {
      const cut = cutShort(st.pending), p = dropPending();
      p?.onCancel?.(); // a hands-free read-back (#1228): logged as cancelled
      if (p?.filled && page.box() === p.filled) page.box('');
      line({ heard: text, about: p ? 'Cancelled.' : 'Nothing to cancel.', tip: cut }); speak([p ? 'Cancelled.' : 'Nothing to cancel.', cut && READBACK_TIP], { force: !!p?.hands }); return;
    }
    case 'stop': stopSpeaking(); line({ heard: text, about: 'Stopped reading.' }); return;
    case 'readBack': { // what was heard, or the message waiting on send (#1190); a pause starts again so it can be cancelled
      const p = st.pending;
      if (p?.filled) {
        if (p.timer) { clearTimeout(p.timer); p.timer = setTimeout(p.due, PAUSE_MS); }
        line({ heard: text, about: `Waiting to send: "${p.filled}". Say send or cancel.`, confirm: true }); speak([p.filled], { tag: p }); return;
      }
      const was = st.lastHeard && !isNoise(st.lastHeard) ? st.lastHeard : '';
      line({ heard: text, about: was ? `Heard: "${was}"` : 'Nothing heard yet.' }); speak([was ? `I heard: ${was}` : 'Nothing heard yet.']); return;
    }
    case 'unread': return readUnread(text);
    case 'desk': {
      const m = bestMatch(c.name, deskItems());
      if (!m) return miss(text, `No desk called "${c.name}".`);
      page.selectDesk(m.id); line({ heard: text, about: `Went to the ${m.label} desk.` }); return;
    }
    case 'open': {
      const m = findSession(c.name);
      if (!m) return miss(text, `No session matches "${c.name}".`);
      await page.open(m.id, m.desk);
      line({ heard: text, about: `Opened ${m.label}.${m.close ? ` (${m.close.label} was close too.)` : ''}` });
      speak([m.label]); return;
    }
    case 'next': { // passes what the autopilot is about to take (#1146), and says how many
      const { session: s, skipped } = page.nextWaiting(await pilotTaking()), more = withPilot(skipped);
      if (!s) { const say = `Nothing ${skipped ? 'else ' : ''}is waiting on you.${more ? ` ${more}` : ''}`; line({ heard: text, about: say }); speak([say]); return; }
      await page.open(s.id, s.client); line({ heard: text, about: `Opened ${titleOf(s)}, waiting on you.${more ? ` ${more}` : ''}` }); speak([`${titleOf(s)}.`, more]); return;
    }
    case 'pilot': return pilotSwitch(c, text, ask);
    case 'pilotReport': return pilotReport(text);
    case 'scroll': page.scrollPages(c.dir); line({ heard: text, about: `Scrolled ${c.dir}.` }); return;
    case 'read': return readReply(true);
    case 'more': { // the updates a fold held (#1161), or the rest of what was read
      if (st.level === 'off') { // the autopilot's report shows its rest here; a reply needs Read aloud up
        const rest = st.reading?.source ? [] : st.reading?.rest || [];
        if (st.reading && !st.reading.source) st.reading.rest = [];
        line({ heard: text, about: rest.length ? rest.join(' ') : OFF_HINT }); return;
      }
      const folded = st.reading?.folded || [];
      if (folded.length) { st.reading = null; line({ heard: text, about: `Reading ${folded.length} updates.` }); for (const it of folded) speak(it.parts, { source: it.source }); return; }
      const rest = st.reading?.rest || [];
      if (!rest.length) { line({ heard: text, about: 'Nothing more to read.' }); speak(['That is all.']); return; }
      st.reading.rest = []; line({ heard: text, about: 'Reading the rest.' }); speak(rest, { source: st.reading.source }); return;
    }
    case 'answer': {
      if (!cur) return miss(text, 'Open a session first.');
      return deliver(text, `Q${c.n} ${c.text}`, cur);
    }
    case 'send': {
      const box = page.box().trim();
      if (!cur || !box) { line({ heard: text, about: 'Nothing to send.' }); speak(['Nothing to send.']); return; }
      page.box(''); await page.send(box); line({ heard: text, about: `Sent to ${titleOf(cur)}.` }); return; // "send" is the yes
    }
    case 'merge': {
      if (!cur || !page.canMerge()) return miss(text, 'No merge is waiting in this session.');
      return ask(`Merge in ${titleOf(cur)}? Say yes or cancel.`, async () => { await page.merge(); line({ about: 'Sent merge.' }); });
    }
    case 'interrupt': {
      if (!cur || !page.isWorking()) return miss(text, 'This session is not working.');
      return ask(`Stop ${titleOf(cur)}? Say yes or cancel.`, async () => { await page.interrupt(); line({ about: 'Stopped the session.' }); });
    }
    case 'archive': {
      if (!cur) return miss(text, 'Open a session first.');
      return ask(`Archive ${titleOf(cur)}? Say yes or cancel.`, async () => { await page.archive(cur.id); line({ about: `Archived ${titleOf(cur)}.` }); });
    }
    case 'new': {
      const w = newWhere(c.desk, c.group);
      if (w.why) return miss(text, w.why);
      const where = `${w.desk?.label || page.deskName()}${w.group ? `, group ${w.group.label}` : ''}`;
      return ask(`New session in ${where}${c.title ? ` called "${c.title}"` : ''}? Say yes or cancel.`, async () => {
        await startNew(w, c.title);
        line({ about: 'New session ready: say "tell it" and what to do, or type it.' });
      });
    }
    default: return miss(text);
  }
}
// ---------- the autopilot (#1146): its engage switch by voice, its report, and what "next" passes ----------
// The sessions a run is about to take, from the app; none when it cannot say.
const pilotTaking = () => page.pilotTalk().then((r) => new Set(r.taking || []), () => new Set());
// "Autopilot on / off [for a desk]": the desk's switch in the 🤖 drop-down, after a yes. Never enables the autopilot
// itself (☰ > Docket settings), and says why a desk cannot be engaged.
async function pilotSwitch(c, text, ask) {
  const m = c.desk ? bestMatch(c.desk, deskItems()) : deskItems().find((d) => d.id === page.deskId());
  if (!m) return miss(text, c.desk ? `No desk called "${c.desk}".` : 'Open a desk first.');
  let v; try { v = await page.pilotView(); } catch (err) { return miss(text, `Could not reach the autopilot: ${err.message}`); }
  const d = (v.desks || []).find((x) => x.id === m.id);
  if (!d) return miss(text, v.on ? `The autopilot cannot be engaged on ${m.label}.` : 'The autopilot is disabled. Enable it first, in ☰ > Docket settings > Autopilot.');
  if (d.remote && !d.on) return miss(text, `The autopilot is not enabled on ${d.remote}, the computer ${m.label} is on. Enable it there first.`);
  if (d.engaged === c.on) return miss(text, `The autopilot is already ${c.on ? 'engaged' : 'off'} on ${m.label}.`);
  if (c.on && !d.signedIn) return miss(text, `${m.label} has no brand signed in, so the autopilot cannot run there. Sign in to one first, in ☰ > Desks.`);
  const did = c.on ? 'Engage' : 'Disengage';
  return ask(`${did} the autopilot on ${m.label}? Say yes or cancel.`, async () => {
    try { const r = await page.pilotEngage(m.id, c.on); line({ about: `The autopilot is ${c.on ? 'engaged' : 'off'} on ${m.label}.${r.note ? ` ${r.note}` : ''}` }); }
    catch (err) { line({ about: err.message, kind: 'bad' }); speak([err.message]); }
  });
}
// "What did the autopilot do": its log for the open desk since this was last asked there (talk:pilotSince, per desk),
// read like a reply: the summary, then "say more" for each item.
async function pilotReport(text) {
  if (page.deskRemote()) return miss(text, `The autopilot for ${page.deskName()} keeps its log on that desk's own computer.`);
  const desk = page.deskId(), since = get('pilotSince', {});
  let r; try { r = await page.pilotTalk(since[desk] || 0); } catch (err) { return miss(text, `Could not read the autopilot's log: ${err.message}`); }
  set('pilotSince', { ...since, [desk]: r.at });
  const head = [...(r.on ? [] : ['The autopilot is disabled.']), ...r.head, r.rest.length ? 'Say more for the rest.' : ''].filter(Boolean);
  st.reading = { rest: r.rest };
  line({ heard: text, about: head.join(' ') });
  speak(head);
}
function miss(text, why = '') {
  line({ heard: text, about: why || "Didn't catch a command.", sendAs: !why && !!page.current() });
  if (why) speak([why]);
}

// ---------- reading aloud ----------
// Read aloud (talk:read) reads the open session's replies when a turn ends, and talk's own prompts. A prompt is spoken
// only in answer to words heard through this tab's microphone in the last few seconds: never for text given to heard()
// by code or a test, and never on its own. Everything said, or that would have been, is kept in st.said to check.
const MIC_WINDOW = 10000;

// The natural voice (#1147): Kokoro in its own worker, loaded only while Read aloud is above Off (or a sample asks
// for it) and dropped when it is not wanted. Until it is ready, or when it fails, this computer's own voice reads.
function voiceWorker() {
  const t = st.tts;
  if (t.worker) return t.worker;
  t.worker = new Worker(new URL('./talk-voice-worker.mjs', import.meta.url), { type: 'module' });
  t.worker.onmessage = ({ data }) => {
    if (data.t === 'progress') { t.loaded = data.loaded; t.total = data.total; ringSoon(); drawVoiceNote(); drawRing(); }
    else if (data.t === 'ready') { Object.assign(t, { ready: true, device: data.device, pace: data.pace, ms: data.ms, bytes: data.bytes }); t.loadDone?.(); drawVoiceNote(); drawRing(); }
    else if (data.t === 'audio') { t.wants.get(data.id)?.ok(data); t.wants.delete(data.id); }
    else if (data.t === 'error') {
      if (data.id == null) { t.loadFail?.(new Error(data.error)); return; }
      t.wants.get(data.id)?.no(new Error(data.error)); t.wants.delete(data.id);
    }
  };
  return t.worker;
}
// Loading it on purpose (wanted, a sample, Resume) ends a pause (talk:voicePaused, below).
export function loadVoice() {
  const t = st.tts;
  if (get('voicePaused', false) !== false) set('voicePaused', false);
  if (t.loadP && !t.failed) return t.loadP; // a failed load is tried again the next time it is wanted
  Object.assign(t, { ready: false, failed: '', loaded: 0, total: 0, dlAt: 0, ring: false });
  t.loadP = new Promise((ok, no) => { t.loadDone = ok; t.loadFail = (e) => { t.failed = e.message; drawVoiceNote(); drawRing(); no(e); }; });
  t.loadP.catch(() => {});
  voiceWorker().postMessage({ t: 'load', device: settings().device });
  drawVoiceNote();
  return t.loadP;
}
function unloadVoice() {
  const t = st.tts;
  if (!t.worker) return;
  stopSpeaking(); t.worker.terminate();
  Object.assign(t, { worker: null, loadP: null, ready: false, failed: '', loaded: 0, total: 0, dlAt: 0, ring: false });
  drawVoiceNote(); drawRing();
}
// Wanted while Read aloud is above Off here with a natural voice picked, and its download not paused; the menu's
// samples also load it while it is open. At Off nothing is spoken but the samples.
function wantVoice() {
  if (st.level !== 'off' && st.locked && isKokoro(settings().voice) && get('voicePaused', false) === false) loadVoice();
  else if ($('talkMenu')?.hidden !== false) unloadVoice();
}
// The voice, picked on the setup card (#1164): the natural voice (the one picked before, or the first), or this
// computer's own: the one it would read with, or 'system' when the browser lists none (any name that is not a natural
// voice's reads with this computer's own).
const systemVoiceId = () => (window.speechSynthesis && voice('')?.name) || 'system';
export function chooseVoice(natural) {
  set('voice', natural ? (isKokoro(get('voice', '')) ? get('voice', '') : KOKORO[0][0]) : systemVoiceId());
  wantVoice(); drawMenu();
}
// ▶ on the card's This computer's voice: a live sample, through the queue like the menu's.
export function hearSystem() {
  stopSpeaking(); enqueue({ kind: 'asked', parts: ["This is this computer's voice. Replies will sound like this."], source: {}, voice: systemVoiceId() });
}
// ▶ in Help > Key's Sounds (#1177): a line as Who and why says it, in the voice picked (this computer's own until the
// natural one is ready; nothing downloads for it), and the tone between two items. Both play at any level.
export function hearLine() {
  stopSpeaking(); enqueue({ kind: 'asked', parts: ['Relay fix is done.'], source: {}, voice: settings().voice });
}
export const hearTone = () => tone(true);

// ---------- the natural voice's download in the top bar (#1164) ----------
// While it downloads, a ring in the main color with its percent stands in for 🎙▾, in the same place and size, and says
// how far it is when pointed at; pressed, the menu offers Pause and Cancel above its usual rows. Done, it turns back into
// 🎙▾ with one soft pulse; failed, 🎙▾ comes back and the menu's voice line says why. This computer's voice reads
// meanwhile. A load that finishes within RING_WAIT (the browser kept the files) never shows it. Pause stops the
// download and keeps the share done in talk:voicePaused (false when not paused), so the ring stays, paused, after a
// reload; Resume picks up again (files finished before are not fetched again). Cancel stops it and reads with this
// computer's voice.
const RING_WAIT = 600;
const expectBytes = () => VOICE_MB[settings().device === 'wasm' || !navigator.gpu ? 'wasm' : 'webgpu'] * 1e6;
function ringSoon() {
  const t = st.tts, p = t.loadP;
  if (t.dlAt || t.loaded >= t.total) return;
  t.dlAt = Date.now();
  setTimeout(() => { if (t.loadP === p && !t.ready && !t.failed && t.loaded < t.total) { t.ring = true; drawRing(); } }, RING_WAIT);
}
function ringText() {
  const t = st.tts, paused = get('voicePaused', false), all = Math.max(t.total, expectBytes()), mb = (b) => Math.round(b / 1e6);
  const pct = Math.min(99, Math.floor((paused !== false ? paused : t.loaded / all) * 100));
  if (paused !== false) return { pct, paused: true, text: `Natural voice paused at ${pct}% of ${mb(all)} MB. This computer's voice reads meanwhile. Press for Resume or Cancel` };
  return { pct, paused: false, text: t.loaded < t.total ? `Natural voice: ${mb(t.loaded)} of ${mb(all)} MB. This computer's voice reads until it's ready. Press for Pause or Cancel` : "Natural voice: getting it ready. This computer's voice reads until it is. Press for Pause or Cancel" };
}
const ringOn = () => get('voicePaused', false) !== false || (st.tts.ring && !!st.tts.loadP && !st.tts.ready && !st.tts.failed);
const noPress = (text) => text.replace(/ Press for .*$/, '');
function drawRing() {
  const b = $('talkBtn'); if (!b) return;
  const was = b.classList.contains('dl');
  if (!ringOn()) {
    st.tts.ring = false;
    if (!was) return;
    b.classList.remove('dl'); b.style.width = ''; b.setAttribute('aria-label', 'Talk mode'); showButton();
    if (st.tts.ready) { b.classList.remove('pulse'); void b.offsetWidth; b.classList.add('pulse'); b.addEventListener('animationend', () => b.classList.remove('pulse'), { once: true }); }
    drawMenu();
    return;
  }
  const r = ringText(), ring = b.querySelector('.talk-ring');
  if (!was) { if (b.offsetWidth) b.style.width = b.offsetWidth + 'px'; b.classList.add('dl'); drawMenu(); }
  ring.style.setProperty('--p', r.pct); ring.classList.toggle('paused', r.paused); ring.firstElementChild.textContent = r.pct;
  b.title = r.text; b.setAttribute('aria-label', `Natural voice download, ${r.pct}%${r.paused ? ', paused' : ''}`);
  const n = $('tmDlNote'); if (n) n.textContent = noPress(r.text);
}
function pauseVoice() {
  const t = st.tts, f = Math.min(0.99, t.loaded / Math.max(t.total, expectBytes()));
  set('voicePaused', f); unloadVoice(); drawMenu();
}
function resumeVoice() { loadVoice(); st.tts.ring = true; drawRing(); drawMenu(); }
function cancelVoice() { set('voicePaused', false); set('voice', systemVoiceId()); unloadVoice(); drawRing(); drawMenu(); }
// One piece made in the worker: { key, id, p } (p: its { audio, rate, ms }). While a piece plays, the next one of the
// same item is made ahead (t.ahead), so it starts right after; one the queue no longer wants is dropped unmade.
const keyOf = (text, voice) => `${voice}|${settings().rate}|${text}`;
function make(text, voice) {
  const t = st.tts, a = { key: keyOf(text, voice), id: ++t.seq };
  a.p = new Promise((ok, no) => t.wants.set(a.id, { ok, no }));
  a.p.catch(() => {});
  voiceWorker().postMessage({ t: 'say', id: a.id, text, voice, speed: settings().rate });
  return a;
}
function dropAhead() {
  const t = st.tts, a = t.ahead;
  if (!a) return;
  t.ahead = null; t.worker?.postMessage({ t: 'drop', upto: a.id });
  t.wants.get(a.id)?.no(new Error('dropped')); t.wants.delete(a.id);
}
function made(text, voice) {
  const t = st.tts;
  if (t.ahead?.key === keyOf(text, voice)) { const a = t.ahead; t.ahead = null; return a.p; }
  dropAhead();
  return make(text, voice).p;
}
// 'playback': bigger buffers, so the sound does not break up while the next sentence is made on the same processor.
const audioCtx = () => { const t = st.tts; if (!t.ctx) { t.ctx = new AudioContext({ latencyHint: 'playback' }); toSpeaker(t.ctx); } t.ctx.resume?.(); return t.ctx; };
// The hiss that keeps the output awake while reading (#1250, talk-sound.mjs's WAKE): wake() as an item is about to
// be said (it starts the hiss, or keeps it going), sleepSoon() once quiet, and awoke() before each piece's sound waits
// out what is left of the lead-in. Started while the natural voice makes its first piece, it usually costs no time.
function wake() {
  const t = st.tts;
  clearTimeout(t.sleepT); t.sleepT = 0;
  if (t.awakeAt) return;
  try {
    const ctx = audioCtx(), src = ctx.createBufferSource(), buf = ctx.createBuffer(1, Math.round(ctx.sampleRate), ctx.sampleRate);
    buf.copyToChannel(wakeNoise(ctx.sampleRate), 0);
    src.buffer = buf; src.loop = true; src.connect(ctx.destination); src.start();
    t.awake = src;
  } catch {}
  t.awakeAt = performance.now(); // after the hiss starts: the first AudioContext alone can take a few hundred ms
}
function sleepSoon() {
  const t = st.tts;
  if (!t.awakeAt || t.sleepT) return;
  t.sleepT = setTimeout(() => { t.sleepT = 0; t.awakeAt = 0; try { t.awake?.stop(); } catch {} t.awake = null; }, WAKE.tailMs);
}
async function awoke(run, rec) {
  const ms = leadLeft(st.tts.awakeAt, performance.now());
  if (rec) rec.lead = ms;
  if (ms) await new Promise((ok) => setTimeout(ok, ms));
  return run === st.speakRun;
}
// The output picked in Sound and microphone help (#1226), kept in this browser (talk:speaker): the natural voice's
// AudioContext and the voice sample's Audio element play there, where the browser can (setSinkId); one that is gone
// falls back to the default. This computer's own voice (speechSynthesis) has no such choice: the default output only.
const canPickSpeaker = () => !!(window.AudioContext?.prototype.setSinkId || window.HTMLMediaElement?.prototype.setSinkId);
const speakerOutputs = () => (navigator.mediaDevices?.enumerateDevices ? navigator.mediaDevices.enumerateDevices().then((ds) => ds.filter((d) => d.kind === 'audiooutput'), () => null) : Promise.resolve(null));
export async function toSpeaker(target) {
  if (!target?.setSinkId) return;
  const want = get('speaker', ''), id = want ? sinkFor(want, await speakerOutputs()) : '';
  if ((typeof target.sinkId === 'string' ? target.sinkId : '') === id) return;
  try { await target.setSinkId(id); } catch { if (id) try { await target.setSinkId(''); } catch {} }
}
function playAudio({ audio, rate }, started) {
  const t = st.tts, ctx = audioCtx();
  const buf = ctx.createBuffer(1, audio.length, rate); buf.copyToChannel(audio, 0);
  const src = ctx.createBufferSource(); src.buffer = buf; src.connect(ctx.destination);
  return new Promise((ok) => { t.node = src; t.ended = ok; src.onended = () => { t.node = null; t.ended = null; ok(); }; src.start(); started(); });
}
function voice(want = settings().voice) {
  const vs = speechSynthesis.getVoices();
  return vs.find((v) => v.name === want && v.localService) || vs.find((v) => v.localService && v.default && /^en/i.test(v.lang)) || vs.find((v) => v.localService && /^en/i.test(v.lang)) || vs.find((v) => v.localService) || null;
}
function saySystem(text, want, started) {
  const v = voice(want), u = new SpeechSynthesisUtterance(text);
  if (v) { u.voice = v; u.lang = v.lang; }
  u.rate = settings().rate;
  return new Promise((ok) => { u.onstart = started; u.onend = u.onerror = () => ok(); speechSynthesis.speak(u); });
}
// Too slow to keep up (the processor alone, where the page gets one thread: ~5 s for each second of speech on a 2026
// laptop), the natural voice would leave long gaps, so this computer's own reads instead. Only there: on the graphics
// card the warm-up's timing still includes compiling (1.1 s measured once, against ~0.45 s for every sentence after).
const tooSlow = () => st.tts.device === 'wasm' && st.tts.pace > 1;
const natural = (want) => isKokoro(want) && st.tts.ready && !tooSlow();
// The engine: one piece, said to its end (the promise settles then). The natural voice when it is ready and quick
// enough, this computer's own otherwise (one utterance a piece, since long ones get cut off in some browsers). One
// function, so another engine can stand in for this one. started(): the piece's sound has begun.
async function sayPiece(text, want, started, first, rec) {
  const run = st.speakRun;
  if (natural(want)) {
    const t0 = performance.now(), a = await made(text, want);
    if (run !== st.speakRun || !await awoke(run, rec)) return;
    if (first) { st.voiceStats.push({ firstSound: Math.round(performance.now() - t0), make: a.ms, seconds: +(a.audio.length / a.rate).toFixed(2), device: st.tts.device }); if (st.voiceStats.length > 20) st.voiceStats.shift(); }
    const p = playAudio(a, started), up = upcoming(st.q);
    if (up) st.tts.ahead = make(up, want);
    return p;
  }
  if (window.speechSynthesis && await awoke(run, rec)) return saySystem(text, want, started);
}
// The tone between two items (#1161): two soft notes going up, under 300 ms, made here; none with Sound off in ☰.
// asked: ▶ in Help > Key (#1177), played whatever ☰ > Sound says.
const TONE_MS = 260;
function tone(asked = false) {
  if (!asked && !page.soundOn?.()) return Promise.resolve();
  played({ tone: true, ...(asked && { asked }) });
  try {
    const ctx = audioCtx();
    [587.33, 783.99].forEach((freq, i) => {
      const at = ctx.currentTime + 0.01 + i * 0.11, osc = ctx.createOscillator(), gain = ctx.createGain();
      osc.type = 'sine'; osc.frequency.value = freq;
      gain.gain.setValueAtTime(0.0001, at);
      gain.gain.exponentialRampToValueAtTime(0.06, at + 0.015);
      gain.gain.exponentialRampToValueAtTime(0.0001, at + 0.13);
      osc.connect(gain).connect(ctx.destination);
      osc.start(at); osc.stop(at + 0.14);
    });
  } catch {}
  return new Promise((ok) => setTimeout(ok, TONE_MS));
}
// What was played, piece by piece, and each tone, for checks (the last 50).
function played(x) { const r = { at: Date.now(), ...x }; st.played.push(r); if (st.played.length > 50) st.played.shift(); return r; }

// The speech queue (#1161, talk-queue.mjs): every item goes in through speak(), and pump() says it a piece at a time,
// asking the queue for the next piece each time one ends, so nothing new cuts off a piece being said. Only Stop and the
// push-to-talk key (stopSpeaking) cut the sound at once.
const openId = () => page.current()?.id || null;
function enqueue(item) {
  const it = add(st.q, item, { openId: openId() });
  for (const r of item.recs || []) { stamp(r, 'queued'); r.text = item.parts.join(' '); if (!it) r.dropWhy = 'locked'; }
  sweep();
  showNow();
  pump();
}
async function pump() {
  if (st.playing) return;
  const n = fresh(next(st.q, { openId: openId() }));
  if (n?.item.folded) for (const f of n.item.folded) for (const r of f.recs || []) r.dropWhy = 'folded';
  sweep();
  if (!n) { sleepSoon(); if (st.speaking) speaking(null); return; }
  const run = st.speakRun, it = n.item, src = it.source || {}, want = it.voice || settings().voice;
  st.playing = n;
  wake();
  if (it.folded) st.reading = { folded: it.folded };
  try {
    if (n.tone) { speaking(src); await tone(); }
    if (run !== st.speakRun) return;
    const text = n.lead ? `${n.lead} ${n.text}` : n.text;
    const rec = played({ text, kind: it.kind, engine: natural(want) ? 'natural' : 'system' });
    if (it.kind === 'need' && it.session) st.lastAsked = { id: it.session, at: Date.now() }; // hands-free sends here (#1228)
    await sayPiece(text, want, () => { if (run !== st.speakRun) return; speaking({ ...src, sentence: n.text }); for (const r of it.recs || []) stamp(r, 'started'); }, it.i === 1, rec);
  } catch (err) {
    if (run === st.speakRun) { stopSpeaking(); line({ about: `The natural voice failed: ${err.message}`, kind: 'bad' }); }
    return;
  }
  if (run !== st.speakRun) return; // stopped or skipped meanwhile, which reset it
  st.playing = null;
  pump();
}
// A line's sessions looked at again as it comes to the front, before its first piece (#1177, talk-grammar's recheck):
// unchanged, it plays as it was; changed, it is made again from how they are now, or skipped when none is left.
const nowOf = (id) => { const n = page.needOf(id); return { ...n, why: whyOf(n.label), turnWhy: n.turnLabel ? whyOf(n.turnLabel) : undefined }; };
function fresh(n) {
  while (n && n.item.from && n.item.i === 1 && !n.item.checked) {
    const it = n.item, r = recheck(it.from, nowOf);
    it.checked = true;
    const fixes = fixesOn() || it.from.some((x) => x.why === 'signin'); // a sign-in line (#1260) is always looked at again: one signed in to meanwhile is not said late
    for (const d of r.dropped) if (d.item.rec) fixDo(d.item.rec, `drop: ${d.why}`, fixes);
    for (const d of r.redone) if (d.item.rec) fixDo(d.item.rec, `say instead: ${d.why}`, fixes);
    if (!fixes || (!r.changed && !it.stale)) break;
    const parts = r.items.length ? spokenLines(r.items, { level: st.level, ...it.built }).parts : [];
    for (const x of it.from) if (x.rec && !r.items.some((y) => y.rec === x.rec)) x.rec.dropWhy = 'rechecked';
    it.recs = r.items.map((x) => x.rec).filter(Boolean);
    if (!parts.length) { skip(st.q); st.q.talking = n.tone; n = next(st.q, { openId: openId() }); continue; }
    const ids = [...new Set(r.items.map((x) => x.id))], one = r.items[0];
    if (!it.source?.reply) { it.source = ids.length === 1 ? { id: one.id, title: one.title, desk: one.desk } : { title: `${ids.length} sessions` }; it.session = ids.length === 1 ? one.id : null; }
    it.from = r.items; it.parts = sentences(parts.map(sayNumbers)); it.i = 1;
    n = { ...n, text: it.parts[0] };
  }
  return n;
}
// The user acted on these sessions (#1177; the page sees each request, talk-grammar's actedOn): their lines waiting to
// merge and in the queue go at once, and one being said stops after its sentence. act: what they did, for the log.
// signin: they pressed a sign-in card's Sign in or Done (#1260), which drops the lines with the line fixes off too.
export function acted(ids, act = '', signin = false) {
  if (!ids.length) return;
  const fixes = fixesOn() || signin;
  for (const r of st.recs) if (ids.includes(r.session)) {
    if (act) actOn(r, act);
    if (r.started == null) { fixDo(r, 'drop: you acted', fixes); if (fixes) r.dropWhy = 'you acted'; } else if (r.ended == null) fixDo(r, 'stop after this sentence: you acted', fixes);
  }
  if (!fixes) return;
  for (const x of st.lines.items) if (ids.includes(x.id) && x.rec) endRec(x.rec, 'you acted');
  st.lines.items = st.lines.items.filter((x) => !ids.includes(x.id));
  for (const id of ids) drop(st.q, id);
  for (const w of st.q.waiting) if (w.recs) w.recs = w.recs.filter((r) => !ids.includes(r.session));
  sweep();
  showNow();
}
// ---------- Read aloud's timing log (#1177, talk-log.mjs) ----------
// A record for each line or reply an event makes, finished when it has been said or is dropped, and then sent to the
// app (data/talk-log.jsonl). One being said when it is cut short counts as said.
function track(item, event) {
  const n = page.needOf(item.id), state = { ...n, viewed: item.id === openId() };
  const rec = newRecord({ event, session: item.id, title: item.title, why: item.why, state });
  st.recs.add(rec);
  return { ...item, rec };
}
function endRec(rec, dropWhy) {
  if (!rec || !st.recs.has(rec)) return;
  if (dropWhy && rec.started == null) dropRec(rec, dropWhy); else stamp(rec, 'ended');
  st.recs.delete(rec);
  page.logTalk?.(logRow(rec));
}
// Records whose item has left the queue: said to the end (or cut after a sentence), or gone without a sound, for the
// reason set when it went (dropWhy), else a newer line about the same session or the session opened (the queue's rules).
function sweep() {
  const inQ = new Set([st.q.cur, st.playing?.item, ...st.q.waiting].flatMap((it) => it?.recs || []));
  for (const r of st.recs) if (r.queued != null && !inQ.has(r)) endRec(r, r.dropWhy || 'replaced');
}
const dropAll = (why) => { for (const r of st.recs) if (r.queued != null && r.started == null) r.dropWhy = why; };
// What is talking, the one place speech starts and ends (#1148): { id, title, desk, reply, sentence } while a session's
// line or reply is spoken (reply: the open session's reply is being read, and sentence is the one being spoken), {}
// for talk mode's own words, null once quiet. The page shows it in the top bar, the session's row and the chat, with
// how many items wait (#1161). The queue calls this as it speaks.
export function speaking(source) {
  st.speaking = source && !st.screenLocked ? { ...source, test: !!st.testCopy } : null;
  showNow();
}
function showNow() { page.speaking?.(st.speaking && { ...st.speaking, waiting: waiting(st.q, { openId: openId() }) }); }
// Whether speak() voices something: this tab holds talk mode, the screen is unlocked (#1173), Read aloud is above Off
// (#1177), a voice can read, and a prompt answers the microphone within MIC_WINDOW.
// force: hands-free's own words (#1228), its read-back above all, said at any level and while the screen is locked.
export const mayVoice = ({ level, prompt, micAgo, locked, screenLocked, canSpeak, force = false }) =>
  locked && canSpeak && (force || (!screenLocked && level !== 'off' && (!prompt || micAgo < MIC_WINDOW)));
// prompt: talk's own words (a confirmation, a reply asked for), held to the microphone rule, and asked for in the
// queue; false for what Read aloud's level says on its own, as kind (need or news). At Off nothing is spoken, prompts
// included (#1177): talk's answers show only in the talk line, and the samples (▶) go to the queue on their own. Label
// numbers are said the way people say them (#1157), a sentence a piece (talk-grammar's sentences(), the first kept
// short so it starts quickly). from, built, recs: a line's sessions, how it was made, and its timing records (#1177).
export function speak(parts, { prompt = true, source = null, kind = 'news', from = null, built = null, recs = null, tag = null, force = false } = {}) {
  parts = parts.filter(Boolean);
  if (!parts.length) { for (const r of recs || []) endRec(r, 'quiet'); return; }
  const off = st.level === 'off';
  const ok = mayVoice({ level: st.level, prompt, micAgo: Date.now() - st.micAt, locked: st.locked, screenLocked: st.screenLocked, canSpeak: natural(settings().voice) || !!window.speechSynthesis, force });
  st.said.push({ at: Date.now(), text: parts.join(' '), spoken: ok, ...(!ok && (st.screenLocked ? { dropped: 'screen locked' } : off && { dropped: 'read aloud off' })) }); if (st.said.length > 50) st.said.shift();
  if (st.screenLocked && !ok) console.info('Read aloud: dropped while the screen is locked:', parts.join(' '));
  if (ok) enqueue({ kind: prompt ? 'asked' : kind, parts: sentences(parts.map(sayNumbers)), source, session: source?.id || null, ...(from && { from, built }), ...(recs && { recs }), ...(tag && { tag }), ...(force && { force }) });
  else for (const r of recs || []) endRec(r, st.screenLocked ? 'locked' : off ? 'off' : 'no voice');
}
export const said = () => st.said; // what was spoken, or would have been (spoken: false), for checks
// The sound stops at once; what waits is the caller's to keep or empty.
function cutSound() {
  st.speakRun++; st.playing = null;
  if (window.speechSynthesis?.speaking || window.speechSynthesis?.pending) speechSynthesis.cancel();
  const t = st.tts;
  dropAhead();
  if (t.seq) t.worker?.postMessage({ t: 'drop', upto: t.seq });
  for (const w of t.wants.values()) w.no(new Error('dropped'));
  t.wants.clear();
  if (t.node) { t.node.onended = null; try { t.node.stop(); } catch {} t.node = null; t.ended?.(); t.ended = null; }
  sleepSoon();
}
// Stop (the pill or "stop") and the push-to-talk key: everything goes.
export function stopSpeaking(why = 'stopped') {
  dropAll(why); clear(st.q); cutSound(); sweep();
  if (st.speaking) speaking(null);
}
// The screen locked or unlocked (#1173; the app watches it and tells the page). Locking stops the reading at once and
// empties the queue as Stop does, lines gathering to merge go too, and the queue drops whatever comes in until unlock,
// so nothing is said afterwards. Chimes follow their own rules and are not touched here.
export function setScreenLocked(on) {
  on = !!on;
  if (on === st.screenLocked) return;
  st.screenLocked = on;
  if (on) dropAll('locked');
  lock(st.q, on);
  if (on) {
    if (st.rec) stopRec(false);
    for (const x of st.lines.items) endRec(x.rec, 'locked');
    clearTimeout(st.lines.timer); st.lines = { items: [], timer: null, doneAt: st.lines.doneAt };
    cutSound(); sweep(); speaking(null);
  }
  console.info(on ? 'Read aloud: the screen locked; reading stopped and the queue emptied' : 'Read aloud: the screen unlocked');
}
// The pill's "+N waiting", pressed: on to the next item now.
export function skipSpeaking() {
  cutSound(); skip(st.q); sweep(); pump();
}
const sourceOf = (s, more = {}) => (s ? { id: s.id, title: titleOf(s), desk: s.client || page.deskId(), ...more } : null);
const OFF_HINT = 'Read aloud is off. Turn it up in 🎙▾ to hear replies.';
// How many of a session's replies were read aloud, kept per computer for "catch me up" (#1190): the latest 200 sessions.
function markRead(id, n = page.replies().length) {
  if (!id) return;
  const all = get('readTo', {}) || {}; delete all[id]; all[id] = n;
  const ids = Object.keys(all); for (const k of ids.slice(0, Math.max(0, ids.length - 200))) delete all[k];
  set('readTo', all);
}
// "read unread" / "catch me up": the open session's replies from the first not read aloud through the latest, each cut
// down as a read reply is; "more" carries on.
function readUnread(text) {
  if (st.level === 'off') { line({ heard: text, about: OFF_HINT }); return; }
  const cur = page.current();
  if (!cur) return miss(text, 'Open a session first.');
  const replies = page.replies(), list = unreadReplies(replies, (get('readTo', {}) || {})[cur.id]);
  if (!list.length) { line({ heard: text, about: 'Everything here has been read.' }); speak(['Everything here has been read.']); return; }
  const parts = [`${titleOf(cur).replace(/[.!?]+$/, '')}. ${list.length === 1 ? 'One reply.' : `${list.length} replies.`}`], rest = [];
  list.forEach((t, i) => {
    const s = speakable(t), label = list.length > 1 ? [`Reply ${i + 1}.`] : [];
    if (!rest.length) { parts.push(...label, ...s.head); rest.push(...s.rest); } else rest.push(...label, ...s.head, ...s.rest);
  });
  const source = sourceOf(cur, { reply: true });
  st.reading = { rest, source };
  markRead(cur.id, replies.length);
  speak([...parts, rest.length ? 'Say more for the rest.' : ''], { source });
  line({ heard: text, about: `Reading ${list.length === 1 ? 'one reply' : `${list.length} replies`} from ${titleOf(cur)}.` });
}
function readReply(asked) {
  if (asked && st.level === 'off') { line({ about: OFF_HINT }); return; }
  const cur = page.current(), text = page.lastReply();
  if (!text) { if (asked) { line({ about: 'No reply to read yet.' }); speak(['No reply to read yet.']); } return; }
  const { head, rest } = speakable(text);
  const source = sourceOf(cur, { reply: true });
  st.reading = { rest, source }; markRead(cur?.id);
  speak([`${titleOf(cur).replace(/[.!?]+$/, '')}.`, ...head, rest.length ? 'Say more for the rest.' : ''], { prompt: asked, source });
  if (asked) line({ about: `Reading ${titleOf(cur)}.` });
}
// ---------- Read aloud's level: lines when a session finishes or needs you (#1148) ----------
// Only the open session and the sessions under it get lines; the rest only chime. Lines gather for the chimes' merge
// wait and are spoken as one (talk-grammar.mjs spokenLines). A sign-in (#1260) goes at once, with what has gathered:
// the user may sign in within seconds, and the line would then come after it.
function announce(item) {
  if (!st.locked) { st.recs.delete(item.rec); return; } // another tab speaks, and logs
  if (st.level === 'off') { endRec(item.rec, 'off'); return; }
  st.lines.items.push(item);
  if (item.why === 'signin') { clearTimeout(st.lines.timer); flushLines(); return; }
  st.lines.timer ||= setTimeout(flushLines, LINE_MERGE_MS);
}
// In the speech queue (#1161) the sessions that need you (a question, a wait, a merge) are one item that cuts in after
// the sentence being said, and the rest (done, reports) another that waits its turn.
function flushLines() {
  const all = st.lines.items, why = new Map();
  for (const x of all) if (x.why) why.set(x.id, x.report ? 'report' : x.why);
  const needs = all.filter((x) => ['signin', 'question', 'merge', 'waiting'].includes(why.get(x.id)));
  let doneAt = st.lines.doneAt;
  st.lines = { items: [], timer: null, doneAt };
  for (const [kind, items] of [['need', needs], ['news', all.filter((x) => !needs.includes(x))]]) {
    if (!items.length) continue;
    const built = { now: Date.now(), doneAt, fixes: fixesOn() }, r = spokenLines(items, { level: st.level, ...built });
    doneAt = st.lines.doneAt = r.doneAt;
    // what is talking: the open session while its reply is read, the one session a line is about, or "N sessions"
    const ids = [...new Set(items.map((x) => x.id))], open = items.find((x) => x.head) && levelAtLeast(st.level, 'open') ? page.current() : null;
    const one = items.find((x) => x.id === ids[0]);
    const source = open ? sourceOf(open, { reply: true }) : ids.length === 1 ? { id: one.id, title: one.title, desk: one.desk } : { title: `${ids.length} sessions` };
    if (r.rest.length) st.reading = { rest: r.rest, source };
    const recs = items.map((x) => x.rec).filter(Boolean);
    for (const x of recs) stamp(x, 'announced');
    speak(r.parts, { prompt: false, source, kind, from: items, built, recs });
  }
}
// The open session's turn ended: its line when it needs you (turnWhy, #1181: a turn marked done or quiet, or one that
// does not need you, gets none, and "wants to merge" only when it asked to), and from level open its reply (as Read
// aloud read it before). quiet: the turn ended with report_quiet. With the line fixes on (#1177), no line says it is done
// or wants something: the user is looking at it, and it gets no chime (logged as dropped: viewed). A turn with nothing
// to say is logged as dropped (not waiting), with the label the turn declared in its state.
export function turnEnded(id, { quiet = false } = {}) {
  const cur = page.current();
  if (st.level === 'off' || !st.locked || cur?.id !== id) return;
  const n = page.needOf(id), text = page.lastReply(), reads = levelAtLeast(st.level, 'open') && !!text, fixes = fixesOn();
  if (n.muted) return;
  const why = turnWhy({ ...n, label: n.turnLabel ?? n.label, needs: n.needsTurn ?? n.needs, quiet }); // an open sign-in has its own line (#1260)
  const item = track({ id, title: titleOf(cur), desk: cur.client || page.deskId(), why: why || undefined, pr: why === 'merge' ? n.pr : null, ...(reads ? speakable(text) : { head: [], rest: [] }) }, 'turnEnded');
  if (!why && !reads) { endRec(item.rec, 'not waiting'); return; }
  if (why) fixDo(item.rec, reads ? 'no status line: session being viewed' : 'skip: session being viewed', fixes);
  if (fixes && !reads) { endRec(item.rec, 'viewed'); return; }
  announce(item);
}
// A session's dot settled orange (finished, or needs you): a line when it is under the open session, by how its turn
// stands (an open sign-in has its own line, signinNeeded).
export function settled(s) {
  const cur = page.current(), n = page.needOf(s.id), why = whyOf(n.turnLabel ?? n.label);
  if (!cur || s.id === cur.id || !inFamily(s.id, cur.id, page.parentOf)) return;
  if (!n.muted) announce(track({ id: s.id, title: titleOf(s), desk: s.client, why, pr: n.pr }, 'settled'));
}
// A session asked for a sign-in (#1253): said at once for any session, the open one too, since it may time out:
// "<title> needs you to sign in to <site>."
export function signinNeeded(s) {
  const n = page.needOf(s.id);
  if (whyOf(n.label) !== 'signin' || n.muted) return;
  announce(track({ id: s.id, title: titleOf(s), desk: s.client, why: 'signin', pr: n.pr, site: n.site }, 'signin'));
}
// A report in the open session's chat from a session under it: its first sentence, at level family.
export function childReport(ev) {
  if (!page.current() || ev.news || page.needOf(ev.childId).muted) return; // a muted session or desk is not read (#1269)
  announce(track({ id: ev.childId, title: ev.title, desk: ev.desk || page.deskId(), why: ev.waiting ? 'waiting' : 'done', report: ev.text || '' }, 'childReport'));
}

// ---------- the talk line inside the typing box, and the 🎙 hold button in its bar (#1145) ----------
// While Listen is on the box's edge is tinted, and one slim line above the text shows what was heard, → what it is
// about to do, and its buttons; it shows only when there is something to show. The status takes the place of
// "Enter sends". With Listen off the box is as it always was.
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
function line({ heard, about, confirm = false, sendAs = false, kind = '', tip = false, help = false } = {}) {
  if (!st.listen) return;
  if (heard !== undefined) $('talkHeard').textContent = heard ? `“${heard}”` : '';
  $('talkHeard').hidden = !$('talkHeard').textContent;
  $('talkAbout').textContent = about || '';
  $('talkAbout').className = 'talk-about' + (kind ? ' ' + kind : '');
  $('talkArrow').hidden = !about || $('talkHeard').hidden;
  $('talkYes').hidden = !confirm; $('talkCancel').hidden = !confirm;
  $('talkSendAs').hidden = !sendAs; $('talkTip').hidden = !tip; $('talkMicHelp').hidden = !help;
  $('talkLine').hidden = !about && $('talkHeard').hidden;
  hint();
}
// The status in the box's bar: Ready / Listening with its meter / Say yes or cancel.
function hint() {
  const on = st.listen;
  $('chint').hidden = on; $('talkState').hidden = !on; $('talkMic').hidden = !on;
  $('composeRow').classList.toggle('talk-on', on);
  if (!on) { $('talkLine').hidden = true; return; }
  if (st.rec) return;
  $('talkState').classList.remove('on');
  $('talkState').textContent = (!st.locked ? 'Talk mode is on in another Docket tab'
    : st.pending ? 'Say yes or cancel'
    : !st.ready && st.loadP ? $('talkState').dataset.loading || 'Getting the speech model…'
    : handsOn() ? handsHint()
    : `Hold ${keyName()} to talk`);
}
function showListening(level) {
  $('talkState').textContent = 'Listening…'; $('talkState').classList.add('on');
  $('talkMic').classList.add('listening');
  $('talkLevel').hidden = false; $('talkLevel').firstElementChild.style.width = Math.round(level * 100) + '%';
}
function showIdle(note = '') {
  $('talkMic').classList.remove('listening');
  $('talkLevel').hidden = true;
  hint();
  if (note) line({ about: note });
}
function showLoading(loaded, total) {
  if (!total || st.ready) return;
  $('talkState').dataset.loading = `Getting the speech model (once): ${Math.round(loaded / 1e6)} of ${Math.round(total / 1e6)} MB`;
  hint();
}
// The top bar's 🎙▾ looks on while either switch is on.
function showButton() {
  const on = st.listen || st.level !== 'off';
  $('talkBtn').classList.toggle('on', on);
  if (!$('talkBtn').classList.contains('dl')) $('talkBtn').title = page.tipText('talk-btn', on); // the ring keeps its own
}

// ---------- the two switches: Listen (speech to text) and Read aloud (text to speech) ----------
// One tab at a time listens and speaks: the one holding the 'docket-talk' lock, held while either switch is on here
// and handed on when this tab closes. Only Listen loads the speech model or opens the microphone.
function holdLock() {
  if (!st.listen && st.level === 'off') { st.releaseLock?.(); st.releaseLock = null; st.locked = false; return; }
  if (st.locked || st.lockAsked) return;
  if (!navigator.locks) { st.locked = true; afterLock(); return; }
  st.lockAsked = true;
  navigator.locks.request('docket-talk', () => new Promise((release) => {
    st.lockAsked = false;
    if (!st.listen && st.level === 'off') { release(); return; }
    st.locked = true; st.releaseLock = release; afterLock();
  }));
}
function afterLock() { if (st.listen) loadModel(); if (st.listen && get('handsFree', false)) handsStart(true); wantVoice(); showIdle(); }
export function setListen(on) {
  if (on === st.listen) return;
  st.listen = on; set('listen', on);
  if (!on) { if (handsOn()) setHands(false); dropPending(); stopRec(false); }
  holdLock();
  if (on) { const first = !get('toldReadback', false); if (first) set('toldReadback', true); line({ heard: '', about: first ? READBACK_NOTE : '' }); if (st.locked) loadModel(); }
  showButton(); showIdle(); drawMenu();
}
export function setLevel(level) {
  level = readLevelOf(level);
  if (level === st.level) return;
  st.level = level; set('readLevel', level);
  if (level === 'off') { stopSpeaking('off'); for (const x of st.lines.items) endRec(x.rec, 'off'); clearTimeout(st.lines.timer); st.lines = { items: [], timer: null, doneAt: 0 }; }
  holdLock(); wantVoice(); showButton(); drawMenu();
}

// ---------- hands-free (#1228, experimental): the wake name, then the message (talk-hands.mjs listens) ----------
// On only with Listen on, in the tab holding talk mode; kept in this browser (talk:handsFree). The wake name, the
// method and the mode are this computer's (the app keeps them, GET /api/hands-free), since two computers side by side
// may share one microphone.
export function setHands(on) {
  set('handsFree', !!on);
  if (!on && st.pending?.hands) dropPending()?.onCancel?.();
  if (on && !st.listen) setListen(true);
  if (st.locked || !on) handsStart(!!on);
  drawHands();
}
function handsHint() {
  const s = handsState();
  if (s.err) return 'Hands-free stopped';
  if (!s.ready) return 'Hands-free: getting its listening ready…';
  if (s.state === 'woke') return 'Heard you: go on…';
  if (s.state === 'busy') return 'Working out the words…';
  return `Listening for "${wakeWord()}", or hold ${keyName()}`;
}
// The badge in the top bar while it listens (an indicator in the main color: it shows only while on), and the rest.
function drawHands() {
  const b = $('handsBadge');
  if (b) {
    const s = handsState();
    b.hidden = !s.on;
    if (s.on) {
      $('handsWord').textContent = s.state === 'idle' ? wakeWord() : s.state === 'pending' ? 'sending…' : 'listening…';
      b.title = `${page.tipText('talk-hands-badge')}\n\nListening for "${wakeWord()}"${modeOf(s.cfg?.mode) === 'compare' ? ', compare only (never sends)' : ''}. It turns itself off after ${Math.max(1, Math.ceil(handsLeft() / 60e3))} more minutes without it.`;
      b.classList.toggle('woke', s.state !== 'idle');
    }
  }
  showIdle(); drawMenu();
}
// Hands-free turned itself off (after 30 minutes without the wake name).
function handsOff(why) {
  set('handsFree', false);
  if (st.pending?.hands) dropPending()?.onCancel?.();
  const say = why === 'idle' ? `Hands-free is off: 30 minutes without hearing ${wakeWord()}.` : 'Hands-free is off.';
  line({ about: say }); speak([say], { force: true });
  drawHands();
}
// The message after the wake name (o: { compare, method, many, computer, done(outcome, target) }). A whole screen
// command is done here (next, read it, stop...); anything else goes to the session whose question was read aloud last,
// or the session it names, or the open one: read back, then sent after SEND_PAUSE_MS unless cancelled. Comparison
// mode reads back what it would do and never does it.
async function handsHeard(text, o) {
  st.micAt = Date.now(); st.lastHeard = text;
  const c = parse(text, { pending: !!st.pending }), r = route(text, c, { known }), local = r.via === 'local' && c.kind !== 'answer';
  if (local && !o.compare) { await act(c, text); o.done(c.kind === 'stop' ? 'stopped' : 'confirmed'); return; }
  const cur = page.current(), sessions = page.sessions(true).map((s) => ({ id: s.id, title: titleOf(s), desk: s.client }));
  const t = local ? { target: null, text }
    : chooseTarget(c.kind === 'answer' ? `Q${c.n} ${c.text}` : text, { lastAsked: st.lastAsked, current: cur && { id: cur.id, title: titleOf(cur), desk: cur.client || page.deskId() }, sessions });
  if (!t.target && !local && !o.compare) { const say = 'No session to send it to. Open one, or start with tell and its name.'; line({ heard: text, about: say, kind: 'bad' }); speak([say], { force: true }); o.done('none'); return; }
  if (!t.text) { o.done('empty'); return; }
  const by = o.method.toUpperCase();
  const rb = t.target ? handsReadback({ title: t.target.title, text: t.text, computer: o.computer, many: o.many, compare: o.compare, method: o.method })
    : { say: `Heard you by ${by}. Would ${local ? 'do' : 'send'}: ${t.text}.`, about: `Compare only (${by}): would ${local ? 'do' : 'send, with no session to send it to,'} "${t.text}". Say yes if that was you, or cancel.` };
  dropPending()?.onCancel?.();
  const p = st.pending = { about: rb.about, hands: true, at: Date.now() };
  let over = false;
  const fin = (out, tgt = '') => { if (!over) { over = true; o.done(out, tgt); } };
  const go = async (how) => {
    if (o.compare) { fin(how === 'yes' ? 'confirmed' : 'none'); line({ about: how === 'yes' ? 'Noted: that was you. Nothing was sent (compare only).' : 'Compare only: nothing was sent.' }); if (how === 'yes') speak(['Noted.'], { force: true }); return; }
    try { await page.sendTo(t.target, t.text); line({ about: `Sent to ${t.target.title}.` }); fin(how === 'yes' ? 'confirmed' : 'sent', t.target.title); }
    catch (err) { line({ about: `Not sent: ${err.message}`, kind: 'bad' }); fin('cancelled'); }
  };
  p.run = () => go('yes'); p.onCancel = () => fin('cancelled');
  line({ heard: text, about: rb.about, confirm: true });
  speak([rb.say], { tag: p, force: true });
  // The wait starts once the read-back is said, and holds while someone speaks or words are being worked out (it may be
  // "cancel"); held for more than 20 s (a television that never pauses), it gives up rather than send.
  const due = () => {
    if (st.pending !== p) return;
    if (stillSaying(p) || st.rec || st.wants.size || handsBusy()) {
      if (Date.now() - p.at > 20000) { dropPending(); line({ about: 'Not sent: could not hear a pause to send it in.', kind: 'bad' }); fin('cancelled'); return; }
      p.timer = setTimeout(due, 300); return;
    }
    if (!p.said) { p.said = true; p.timer = setTimeout(due, SEND_PAUSE_MS); return; }
    dropPending(); go('wait');
  };
  p.timer = setTimeout(due, 300);
}
// Hands-free settings and log: the wake name and this computer's name (kept by the app on this computer), the method,
// openWakeWord's model, the mode, and the comparison numbers from <data>/talk-wake.jsonl.
async function handsSettings() {
  let cfg, log;
  try { [cfg, log] = await Promise.all([page.handsConfig(), page.wakeLog()]); } catch (err) { line({ about: `Could not read the hands-free settings: ${err.message}`, kind: 'bad' }); return; }
  const others = page.remoteComputers?.() || [], same = cleanWakeName(cfg.wake) === WAKE_DEFAULT;
  const models = cfg.models?.length ? cfg.models : OWW_MODELS.map(([id, label]) => ({ id, label }));
  const body = `<div class="talk-set hands-set">
    <label>Wake name <input id="hfWake" value="${esc(cfg.wake)}" maxlength="24" spellcheck="false"${page.tip('hands-wake')}></label>
    ${others.length && same ? `<div class="talk-note">Docket on ${esc(others.join(', '))} is connected here. If it listens in the same room, give each computer its own wake name, so one sentence wakes only one.</div>` : ''}
    <label>This computer in the read-back <input id="hfComputer" value="${esc(cfg.computer)}" placeholder="${esc(cfg.hostname || '')}" maxlength="24"${page.tip('hands-computer')}></label>
    <label class="hands-chk"><input type="checkbox" id="hfOthers"${cfg.others ? ' checked' : ''}${page.tip('hands-others')}> Another Docket listens in this room: say this computer's name in the read-back</label>
    <label>Hear the wake name with <select id="hfMethod"${page.tip('hands-method')}>${METHODS.map(([k, n]) => opt(k, n, methodOf(cfg.method))).join('')}</select></label>
    <label>Wake-word model (B) <select id="hfModel"${page.tip('hands-model')}>${models.map((m) => opt(m.id, m.label + (m.custom ? ' (yours)' : ''), cfg.modelB)).join('')}</select></label>
    <label>When it hears you <select id="hfMode"${page.tip('hands-mode')}>${MODES.map(([k, n]) => opt(k, n, modeOf(cfg.mode))).join('')}</select></label>
    <div class="talk-note">A works with any name: the speech model checks the first two seconds of each thing said. B listens for its model's phrase only (${esc(models.map((m) => m.label).join(', '))}); a name of your own uses A until it has a model: put its .onnx file in ${esc(cfg.modelDir || 'the wake-models folder')} and it shows here. openWakeWord's pre-trained models are licensed for non-commercial use only.</div>
    <div class="talk-note">Compare only never sends: each wake is read back and logged with the words heard (never the sound). Say yes when it was you, cancel when it was not.</div>
    <div class="talk-note">Comparison so far:</div><ul class="talk-log"><li>${esc(statWords('a', log.stats?.a))}</li><li>${esc(statWords('b', log.stats?.b))}</li></ul>
    ${log.rows?.length ? `<div class="talk-note">Last wakes:</div><ol class="talk-log">${log.rows.slice().reverse().map((x) => `<li>${esc(wakeWords(x))}</li>`).join('')}</ol>` : ''}
    ${log.file ? `<div class="talk-note">The full log (the last 2000): ${esc(log.file)}</div>` : ''}
    <div class="talk-note">It keeps listening while the screen is locked, and turns itself off after 30 minutes without the wake name. Many Bluetooth headsets and speakerphones give their microphone to one connected computer at a time, so a second computer may hear nothing: Microphone help says which one is picked.</div>
  </div>`;
  if (await page.dialog({ title: 'Hands-free (experimental)', body, buttons: [{ label: 'Cancel', value: null }, { label: 'Save', value: 'save', primary: true }] }) !== 'save') return;
  const v = { wake: cleanWakeName($('hfWake').value), computer: $('hfComputer').value, others: $('hfOthers').checked, method: $('hfMethod').value, modelB: $('hfModel').value, mode: $('hfMode').value };
  try { await page.handsConfig(v); } catch (err) { line({ about: `Could not save the hands-free settings: ${err.message}`, kind: 'bad' }); return; }
  await handsRestart(); drawHands();
}

// The key: held, it listens; any other key while it is held means it was a shortcut, so nothing is kept.
function onKeyDown(e) {
  if (!st.listen || !st.locked) return;
  if (e.code === settings().key) {
    if (e.repeat) return;
    if (!page.canListen()) { line({ about: 'Close the open window first, then hold the key again.' }); return; }
    startRec(); return;
  }
  if (st.rec) stopRec(false);
}
function onKeyUp(e) { if (st.rec && e.code === settings().key) stopRec(true); }

// 🎙 in the box: hold it while you speak (it shows only while Listen is on).
function wireMic(b) {
  let holding = false;
  const down = () => { if (!st.listen || !st.locked || holding) return; holding = true; startRec(); };
  const up = (keep) => { if (!holding) return; holding = false; stopRec(keep); };
  b.addEventListener('pointerdown', (e) => { if (e.button !== 0) return; try { b.setPointerCapture(e.pointerId); } catch {} down(); });
  b.addEventListener('pointerup', () => up(true)); b.addEventListener('pointercancel', () => up(false));
  b.addEventListener('keydown', (e) => { if ((e.key === 'Enter' || e.key === ' ') && !e.repeat) { e.preventDefault(); down(); } });
  b.addEventListener('keyup', (e) => { if (e.key === 'Enter' || e.key === ' ') up(true); });
}

// ---------- 🎙▾ in the top bar: the two switches and the voice ----------
// The menu is made of the parts Docket's other menus use (.ctx items with a ✓ tick, rules, a muted heading and note).
const opt = (v, label, cur) => `<option value="${esc(v)}"${String(v) === String(cur) ? ' selected' : ''}>${esc(label)}</option>`;
function drawMenu() {
  const m = $('talkMenu'); if (!m || m.hidden) return;
  const s = settings();
  const check = (k, on, label, tipId) => `<button role="menuitemcheckbox" aria-checked="${on}" data-talk="${k}"${page.tip(tipId)}><span class="tick">${on ? '✓' : ''}</span>${esc(label)}</button>`;
  const dl = ringOn() ? ringText() : null, item = (k, label, tipId) => `<button role="menuitem" data-talk="${k}"${page.tip(tipId)}><span class="tick"></span>${esc(label)}</button>`;
  m.innerHTML = (dl ? `<div class="tp-h">Natural voice</div><div class="sub-f" id="tmDlNote" aria-live="polite">${esc(noPress(dl.text))}</div>`
      + (dl.paused ? item('resume', 'Resume the download', 'talk-dl-resume') : item('pause', 'Pause the download', 'talk-dl-pause'))
      + item('cancel', "Cancel it and use this computer's voice", 'talk-dl-cancel') + '<hr>' : '')
    + check('listen', st.listen, 'Listen', 'talk-listen')
    + `<button role="menuitemcheckbox" aria-checked="${handsOn()}" data-talk="hands"${page.tip('talk-hands')}><span class="tick">${handsOn() ? '✓' : ''}</span>Hands-free (wake word) <small>experimental</small></button>`
    + item('handsset', 'Hands-free settings and log', 'talk-hands-set') + item('michelp', 'Microphone help', 'talk-mic-help')
    + `<hr><div class="tp-h">When I speak a message</div>`
    + READBACKS.map(([k, n]) => `<button role="menuitemradio" aria-checked="${s.readback === k}" data-talk-readback="${k}"${page.tip('talk-readback-' + k)}><span class="tick">${s.readback === k ? '✓' : ''}</span>${esc(n)}</button>`).join('')
    + `<hr><div class="tp-h">Read aloud</div>`
    + READ_LEVELS.map(([k, n]) => `<button role="menuitemradio" aria-checked="${st.level === k}" data-talk-level="${k}"${page.tip('talk-level-' + k)}><span class="tick">${st.level === k ? '✓' : ''}</span>${esc(n)}</button>`).join('')
    + (st.level === 'off' ? `<div class="sub-f">Docket's chimes still follow ☰ > Sound.</div>` : '')
    + voiceRows(s) + item('canthear', "Can't hear it?", 'talk-cant-hear')
    + `<hr><div class="sub-f">Hold ${esc(keyName())} or 🎙 in the typing box to talk. Audio stays on this computer. The key and the speech model: ☰ > Docket settings > Talk mode.</div>`;
}
// The Voice rows (#1147): the natural voices, then this computer's own as the fallback, each with ▶ to hear it; the
// speed as toggle chips; a line on the natural voice's download.
const RATES = [0.9, 1, 1.1, 1.25, 1.5];
const shortName = (n) => n.replace(/^Microsoft /, '').replace(/ - .*$/, '');
function voiceRows(s) {
  const basic = (window.speechSynthesis?.getVoices() || []).filter((v) => v.localService && /^en/i.test(v.lang));
  const row = (id, name, sub) => {
    const on = s.voice === id;
    return `<div class="tp-v"><button role="menuitemradio" aria-checked="${on}" data-talk-voice="${esc(id)}"${page.tip('talk-voice')}><span class="tick">${on ? '✓' : ''}</span>${esc(name)} <small>${esc(sub)}</small></button>`
      + `<button class="tp-play" data-talk-sample="${esc(id)}" aria-label="Hear ${esc(name)}"${page.tip('talk-sample')}>▶</button></div>`;
  };
  return `<hr><div class="tp-h">Voice</div><div class="tp-voices" role="group" aria-label="Voice">`
    + `<div class="tp-sub">Natural, made on this computer</div>${KOKORO.map(([id, n, where, g]) => row(id, n, `${where} English, ${g}`)).join('')}`
    + (basic.length ? `<div class="tp-sub">This computer's voices (basic)</div>${basic.map((v) => row(v.name, shortName(v.name), v.lang)).join('')}` : '')
    + `</div><div class="tp-h">Speed</div><div class="tp-chips" role="group" aria-label="Speed">${RATES.map((r) => `<button class="chip-tgl${s.rate === r ? ' on' : ''}" data-talk-rate="${r}" aria-pressed="${s.rate === r}"${page.tip('talk-rate')}>${r}×</button>`).join('')}</div>`
    + `<div class="sub-f" id="tmVoiceNote" aria-live="polite">${esc(voiceNote())}</div>`;
}
function voiceNote() {
  const t = st.tts, mb = (b) => Math.round(b / 1e6), last = st.voiceStats.at(-1);
  if (!isKokoro(settings().voice)) return "Read with this computer's own voice.";
  if (t.failed) return `The natural voice did not load (${t.failed}), so this computer's own voice reads instead.`;
  if (t.ready && tooSlow()) return `The natural voice is too slow on the processor here (${t.pace} s for each second of speech), so this computer's own voice reads instead. On the graphics card it is quick: ☰ > Docket settings > Talk mode > Run it on.`;
  if (t.ready) return `Natural voice ready, on the ${t.device === 'webgpu' ? 'graphics card' : 'processor'}${t.bytes ? ` (${mb(t.bytes)} MB)` : ''}.${last ? ` Last reply: first words after ${(last.firstSound / 1000).toFixed(1)} s.` : ''}`;
  if (t.loadP) return t.total && t.loaded < t.total ? `Downloading the natural voice: ${mb(t.loaded)} of ${mb(t.total)} MB. This computer's own voice reads until it is ready.` : 'Getting the natural voice ready…';
  return `Downloaded once, when Read aloud is above Off (${VOICE_MB.wasm} MB, or ${VOICE_MB.webgpu} MB to run on the graphics card). The text stays on this computer.`;
}
function drawVoiceNote() { const n = $('tmVoiceNote'); if (n) n.textContent = voiceNote(); }
// ▶ on a natural voice loads it if need be (the user asked to hear it), then plays it if the menu is still open.
async function sample(id) {
  const name = KOKORO.find(([k]) => k === id)?.[1] || shortName(id);
  if (isKokoro(id) && !st.tts.ready) { try { await loadVoice(); } catch { return; } if ($('talkMenu').hidden) return; }
  stopSpeaking(); enqueue({ kind: 'asked', parts: [`This is ${name}. Replies will sound like this.`], source: {}, voice: id });
}
function menu(open) {
  $('talkMenu').hidden = !open; $('talkBtn').setAttribute('aria-expanded', String(open));
  if (open) { drawMenu(); $('talkMenu').querySelector('.tp-voices [aria-checked="true"]')?.scrollIntoView({ block: 'nearest' }); } else wantVoice();
}
function wireMenu() {
  $('talkBtn').onclick = () => menu($('talkMenu').hidden);
  $('talkMenu').addEventListener('click', (e) => {
    const b = e.target.closest('button'); if (!b) return;
    if (b.dataset.talk === 'listen') setListen(!st.listen);
    else if (b.dataset.talk === 'hands') { setHands(!handsOn()); redraw('[data-talk="hands"]'); }
    else if (b.dataset.talk === 'handsset') { menu(false); handsSettings(); }
    else if (b.dataset.talkLevel) setLevel(b.dataset.talkLevel);
    else if (b.dataset.talkSample) sample(b.dataset.talkSample); // pressed: plays whatever the switches say
    else if (b.dataset.talkVoice) { set('voice', b.dataset.talkVoice); wantVoice(); redraw(`[data-talk-voice="${CSS.escape(b.dataset.talkVoice)}"]`); }
    else if (b.dataset.talkRate) { set('rate', Number(b.dataset.talkRate)); redraw(`[data-talk-rate="${b.dataset.talkRate}"]`); }
    else if (b.dataset.talkReadback) { set('readback', b.dataset.talkReadback); redraw(`[data-talk-readback="${b.dataset.talkReadback}"]`); }
    else if (b.dataset.talk === 'pause') { pauseVoice(); $('talkMenu').querySelector('[data-talk="resume"]')?.focus(); }
    else if (b.dataset.talk === 'resume') { resumeVoice(); $('talkMenu').querySelector('[data-talk="pause"]')?.focus(); }
    else if (b.dataset.talk === 'cancel') { cancelVoice(); menu(false); $('talkBtn').focus(); }
    else if (b.dataset.talk === 'michelp') { menu(false); micHelp(); }
    else if (b.dataset.talk === 'canthear') { menu(false); micHelp('speakers'); }
  });
  // Redrawn in place: the voice list keeps where it was scrolled to, and the pressed control keeps the focus.
  const redraw = (sel) => { const top = $('talkMenu').querySelector('.tp-voices')?.scrollTop; drawMenu(); const v = $('talkMenu').querySelector('.tp-voices'); if (v) v.scrollTop = top; $('talkMenu').querySelector(sel)?.focus(); };
  document.addEventListener('mousedown', (e) => { if (!$('talkMenu').hidden && !e.target.closest('#talkWrap')) menu(false); });
  document.addEventListener('keydown', (e) => { if (!$('talkMenu').hidden && e.key === 'Escape') { e.stopPropagation(); menu(false); $('talkBtn').focus(); } }, true);
}

// ---------- Microphone help (#1224) ----------
// A dialog that checks, in this page, what stands between Talk and the microphone: a secure page, the browser's
// support, the page's permission, the microphones the browser sees, and a short test recording with its level. Then
// the fix steps for what it found, in this computer's words, with links to the OS settings pages, and Try again.
// All of it runs here, never in the app: the browser may be on another computer (Remote Desks). The microphone picked
// here is kept in this browser (talk:mic) and asked for as `ideal`, so one that is gone falls back to the default.
const MIC_SECS = 20; // the test recording stops by itself after this
const micVirtual = (d) => d.deviceId === 'default' || d.deviceId === 'communications'; // Chrome's stand-ins for the OS's picks
const micInputs = () => navigator.mediaDevices.enumerateDevices().then((ds) => ds.filter((d) => d.kind === 'audioinput' && !micVirtual(d)), () => []);
const micPermission = () => navigator.permissions?.query({ name: 'microphone' }).then((p) => p.state, () => '') || Promise.resolve('');
function micStop() {
  const t = st.micTest; st.micTest = null; if (!t) return;
  t.stopped = true; clearTimeout(t.timer); cancelAnimationFrame(t.raf);
  t.stream?.getTracks().forEach((x) => x.stop()); t.ctx?.close().catch(() => {});
  const m = $('micMeter'); if (m) m.hidden = true;
}
// Sound and microphone help (#1226): the same dialog has a Speakers part, which plays a test tone and the voice
// sample, shows whether the browser lets the page play sound, the outputs it sees and a picker, then what to check on
// the computer. part: which comes first, 'mic' (Talk's link) or 'speakers' ("Can't hear it?"). Opened for the speakers,
// the microphone is checked only when asked, so the browser does not ask for it.
export async function micHelp(part = 'mic') {
  const run = ++st.micRun, speakers = part === 'speakers';
  const micBody = `<section class="snd-part" aria-labelledby="micHead"><h3 class="snd-h" id="micHead">Microphone</h3>
    <ul class="mic-checks" id="micChecks" aria-live="polite"><li><span class="mic-ok" aria-hidden="true">…</span>${speakers ? 'Press Check the microphone to test it.' : 'Checking the microphone…'}</li></ul>
    <div class="mic-meter" id="micMeter" role="meter" aria-label="Microphone level" aria-valuemin="0" aria-valuemax="100" hidden><i></i></div>
    <label id="micPickRow" hidden>Microphone for Talk <select id="micPick"${page.tip('talk-mic-pick')}></select></label>
    <div class="talk-note" id="micGone" hidden>The microphone picked before is not connected, so Talk uses the default.</div>
    <div class="talk-note" id="micFixHead" hidden>To fix it</div><ol class="mic-steps" id="micSteps"></ol>
    <div><button id="micAgain"${page.tip('talk-mic-again')}>${speakers ? 'Check the microphone' : 'Try again'}</button></div></section>`;
  const sndBody = `<section class="snd-part" aria-labelledby="sndHead"><h3 class="snd-h" id="sndHead">Speakers</h3>
    <div class="snd-btns"><button id="sndTone"${page.tip('talk-snd-tone')}>Play test tone</button><button id="sndSample"${page.tip('talk-snd-sample')}>Play voice sample</button></div>
    <ul class="mic-checks" id="sndChecks" aria-live="polite"><li><span class="mic-ok" aria-hidden="true">…</span>Checking the speakers…</li></ul>
    <label id="sndPickRow" hidden>Output for Read aloud <select id="sndPick"${page.tip('talk-snd-pick')}></select></label>
    <div class="talk-note">Can't hear it?</div><ol class="mic-steps" id="sndSteps"></ol></section>`;
  const body = `<div class="talk-set mic-help" id="micHelp">${speakers ? sndBody + micBody : micBody + sndBody}</div>`;
  st.sndPlayed = undefined;
  const closed = page.dialog({ title: 'Sound and microphone help', body, buttons: [{ label: 'Close', value: null }] });
  $('micAgain').onclick = () => micCheck(run);
  $('micPick').onchange = () => { set('mic', $('micPick').value); micCheck(run); };
  $('sndTone').onclick = async () => { st.sndPlayed = await sndTone(); sndCheck(run); };
  $('sndSample').onclick = async () => { st.sndPlayed = await sndSample(); sndCheck(run); };
  $('sndPick').onchange = async () => { set('speaker', $('sndPick').value); if (st.tts.ctx) await toSpeaker(st.tts.ctx); st.sndPlayed = undefined; sndCheck(run); };
  const ctx = st.tts.ctx, redraw = () => sndCheck(run);
  ctx?.addEventListener('statechange', redraw);
  sndCheck(run);
  if (!speakers) micCheck(run);
  (speakers ? $('sndTone') : $('micAgain')).focus();
  await closed;
  ctx?.removeEventListener('statechange', redraw);
  if (st.micRun === run) { st.micRun++; micStop(); sndStop(); }
}
// The Speakers part's checks and steps, drawn again after each tone, sample, pick or change of state.
async function sndCheck(run) {
  const outputs = await speakerOutputs();
  if (st.micRun !== run || !$('micHelp')) return;
  const want = get('speaker', ''), state = st.tts.ctx?.state || '', system = !!window.speechSynthesis && !natural(settings().voice);
  const canPick = canPickSpeaker(), p = { hasAudio: !!window.AudioContext, state, outputs, canPick, sink: want, system, played: st.sndPlayed };
  $('sndChecks').innerHTML = soundChecks(p).map((c) => `<li><span class="mic-ok${c.ok === true ? ' ok' : c.ok === false ? ' bad' : ''}" aria-hidden="true">${c.ok === true ? '✓' : c.ok === false ? '✗' : '?'}</span>${esc(c.text)}</li>`).join('');
  // The picker: Default, then each output the browser names an id for (none until the page may use the microphone).
  const outs = (outputs || []).filter((d) => d.deviceId && !virtualDevice(d));
  $('sndPick').innerHTML = opt('', "Default (the computer's choice)", want) + outs.map((d, i) => opt(d.deviceId, d.label || `Output ${i + 1}`, want)).join('');
  $('sndPickRow').hidden = !canPick || (!outs.length && !want);
  $('sndSteps').innerHTML = soundSteps({ mac: !!page.mac, state, system }).map((s) => `<li>${esc(s.text)}${s.open ? ` <a class="lk" href="${esc(s.open[1])}"${page.tip('talk-mic-open')}>${esc(s.open[0])}</a>` : ''}</li>`).join('');
}
// The test tone: two plain notes over about a second and a half, through Read aloud's own AudioContext and output.
// 'played' once the browser lets it play, 'blocked' when it keeps the page silent.
async function sndTone() {
  if (!window.AudioContext) return 'failed';
  stopSpeaking();
  try {
    const ctx = audioCtx();
    await toSpeaker(ctx);
    await Promise.race([ctx.resume?.(), new Promise((ok) => setTimeout(ok, 1500))]);
    if (ctx.state !== 'running') return 'blocked';
    [440, 660].forEach((freq, i) => {
      const at = ctx.currentTime + 0.02 + i * 0.7, osc = ctx.createOscillator(), gain = ctx.createGain();
      osc.type = 'sine'; osc.frequency.value = freq;
      gain.gain.setValueAtTime(0.0001, at);
      gain.gain.exponentialRampToValueAtTime(0.2, at + 0.03);
      gain.gain.setValueAtTime(0.2, at + 0.55);
      gain.gain.exponentialRampToValueAtTime(0.0001, at + 0.65);
      osc.connect(gain).connect(ctx.destination); osc.start(at); osc.stop(at + 0.7);
    });
    return 'played';
  } catch { return 'failed'; }
}
// The voice sample (the same file as the setup card's ▶), through an Audio element: the other way sound leaves the page.
async function sndSample() {
  stopSpeaking(); sndStop();
  const a = st.sndAudio = new Audio('/sounds/voice-sample.wav');
  await toSpeaker(a);
  try { await a.play(); return 'played'; } catch (err) { return err?.name === 'NotAllowedError' ? 'blocked' : 'failed'; }
}
function sndStop() { const a = st.sndAudio; st.sndAudio = null; a?.pause(); }
async function micCheck(run) {
  micStop();
  const live = () => st.micRun === run && !!$('micHelp');
  $('micAgain').disabled = true;
  const p = micPage(), want = get('mic', '');
  let permission = '', inputs = null, kind = null, stream = null;
  if (p.secure && p.hasMedia) {
    [permission, inputs] = await Promise.all([micPermission(), micInputs()]);
    try { stream = await navigator.mediaDevices.getUserMedia({ audio: micAudio(want) }); } catch (err) { kind = micKind(err, p); }
    if (stream) [permission, inputs] = await Promise.all([micPermission(), micInputs()]); // names show once it is allowed
  } else kind = micKind(null, p);
  if (!live()) { stream?.getTracks().forEach((x) => x.stop()); return; }
  $('micAgain').disabled = false; $('micAgain').textContent = 'Try again'; $('micFixHead').hidden = false;
  if (stream) sndCheck(run); // the outputs' names show now too
  const using = stream?.getAudioTracks()[0]?.label || '';
  const draw = (level) => { $('micChecks').innerHTML = micChecks({ ...p, permission, inputs, kind, level, using }).map((c) => `<li><span class="mic-ok${c.ok === true ? ' ok' : c.ok === false ? ' bad' : ''}" aria-hidden="true">${c.ok === true ? '✓' : c.ok === false ? '✗' : '?'}</span>${esc(c.text)}</li>`).join(''); };
  draw(0);
  // The picker: Default, then each microphone; shown when there is a choice to make.
  const ins = inputs || [];
  $('micPick').innerHTML = opt('', "Default (the computer's choice)", want) + ins.map((d, i) => opt(d.deviceId, d.label || `Microphone ${i + 1}`, want)).join('');
  $('micPickRow').hidden = ins.length < 2 && !want;
  $('micGone').hidden = !want || !ins.some((d) => d.label) || ins.some((d) => d.deviceId === want);
  $('micFixHead').textContent = kind === null ? 'If the level does not move when you speak' : 'To fix it';
  $('micSteps').innerHTML = micSteps(kind, { mac: !!page.mac, permission }).map((s) => `<li>${esc(s.text)}${s.open ? ` <a class="lk" href="${esc(s.open[1])}"${page.tip('talk-mic-open')}>${esc(s.open[0])}</a>` : ''}</li>`).join('');
  if (kind === null) {
    if (st.micErr) { st.micErr = null; line({ about: 'The microphone works now. Hold the key to talk.', kind: 'ok' }); }
    micMeter(stream, draw);
  }
}
// The test recording's level, live, for MIC_SECS; the check line says so once it has heard sound.
function micMeter(stream, draw) {
  const t = st.micTest = { stream, peak: 0 };
  try {
    const ctx = t.ctx = new AudioContext(), an = ctx.createAnalyser(); an.fftSize = 1024;
    ctx.createMediaStreamSource(stream).connect(an);
    const buf = new Float32Array(an.fftSize), m = $('micMeter'); m.hidden = false;
    const tick = () => {
      if (t.stopped) return;
      an.getFloatTimeDomainData(buf);
      let sum = 0; for (let i = 0; i < buf.length; i++) sum += buf[i] * buf[i];
      const level = Math.min(1, Math.sqrt(sum / buf.length) * 6);
      m.firstElementChild.style.width = Math.round(level * 100) + '%'; m.setAttribute('aria-valuenow', String(Math.round(level * 100)));
      if (level > 0.02 && t.peak <= 0.02) draw(level);
      t.peak = Math.max(t.peak, level);
      t.raf = requestAnimationFrame(tick);
    };
    tick();
  } catch {}
  t.timer = setTimeout(micStop, MIC_SECS * 1000);
}

// ☰ > Docket settings > Talk mode: the key, the speech model and where it runs.
async function openSettings() {
  const s = settings();
  const last = st.stats.slice(-5);
  const log = await Promise.resolve(page.talkLog?.()).catch(() => null) || { rows: [] }; // Read aloud's timing (#1177)
  const body = `<div class="talk-set">
    <label>Push-to-talk key <select id="tsKey"${page.tip('talk-key')}>${keys().map(([k, n]) => opt(k, n, s.key)).join('')}</select></label>
    <label>Speech model <select id="tsModel"${page.tip('talk-model')}>${opt('base', `Quicker (${SIZES.base.webgpu} MB; ${SIZES.base.wasm} MB on the processor)`, s.model)}${opt('small', `Hears names better (${SIZES.small.webgpu} MB; ${SIZES.small.wasm} MB on the processor)`, s.model)}</select></label>
    <label>Run it on <select id="tsDevice"${page.tip('talk-device')}>${opt('auto', 'Graphics card when there is one', s.device)}${opt('wasm', 'Processor only', s.device)}</select></label>
    <div class="talk-note">Audio stays on this computer: the speech model runs in this page. Screen commands (open, next, scroll, read, go to a desk) are worked out here too; anything else goes as text to the open session, as if typed.${
st.ready ? ` The speech model runs on the ${st.device === 'webgpu' ? 'graphics card (WebGPU)' : 'processor (WASM)'}${st.bytes ? `, ${Math.round(st.bytes / 1e6)} MB` : ''}.` : ''}</div>
    ${last.length ? `<div class="talk-note">Last commands: ${last.map((x) => `key up → text ${x.releaseToText} ms, text → done ${x.textToAction ?? '…'} ms`).join(' · ')}</div>` : ''}
    <div class="talk-note">Read aloud's timing, the last ${log.rows.length || 10}${log.rows.length ? `:</div><ol class="talk-log">${log.rows.slice().reverse().map((r) => `<li>${esc(rowWords(r))}</li>`).join('')}</ol>` : ': nothing yet.</div>'}
    ${log.file ? `<div class="talk-note">The full log (the last 500): ${esc(log.file)}</div>` : ''}
  </div>`;
  if (await page.dialog({ title: 'Talk mode', body, buttons: [{ label: 'Cancel', value: null }, { label: 'Save', value: 'save', primary: true }] }) !== 'save') return;
  // The closed dialog keeps its fields until the next one opens.
  const v = { key: $('tsKey').value, model: $('tsModel').value, device: $('tsDevice').value };
  for (const [k, x] of Object.entries(v)) set(k, x);
  if (st.listen && st.locked) loadModel();
  showIdle();
}

// The switches as they were before: talk:on was talk mode (now Listen, #1145), and the Read aloud switch (talk:read)
// is now the level (talk:readLevel, #1148), where everyone starts on Off, those who had Read aloud on too. The lowest
// level was called Chimes, stored as 'chimes': it is Off now (#1177). A test copy always starts on Off. The "Send what I
// say at once" switch (talk:sendNow) is now "When I speak a message" (talk:readback, #1190): on is Send at once. The
// line fixes (talk:lineFixes) are on by default since #1258: a false stored before then (no menu ever set it) counts as
// unset, once (talk:lineFixesOn marks it done).
export function migrate(get, set) {
  if (!get('lineFixesOn', false)) { if (get('lineFixes', null) === false) set('lineFixes', true); set('lineFixesOn', true); }
  if (get('readback', null) === null && get('sendNow', false) === true) set('readback', 'now');
  if (get('listen', null) === null) set('listen', !!get('on', false));
  const level = get('readLevel', null);
  if (level === null || level === 'chimes') set('readLevel', 'off');
}
export function start(p) {
  page = p; $ = (id) => document.getElementById(id);
  migrate(get, set);
  wireMic($('talkMic')); wireMenu();
  handsInit({ page, get, transcribe, loadModel, line, heard, handsHeard, stopSpeaking, micFailed, draw: drawHands, offBy: handsOff,
    device: () => st.device || 'wasm', speakingNow: () => !!st.playing || !!window.speechSynthesis?.speaking, recording: () => !!st.rec, chime: () => tone(true) });
  $('handsBadge')?.addEventListener('click', () => menu(true));
  $('talkYes').onclick = () => st.pending && act({ kind: 'yes' }, 'Clicked yes');
  $('talkCancel').onclick = () => act({ kind: 'cancel' }, 'Clicked cancel');
  $('talkTip').onclick = () => menu(true);
  $('talkMicHelp').onclick = () => micHelp();
  $('talkSendAs').onclick = async () => { const t = st.lastHeard; line({ about: '' }); if (t) { await page.send(t); line({ about: `Sent to ${titleOf(page.current())}.` }); } };
  addEventListener('keydown', onKeyDown, true); addEventListener('keyup', onKeyUp, true);
  addEventListener('blur', () => { if (st.rec) stopRec(false); });
  window.speechSynthesis?.getVoices(); // the list fills in later in some browsers
  showButton(); hint(); drawRing();
  Promise.resolve(page.testCopy).then((test) => {
    st.testCopy = !!test;
    if (test) set('readLevel', 'off');
    setLevel(get('readLevel', 'off'));
    if (get('listen', false)) setListen(true);
  });
  return { setListen, setLevel, setHands, handsState, setScreenLocked, setLineFixes: (on) => set('lineFixes', !!on), acting: (path, body) => acted(actedOn(path, body), actName(path, body), !!signinAct(path, body)), turnEnded, settled, signinNeeded, childReport, speaking, skipSpeaking, played: st.played,

 transcribe, heard, speak, stopSpeaking, openSettings, micHelp, askMic, toSpeaker, stats: st.stats, said: st.said, state: st, keyName, settings, chooseVoice, hearSystem, hearLine, hearTone, voiceMB: VOICE_MB.webgpu };
}
