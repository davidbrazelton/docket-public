// Hands-free Talk's model files (#1228), kept by the app in <data>/wake-models and served to the page at
// /api/wake-model/<name>.onnx, so the page fetches them from Docket itself (openWakeWord's release files cannot be
// fetched by a page from GitHub). Each known file is fetched once from a pinned release; a wake-word model you train
// yourself is dropped into the same folder (its file name is its phrase: docket.onnx, hey_desk.onnx) and shows in the
// hands-free settings as yours.
import fs from 'node:fs';
import path from 'node:path';
import { OWW_MODELS } from './talk-wake.mjs';

const OWW_RELEASE = 'https://github.com/dscripka/openWakeWord/releases/download/v0.5.1/';
export const KNOWN = {
  // Silero VAD v5, as onnx-community publishes it (pinned to one revision)
  silero_vad: 'https://huggingface.co/onnx-community/silero-vad/resolve/e71cae966052b992a7eca6b17738916ce0eca4ec/onnx/model.onnx',
  melspectrogram: OWW_RELEASE + 'melspectrogram.onnx',
  embedding_model: OWW_RELEASE + 'embedding_model.onnx',
  ...Object.fromEntries(OWW_MODELS.map(([id]) => [id, `${OWW_RELEASE}${id}.onnx`])),
};
const SUPPORT = new Set(['silero_vad', 'melspectrogram', 'embedding_model']);
export const MAX_BYTES = 20e6;
export const validName = (n) => typeof n === 'string' && /^[A-Za-z0-9][\w.-]{0,63}$/.test(n) && !n.includes('..');
// A model's phrase from its file name: hey_desk_v0.2 → "Hey desk".
export const labelOf = (id) => { const t = id.replace(/_v\d+(?:\.\d+)*$/, '').replace(/[_-]+/g, ' ').trim(); return t ? t[0].toUpperCase() + t.slice(1) : id; };
// The wake-word models to choose from: the pre-trained ones, then any of your own in the folder.
export function modelList(dir) {
  let files = []; try { files = fs.readdirSync(dir); } catch {}
  const own = files.filter((f) => f.endsWith('.onnx')).map((f) => f.slice(0, -5)).filter((id) => validName(id) && !KNOWN[id] && !SUPPORT.has(id)).sort();
  return [...OWW_MODELS.map(([id, label]) => ({ id, label })), ...own.map((id) => ({ id, label: labelOf(id), custom: true }))];
}
// The file for a model, fetched first when it is a known one not here yet (one fetch at a time for each). null: unknown.
const fetching = new Map();
export async function modelFile(dir, name, { fetchFn = fetch } = {}) {
  if (!validName(name)) return null;
  const file = path.join(dir, `${name}.onnx`);
  if (fs.existsSync(file)) return file;
  if (!KNOWN[name]) return null;
  if (!fetching.has(name)) {
    fetching.set(name, (async () => {
      const r = await fetchFn(KNOWN[name], { redirect: 'follow' });
      if (!r.ok) throw new Error(`${name}: ${r.status} from ${new URL(KNOWN[name]).host}`);
      const buf = Buffer.from(await r.arrayBuffer());
      if (buf.length > MAX_BYTES || buf.length < 1000) throw new Error(`${name}: unexpected size ${buf.length}`);
      fs.mkdirSync(dir, { recursive: true });
      const tmp = `${file}.${process.pid}.tmp`;
      fs.writeFileSync(tmp, buf); fs.renameSync(tmp, file);
      return file;
    })().finally(() => fetching.delete(name)));
  }
  return fetching.get(name);
}
