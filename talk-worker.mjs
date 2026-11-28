// Talk mode's speech-to-text (#1105): Whisper on this computer, in a worker so the page never stalls while it works.
// The model files come from Hugging Face once and stay in the browser's cache ('transformers-cache'); audio never
// leaves this worker. Messages in: { t: 'load', model, device } and { t: 'transcribe', id, audio, prompt }.
// Messages out: { t: 'progress', loaded, total }, { t: 'ready', device, model, ms, bytes }, { t: 'text', id, text, ms }, { t: 'error', id, error }.
import { AutoTokenizer, AutoProcessor, WhisperForConditionalGeneration, Tensor, env } from 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@4.3.2/dist/transformers.min.js';

env.allowLocalModels = false;
// On the graphics card, Base (or Small); on the processor alone one size down, since the page is not cross-origin
// isolated and WASM runs on one thread there: Base took ~10 s a command on a 2026 laptop, Tiny ~4.5 s.
const MODELS = {
  webgpu: { base: 'onnx-community/whisper-base.en', small: 'onnx-community/whisper-small.en' },
  wasm: { base: 'onnx-community/whisper-tiny.en', small: 'onnx-community/whisper-base.en' },
};
let m = null, loading = null;

async function gpu() {
  try { const a = navigator.gpu && await navigator.gpu.requestAdapter(); return a ? { f16: a.features.has('shader-f16') } : null; } catch { return null; }
}

async function load(model = 'base', want = 'auto') {
  const g = want === 'wasm' ? null : await gpu();
  const device = g ? 'webgpu' : 'wasm', id = MODELS[device][model] || MODELS[device].base;
  // The encoder is the slow part: half precision on a card that has it (3× quicker than full on an Intel Iris Xe),
  // and the decoder at 4 bits. On the processor both are 8-bit.
  const dtype = g ? { encoder_model: g.f16 ? 'fp16' : 'fp32', decoder_model_merged: 'q4' } : { encoder_model: 'q8', decoder_model_merged: 'q8' };
  const t0 = performance.now(), files = new Map();
  const progress_callback = (p) => {
    if (p.status !== 'progress' && p.status !== 'done') return;
    if (p.total) files.set(p.file, { loaded: p.status === 'done' ? p.total : p.loaded, total: p.total });
    let loaded = 0, total = 0; for (const f of files.values()) { loaded += f.loaded; total += f.total; }
    postMessage({ t: 'progress', loaded, total });
  };
  const [tok, proc, net] = await Promise.all([
    AutoTokenizer.from_pretrained(id, { progress_callback }),
    AutoProcessor.from_pretrained(id, { progress_callback }),
    WhisperForConditionalGeneration.from_pretrained(id, { device, dtype, progress_callback }),
  ]);
  const ids = (t) => tok.convert_tokens_to_ids([t])[0];
  m = { id, device, tok, proc, net, prev: ids('<|startofprev|>'), init: [ids('<|startoftranscript|>'), ids('<|notimestamps|>')] };
  // One short run so the first real command does not pay for compiling the GPU shaders.
  await transcribe(new Float32Array(16000), '');
  let bytes = 0; for (const f of files.values()) bytes += f.total;
  postMessage({ t: 'ready', device, model: id, ms: Math.round(performance.now() - t0), bytes });
}

// Whisper's features always cover 30 s, and working them out over 30 s of padding took ~0.7 s of every command.
// Only the clip and half a second of silence are worked out; the rest is the value silence comes to, which is the
// floor log10_max_norm clamps to (the loudest value less 8, then scaled: the largest feature less 2). Same numbers.
async function features(audio) {
  const fe = m.proc.feature_extractor, hop = fe.config.hop_length, total = fe.config.nb_max_frames;
  const len = Math.min(fe.config.n_samples, Math.ceil((audio.length + 8000) / hop) * hop);
  const f = (await fe(audio, { max_length: len })).input_features;
  const [, bins, frames] = f.dims;
  if (frames >= total) return f;
  let max = -Infinity; for (const v of f.data) if (v > max) max = v;
  const out = new Float32Array(bins * total).fill(max - 2);
  for (let i = 0; i < bins; i++) out.set(f.data.subarray(i * frames, (i + 1) * frames), i * total);
  return new Tensor('float32', out, [1, bins, total]);
}

// The words heard in 16 kHz mono audio. prompt: earlier text that primes the model with the names it should expect.
// On the processor every prompt word costs time (a 100-word prompt added ~2 s), so only its end, the session names, is kept.
async function transcribe(audio, prompt) {
  const input_features = await features(audio);
  const pre = prompt ? [m.prev, ...m.tok.encode(' ' + prompt.trim(), { add_special_tokens: false }).slice(m.device === 'webgpu' ? -180 : -48)] : [];
  const dec = [...pre, ...m.init];
  const out = await m.net.generate({ inputs: input_features, decoder_input_ids: dec, max_new_tokens: 96 });
  const seq = Array.from(out.tolist ? out.tolist()[0] : out[0], Number);
  return m.tok.decode(seq.slice(dec.length), { skip_special_tokens: true }).trim();
}

onmessage = async ({ data }) => {
  try {
    if (data.t === 'load') {
      if (!loading || data.model !== loading.model || data.device !== loading.device) {
        if (m) { const old = m.net; m = null; old.dispose?.(); }
        loading = { model: data.model, device: data.device, p: load(data.model, data.device) };
      }
      await loading.p;
    } else if (data.t === 'transcribe') {
      await loading?.p;
      if (!m) throw new Error('The speech model is not loaded');
      const t0 = performance.now();
      const text = await transcribe(data.audio, data.prompt);
      postMessage({ t: 'text', id: data.id, text, ms: Math.round(performance.now() - t0) });
    }
  } catch (err) {
    if (data.t === 'load') loading = null;
    postMessage({ t: 'error', id: data.id, error: String(err?.message || err) });
  }
};
