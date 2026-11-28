// A box being typed in survives updates (#1087), in a real browser on a throwaway Docket whose Grok is
// test-fixtures/fake-acp-agent.mjs. The page's live connection is passed through Playwright, which adds updates of its
// own (a session's new title and status, replies arriving, list and panel redraws) while text is typed into each inline
// editor and text box an update can redraw. The box, its focus and its text must still be there after the updates,
// the held redraws must show once the focus leaves, and Enter / Escape still save or cancel. Skipped where
// Playwright's Chromium is not installed.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { freePorts, stopTree, TEST_DOCKET_ENV } from './free-port.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.dirname(HERE);
const [PORT, RUNNER_PORT] = await freePorts(2);
const URL_ = `http://127.0.0.1:${PORT}`;
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'docket-1087-'));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const api = async (p, body) => {
  const r = await fetch(URL_ + p, { method: body ? 'POST' : 'GET', headers: { 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
  return r.json();
};
async function waitFor(what, fn, ms = 30000) {
  for (const until = Date.now() + ms; ;) {
    const v = await fn().catch(() => null);
    if (v) return v;
    if (Date.now() > until) throw new Error('Timed out waiting for ' + what);
    await sleep(150);
  }
}
const runnerPid = () => fetch(`http://127.0.0.1:${RUNNER_PORT}/health`).then((r) => r.json()).then((h) => h.pid).catch(() => null);

let chromium = null;
try { ({ chromium } = await import('playwright')); } catch {}
let browser = null, skip = false;
try { browser = await chromium.launch(); } catch { skip = 'Playwright\'s Chromium is not installed (npx playwright install chromium)'; }

let server, page, toPage = null, a, b;
before(async () => {
  if (skip) return;
  const t1 = { id: 't1', name: 'T1', home: path.join(tmp, 'claude-1'), folder: path.join(tmp, 'work-1'), grokHome: path.join(tmp, 'grok-1'), defaultEngine: 'grok', brandsOff: ['claude'] };
  for (const d of [t1.home, t1.folder, t1.grokHome]) fs.mkdirSync(d, { recursive: true });
  fs.writeFileSync(path.join(tmp, 'clients.json'), JSON.stringify([t1]));
  fs.writeFileSync(path.join(tmp, 'state.json'), JSON.stringify({ sessions: {}, updates: { minutes: 0 } }));
  server = spawn(process.execPath, [path.join(ROOT, 'server.mjs')], {
    cwd: ROOT, stdio: 'ignore', windowsHide: true,
    env: { ...process.env, ...TEST_DOCKET_ENV, PORTAL_PORT: String(PORT), DOCKET_RUNNER_PORT: String(RUNNER_PORT), PORTAL_CLIENTS: path.join(tmp, 'clients.json'),
      PORTAL_STATE: path.join(tmp, 'state.json'), PORTAL_SCHEDULES: path.join(tmp, 'schedules.json'), PORTAL_DATA: path.join(tmp, 'data'),
      PORTAL_GROK_EXE: path.join(HERE, '..', 'test-fixtures', 'fake-acp-agent.mjs') },
  });
  await waitFor('the test Docket to start', () => api('/api/clients?quick=1'));
  a = await api('/api/sessions', { client: 't1', text: 'first', engine: 'grok' });
  b = await api('/api/sessions', { client: 't1', text: 'second', engine: 'grok' });
  await waitFor('both replies', async () => (await api('/api/sessions?client=t1')).live.filter((s) => s.status === 'idle').length === 2);
  await api(`/api/sessions/${a.id}/rename?client=t1`, { title: 'Alpha' }).catch(() => {});
  await api(`/api/sessions/${b.id}/rename?client=t1`, { title: 'Bravo' }).catch(() => {});

  const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 } });
  await ctx.addInitScript(() => { if (!localStorage.getItem('client')) { localStorage.setItem('client', '"t1"'); localStorage.setItem('tourSeen', 'true'); localStorage.setItem('accentAsked', 'true'); localStorage.setItem('wnLast', '"99.0.0"'); } });
  page = await ctx.newPage();
  await page.routeWebSocket(/\/ws$/, (ws) => { ws.connectToServer(); toPage = ws; });
  page.on('dialog', (d) => d.dismiss());
  await page.goto(URL_);
  await waitFor('the page to connect', async () => !!toPage);
  await page.waitForSelector(`#list .row[data-id="${a.id}"]`);
});

after(async () => {
  await browser?.close();
  const pid = await runnerPid();
  server?.kill();
  if (pid) stopTree(pid);
  await sleep(300);
  try { fs.rmSync(tmp, { recursive: true, force: true }); } catch {}
});

const live = async (id) => (await api('/api/sessions?client=t1')).live.find((s) => s.id === id);
const push = (m) => toPage.send(JSON.stringify(m));
let n = 0;
// A burst of updates of every kind a working session sends, for the open session and another: its row (status and
// title), a reply arriving, a list rebuild, the details panel, the groups and the stats.
async function storm(id = page.selected) {
  const s = await live(id), o = await live(id === a.id ? b.id : a.id);
  for (let i = 0; i < 3; i++) {
    push({ t: 'session', session: { ...s, status: i % 2 ? 'running' : 'idle', lastModified: Date.now() } });
    push({ t: 'session', session: { ...o, status: i % 2 ? 'idle' : 'running', lastModified: Date.now() } });
    push({ t: 'event', id, ev: { k: 'text', id: `x${++n}`, text: 'A long reply line.\n\n'.repeat(20) } });
    push({ t: 'waiting', id: o.id, client: 't1', waiting: i % 2 === 0 });
    push({ t: 'stats-ready', client: 't1' });
    push({ t: 'groups', client: 't1' });
    await page.evaluate(() => { renderHead(); renderList(); renderTasks?.(); }); // the redraws as an update sets them off, not the person
    await sleep(120);
  }
  await sleep(600); // the list and panel reloads those set off have come back
}
async function openSession(id) {
  await page.locator(`#list .row[data-id="${id}"]`).first().click();
  // and its chat has loaded: a message pushed while it loads goes in the list the loaded chat then replaces
  await page.waitForFunction((x) => document.querySelector('#head h1') && S.selected === x && S.events.length
    && !document.querySelector('#events > .note')?.textContent.startsWith('Loading'), id);
  page.selected = id;
}
// The box is the same element, still in the page, with the focus and the text typed into it.
async function survives(box, text, what) {
  assert.ok(await box.evaluate((x) => x.isConnected), `${what}: the box is still there`);
  assert.ok(await box.evaluate((x) => document.activeElement === x), `${what}: it still has the focus`);
  assert.equal(await box.evaluate((x) => x.value ?? x.textContent), text, `${what}: the text typed is still in it`);
}

test('the session title being renamed survives updates, and Enter saves it', { skip }, async () => {
  await openSession(a.id);
  await page.locator('#head h1#title').click();
  const box = await page.waitForSelector('#head input');
  await page.keyboard.press('Control+A');
  await page.keyboard.type('Alpha renamed');
  await storm();
  await survives(box, 'Alpha renamed', 'session title');
  await page.keyboard.type(' twice');
  await storm();
  await survives(box, 'Alpha renamed twice', 'session title');
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => document.querySelector('#head h1#title')?.textContent === 'Alpha renamed twice');
  await waitFor('the new title to be saved', async () => (await live(a.id)).title === 'Alpha renamed twice', 5000);
  await waitFor('the list to show it', async () => (await page.locator(`#list .row[data-id="${a.id}"]`).first().innerText()).includes('Alpha renamed twice'), 5000);
});

test('Escape cancels a rename, and the held redraws show at once', { skip }, async () => {
  await page.locator('#head h1#title').click();
  await page.waitForSelector('#head input');
  await page.keyboard.type('Never saved');
  const s = await live(a.id);
  push({ t: 'session', session: { ...s, status: 'running', lastModified: Date.now() } });
  await sleep(300);
  assert.ok(await page.locator('#head input').count(), 'still renaming while the update arrived');
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => document.querySelector('#head h1#title')?.textContent === 'Alpha renamed twice');
  assert.equal((await live(a.id)).title, 'Alpha renamed twice');
});

test('leaving the box saves it, and the held header catches up', { skip }, async () => {
  await page.locator('#head h1#title').click();
  const box = await page.waitForSelector('#head input');
  await page.keyboard.press('Control+A');
  await page.keyboard.type('Alpha by blur');
  await storm();
  await survives(box, 'Alpha by blur', 'session title');
  await page.mouse.click(5, 890);
  await page.waitForFunction(() => document.querySelector('#head h1#title')?.textContent === 'Alpha by blur');
  await waitFor('the new title to be saved', async () => (await live(a.id)).title === 'Alpha by blur', 5000);
});

test('the rename box survives a real reply streaming in', { skip }, async () => {
  await page.locator('#head h1#title').click();
  const box = await page.waitForSelector('#head input');
  await page.keyboard.press('Control+A');
  await page.keyboard.type('Alpha while working');
  await api(`/api/sessions/${a.id}/send?client=t1`, { text: 'another turn\nSTREAM 15' }).catch(() => {}); // a reply in 15 pieces, 200 ms apart
  await page.waitForFunction(() => $('events').textContent.includes('Streamed line 3.'));
  await survives(box, 'Alpha while working', 'session title while a reply streams in');
  await page.keyboard.type('!');
  await waitFor('the reply to finish', async () => (await live(a.id)).status === 'idle', 15000);
  await page.waitForFunction(() => $('events').textContent.includes('Streamed line 15.'));
  await sleep(500);
  await survives(box, 'Alpha while working!', 'session title after the turn');
  await page.keyboard.press('Enter');
  await waitFor('the new title to be saved', async () => (await live(a.id)).title === 'Alpha while working!', 5000);
});

test('a schedule\'s title being renamed survives updates', { skip }, async () => {
  const sch = await api('/api/schedules', { client: 't1', title: 'Morning check', cron: '0 9 * * 1-5', folder: path.join(tmp, 'work-1'), prompt: 'check' });
  await page.evaluate((id) => openSchedule(id), sch.id);
  await page.waitForFunction(() => document.querySelector('#head h1#title')?.textContent === 'Morning check');
  await page.locator('#head h1#title').click();
  const box = await page.waitForSelector('#head input');
  await page.keyboard.press('Control+A');
  await page.keyboard.type('Evening check');
  for (let i = 0; i < 3; i++) {
    push({ t: 'schedules', client: 't1' });
    await page.evaluate(() => { renderScheduleHead(); renderSchedulePanel(); });
    await sleep(150);
  }
  await survives(box, 'Evening check', 'schedule title');
  await page.keyboard.press('Enter');
  await waitFor('the new title to be saved', async () => (await api('/api/schedules?client=t1')).find((x) => x.id === sch.id)?.title === 'Evening check', 5000);
  await page.waitForFunction(() => document.querySelector('#head h1#title')?.textContent === 'Evening check');
  await page.evaluate((id) => setMode('sessions', id), a.id);
});

test('a field of the schedule editor keeps its focus and text through updates', { skip }, async () => {
  const sch = (await api('/api/schedules?client=t1'))[0];
  await page.evaluate((id) => openSchedule(id), sch.id);
  const box = await page.waitForSelector('#sPrompt');
  await box.click();
  await page.keyboard.press('Control+End');
  await page.keyboard.type(' and more');
  const text = await box.evaluate((x) => x.value);
  for (let i = 0; i < 3; i++) {
    push({ t: 'schedules', client: 't1' });
    await page.evaluate(() => { schedDirty = false; renderSchedulePanel(); }); // even before the first keystroke marks it changed
    await sleep(150);
  }
  await survives(box, text, 'schedule instructions');
  await page.evaluate((id) => { schedDirty = false; return setMode('sessions', id); }, a.id);
  await openSession(a.id);
});

test('a brief being edited in the Suggested box keeps its focus and text through list redraws', { skip }, async () => {
  await page.evaluate(() => { S.inbox.t1 = [{ id: 'ib1', fromName: 'Other desk', title: 'Handed-over work', brief: 'Do the thing' }]; renderList(); });
  await page.locator('[data-inbox-edit="ib1"]').click();
  const box = await page.waitForSelector('[data-inbox-text="ib1"]');
  await page.keyboard.press('End');
  await page.keyboard.type(' carefully');
  await storm();
  await page.evaluate(() => { S.inbox.t1 = [{ id: 'ib1', fromName: 'Other desk', title: 'Handed-over work', brief: 'Do the thing' }]; renderList(); });
  await survives(box, 'Do the thing carefully', 'inbox brief');
  await page.locator('[data-inbox-edit="ib1"][data-cancel]').click();
  await page.evaluate(() => { S.inbox.t1 = []; renderList(); });
});

test('a sign-in code being pasted survives redraws of the sign-in, and goes once the sign-in moves on', { skip }, async () => {
  await page.evaluate(() => setSignin('t1', 'grok', 'code', { url: 'https://example.invalid/sign-in' }));
  const box = await page.waitForSelector('#signin .signin-code-in');
  await box.click();
  await page.keyboard.type('CODE-1234');
  for (let i = 0; i < 3; i++) {
    push({ t: 'clients' });
    await page.evaluate(() => { drawSignin(); showSignin(); });
    await sleep(150);
  }
  await survives(box, 'CODE-1234', 'sign-in code');
  await page.evaluate(() => setSignin()); // the sign-in ends: that redraw is not held
  await page.waitForFunction(() => !document.querySelector('#signin .signin-code-in'));
});

test('a site being typed in the signed-in sites dialog survives browser updates', { skip }, async () => {
  await page.evaluate(() => { openSites(); });
  const box = await page.waitForSelector('#dlgBody #svUrl');
  await box.click();
  await page.keyboard.press('Control+A');
  await page.keyboard.type('example.com/login');
  for (let i = 0; i < 3; i++) {
    push({ t: 'browser', client: 't1', sites: [`site${i}.example`], open: false });
    await sleep(150);
  }
  await survives(box, 'example.com/login', 'site to sign in to');
  await page.locator('#dlgBody .sv-note').click(); // the focus leaves it: the held redraw shows the new sites
  await page.waitForFunction(() => document.querySelector('#dlgBody .site-rows')?.textContent.includes('site2.example'));
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => $('dlg').hidden);
});

test('the Other box of a plan decision in the chat keeps its text through the chat being drawn again', { skip }, async () => {
  await openSession(a.id);
  const plans = (opts) => ({ client: 't1', on: true, folder: false, plans: [{ id: 'p1', title: 'Plan', coordinator: a.id, holders: [], done: 0, total: 1, decisions: [{ q: 41, options: opts, state: 'open' }] }] });
  await page.evaluate((p) => { window.loadPlans = async () => {}; S.plans = p; }, plans(['Yes', 'No']));
  push({ t: 'event', id: a.id, ev: { k: 'text', id: 'qdec1', text: 'Q41: Keep the CSV export?' } });
  const sel = '[data-qdec="41"] input[data-qother]';
  await page.waitForSelector(sel);
  await page.locator(sel).click();
  await page.keyboard.type('Only for admins');
  const kept = async (what) => {
    assert.equal(await page.locator(sel).inputValue(), 'Only for admins', `${what}: the text is still there`);
    assert.ok(await page.evaluate((s) => document.activeElement === document.querySelector(s), sel), `${what}: it still has the focus`);
  };
  await page.evaluate(() => renderEvents(true)); // the whole chat drawn again
  await kept('the chat drawn again');
  const box = await page.$(sel);
  await page.evaluate((p) => { S.plans = p; decorateDecisions(); }, plans(['Yes', 'No', 'Later'])); // its options changed meanwhile
  await storm(a.id);
  await survives(box, 'Only for admins', 'decision Other box');
  await page.mouse.click(5, 890); // the focus leaves it: the held redraw shows the new option
  await page.waitForSelector('[data-qdec="41"] [data-qans="Later"]');
});

// Every inline editor goes through inlineEdit, which marks it so the edit hold covers it; one built some other way
// would not be covered.
test('no inline editor is built outside inlineEdit', () => {
  const src = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  const swaps = [...src.matchAll(/\.replaceWith\((\w+)\)/g)].map((m) => m[1]);
  const fn = src.slice(src.indexOf('function inlineEdit('), src.indexOf('function inlineEdit(') + 1200);
  assert.ok(fn.includes('h.replaceWith(inp)') && fn.includes("inp.dataset.editing = ''"));
  for (const m of src.matchAll(/(\w+)\s*=\s*document\.createElement\('(input|textarea)'\)[^\n]*\n(?:[^\n]*\n){0,3}?[^\n]*\.replaceWith\(\1\)/g))
    assert.ok(m[0].includes('dataset.editing'), `an inline editor that is not marked data-editing: ${m[0].slice(0, 120)}`);
  assert.ok(swaps.length);
});
