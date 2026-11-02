// Open menus survive session updates (#591), in a real browser on a throwaway Docket whose Grok is
// fixtures/fake-acp-agent.mjs. The page's live connection is passed through Playwright, which adds updates of its
// own (a session's new title and status, replies arriving, list and panel redraws) while each kind of menu is open.
// Each menu must stay open and usable, the updates must wait while it is open and show once it closes, and a menu
// for a session that is deleted still closes. Skipped where Playwright's Chromium is not installed.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { freePorts } from './free-port.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.dirname(HERE);
const [PORT, RUNNER_PORT] = await freePorts(2);
const URL_ = `http://127.0.0.1:${PORT}`;
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'docket-591-'));
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
    env: { ...process.env, PORTAL_PORT: String(PORT), DOCKET_RUNNER_PORT: String(RUNNER_PORT), PORTAL_CLIENTS: path.join(tmp, 'clients.json'),
      PORTAL_STATE: path.join(tmp, 'state.json'), PORTAL_SCHEDULES: path.join(tmp, 'schedules.json'), PORTAL_DATA: path.join(tmp, 'data'),
      PORTAL_GROK_EXE: path.join(HERE, 'fixtures', 'fake-acp-agent.mjs') },
  });
  await waitFor('the test Docket to start', () => api('/api/clients?quick=1'));
  a = await api('/api/sessions', { client: 't1', text: 'first', engine: 'grok' });
  b = await api('/api/sessions', { client: 't1', text: 'second', engine: 'grok' });
  await waitFor('both replies', async () => (await api('/api/sessions?client=t1')).live.filter((s) => s.status === 'idle').length === 2);
  await api(`/api/sessions/${a.id}/rename?client=t1`, { title: 'Alpha' }).catch(() => {});
  await api(`/api/sessions/${b.id}/rename?client=t1`, { title: 'Bravo' }).catch(() => {});

  const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 } });
  await ctx.addInitScript(() => { if (!localStorage.getItem('client')) { localStorage.setItem('client', '"t1"'); localStorage.setItem('tourSeen', 'true'); localStorage.setItem('accentAsked', 'true'); } });
  page = await ctx.newPage();
  // The page's own connection, passed through; toPage adds a message of the test's own.
  await page.routeWebSocket(/\/ws$/, (ws) => { ws.connectToServer(); toPage = ws; });
  page.on('dialog', (d) => d.dismiss());
  await page.goto(URL_);
  await waitFor('the page to connect', async () => !!toPage);
  await page.waitForSelector(`#list .row[data-id="${a.id}"]`);
  await page.waitForSelector(`#list .row[data-id="${b.id}"]`);
});

after(async () => {
  await browser?.close();
  const pid = await runnerPid();
  server?.kill();
  if (pid) try { process.kill(pid); } catch {}
  await sleep(300);
  try { fs.rmSync(tmp, { recursive: true, force: true }); } catch {}
});

const live = async (id) => (await api('/api/sessions?client=t1')).live.find((s) => s.id === id);
const push = (m) => toPage.send(JSON.stringify(m));
const rowTitle = (id) => page.locator(`#list .row[data-id="${id}"]`).first().innerText();
let n = 0;
// A burst of updates of every kind a working session sends: its row (a new title and status), a reply arriving in
// the open session (the chat scrolls down by itself), a rename (a real one, so the title it gives sticks), a list rebuild, the details panel and the tabs.
async function storm(title) {
  await api(`/api/sessions/${a.id}/rename?client=t1`, { title }); // the app sends the new title to the page itself
  const s = await live(a.id);
  for (let i = 0; i < 3; i++) {
    push({ t: 'session', session: { ...s, status: i % 2 ? 'running' : 'idle', lastModified: Date.now() } });
    push({ t: 'event', id: page.selected, ev: { k: 'text', id: `x${++n}`, text: 'A long reply line.\n\n'.repeat(40) } });
    push({ t: 'waiting', id: b.id, client: 't1', waiting: i % 2 === 0 });
    push({ t: 'stats-ready', client: 't1' });
    push({ t: 'groups', client: 't1' });
    await sleep(120);
  }
  await sleep(600); // the list and panel reloads those set off have come back
}
async function openSession(id) {
  await page.locator(`#list .row[data-id="${id}"]`).first().click();
  await page.waitForFunction((x) => document.querySelector('#head h1') && S.selected === x, id);
  page.selected = id;
}
const ctxOpen = () => page.evaluate(() => !!document.getElementById('ctx'));
// The held updates show once the menu has closed: the list has the new title.
async function heldThenShown(title) {
  assert.notEqual(await rowTitle(a.id).then((t) => t.includes(title)), true, 'the list waited while the menu was open');
}
async function shownAfter(title) {
  await waitFor('the held updates to show', async () => (await rowTitle(a.id)).includes(title), 5000);
}

test('a session menu opened by right-click stays open through updates, and the updates show once it closes', { skip }, async () => {
  await openSession(b.id);
  const marker = await page.evaluate(() => { const r = document.querySelector('#list'); r.dataset.t = '1'; return true; });
  assert.ok(marker);
  await page.locator(`#list .row[data-id="${a.id}"]`).first().click({ button: 'right' });
  await page.waitForSelector('#ctx.sess-menu');
  const menu = await page.$('#ctx');
  await storm('Alpha one');
  assert.ok(await menu.evaluate((m) => m.isConnected), 'the same menu is still there');
  await heldThenShown('Alpha one');
  // still usable: the arrow keys move through it and Chime toggles in place
  await page.keyboard.press('ArrowDown');
  assert.ok(await page.evaluate(() => document.getElementById('ctx').contains(document.activeElement)));
  await page.locator('#ctx [data-act="chime"]').click();
  assert.ok(await ctxOpen(), 'Chime keeps it open');
  await page.keyboard.press('Escape');
  assert.equal(await ctxOpen(), false);
  await shownAfter('Alpha one');
});

test('the ⋯ menu in the header stays open while replies arrive and the chat scrolls by itself', { skip }, async () => {
  await openSession(a.id);
  await page.locator('#sessMenuBtn').click();
  await page.waitForSelector('#ctx.sess-menu');
  const top = await page.evaluate(() => $('transcript').scrollTop);
  await storm('Alpha two');
  assert.ok(await page.evaluate(() => $('transcript').scrollTop) > top, 'the chat did scroll down by itself');
  assert.ok(await ctxOpen(), 'still open');
  assert.equal(await page.locator('#sessMenuBtn').getAttribute('aria-expanded'), 'true', 'the header it hangs from was not redrawn under it');
  await page.mouse.click(5, 890); // a click away closes it
  assert.equal(await ctxOpen(), false);
  await shownAfter('Alpha two');
  assert.equal(await page.locator('#head h1').innerText(), 'Alpha two', 'the header caught up too');
});

test('the ☰ menu and a submenu in it stay open', { skip }, async () => {
  await page.locator('#menuBtn').click();
  await page.waitForSelector('#ctx');
  await page.locator('#ctx [data-sub="settings"]').click();
  await page.waitForSelector('#ctx [data-sub="settings"] + .sub:not([hidden])');
  await storm('Alpha three');
  assert.ok(await page.locator('#ctx [data-sub="settings"] + .sub').isVisible(), 'Settings is still open');
  await heldThenShown('Alpha three');
  await page.keyboard.press('Escape'); // closes Settings
  await page.keyboard.press('Escape'); // closes ☰
  assert.equal(await ctxOpen(), false);
  await shownAfter('Alpha three');
});

test('the 👁 view menu stays open, and its own choices still redraw the list at once', { skip }, async () => {
  await page.locator('#viewBtn').click();
  await page.waitForSelector('#viewMenu:not([hidden])');
  await storm('Alpha four');
  assert.ok(await page.locator('#viewMenu').isVisible());
  await heldThenShown('Alpha four');
  const grouped = await page.evaluate(() => S.groupView);
  await page.locator('#viewMenu [data-view="groupView"]').click(); // Grouped: the person's own redraw is not held
  await page.waitForFunction((g) => S.groupView === !g && !!document.querySelector('#list .gsec') === !g, grouped);
  assert.ok(await page.locator('#viewMenu').isVisible(), 'still open after a choice in it');
  await page.locator('#viewMenu [data-view="groupView"]').click();
  await page.mouse.click(5, 890);
  assert.ok(!(await page.locator('#viewMenu').isVisible()));
  await shownAfter('Alpha four');
});

test('the Back menu stays open', { skip }, async () => {
  await openSession(b.id);
  await page.locator('#backBtn').click({ button: 'right' });
  await page.waitForSelector('#ctx.nav-menu');
  await storm('Alpha five');
  assert.ok(await ctxOpen());
  await heldThenShown('Alpha five');
  await page.keyboard.press('Escape');
  await shownAfter('Alpha five');
});

test('a row menu in the details panel stays open', { skip }, async () => {
  const row = page.locator('#tasksBody [data-row-folder]').first();
  await row.waitFor();
  await row.click({ button: 'right' });
  await page.waitForSelector('#ctx.row-menu');
  await storm('Alpha six');
  assert.ok(await ctxOpen());
  await heldThenShown('Alpha six');
  await page.keyboard.press('Escape');
  await shownAfter('Alpha six');
});

test('a group\'s right-click menu stays open', { skip }, async () => {
  await api('/api/groups', { client: 't1', name: 'Gamma' });
  // Gamma has no sessions yet, so it shows only with Show empty groups on
  await page.evaluate(() => loadGroups(S.client).then(() => { S.groupView = S.showEmptyGroups = true; renderList(); }));
  const head = page.locator('#list .gsec[data-gid]').filter({ hasText: 'Gamma' }).first();
  await head.waitFor();
  await head.click({ button: 'right' });
  await page.waitForSelector('#ctx [data-gact]');
  await storm('Alpha seven');
  assert.ok(await ctxOpen());
  await page.keyboard.press('Escape');
  await page.evaluate(() => { S.groupView = S.showEmptyGroups = false; renderList(); });
  await shownAfter('Alpha seven');
});

test('a dropdown (the Order choice over the list) is not rebuilt or closed while open', { skip }, async () => {
  const sel = page.locator('#listOrder');
  await sel.focus();
  await sel.dispatchEvent('pointerdown');
  const el = await page.$('#listOrder');
  await storm('Alpha eight');
  assert.ok(await el.evaluate((x) => x.isConnected && document.activeElement === x), 'the same dropdown, still with the focus');
  await heldThenShown('Alpha eight');
  await page.mouse.click(5, 890); // the focus leaves it
  await shownAfter('Alpha eight');
});

test('a dropdown in the details panel (the session\'s group) is not rebuilt while open', { skip }, async () => {
  const sel = page.locator('#groupSelect');
  await sel.waitFor();
  await sel.focus();
  await sel.dispatchEvent('pointerdown');
  const el = await page.$('#groupSelect');
  await storm('Alpha nine');
  assert.ok(await el.evaluate((x) => x.isConnected && document.activeElement === x));
  await page.mouse.click(5, 890);
  await shownAfter('Alpha nine');
});

test('a menu for a session that is deleted closes', { skip }, async () => {
  await page.locator(`#list .row[data-id="${a.id}"]`).first().click({ button: 'right' });
  await page.waitForSelector('#ctx.sess-menu');
  push({ t: 'deleted', id: a.id, client: 't1' });
  await waitFor('the menu to close', async () => !(await ctxOpen()), 3000);
});
