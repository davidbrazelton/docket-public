// Scheduled tasks for the portal: run a saved prompt as a normal session on a
// schedule, and catch up a run that was missed while the portal was not running
// (or the computer was asleep). Missed runs are caught up once, not once per miss.
import fs from 'node:fs';
import path from 'node:path';

// ---------- cron: "minute hour day-of-month month day-of-week", local time ----------
const RANGES = [[0, 59], [0, 23], [1, 31], [1, 12], [0, 6]];
function parseField(text, [lo, hi]) {
  const out = new Set();
  for (const part of text.split(',')) {
    const [range, stepText] = part.split('/');
    const step = stepText ? Number(stepText) : 1;
    let [a, b] = range === '*' ? [lo, hi] : range.split('-').map(Number);
    if (b === undefined) b = stepText ? hi : a;
    if (![a, b, step].every(Number.isInteger) || step < 1 || a < lo || b > hi) throw new Error(`Bad schedule part "${part}"`);
    for (let v = a; v <= b; v += step) out.add(v === 7 && hi === 6 ? 0 : v);
  }
  return out;
}
export function parseCron(expr) {
  const f = String(expr).trim().split(/\s+/);
  if (f.length !== 5) throw new Error('A schedule needs 5 parts: minute hour day month weekday');
  const [min, hour, dom, mon, dow] = f.map((x, i) => parseField(x, RANGES[i]));
  return { min, hour, dom, mon, dow, domAny: f[2] === '*', dowAny: f[4] === '*' };
}
function matches(c, d) {
  if (!c.min.has(d.getMinutes()) || !c.hour.has(d.getHours()) || !c.mon.has(d.getMonth() + 1)) return false;
  const domOk = c.dom.has(d.getDate()), dowOk = c.dow.has(d.getDay());
  // Standard cron: when both day fields are limited, either one matching is enough.
  return c.domAny || c.dowAny ? domOk && dowOk : domOk || dowOk;
}
// When the clocks go back, the hour before the change happens twice. A time in the
// second copy of that hour is not a run time of its own, so it does not run twice.
function repeatedTime(d) {
  const back = d.getTimezoneOffset() - new Date(d.getTime() - 3 * 3600e3).getTimezoneOffset(); // minutes the clocks went back in the last 3 hours
  if (back <= 0) return false;
  const first = new Date(d.getTime() - back * 60e3);
  return first.getDate() === d.getDate() && first.getHours() === d.getHours() && first.getMinutes() === d.getMinutes();
}
const isRunTime = (c, d) => matches(c, d) && !repeatedTime(d);
// Steps a real minute at a time. (Stepping the local clock with setMinutes jumps an
// hour, or gets stuck, around a daylight saving change.)
const MINUTE = 60e3, LOOK = 400 * 1440;
// The most recent scheduled time at or before `from`, looking back up to 400 days.
export function previousRun(expr, from = new Date()) {
  const c = parseCron(expr);
  let t = Math.floor(new Date(from).getTime() / MINUTE) * MINUTE;
  for (let i = 0; i < LOOK; i++, t -= MINUTE) if (isRunTime(c, new Date(t))) return new Date(t);
  return null;
}
export function nextRun(expr, from = new Date()) {
  const c = parseCron(expr);
  let t = Math.floor(new Date(from).getTime() / MINUTE) * MINUTE + MINUTE;
  for (let i = 0; i < LOOK; i++, t += MINUTE) if (isRunTime(c, new Date(t))) return new Date(t);
  return null;
}

// ---------- the schedule list ----------
// isPaused: Docket is paused (Pause all); due runs wait and start after Resume all.
export function createScheduler({ file, clients, startRun, isRunning, onChange, isPaused = () => false, log = console.log }) {
  let list = [];
  try { list = JSON.parse(fs.readFileSync(file, 'utf8')); } catch {}
  // Written to a spare file and swapped in, so stopping mid-write cannot leave a half-written list.
  const save = () => { fs.writeFileSync(file + '.tmp', JSON.stringify(list, null, 2)); fs.renameSync(file + '.tmp', file); onChange?.(); };
  const clientOf = (s) => clients.find((c) => c.id === s.client);
  const promptFile = (s) => path.join(clientOf(s).home, 'scheduled-tasks', s.id, 'SKILL.md');

  function readPrompt(s) {
    const text = fs.readFileSync(promptFile(s), 'utf8');
    return text.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n/, '').trim(); // drop the name/description header
  }

  function view(s) {
    let next = null, error = null;
    try {
      if (s.enabled) next = s.fireAt ? (new Date(s.fireAt) > new Date(s.lastRunAt || 0) ? s.fireAt : null) : nextRun(s.cron)?.toISOString();
    } catch (e) { error = e.message; }
    return { ...s, nextRunAt: next, error, running: !!(s.lastSessionId && isRunning(s.lastSessionId)) };
  }

  function run(s, { missed = null, manual = false } = {}) {
    if (s.lastSessionId && isRunning(s.lastSessionId)) { log(`[schedule] ${s.id}: last run still working, skipped`); return null; }
    const prompt = readPrompt(s);
    const note = missed ? `\n\n(The portal is running this now because the scheduled time, ${new Date(missed).toLocaleString()}, was missed while the portal was not running.)` : '';
    // The run is saved as done before its session starts: if Docket stops in between,
    // the run is lost rather than repeated after the restart.
    const entry = { at: new Date().toISOString(), sessionId: null, missed, manual };
    s.lastRunAt = entry.at;
    s.runs = [entry, ...(s.runs || [])].slice(0, 20);
    if (s.fireAt) s.enabled = false; // a one-time task is used up by any run, Run now included
    save();
    let sessionId;
    try {
      sessionId = startRun({ client: s.client, cwd: s.folder || clientOf(s).folder, title: s.title, prompt: prompt + note, scheduleId: s.id, runAt: entry.at });
    } catch (e) {
      // Not tried again: the session may have started before the error.
      entry.error = e.message; save();
      log(`[schedule] ${s.id}: could not start the run: ${e.message}`);
      return null;
    }
    entry.sessionId = sessionId;
    s.lastSessionId = sessionId;
    save();
    log(`[schedule] ran ${s.id}${missed ? ' (catching up a missed run)' : ''}${manual ? ' (run now)' : ''}`);
    return sessionId;
  }

  // Every run-time that has passed since the last run means a run is due. Only
  // one run happens, however many were missed.
  function tick() {
    if (isPaused()) return;
    const now = new Date();
    for (const s of list) {
      if (!s.enabled || !clientOf(s)) continue;
      try {
        const due = s.fireAt ? new Date(s.fireAt) : previousRun(s.cron, now);
        if (!due || due > now) continue;
        if (s.lastRunAt && new Date(s.lastRunAt) >= due) continue;
        const late = now - due > 3 * 60 * 1000;
        run(s, { missed: late ? due.toISOString() : null });
      } catch (e) { log(`[schedule] ${s.id}: ${e.message}`); }
    }
  }
  const timer = setInterval(tick, 30 * 1000);
  setTimeout(tick, 5000); // on start-up: catch up anything missed while the portal was off

  return {
    list: (clientId) => list.filter((s) => !clientId || s.client === clientId).map(view),
    get: (id) => list.find((s) => s.id === id),
    runNow: (id) => { const s = list.find((x) => x.id === id); return s ? run(s, { manual: true }) : null; },
    setEnabled(id, enabled) {
      const s = list.find((x) => x.id === id); if (!s) return false;
      s.enabled = !!enabled;
      // Turning a schedule back on does not replay what was missed while it was off.
      if (enabled && s.cron) s.lastRunAt = new Date().toISOString();
      save(); return true;
    },
    // Adds a schedule. Its instructions live in <client home>\scheduled-tasks\<id>\SKILL.md,
    // the same place the Claude desktop app keeps them.
    add({ id, client, title, cron, fireAt, folder, prompt, lastRunAt }) {
      if (!/^[a-z0-9][a-z0-9-]{1,60}$/.test(id)) throw new Error('id must be lower-case letters, numbers and dashes');
      if (list.some((x) => x.id === id)) throw new Error(`A schedule named ${id} already exists`);
      if (cron) parseCron(cron); else if (!fireAt || isNaN(Date.parse(fireAt))) throw new Error('Give a cron schedule or a one-time fireAt date');
      const s = { id, client, title: title || id, cron: cron || null, fireAt: fireAt || null, folder: folder || null, enabled: true,
        lastRunAt: lastRunAt || new Date().toISOString(), lastSessionId: null, runs: [] };
      if (prompt !== undefined) {
        fs.mkdirSync(path.dirname(promptFile(s)), { recursive: true });
        fs.writeFileSync(promptFile(s), `---\nname: ${id}\ndescription: ${String(title || id).replace(/\n/g, ' ')}\n---\n\n${prompt}\n`);
      }
      if (!fs.existsSync(promptFile(s))) throw new Error(`No instructions file at ${promptFile(s)}`);
      list.push(s); save(); return view(s);
    },
    // Full detail for the editor: the schedule plus its instructions.
    detail(id) {
      const s = list.find((x) => x.id === id); if (!s) return null;
      let prompt = ''; try { prompt = readPrompt(s); } catch {}
      return { ...view(s), prompt };
    },
    // Change any of title, schedule (cron or one-time fireAt), folder and instructions.
    update(id, { title, cron, fireAt, folder, prompt }) {
      const s = list.find((x) => x.id === id); if (!s) throw new Error('Unknown schedule');
      if (cron !== undefined && cron) parseCron(cron);
      if (fireAt !== undefined && fireAt && isNaN(Date.parse(fireAt))) throw new Error('That one-time date is not valid');
      if (title !== undefined) s.title = String(title).trim() || s.id;
      if (cron) { s.cron = cron; s.fireAt = null; }
      else if (fireAt) { s.fireAt = new Date(fireAt).toISOString(); s.cron = null; if (new Date(s.fireAt) > new Date()) s.enabled = true; }
      if (folder !== undefined) s.folder = String(folder).trim() || null;
      if (prompt !== undefined) {
        fs.mkdirSync(path.dirname(promptFile(s)), { recursive: true });
        fs.writeFileSync(promptFile(s), `---\nname: ${s.id}\ndescription: ${String(s.title).replace(/\n/g, ' ')}\n---\n\n${String(prompt).trim()}\n`);
      }
      save();
      return this.detail(id);
    },
    // Takes the schedule off the list. Its instructions file is left where it is.
    remove(id) { const n = list.length; list = list.filter((x) => x.id !== id); if (list.length !== n) save(); return list.length !== n; },
    // The chat session used to edit this schedule.
    setEditor(id, sessionId) { const s = list.find((x) => x.id === id); if (s) { s.editorSessionId = sessionId; save(); } },
    stop() { clearInterval(timer); },
  };
}
