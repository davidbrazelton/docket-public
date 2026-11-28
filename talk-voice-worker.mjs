// Talk mode's voice (#1147): Kokoro-82M on this computer, in a worker, so replies are read in a natural voice without
// the text leaving the page. The model comes from Hugging Face once and stays in the browser's cache ('transformers-cache',
// and each voice's style in 'kokoro-voices'). kokoro-js's browser build carries its own transformers (3.5.1), pinned with it.
// Messages in: { t: 'load', device }, { t: 'say', id, text, voice, speed } and { t: 'drop', upto }.
// Messages out: { t: 'progress', loaded, total }, { t: 'ready', device, ms, bytes, pace }, { t: 'audio', id, audio, rate, ms },
// { t: 'error', id, error } (no id: the load failed).
import { KokoroTTS } from 'https://cdn.jsdelivr.net/npm/kokoro-js@1.2.1/dist/kokoro.web.js';

const MODEL = 'onnx-community/Kokoro-82M-v1.0-ONNX';
let tts = null, loading = null, dropped = 0, queue = Promise.resolve();

async function gpu() {
  try { return !!(navigator.gpu && await navigator.gpu.requestAdapter()); } catch { return false; }
}

// On the graphics card full precision (326 MB): its 8-bit model sounds garbled there, and half precision (163 MB) was
// clipped twice as loud and turned a long sentence into silence (NaN) on an Intel laptop GPU (#1154). On the processor
// 8-bit (92 MB).
async function load(want = 'auto') {
  const device = want !== 'wasm' && await gpu() ? 'webgpu' : 'wasm';
  const t0 = performance.now(), files = new Map();
  const progress_callback = (p) => {
    if (p.status !== 'progress' && p.status !== 'done') return;
    if (p.total) files.set(p.file, { loaded: p.status === 'done' ? p.total : p.loaded, total: p.total });
    let loaded = 0, total = 0; for (const f of files.values()) { loaded += f.loaded; total += f.total; }
    postMessage({ t: 'progress', loaded, total });
  };
  tts = await KokoroTTS.from_pretrained(MODEL, { dtype: device === 'webgpu' ? 'fp32' : 'q8', device, progress_callback });
  // One short run so the first reply does not pay for compiling the GPU shaders, and a second to time: pace is the
  // seconds it takes to make one second of speech (above 1, reading cannot keep up and leaves gaps).
  await tts.generate('Ready.', { voice: 'af_heart' });
  const t1 = performance.now(), out = await tts.generate('This is how fast it reads.', { voice: 'af_heart' });
  const pace = +((performance.now() - t1) / 1000 / (out.audio.length / out.sampling_rate)).toFixed(2);
  let bytes = 0; for (const f of files.values()) bytes += f.total;
  postMessage({ t: 'ready', device, ms: Math.round(performance.now() - t0), bytes, pace });
}

// One sentence at a time, in order: the page plays each while the next is made. Dropped ones are skipped.
async function say({ id, text, voice, speed }) {
  if (id <= dropped) return;
  await loading?.p;
  if (!tts) throw new Error('The voice is not loaded');
  const t0 = performance.now();
  const out = await tts.generate(text, { voice, speed });
  if (id <= dropped) return;
  const audio = out.audio.slice();
  postMessage({ t: 'audio', id, audio, rate: out.sampling_rate, ms: Math.round(performance.now() - t0) }, [audio.buffer]);
}

onmessage = ({ data }) => {
  if (data.t === 'load') {
    if (!loading || data.device !== loading.device) loading = { device: data.device, p: load(data.device) };
    loading.p.catch((err) => { loading = null; postMessage({ t: 'error', error: String(err?.message || err) }); });
  } else if (data.t === 'say') {
    queue = queue.then(() => say(data)).catch((err) => postMessage({ t: 'error', id: data.id, error: String(err?.message || err) }));
  } else if (data.t === 'drop') dropped = Math.max(dropped, data.upto);
};
