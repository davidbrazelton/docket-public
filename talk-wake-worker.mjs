// Hands-free Talk's listening (#1228), in a worker so the page never stalls: the voice activity detector (Silero VAD)
// on every 32 ms of sound, and with method B the openWakeWord models on every 80 ms (talk-wake.mjs keeps their rolling
// features). Nothing is kept: each message's audio is looked at and let go. The model files come from Docket itself
// (GET /api/wake-model/<name>.onnx, which fetches each once from its maker into <data>/wake-models), so audio and
// models never meet anywhere else. Messages in: { t: 'load', b } (b: openWakeWord model name, or '' for none) and
// { t: 'audio', audio } (16 kHz mono). Out: { t: 'ready', ms, b }, { t: 'heard', vad: [chance of speech a frame], b:
// [score a chunk], ms: { vad, b } } and { t: 'error', error }.
import * as ort from 'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.20.1/dist/ort.wasm.min.mjs';
import { newWakeStream, pushWake, newFramer, frames } from './talk-wake.mjs';

ort.env.wasm.wasmPaths = 'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.20.1/dist/';
ort.env.wasm.numThreads = 1; // the page is not cross-origin isolated, so one thread is all there is
const model = (name) => ort.InferenceSession.create(`/api/wake-model/${encodeURIComponent(name)}.onnx`, { executionProviders: ['wasm'] });
let vad = null, oww = null, loading = null, busy = Promise.resolve();

// Silero VAD v5: 512 new samples with the last 64 of the frame before, and its state carried from frame to frame.
async function loadVad() {
  const s = await model('silero_vad');
  return { s, state: new ort.Tensor('float32', new Float32Array(2 * 128), [2, 1, 128]), sr: new ort.Tensor('int64', BigInt64Array.from([16000n]), []), ctx: new Float32Array(64), framer: newFramer(512) };
}
async function vadRun(v, x) {
  const input = new Float32Array(576); input.set(v.ctx); input.set(x, 64); v.ctx = x.slice(-64);
  const r = await v.s.run({ input: new ort.Tensor('float32', input, [1, 576]), state: v.state, sr: v.sr });
  v.state = r.stateN;
  return r.output.data[0];
}
async function loadOww(name) {
  const [mel, emb, wake] = await Promise.all([model('melspectrogram'), model('embedding_model'), model(name)]);
  return newWakeStream({
    mel: async (x) => { const o = (await mel.run({ [mel.inputNames[0]]: new ort.Tensor('float32', x, [1, x.length]) }))[mel.outputNames[0]]; return { data: o.data, frames: o.dims[2] }; },
    embed: async (x) => (await emb.run({ [emb.inputNames[0]]: new ort.Tensor('float32', x, [1, 76, 32, 1]) }))[emb.outputNames[0]].data,
    wake: async (x) => (await wake.run({ [wake.inputNames[0]]: new ort.Tensor('float32', x, [1, 16, 96]) }))[wake.outputNames[0]].data[0],
  });
}
async function load(b) {
  const t0 = performance.now();
  [vad, oww] = await Promise.all([vad || loadVad(), b ? loadOww(b) : null]);
  postMessage({ t: 'ready', ms: Math.round(performance.now() - t0), b });
}
async function heard(audio) {
  const out = { t: 'heard', vad: [], b: [], ms: { vad: 0, b: 0 } };
  let t0 = performance.now();
  for (const x of frames(vad.framer, audio)) out.vad.push(await vadRun(vad, x));
  out.ms.vad = performance.now() - t0;
  if (oww) { t0 = performance.now(); out.b = await pushWake(oww, audio); out.ms.b = performance.now() - t0; }
  postMessage(out);
}

onmessage = ({ data }) => {
  // one at a time, in order: the models keep state from one frame to the next
  busy = busy.then(async () => {
    try {
      if (data.t === 'load') { loading = load(data.b || ''); await loading; }
      else if (data.t === 'audio') { await loading; if (vad) await heard(data.audio); }
    } catch (err) {
      if (data.t === 'load') { loading = null; vad = null; oww = null; }
      postMessage({ t: 'error', error: String(err?.message || err) });
    }
  });
};
