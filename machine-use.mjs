// ☰ > Memory and disk: what Docket and its sessions hold in memory right now, and how big its folders are.
import fs from 'node:fs';
import path from 'node:path';

// The programs a session runs as, by name, and the browsers its helpers open (Chrome, Chromium, Edge, and on a
// Mac "Google Chrome for Testing Helper (Renderer)" and the like).
const SESSION_PROGRAMS = { claude: 'Claude programs', grok: 'Grok programs', codex: 'Codex programs' };
const BROWSER = /^(chrome|chromium|msedge|headless_shell|chrome-headless-shell|google chrome|chromium )/;

// The list of running programs ([{ pid, ppid, name, mem }], from platform.mjs) grouped for the window: the app
// itself, the runner, then everything the two started, below them at any depth. The runner's own children are the
// session programs; everything below those is a helper (node programs, the private browser, the rest). The runner
// is started detached, so on a Mac its parent is no longer the app, and both are walked on their own.
export function groupProcesses(list, { appPid, runnerPid }) {
  const byPid = new Map(list.map((p) => [p.pid, p]));
  const kids = new Map();
  for (const p of list) if (p.pid !== p.ppid) (kids.get(p.ppid) || kids.set(p.ppid, []).get(p.ppid)).push(p);
  const groups = new Map();
  const add = (key, label, mem) => { const g = groups.get(key) || groups.set(key, { key, label, count: 0, mem: 0 }).get(key); g.count++; g.mem += mem; };
  const seen = new Set([appPid, runnerPid]);
  const walk = (pid, top) => {
    for (const c of kids.get(pid) || []) {
      if (seen.has(c.pid)) continue;
      seen.add(c.pid);
      if (top && SESSION_PROGRAMS[c.name]) add(c.name, SESSION_PROGRAMS[c.name], c.mem);
      else if (BROWSER.test(c.name)) add('browser', 'Private browser', c.mem);
      else if (c.name === 'node') add('node', 'Helper node programs', c.mem);
      else add('other', 'Other helpers', c.mem);
      walk(c.pid, false);
    }
  };
  if (runnerPid) walk(runnerPid, true);
  walk(appPid, false);
  const one = (pid, label) => ({ label, count: byPid.has(pid) ? 1 : 0, mem: byPid.get(pid)?.mem || 0 });
  const order = ['claude', 'grok', 'codex', 'node', 'browser', 'other'];
  const rows = [one(appPid, 'Docket app'), one(runnerPid, 'Session runner'),
    ...order.map((k) => groups.get(k)).filter(Boolean)];
  return { rows, total: rows.reduce((s, r) => s + r.mem, 0) };
}

// The size of a folder and the number of files in it, counting every folder inside it. Links are counted as
// themselves and not followed (Windows junctions included), so nothing is counted twice. A folder that is not
// there gives null. Each folder's files are looked at together; folders one at a time, so a big one (node_modules)
// never opens thousands of files at once.
export async function folderSize(dir, { filter } = {}) {
  let top;
  try { top = await fs.promises.readdir(dir, { withFileTypes: true }); } catch { return null; }
  const total = { bytes: 0, files: 0 };
  const walk = async (d, entries) => {
    const files = [];
    for (const e of entries) {
      if (filter && d === dir && !filter(e.name)) continue;
      const p = path.join(d, e.name);
      if (e.isDirectory()) {
        let inner; try { inner = await fs.promises.readdir(p, { withFileTypes: true }); } catch { continue; }
        await walk(p, inner);
      } else files.push(p);
    }
    const sizes = await Promise.all(files.map((f) => fs.promises.lstat(f).then((s) => s.size, () => null)));
    for (const s of sizes) if (s !== null) { total.bytes += s; total.files++; }
  };
  await walk(dir, top);
  return total;
}
