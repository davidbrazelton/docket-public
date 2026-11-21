// Screen and mouse control (#822): a session sees the desktop outside Docket and moves the mouse and types there,
// as a last resort for programs with no better way in. This file runs the actions and keeps the guardrails that need
// no Docket state: the log of every action (with a picture of the screen before each click or drag), the Stop that
// halts a running sequence at once, and the badge on the screen while a session is in control. server.mjs decides
// who may (the desk's setting, off by default) and serves the tools; platform.mjs has the per-platform scripts.
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { screenScript, screenCommand, screenBadgeCommand, SCREEN_BADGE, fitShot, shotArea, toScreen, keyCodes } from './platform.mjs';

export const SCREEN_TOOLS = ['screen_shot', 'mouse_move', 'mouse_click', 'mouse_drag', 'mouse_scroll', 'key_type', 'key_press'];
export const STOPPED = 'The user pressed Stop on screen control. Do not use the screen tools again this turn: end your turn and tell the user what you did and where you stopped.';
export const PASSWORD = 'Not typed: the field that has the keyboard is a password field. Docket never types into one. Ask the user to type it.';
const IDLE_MS = 20e3; // the badge stays this long after the last action
const ACTION_MS = 60e3; // an action that takes longer is stopped
const KEEP_DAYS = 30; // the log and its pictures

// The text of one action for the log: what was asked, with typed text cut short.
export function logArgs(name, args = {}) {
  const { desk, ...rest } = args;
  if (typeof rest.text === 'string' && rest.text.length > 200) rest.text = rest.text.slice(0, 200) + '…';
  return rest;
}
// What a screenshot says beside the image: the area, the scale, and the monitors.
export function shotText(area, fit, screens, { platform = process.platform, badge = false } = {}) {
  const unit = platform === 'darwin' ? 'points' : 'pixels';
  const mons = screens.map((s, i) => `${i + 1}: ${s.w}×${s.h} at ${s.x},${s.y}${s.scale && s.scale !== 1 ? `, scaled ${Math.round(s.scale * 100)}%` : ''}${s.primary ? ', main' : ''}`).join('; ');
  return `This image is ${fit.w}×${fit.h}: the screen area ${area.w}×${area.h} ${unit} at ${area.x},${area.y}, shown at ${(fit.w / area.w).toFixed(3)} of its size. `
    + 'Give the mouse tools points in this image\'s pixels; Docket maps them back to the screen. Each screen_shot replaces the last one as the image points refer to. '
    + `Monitors (${unit}): ${mons}.`
    + (badge ? ' The orange bar at the top of the main monitor is Docket\'s own Stop control: never click it.' : '');
}

// dataDir: where the script, the log and its pictures go. changed(active): the sessions in control changed (for the
// page's indicator). spawnImpl: for tests.
export function createScreenControl({ dataDir, platform = process.platform, spawnImpl = spawn, changed = () => {}, badge = true }) {
  const dir = path.join(dataDir, 'screen');
  const shots = new Map(); // key -> the last screenshot { x, y, w, h, iw, ih }, which the image points refer to
  const turns = new Map(); // session -> how many messages the person sent it; a Stop holds until the next one
  const stopped = new Set(); // `${key}#${turn}` the person stopped
  const children = new Set();
  const active = new Map(); // key -> { key, session, title, desk, from, action, at }
  let scripts = null, screensCache = null, badgeProc = null, badgeText = '', idleTimer = null;
  const prune = () => {
    const logDir = path.join(dir, 'log'), cut = new Date(Date.now() - KEEP_DAYS * 864e5).toISOString().slice(0, 10);
    try { for (const n of fs.readdirSync(logDir)) if (n.slice(0, 10) < cut) fs.rmSync(path.join(logDir, n), { recursive: true, force: true }); } catch {}
  };
  function files() {
    if (scripts) return scripts;
    const sc = screenScript(platform);
    if (!sc) throw new Error('Screen control works on Windows and macOS only.');
    fs.mkdirSync(dir, { recursive: true });
    scripts = { main: path.join(dir, sc.file), badge: path.join(dir, SCREEN_BADGE.file) };
    fs.writeFileSync(scripts.main, sc.text); // written each time Docket starts, so an update takes effect
    if (platform === 'win32') fs.writeFileSync(scripts.badge, SCREEN_BADGE.text);
    prune();
    return scripts;
  }
  function exec(req, desk) {
    const c = screenCommand(files().main, req, platform);
    return new Promise((resolve, reject) => {
      const p = spawnImpl(c.cmd, c.args, { windowsHide: true });
      p.desk = desk; children.add(p);
      let out = '', err = '';
      p.stdout?.on('data', (d) => { out += d; });
      p.stderr?.on('data', (d) => { err += d; });
      const timer = setTimeout(() => { p.timedOut = true; p.kill(); }, ACTION_MS);
      p.on('error', (e) => { clearTimeout(timer); children.delete(p); reject(e); });
      p.on('close', (code) => {
        clearTimeout(timer); children.delete(p);
        if (p.stopped) return reject(new Error(STOPPED));
        if (p.timedOut) return reject(new Error('The action took over a minute and was stopped.'));
        let j = null;
        try { j = JSON.parse(String(out).trim().split(/\r?\n/).pop()); } catch {}
        if (!j) return reject(new Error((String(err).trim() || String(out).trim() || `The screen script ended with code ${code}`).slice(0, 500)));
        if (j.error === 'password') return reject(new Error(PASSWORD));
        if (j.error) return reject(new Error(/handle is invalid/i.test(j.error) ? 'The screen could not be read: it may be locked, or showing a Windows security prompt.' : j.error));
        resolve(j);
      });
    });
  }
  async function screens() {
    if (!screensCache || Date.now() - screensCache.at > 30e3) screensCache = { at: Date.now(), list: (await exec({ op: 'screens' })).screens };
    return screensCache.list;
  }

  // ---------- the badge on the screen and the page's indicator ----------
  function showBadge() {
    const text = active.size === 1 ? `Docket: "${[...active.values()][0].title}" is using the mouse and keyboard` : `Docket: ${active.size} sessions are using the mouse and keyboard`;
    if (!badge || platform !== 'win32' || (badgeProc && badgeText === text)) return;
    hideBadge();
    const c = screenBadgeCommand(files().badge, text, platform);
    const p = badgeProc = spawnImpl(c.cmd, c.args, { windowsHide: true });
    badgeText = text;
    p.stdout?.on('data', (d) => { if (/\bstop\b/.test(String(d))) stop('the Stop button on the screen'); });
    p.on('error', () => {});
    p.on('close', () => { if (badgeProc === p) badgeProc = null; });
  }
  function hideBadge() { const p = badgeProc; badgeProc = null; badgeText = ''; try { p?.kill(); } catch {} }
  const view = () => [...active.values()].map(({ key, session, title, desk, from, action, at }) => ({ key, session, title, desk, from, action, at }));
  function idle() {
    clearTimeout(idleTimer);
    idleTimer = setTimeout(() => {
      for (const [k, a] of active) if (Date.now() - a.at >= IDLE_MS) active.delete(k);
      if (!active.size) hideBadge(); else idle();
      changed(view());
    }, IDLE_MS);
    idleTimer.unref?.();
  }

  // ---------- the log ----------
  function stamp() { const d = new Date(); return { day: d.toISOString().slice(0, 10), time: d.toISOString().slice(11, 23).replace(/[:.]/g, '') }; }
  function writeLog(entry) {
    try {
      fs.mkdirSync(path.join(dir, 'log'), { recursive: true });
      fs.appendFileSync(path.join(dir, 'log', `${entry.at.slice(0, 10)}.jsonl`), JSON.stringify(entry) + '\n');
    } catch {}
  }
  // A picture of every monitor, saved before a click or drag, for the log.
  async function beforeShot(name) {
    const area = shotArea(await screens()), fit = fitShot(area.w, area.h, { maxSide: 1280 }), { day, time } = stamp();
    const rel = path.join('log', day, `${time}-${name}.jpg`);
    fs.mkdirSync(path.join(dir, 'log', day), { recursive: true });
    return { req: { ...area, tw: fit.w, th: fit.h, file: path.join(dir, rel) }, rel };
  }

  const point = (key, x, y, what = 'point') => {
    const shot = shots.get(key);
    if (!shot) throw new Error(`Take a screen_shot first: a ${what} is given in a screenshot's pixels.`);
    if (!(x >= 0 && y >= 0 && x <= shot.iw && y <= shot.ih)) throw new Error(`${x},${y} is outside the last screenshot (${shot.iw}×${shot.ih}).`);
    return toScreen(shot, x, y);
  };
  async function run(who, name, a, entry) {
    const key = who.key, x = (req) => exec(req, who.desk);
    if (name === 'screen_shot') {
      const list = await screens();
      const area = shotArea(list, { monitor: a.monitor, region: a.region, from: shots.get(key) });
      const fit = fitShot(area.w, area.h);
      const file = path.join(dir, `shot-${randomUUID()}.png`);
      await x({ op: 'shot', ...area, tw: fit.w, th: fit.h, file });
      let data;
      try { data = fs.readFileSync(file).toString('base64'); } finally { fs.rmSync(file, { force: true }); }
      shots.set(key, { ...area, iw: fit.w, ih: fit.h });
      entry.area = area;
      return [{ type: 'image', data, mimeType: 'image/png' }, { type: 'text', text: shotText(area, fit, list, { platform, badge: badge && platform === 'win32' }) }];
    }
    if (name === 'mouse_move') { const p = point(key, a.x, a.y); entry.at_screen = p; await x({ op: 'move', ...p }); return `Moved the mouse to ${a.x},${a.y}.`; }
    if (name === 'mouse_click') {
      const p = point(key, a.x, a.y), b = await beforeShot('click');
      entry.at_screen = p; entry.before = b.rel;
      const count = a.double ? 2 : 1, button = a.button || 'left';
      await x({ op: 'click', ...p, button, count, before: b.req });
      return `${count === 2 ? 'Double-clicked' : 'Clicked'} ${button === 'left' ? '' : button + ' '}at ${a.x},${a.y}. Take a screen_shot to see what it did.`;
    }
    if (name === 'mouse_drag') {
      const p = point(key, a.x, a.y), q = point(key, a.to_x, a.to_y), b = await beforeShot('drag');
      entry.at_screen = p; entry.to_screen = q; entry.before = b.rel;
      await x({ op: 'drag', ...p, x2: q.x, y2: q.y, button: a.button || 'left', before: b.req });
      return `Dragged from ${a.x},${a.y} to ${a.to_x},${a.to_y}.`;
    }
    if (name === 'mouse_scroll') {
      const p = point(key, a.x, a.y), n = Math.max(1, Math.min(50, Math.round(a.amount ?? 3)));
      const dir2 = a.direction || 'down', dx = dir2 === 'right' ? n : dir2 === 'left' ? -n : 0, dy = dir2 === 'down' ? n : dir2 === 'up' ? -n : 0;
      entry.at_screen = p;
      await x({ op: 'scroll', ...p, dx, dy });
      return `Scrolled ${dir2} ${n} at ${a.x},${a.y}.`;
    }
    if (name === 'key_type') {
      const text = String(a.text ?? '');
      if (!text) throw new Error('No text given.');
      if (text.length > 5000) throw new Error('Type at most 5000 characters at a time.');
      await x({ op: 'type', text });
      return `Typed ${text.length} character${text.length === 1 ? '' : 's'}.`;
    }
    if (name === 'key_press') {
      const k = keyCodes(a.keys, platform);
      await x({ op: 'keys', codes: k.codes, guard: k.typesText });
      return `Pressed ${k.names.join('+')}.`;
    }
    throw new Error(`No screen action named ${name}`);
  }

  // who: { key (whose last screenshot), session, title, desk, from (the other computer, for a remote call), turn }.
  // Answers MCP content; throws with words for the session.
  async function act(who, name, args = {}) {
    const turn = who.turn ?? turns.get(who.session) ?? 0;
    if (stopped.has(`${who.key}#${turn}`)) throw new Error(STOPPED);
    active.set(who.key, { key: who.key, session: who.session, title: who.title || 'A session', desk: who.desk, from: who.from || '', action: name, at: Date.now(), turn });
    showBadge(); changed(view()); idle();
    const entry = { at: new Date().toISOString(), session: who.session, title: who.title || '', desk: who.desk, ...(who.from ? { from: who.from } : {}), action: name, args: logArgs(name, args) };
    const t0 = Date.now();
    try {
      const r = await run(who, name, args, entry);
      entry.ok = true;
      return typeof r === 'string' ? [{ type: 'text', text: r }] : r;
    } catch (e) { entry.error = e.message; throw e; }
    finally { entry.ms = Date.now() - t0; writeLog(entry); }
  }
  // Stops every session in control now: their running action ends at once, and they are refused until the person
  // sends them a message (release). desk: only that desk's sessions.
  function stop(by = 'Stop', desk) {
    let n = 0;
    for (const [k, a] of active) {
      if (desk && a.desk !== desk) continue;
      stopped.add(`${k}#${a.turn}`); active.delete(k); n++;
      writeLog({ at: new Date().toISOString(), session: a.session, title: a.title, desk: a.desk, action: 'stop', by });
    }
    for (const p of children) if (!desk || !p.desk || p.desk === desk) { p.stopped = true; try { p.kill(); } catch {} }
    if (!active.size) hideBadge(); else showBadge();
    changed(view());
    return n;
  }
  // The person sent this session a message: a Stop no longer holds it.
  const release = (session) => { turns.set(session, (turns.get(session) || 0) + 1); };
  return { act, stop, release, turnOf: (session) => turns.get(session) || 0, active: view, logDir: () => path.join(dir, 'log'), close: () => { stop('Docket stopping'); hideBadge(); } };
}
