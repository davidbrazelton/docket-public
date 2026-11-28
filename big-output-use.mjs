// What the big-output hook (plugin/hooks/big-output.mjs) did, for the Usage page (#748): per day and desk, the results
// it cut, the characters they had and kept, and how often the session read back what was cut. Many reads back mean
// the cut costs more calls than it saves. Each session's folder under data/tool-output holds a log.jsonl; a folder
// the app removes after KEEP_DAYS is added up into data/tool-output-use.json first, so the counts outlive it.
import fs from 'node:fs';
import path from 'node:path';

export const OUTPUT_LOG = 'log.jsonl'; // in each session's folder, one JSON line per cut or read back
const key = (r) => `${r.date}|${r.client}`;
const blank = (date, client) => ({ date, client, cuts: 0, chars: 0, kept: 0, rereads: 0 });

// One session's log lines as day rows for its desk.
export function outputUseRows(lines, client = '') {
  const out = new Map();
  for (const l of lines) {
    const t = new Date(l?.at || NaN);
    if (isNaN(t)) continue;
    const date = `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, '0')}-${String(t.getDate()).padStart(2, '0')}`; // local, as the usage rows
    const r = out.get(`${date}|${client}`) || blank(date, client);
    if (l.kind === 'cut') { r.cuts++; r.chars += l.chars || 0; r.kept += Math.min(l.kept || 0, l.chars || 0); }
    else if (l.kind === 'reread') r.rereads++;
    out.set(key(r), r);
  }
  return [...out.values()];
}

// Day rows added together.
export function addRows(...lists) {
  const out = new Map();
  for (const r of lists.flat()) {
    const t = out.get(key(r)) || blank(r.date, r.client);
    t.cuts += r.cuts; t.chars += r.chars; t.kept += r.kept; t.rereads += r.rereads;
    out.set(key(t), t);
  }
  return [...out.values()].sort((a, b) => a.date.localeCompare(b.date) || a.client.localeCompare(b.client));
}

export const readLog = (file) => { try { return fs.readFileSync(file, 'utf8').split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean); } catch { return []; } };

// The session folders under root, each with the time its newest file was written.
export function outputFolders(root) {
  let names = [];
  try { names = fs.readdirSync(root, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name); } catch {}
  return names.map((id) => {
    const dir = path.join(root, id);
    let newest = 0;
    try { for (const f of fs.readdirSync(dir)) newest = Math.max(newest, fs.statSync(path.join(dir, f)).mtimeMs); } catch {}
    return { id, dir, newest };
  });
}
