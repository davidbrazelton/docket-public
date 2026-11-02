// A plan folder (#180 step 3): a desk whose plans an outside system keeps, as markdown checklist files in a folder.
// Docket only reads it. Nothing here writes, renames, claims or locks anything in the folder or beside it: it uses
// readdir, stat, realpath and readFile and nothing else, so the outside system stays the only writer.
//
// What counts as a plan: any .md file under the folder (following shortcut folders, which are junctions or links)
// with at least one "- [ ]" or "- [x]" line. A plan may be plain checklist lines with no details, or Docket's own
// shape (plans.mjs): "- Plan:", "- Coordinator:", "- Part of:" and "- Made:" in the head, and indented "- State:",
// "- Held by:", "- After:", "- Brief:", "- Note:", "- Link:" and "- Plan:" lines under a task. Plans are named by
// Docket plan id (p-ab12cd) or by file path.
//
// The tree: a plan's "Part of:" line names its parent. A plan without one hangs off the plan whose checklist line
// links to it (by markdown link or by file name), which is how an index plan names its sub-plans. Progress rolls
// up the tree; links to .md files that are not there, and plans no other file names, are listed.
//
// Which session holds which plan: an optional marker file pattern, such as ".notes-plan-*" in the desk's Claude
// home, where * is the start of the session id and the file holds "state=" and "plan=" lines.
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';

const CHECK = /^(\s*)[-*+] \[([ xX])\]\s*(.*)$/;
const DETAIL = /^(\s+)[-*+] (State|Held by|After|Brief|Note|Link|Plan): ?(.*)$/;
const HEAD = /^[-*+] (Plan|Coordinator|Part of|Made): ?(.*)$/;
const PLAN_ID = /\bp-[a-z0-9]{4,}\b/;
const MD_LINK = /\[[^\]]*\]\(\s*<?([^)>]*?\.md)(?:#[^)>]*)?>?\s*\)/gi;
const BARE = /(?:^|[\s"'`(\[<,;])((?:[A-Za-z]:)?[\w.~\\/-]*?[\w-][\w.-]*\.md)(?![\w])/gi;
const SKIP_DIRS = new Set(['node_modules', 'bin', 'obj']);
const STATE_WORDS = { open: 'open', claimed: 'claimed', waiting_on_user: 'waiting on the user', sent_back: 'sent back' };
const wordToState = (w) => Object.keys(STATE_WORDS).find((k) => STATE_WORDS[k] === String(w).trim().toLowerCase()) || '';

// Paths compared the way the disk does: Windows and macOS ignore case.
export const norm = (p, platform = process.platform) => { const r = path.resolve(p); return platform === 'linux' ? r : r.toLowerCase(); };
const decode = (s) => { try { return decodeURIComponent(s); } catch { return s; } };
const who = (v) => { const m = String(v).trim().match(/^(\S+)(?:\s+\((.*)\))?/); return m ? { id: m[1], title: m[2] || '' } : { id: '', title: '' }; };

// Every .md file a line names: markdown links first, then bare file names, leaving out web addresses.
export function mdRefs(line) {
  const out = [];
  const rest = String(line).replace(/https?:\/\/\S+/g, ' ').replace(MD_LINK, (_, t) => { out.push(decode(t.trim())); return ' '; });
  for (const m of rest.matchAll(BARE)) out.push(m[1]);
  return [...new Set(out)];
}
// A "Part of:" or "Plan:" value: a Docket plan id, or a file (markdown link or bare path), and a task id if named.
function refOf(v) {
  const file = mdRefs(v)[0] || '', id = file ? '' : (String(v).match(PLAN_ID)?.[0] || '');
  return file || id ? { file, id, task: String(v).match(/\btask (T\d+)\b/i)?.[1]?.toUpperCase() || '' } : null;
}

// ---------- one file ----------
export function parseChecklist(text, file = '') {
  const lines = String(text).replace(/\r\n/g, '\n').split('\n');
  const plan = { file, title: '', id: '', coordinator: '', coordinatorTitle: '', made: '', partOf: null, items: [], links: [] };
  let item = null, inCode = false, seenItem = false;
  lines.forEach((line, n) => {
    if (/^\s*(```|~~~)/.test(line)) { inCode = !inCode; return; }
    if (inCode) return;
    if (!plan.title && /^# /.test(line)) { plan.title = line.slice(2).trim(); return; }
    const h = !seenItem && line.match(HEAD);
    if (h) {
      if (h[1] === 'Plan') plan.id = h[2].match(PLAN_ID)?.[0] || '';
      else if (h[1] === 'Coordinator') { const w = who(h[2]); plan.coordinator = w.id; plan.coordinatorTitle = w.title; }
      else if (h[1] === 'Part of') plan.partOf = refOf(h[2]);
      else plan.made = h[2].trim();
      return;
    }
    const c = line.match(CHECK);
    if (c) {
      seenItem = true;
      const t = c[3].match(/^(T\d+)\s+(.*)$/);
      item = { indent: c[1].replace(/\t/g, '  ').length, done: c[2] !== ' ', id: t ? t[1] : '', title: (t ? t[2] : c[3]).replace(/\[([^\]]*)\]\([^)]*\)/g, '$1').trim(), line: n + 1,
        state: c[2] !== ' ' ? 'done' : 'open', holder: '', holderTitle: '', after: [], brief: '', note: '', links: [], plan: null, refs: mdRefs(c[3]) };
      plan.items.push(item);
      for (const r of item.refs) plan.links.push({ ref: r, line: n + 1, item: plan.items.length - 1 });
      return;
    }
    const d = item && line.match(DETAIL);
    if (d && d[1].replace(/\t/g, '  ').length > item.indent) {
      const [, , key, v] = d;
      if (key === 'State') { const s = wordToState(v.replace(/ since .*$/, '')); if (!item.done && s) item.state = s; }
      else if (key === 'Held by') { const w = who(v); item.holder = w.id; item.holderTitle = w.title; }
      else if (key === 'After') item.after = v.match(/T\d+/g) || [];
      else if (key === 'Brief') item.brief = v.trim();
      else if (key === 'Note') item.note = v.trim();
      else if (key === 'Link') { if (v.trim()) item.links.push(v.trim()); }
      else if (key === 'Plan') { item.plan = refOf(v); if (item.plan?.file) plan.links.push({ ref: item.plan.file, line: n + 1, item: plan.items.length - 1, strong: true }); }
      if (key === 'Link') for (const r of mdRefs(v)) plan.links.push({ ref: r, line: n + 1, item: plan.items.length - 1 });
      return;
    }
    if (line.trim() && !/^\s/.test(line)) item = null; // a new paragraph or heading ends the item; an indented line goes on with it
    for (const r of mdRefs(line)) plan.links.push({ ref: r, line: n + 1, item: item ? plan.items.length - 1 : -1 });
  });
  if (plan.partOf?.file) plan.links.push({ ref: plan.partOf.file, line: 0, item: -1, partOf: true });
  if (!plan.title) plan.title = path.basename(file, path.extname(file));
  return plan;
}

// ---------- the folder ----------
// Every .md file under root, following shortcut folders once each (a loop of shortcuts ends where it started).
// Hidden folders (.git) and node_modules, bin and obj are left out; maxFiles and maxDepth keep a folder that
// reaches into a big repo from taking long.
export async function walkFolder(root, { maxFiles = 4000, maxDepth = 10 } = {}) {
  const files = [], dirs = [], seen = new Set();
  let capped = false;
  async function go(dir, depth) {
    let real; try { real = await fsp.realpath(dir); } catch { return; }
    if (seen.has(norm(real))) return;
    seen.add(norm(real));
    let st, ents; try { st = await fsp.stat(dir); ents = await fsp.readdir(dir, { withFileTypes: true }); } catch { return; }
    dirs.push({ path: dir, mtimeMs: st.mtimeMs });
    for (const e of ents) {
      if (e.name.startsWith('.')) continue;
      const p = path.join(dir, e.name);
      let isDir = e.isDirectory(), isFile = e.isFile();
      if (e.isSymbolicLink()) { try { const s = await fsp.stat(p); isDir = s.isDirectory(); isFile = s.isFile(); } catch { continue; } }
      if (isDir) { if (depth < maxDepth && !SKIP_DIRS.has(e.name.toLowerCase())) await go(p, depth + 1); }
      else if (isFile && /\.md$/i.test(e.name)) { if (files.length < maxFiles) files.push(p); else capped = true; }
    }
  }
  await go(root, 0);
  return { files, dirs, capped };
}

// The tree from the parsed files: parents, children, rolled-up progress, broken links and plans nothing names.
// docs: [{ file, plan }] for every .md file read (plan.items empty when it is not a checklist).
export function buildTree(docs, { root = '', exists = (f) => fs.existsSync(f), platform = process.platform } = {}) {
  const n = (p) => norm(p, platform);
  const all = new Map(docs.map((d) => [n(d.file), d]));
  const plans = docs.filter((d) => d.plan.items.length).map((d) => d.plan);
  const byPath = new Map(plans.map((p) => [n(p.file), p]));
  const byId = new Map(plans.filter((p) => p.id).map((p) => [p.id, p]));
  const byName = new Map();
  for (const d of docs) { const k = path.basename(d.file).toLowerCase(); byName.set(k, [...(byName.get(k) || []), d]); }
  const keyOf = (p) => (root ? path.relative(root, p.file) : p.file).split(path.sep).join('/');
  // A reference from a file: { plan } for a plan, { doc } for another markdown file, { broken } when nothing is there.
  const resolve = (ref, from) => {
    if (ref.id) return byId.get(ref.id) ? { plan: byId.get(ref.id) } : { broken: true };
    const f = ref.file;
    const tries = path.isAbsolute(f) ? [f] : [path.resolve(path.dirname(from), f), ...(root ? [path.resolve(root, f)] : [])];
    for (const t of tries) { if (byPath.has(n(t))) return { plan: byPath.get(n(t)) }; if (all.has(n(t))) return { doc: all.get(n(t)) }; }
    const named = byName.get(path.basename(f).toLowerCase()) || [];
    if (named.length === 1) return named[0].plan.items.length ? { plan: byPath.get(n(named[0].file)) } : { doc: named[0] };
    if (named.length > 1) { const p = named.find((d) => d.plan.items.length); return p ? { plan: byPath.get(n(p.file)) } : { doc: named[0] }; }
    return tries.some((t) => exists(t)) ? { doc: null } : { broken: true };
  };
  const named = new Map(plans.map((p) => [p, new Set()])); // plan -> the files that name it
  const broken = [];
  const edges = new Map(plans.map((p) => [p, []])); // child -> [{ from, item, strong }] from checklist lines
  for (const d of docs) {
    const p = d.plan;
    for (const l of p.links) {
      const r = resolve({ file: l.ref }, d.file);
      if (r.broken) { if (p.items.length) broken.push({ from: keyOf(p), file: p.file, ref: l.ref, line: l.line }); continue; }
      if (!r.plan || r.plan === p) continue;
      named.get(r.plan).add(n(d.file));
      if (p.items.length && l.item >= 0 && !l.partOf) edges.get(r.plan).push({ from: p, item: l.item, strong: !!l.strong });
    }
    if (!p.items.length) continue;
    for (const [i, it] of p.items.entries()) if (it.plan?.id) {
      const r = resolve(it.plan, d.file);
      if (r.plan && r.plan !== p) { named.get(r.plan).add(n(d.file)); edges.get(r.plan).push({ from: p, item: i, strong: true }); }
      else if (r.broken) broken.push({ from: keyOf(p), file: p.file, ref: it.plan.id, line: it.line });
    }
    if (p.partOf?.id) {
      const r = resolve(p.partOf, d.file);
      if (r.plan && r.plan !== p) named.get(r.plan).add(n(d.file));
      else if (r.broken) broken.push({ from: keyOf(p), file: p.file, ref: p.partOf.id, line: 0 });
    }
  }
  // Parents: "Part of:" first, then the strongest checklist link; never one that would make a loop.
  const parent = new Map(), parentItem = new Map();
  const above = (p, q) => { for (let x = q, k = 0; x && k < 1000; x = parent.get(x), k++) if (x === p) return true; return false; };
  for (const p of plans) {
    const cands = [];
    if (p.partOf) {
      const r = resolve(p.partOf, p.file);
      if (r.plan && r.plan !== p) {
        const t = p.partOf.task, i = t ? r.plan.items.findIndex((x) => x.id === t) : -1;
        cands.push({ from: r.plan, item: i >= 0 ? i : (edges.get(p).find((e) => e.from === r.plan)?.item ?? -1) });
      }
    }
    cands.push(...[...edges.get(p)].sort((a, b) => (b.strong - a.strong) || a.from.file.localeCompare(b.from.file)));
    const c = cands.find((x) => !above(p, x.from));
    if (c) { parent.set(p, c.from); parentItem.set(p, c.item); }
  }
  const children = new Map(plans.map((p) => [p, []]));
  for (const [c, p] of parent) children.get(p).push(c);
  // Progress, counted on the smallest pieces: a checklist line with a plan under it counts as that plan's lines.
  const memo = new Map();
  const rollup = (p, seen = new Set()) => {
    if (memo.has(p)) return memo.get(p);
    if (seen.has(p)) return { done: 0, total: 0 };
    seen.add(p);
    const under = new Map(); // item index -> child plans hanging off it
    const loose = [];
    for (const c of children.get(p)) { const i = parentItem.get(c); if (i >= 0) under.set(i, [...(under.get(i) || []), c]); else loose.push(c); }
    let done = 0, total = 0;
    p.items.forEach((it, i) => {
      const subs = (under.get(i) || []).map((c) => rollup(c, seen)).filter((r) => r.total);
      if (subs.length) for (const r of subs) { done += r.done; total += r.total; }
      else { total++; if (it.done) done++; }
    });
    for (const c of loose) { const r = rollup(c, seen); done += r.done; total += r.total; }
    const r = { done, total };
    memo.set(p, r);
    return r;
  };
  const out = plans.map((p) => {
    const r = rollup(p), kids = children.get(p);
    return { key: keyOf(p), file: p.file, title: p.title, id: p.id, coordinator: p.coordinator, coordinatorTitle: p.coordinatorTitle, made: p.made,
      done: r.done, total: r.total, own: { done: p.items.filter((x) => x.done).length, total: p.items.length },
      parent: parent.has(p) ? keyOf(parent.get(p)) : null, parentItem: parent.has(p) ? parentItem.get(p) : -1,
      children: kids.map(keyOf), unlinked: !named.get(p).size,
      items: p.items.map((it, i) => ({ id: it.id, title: it.title, state: it.state, depth: it.indent, line: it.line, holder: it.holder, holderTitle: it.holderTitle,
        after: it.after, brief: it.brief, note: it.note, links: it.links, sub: kids.filter((c) => parentItem.get(c) === i).map(keyOf) })) };
  });
  out.sort((a, b) => a.key.localeCompare(b.key));
  return { plans: out, roots: out.filter((p) => !p.parent).map((p) => p.key), broken, unlinked: out.filter((p) => p.unlinked).map((p) => p.key) };
}

// ---------- the desk setting ----------
// planFolder on a desk's entry: { path, marker }, both optional. A path that is not a full path, or a marker pattern
// without exactly one *, is dropped rather than guessed at. Returns an error for the page instead when asked.
export function planFolderProblem(key, value) {
  const v = String(value ?? '').trim();
  if (!v) return '';
  if (key === 'path') return path.isAbsolute(v) ? '' : 'Give the plan folder as a full path, such as C:\\notes\\Projects.';
  if (key === 'marker') return (v.match(/\*/g) || []).length === 1 ? '' : 'Put one * in the marker pattern where the session id goes, such as .notes-plan-*.';
  return 'No such plan folder setting.';
}
export function cleanPlanFolder(p) {
  if (!p || typeof p !== 'object') return undefined;
  const out = {};
  for (const k of ['path', 'marker']) { const v = String(p[k] ?? '').trim().replace(/^"(.*)"$/, '$1'); if (v && !planFolderProblem(k, v)) out[k] = v; }
  return Object.keys(out).length ? out : undefined;
}

// ---------- markers: which session holds which plan ----------
// pattern: a file name with one * for the start of the session id, in the desk's Claude home (or an absolute path).
// Returns [{ session (the start of its id), plan (as written), state, file }] for markers that hold a plan.
export function readMarkers(pattern, home) {
  const p = String(pattern || '').trim();
  if (!p || (p.match(/\*/g) || []).length !== 1) return [];
  const full = path.isAbsolute(p) ? p : path.join(home || '', p), dir = path.dirname(full), name = path.basename(full);
  if (!name.includes('*')) return [];
  const re = new RegExp('^' + name.split('*').map((s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('([A-Za-z0-9_-]{4,})') + '$', 'i');
  let names; try { names = fs.readdirSync(dir); } catch { return []; }
  const out = [];
  for (const f of names) {
    const m = f.match(re); if (!m) continue;
    let text; try { const st = fs.statSync(path.join(dir, f)); if (!st.isFile() || st.size > 65536) continue; text = fs.readFileSync(path.join(dir, f), 'utf8'); } catch { continue; }
    const kv = Object.fromEntries(text.replace(/\r\n/g, '\n').split('\n').map((l) => l.match(/^\s*([\w-]+)\s*=\s*(.*?)\s*$/)).filter(Boolean).map((x) => [x[1].toLowerCase(), x[2]]));
    const state = (kv.state || '').toLowerCase();
    if (!kv.plan || (state && state !== 'claimed')) continue;
    out.push({ session: m[1], plan: kv.plan, state: state || 'claimed', file: path.join(dir, f) });
  }
  return out;
}
// The plan a marker names, as a key in the tree: by path (relative to the folder when not absolute), then by name.
export function markerPlan(tree, root, plan, platform = process.platform) {
  const want = norm(path.isAbsolute(plan) ? plan : path.resolve(root, plan), platform);
  let real = want; try { real = norm(fs.realpathSync(want), platform); } catch {}
  const hit = tree.plans.find((p) => { const f = norm(p.file, platform); if (f === want || f === real) return true; try { return norm(fs.realpathSync(p.file), platform) === real; } catch { return false; } });
  if (hit) return hit.key;
  const same = tree.plans.filter((p) => path.basename(p.file).toLowerCase() === path.basename(plan).toLowerCase());
  return same.length === 1 ? same[0].key : '';
}

// ---------- the cache ----------
// One reader per folder. The tree is read again only when something under the folder changed: each look first
// checks the times of the folders and files it read last time (a stat each, no reading), at most every minGapMs,
// and re-reads only the files whose time or size moved. Two looks at once share one read.
export function createFolderReader({ root, minGapMs = 3000, now = Date.now, walk = walkFolder } = {}) {
  let last = null, checkedAt = 0, running = null;
  const files = new Map(); // path -> { mtimeMs, size, plan }
  async function unchanged() {
    if (!last || last.error) return false;
    for (const d of last.dirs) { try { if ((await fsp.stat(d.path)).mtimeMs !== d.mtimeMs) return false; } catch { return false; } }
    for (const [f, c] of files) { try { const s = await fsp.stat(f); if (s.mtimeMs !== c.mtimeMs || s.size !== c.size) return false; } catch { return false; } }
    return true;
  }
  async function readAll() {
    const t0 = now();
    let st; try { st = await fsp.stat(root); } catch { return { error: `Docket cannot open the plan folder ${root}.`, plans: [], roots: [], broken: [], unlinked: [], dirs: [], at: t0 }; }
    if (!st.isDirectory()) return { error: `${root} is not a folder.`, plans: [], roots: [], broken: [], unlinked: [], dirs: [], at: t0 };
    const w = await walk(root);
    const keep = new Set(w.files.map((f) => norm(f)));
    for (const f of [...files.keys()]) if (!keep.has(norm(f))) files.delete(f);
    let read = 0;
    for (const f of w.files) {
      let s; try { s = await fsp.stat(f); } catch { continue; }
      const c = files.get(f);
      if (c && c.mtimeMs === s.mtimeMs && c.size === s.size) continue;
      let text = ''; try { text = s.size > 2_000_000 ? '' : await fsp.readFile(f, 'utf8'); } catch {}
      files.set(f, { mtimeMs: s.mtimeMs, size: s.size, plan: parseChecklist(text, f) });
      read++;
    }
    const tree = buildTree([...files].map(([file, c]) => ({ file, plan: c.plan })), { root });
    return { ...tree, root, capped: w.capped, files: files.size, read, dirs: w.dirs, at: now(), took: now() - t0 };
  }
  async function get({ fresh = false } = {}) {
    if (running) return running;
    if (last && !fresh && now() - checkedAt < minGapMs) return last;
    running = (async () => {
      try {
        if (!(last && !fresh && await unchanged())) last = await readAll();
        checkedAt = now();
        return last;
      } finally { running = null; }
    })();
    return running;
  }
  return { root, get };
}
