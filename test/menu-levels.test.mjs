// Each menu holds the settings of one level and says which (#1269): ☰ all of Docket (a desk's own settings in
// ☰ › Desks › desk), 👁 this desk's session list, ⋯ this one session. Plus each desk's Chime and session mute on the app.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { PAGE_SETTINGS, SETTINGS } from '../profile-sync.mjs';

const page = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const server = fs.readFileSync(new URL('../server.mjs', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const between = (a, b) => { const i = page.indexOf(a); assert.ok(i > 0, a); return page.slice(i, page.indexOf(b, i)); };

test('each menu starts with its level', () => {
  assert.ok(page.includes(`m.innerHTML = '<div class="lvl-h">All of Docket</div>' + items.map(item).join('');`), '☰');
  assert.ok(page.includes(`$('viewMenu').innerHTML = '<div class="lvl-h">This desk</div>' +`), '👁');
  assert.ok(page.includes(`m.innerHTML = '<div class="lvl-h">This session</div>' + sessionMenuHtml(`), '⋯');
  assert.match(page, /\.ctx \.lvl-h \{[^}]*border-bottom: 1px solid var\(--line\)/);
});

test('a desk\'s own settings are in its group in ☰ › Desks, not in Docket settings or 👁', () => {
  const desk = between('const deskItems = (c) =>', '\nconst DESK_PICK');
  for (const k of ['chime:', 'qlevel:', 'xmodel:', 'sumcheck:']) assert.ok(desk.includes(`['${k}' + c.id`), k);
  const settings = between("['settings', 'Docket settings',", "['about', 'About'");
  assert.ok(!settings.includes('explainmodel') && !settings.includes('xmodel'), 'Explainer model left Docket settings');
  const eye = between('function renderViewMenu() {', '\n}');
  assert.ok(!eye.includes('qlevel') && !eye.includes("h('Questions')"), 'Questions left 👁');
  assert.ok(eye.includes("h('Activity <small>all desks</small>')"), 'Activity says it is for every desk');
  const checks = between('function summaryChecksHtml(r) {', '\n}');
  assert.ok(!checks.includes('scHours') && !checks.includes('scSave'), 'Gauges › Summary checks only reads');
  assert.ok(page.includes("if (act.startsWith('sumcheck:')) showSummaryChecks(act.slice(9), true);"));
  for (const k of ['menu-chime', 'menu-qlevel', 'menu-xmodel', 'menu-sumcheck']) assert.ok(page.includes(`['${k}', `), `tip ${k}`);
});

test('a muted desk or session gets no chime, cache tone or read-aloud line; Sound still overrides', () => {
  assert.ok(PAGE_SETTINGS.includes('deskChime') && !('deskChime' in SETTINGS), 'kept by the app, on this computer only (desk ids differ)');
  assert.ok(page.includes('const isMuted = (id, desk = (S.live[id] || sessionById(id))?.client || S.client) => sessionMuted(id) || deskMuted(desk);'));
  assert.ok(page.includes('if (!due.some((d) => !isMuted(d.s.id, d.c.id)) || !soundOn()) return;'), 'the cache tone');
  assert.ok(page.includes('if (isMuted(s.id, s.client)) chimeLog('), 'the chime');
  assert.match(page, /muted: isMuted\(id\), needs: needsYou\(s\)/, 'read aloud asks isMuted');
  const talk = fs.readFileSync(new URL('../talk.mjs', import.meta.url), 'utf8');
  assert.ok(talk.includes('page.needOf(ev.childId).muted'), 'a muted child\'s report is not read');
});

test('session mute is kept by the app, and the browser\'s old list is sent once', () => {
  assert.ok(server.includes("if (p === '/api/muted-sessions') {"));
  assert.ok(server.includes("broadcast({ t: 'muted-sessions', muted: state.mutedSessions })"));
  assert.ok(page.includes("if (m.t === 'muted-sessions') { S.mutedSessions = m.muted || {}; mutedChanged(); return; }"));
  const load = between('async function loadMuted() {', '\n}');
  assert.match(load, /store\.get\('mutedSessions'/);
  assert.match(load, /localStorage\.removeItem\('mutedSessions'\)/);
  assert.ok(!/store\.set\('mutedSessions'/.test(page), 'nothing writes the browser list any more');
});

test('help says where Sound is', () => {
  assert.ok(!page.includes('☰ > Sound'));
});
