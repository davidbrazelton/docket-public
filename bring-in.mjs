// Bring in past sessions: Claude Code conversations this person had before Docket, in a Claude home other than
// the company's (~/.claude, an earlier CLAUDE_CONFIG_DIR), copied into the company's home so its session list, search
// and costs show them. Copied, never moved: the originals stay, so the old setup keeps working. A report is written
// before anything is copied, and Undo sends only the copies to the Recycle Bin (Trash on a Mac). Kept apart from
// server.mjs so the tests can try it on made-up home folders.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { head, cwdIn } from './work-folders.mjs';

const dirs = (p) => { try { return fs.readdirSync(p, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name); } catch { return []; } };
const isDir = (p) => { try { return fs.statSync(p).isDirectory(); } catch { return false; } };
const real = (p) => { try { return fs.realpathSync.native(p); } catch { return path.resolve(p); } };
const keyOf = (win) => (p) => { const r = real(p).replace(/[\\/]+$/, ''); return win ? r.toLowerCase() : r; };
// a is b, or inside it
const within = (a, b, win) => { const k = keyOf(win); const ka = k(a), kb = k(b); return ka === kb || ka.startsWith(kb + path.sep); };
// A session id is the file name Claude Code gave it (a uuid); nothing else is copied.
const ID_RE = /^[A-Za-z0-9][A-Za-z0-9_-]{0,99}$/;

// Every file under a folder, as full paths.
function walk(dir) {
  const out = [];
  let list = []; try { list = fs.readdirSync(dir, { withFileTypes: true }); } catch { return out; }
  for (const d of list) { const p = path.join(dir, d.name); if (d.isDirectory()) out.push(...walk(p)); else if (d.isFile()) out.push(p); }
  return out;
}
const sizeOf = (f) => { try { return fs.statSync(f).size; } catch { return 0; } };
function tail(file, bytes = 64 * 1024) {
  let fd; try {
    fd = fs.openSync(file, 'r'); const size = fs.fstatSync(fd).size, n = Math.min(bytes, size), b = Buffer.alloc(n);
    return b.toString('utf8', 0, fs.readSync(fd, b, 0, n, size - n));
  } catch { return ''; } finally { if (fd !== undefined) fs.closeSync(fd); }
}
export function sha256(file) { return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex'); }

// The Claude homes to look in, and the ones left out with why. A home is a folder holding projects\ (a projects
// folder itself is taken as its home). Looked in: ~/.claude, other .claude* folders in the user folder, the
// CLAUDE_CONFIG_DIR Docket was started with, and folders the person named (extra). Never this company's own home,
// and never another company's (others: [{ name, home }]), nor a folder inside or around one of them.
export function sourceHomes({ userHome, target, others = [], extra = [], env = {}, win = process.platform === 'win32' }) {
  const cands = [{ home: path.join(userHome, '.claude'), why: 'your own Claude folder' }];
  for (const d of dirs(userHome)) if (/^\.claude./i.test(d)) cands.push({ home: path.join(userHome, d), why: 'a Claude folder in your user folder' });
  if (env.CLAUDE_CONFIG_DIR) cands.push({ home: env.CLAUDE_CONFIG_DIR, why: 'the Claude folder Docket was started with' });
  for (const e of extra) if (e) cands.push({ home: e, why: 'a folder you named', named: true });
  const homes = [], refused = [], seen = new Set(), k = keyOf(win);
  for (const c of cands) {
    let home = path.resolve(c.home);
    if (!isDir(path.join(home, 'projects')) && path.basename(home).toLowerCase() === 'projects' && isDir(home)) home = path.dirname(home);
    if (seen.has(k(home))) continue;
    seen.add(k(home));
    if (within(home, target, win) || within(target, home, win)) { refused.push({ home, why: "It is this desk's own Claude home." }); continue; }
    if (!isDir(path.join(home, 'projects'))) { if (c.named) refused.push({ home, why: 'There is no Claude Code projects folder in it.' }); continue; }
    const other = others.find((o) => o.home && (within(home, o.home, win) || within(o.home, home, win)));
    if (other) { refused.push({ home, why: `It is ${other.name}'s Claude home: another desk's sessions are never brought in.` }); continue; }
    homes.push({ home, why: c.why });
  }
  return { homes, refused };
}

// The text of a message, when the person typed it (not a tool result or a command Claude Code added).
function typed(m) {
  const c = m?.content;
  const t = typeof c === 'string' ? c : Array.isArray(c) ? c.filter((b) => b?.type === 'text').map((b) => b.text).join(' ') : '';
  return t && !/^\s*</.test(t) ? t.replace(/\s+/g, ' ').trim() : '';
}
// What the list shows of one conversation file: its title (the name it was given, else its summary, else its first
// message), its working folder, and when it started and last changed. Only its top and bottom are read.
export function summarize(file, read = head) {
  const top = read(file), bottom = tail(file);
  const lines = (t) => t.split('\n').map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
  const a = lines(top), z = lines(bottom);
  const named = [...a, ...z].reverse().find((e) => e.type === 'custom-title' && e.customTitle)?.customTitle;
  const summary = [...a, ...z].reverse().find((e) => e.type === 'summary' && e.summary)?.summary;
  const first = a.map((e) => e.type === 'user' && typed(e.message)).find(Boolean);
  const when = (l) => l.map((e) => Date.parse(e.timestamp)).filter((x) => x > 0);
  const starts = when(a), ends = when(z);
  return {
    title: String(named || summary || first || '(untitled)').slice(0, 120),
    cwd: cwdIn(top) || null,
    first: starts.length ? Math.min(...starts) : null,
    last: ends.length ? Math.max(...ends) : starts.length ? Math.max(...starts) : null,
  };
}

// The session ids already in a Claude home.
export function idsIn(home) {
  const out = new Set();
  const p = path.join(home, 'projects');
  for (const d of dirs(p)) { let n = []; try { n = fs.readdirSync(path.join(p, d)); } catch {} for (const f of n) if (f.endsWith('.jsonl')) out.add(f.slice(0, -6)); }
  return out;
}

// What the wizard shows: one group per home and project folder (one working folder), each with its sessions. A
// session already in the target home is 'here' (skipped, never overwritten); one found again in a later home is
// 'twice' (brought in once, from the first); the rest are 'new'.
export function findGroups({ homes, target, read = head }) {
  const have = idsIn(target), seen = new Set(), groups = [];
  for (const { home, why } of homes) {
    const projects = path.join(home, 'projects');
    for (const dir of dirs(projects).sort()) {
      let names = []; try { names = fs.readdirSync(path.join(projects, dir)).filter((n) => n.endsWith('.jsonl')); } catch {}
      const sessions = [];
      for (const n of names) {
        const id = n.slice(0, -6), file = path.join(projects, dir, n);
        if (!ID_RE.test(id)) continue;
        const side = path.join(projects, dir, id);
        const bytes = sizeOf(file) + (isDir(side) ? walk(side).reduce((a, f) => a + sizeOf(f), 0) : 0);
        const status = have.has(id) ? 'here' : seen.has(id) ? 'twice' : 'new';
        if (status === 'new') seen.add(id);
        sessions.push({ id, file, bytes, status, ...summarize(file, read) });
      }
      if (!sessions.length) continue;
      sessions.sort((x, y) => (y.last || 0) - (x.last || 0));
      const fresh = sessions.filter((s) => s.status === 'new'), times = fresh.flatMap((s) => [s.first, s.last]).filter(Boolean);
      groups.push({
        key: path.join(projects, dir), home, why, dir, cwd: sessions.find((s) => s.cwd)?.cwd || null, sessions,
        count: fresh.length, bytes: fresh.reduce((a, s) => a + s.bytes, 0),
        first: times.length ? Math.min(...times) : null, last: times.length ? Math.max(...times) : null,
      });
    }
  }
  return groups;
}

// The run a pick makes, before anything is copied: for each new session in the picked groups, where it is, where its
// copy goes (<target>\projects\<same folder name>), and every file with its size and checksum.
export function planRun({ groups, picked, target, client, now = Date.now(), id = crypto.randomUUID().slice(0, 8) }) {
  const items = [];
  for (const g of groups) if (picked.includes(g.key)) for (const s of g.sessions) if (s.status === 'new') {
    const fromDir = path.dirname(s.file), toDir = path.join(target, 'projects', g.dir);
    const fromSide = path.join(fromDir, s.id), toSide = path.join(toDir, s.id);
    const files = [s.file, ...(isDir(fromSide) ? walk(fromSide) : [])].map((f) => {
      const to = path.join(toDir, path.relative(fromDir, f));
      return { from: f, to, size: sizeOf(f), sha256: sha256(f) };
    });
    items.push({ id: s.id, title: s.title, cwd: s.cwd, from: s.file, to: path.join(toDir, s.id + '.jsonl'),
      ...(isDir(fromSide) ? { fromSide, toSide } : {}), size: files.reduce((a, f) => a + f.size, 0), files, status: 'planned' });
  }
  return { id, at: now, client, target, items };
}

// Where a run's report goes: <data>\bring-in\<company>-<run>.json, with a page beside it to read.
export const reportPaths = (dataDir, run) => {
  const base = path.join(dataDir, 'bring-in', `${run.client}-${run.id}`);
  return { json: base + '.json', html: base + '.html' };
};
// Writes both; the JSON (what Undo reads) through a temporary file, so a half-written report never replaces a whole one.
export function writeReport(dataDir, run) {
  const p = reportPaths(dataDir, run);
  fs.mkdirSync(path.dirname(p.json), { recursive: true });
  fs.writeFileSync(p.json + '.tmp', JSON.stringify(run, null, 2));
  fs.renameSync(p.json + '.tmp', p.json);
  fs.writeFileSync(p.html, reportHtml(run));
  return p;
}
export function readReports(dataDir, client) {
  const dir = path.join(dataDir, 'bring-in');
  let names = []; try { names = fs.readdirSync(dir).filter((n) => n.startsWith(client + '-') && n.endsWith('.json')); } catch {}
  return names.map((n) => { try { return JSON.parse(fs.readFileSync(path.join(dir, n), 'utf8')); } catch { return null; } })
    .filter((r) => r && r.client === client && Array.isArray(r.items)).sort((a, b) => b.at - a.at);
}

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const mb = (b) => b >= 1024 * 1024 ? (b / 1024 / 1024).toFixed(1) + ' MB' : Math.max(1, Math.round(b / 1024)) + ' KB';
const day = (t) => t ? new Date(t).toISOString().slice(0, 10) : '';
const WORDS = { planned: 'not copied yet', copied: 'copied', there: 'skipped: already in this home', failed: 'could not be copied', undone: 'copy sent to the Recycle Bin', gone: 'copy already gone' };
// The page to read: when, into which home, and for every session where it was, where its copy is, size and checksum.
export function reportHtml(run) {
  const rows = run.items.map((i) => `<tr><td>${esc(i.title)}<div class="id">${esc(i.id)}</div></td><td>${esc(i.cwd)}</td>`
    + `<td><code>${esc(i.from)}</code>${i.fromSide ? `<br><code>${esc(i.fromSide)}</code>` : ''}</td><td><code>${esc(i.to)}</code>${i.toSide ? `<br><code>${esc(i.toSide)}</code>` : ''}</td>`
    + `<td>${mb(i.size)}<div class="id">${i.files.length} file${i.files.length === 1 ? '' : 's'}</div></td><td><code>${esc(i.files[0]?.sha256.slice(0, 16))}…</code></td>`
    + `<td>${esc(WORDS[i.status] || i.status)}${i.error ? ` (${esc(i.error)})` : ''}</td></tr>`).join('');
  const copied = run.items.filter((i) => i.status === 'copied' || i.status === 'undone').length;
  return `<!doctype html><meta charset="utf-8"><title>Brought in past sessions ${esc(day(run.at))}</title>
<style>body{font:14px system-ui,sans-serif;margin:24px;color:#222}table{border-collapse:collapse;width:100%}td,th{border-bottom:1px solid #ddd;padding:6px 8px;text-align:left;vertical-align:top}code{font-size:12px;word-break:break-all}.id{color:#777;font-size:12px}</style>
<h1>Past sessions brought in</h1>
<p>Run <b>${esc(run.id)}</b> of the Bring in past sessions wizard, ${esc(new Date(run.at).toLocaleString())}, into <code>${esc(run.target)}</code>.
${copied} of ${run.items.length} session${run.items.length === 1 ? '' : 's'} copied. The originals were left where they were; Undo (☰ &gt; Bring in past sessions) sends only the copies to the Recycle Bin, and only those unchanged since the copy unless you tick them.${run.undoneAt ? ` Undone ${esc(new Date(run.undoneAt).toLocaleString())}.` : ''}</p>
<p class="id">The full list of files and checksums (SHA-256) is in the JSON beside this page.</p>
<table><tr><th>Session</th><th>Working folder</th><th>Was (left in place)</th><th>Copy</th><th>Size</th><th>Checksum</th><th>What happened</th></tr>${rows}</table>`;
}

// Copies each planned session: its log and its side folder, never over a file already there. Each copy's checksum is
// taken from the copy itself, so Undo compares with what was really copied. save(run) is called as it goes. An item
// that fails partway hands what it had copied to trash(paths) (the Recycle Bin), so no half copy is left behind.
export async function copyRun(run, { save = () => {}, trash = null } = {}) {
  for (const it of run.items) {
    if (it.status !== 'planned') continue;
    if (fs.existsSync(it.to)) { it.status = 'there'; continue; }
    const made = [];
    if (!fs.existsSync(path.dirname(it.to))) it.madeDir = true;
    try {
      for (const f of it.files) {
        await fs.promises.mkdir(path.dirname(f.to), { recursive: true });
        await fs.promises.copyFile(f.from, f.to, fs.constants.COPYFILE_EXCL);
        made.push(f.to);
        const sum = sha256(f.to);
        if (sum !== f.sha256) { f.sourceSha256 = f.sha256; f.sha256 = sum; f.size = sizeOf(f.to); } // it grew while being read
      }
      it.status = 'copied';
    } catch (e) {
      it.status = 'failed'; it.error = e.code === 'EEXIST' ? 'a file of that name is already there' : e.message;
      // what this item had copied so far is its own copy, and goes to the Recycle Bin; nothing it found there is touched
      if (made.length && trash) { try { await trash(made); } catch { it.partial = made; } } else if (made.length) it.partial = made;
    }
    save(run);
  }
  run.copiedAt = Date.now();
  save(run);
  return run;
}

// A copy's side folder: the one copied, or one the session made after the copy, when it was continued.
const sideOf = (it) => it.toSide || path.join(path.dirname(it.to), it.id);
// Whether each copy is as it was copied: 'same', 'changed' (continued since, or files added), 'gone' (no longer
// there), or 'none' (nothing of it was copied, or it was undone already).
export function checkCopies(run) {
  return run.items.map((it) => {
    if (it.status !== 'copied') return { id: it.id, title: it.title, state: 'none', status: it.status };
    if (!fs.existsSync(it.to)) return { id: it.id, title: it.title, state: 'gone' };
    const k = keyOf(process.platform === 'win32'), listed = new Set(it.files.map((f) => k(f.to)));
    const extra = isDir(sideOf(it)) ? walk(sideOf(it)).filter((f) => !listed.has(k(f))) : [];
    const changed = extra.length > 0 || it.files.some((f) => { try { return sha256(f.to) !== f.sha256; } catch { return false; } });
    return { id: it.id, title: it.title, state: changed ? 'changed' : 'same', at: (() => { try { return fs.statSync(it.to).mtimeMs; } catch { return null; } })() };
  });
}

// Undo: sends each copy (its log and its side folder) to the Recycle Bin with trash(paths), for copies unchanged since
// they were made, and for changed ones only when their id is in force. keep(id) holds back one, giving why ('open': a
// session open in Docket now; 'kept': one the person unticked).
// Only paths inside the target home's projects folder, and never an original, are ever handed to trash.
export async function undoRun(run, { force = [], trash, keep = () => false, save = () => {}, now = Date.now(), win = process.platform === 'win32' }) {
  const states = new Map(checkCopies(run).map((c) => [c.id, c.state]));
  const projects = path.join(run.target, 'projects'), done = [], skipped = [];
  for (const it of run.items) {
    const st = states.get(it.id);
    if (st === 'none') continue;
    if (st === 'gone') { it.status = 'gone'; continue; }
    const held = keep(it.id);
    if (held || (st === 'changed' && !force.includes(it.id))) { skipped.push({ id: it.id, title: it.title, why: held ? (typeof held === 'string' ? held : 'open') : 'changed' }); continue; }
    const paths = [it.to, ...(isDir(sideOf(it)) ? [sideOf(it)] : [])];
    const originals = [it.from, it.fromSide, ...it.files.map((f) => f.from)].filter(Boolean);
    if (paths.some((p) => !within(p, projects, win) || keyOf(win)(p) === keyOf(win)(projects) || originals.some((o) => within(o, p, win)))) {
      skipped.push({ id: it.id, title: it.title, why: 'outside' }); continue;
    }
    try { await trash(paths); it.status = 'undone'; it.undoneAt = now; done.push(it.id); }
    catch (e) { skipped.push({ id: it.id, title: it.title, why: 'failed', error: e.message }); }
    save(run);
  }
  // a project folder this run made, and left empty, goes too (it is empty: nothing in it is lost)
  for (const d of new Set(run.items.filter((i) => i.status === 'undone' && i.madeDir).map((i) => path.dirname(i.to)))) {
    try { if (!fs.readdirSync(d).length) fs.rmdirSync(d); } catch {}
  }
  if (!run.items.some((i) => i.status === 'copied')) run.undoneAt = now;
  save(run);
  return { done, skipped };
}
