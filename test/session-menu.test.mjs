// Tests for a session's menu: right-click a session in the list and ⋯ in its header open the same menu,
// drawn from one list (sessionMenuItems). Runs the session menu part of index.html on its own.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const page = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const start = page.indexOf('// ---------- session menu');
const end = page.indexOf('// end of session menu');
assert.ok(start > 0 && end > start, 'the session menu part of index.html has moved or lost its markers');
const escLine = page.split('\n').find((l) => l.startsWith('const esc = '));
const { sessionMenuItems, sessionMenuHtml } = new Function('tip', escLine + '\n' + page.slice(start, end) + '\nreturn { sessionMenuItems, sessionMenuHtml };')((k) => ` title="${k}"`);

const base = { archived: false, live: true, midReply: false, cwd: 'C:/Work/acme', parentId: null, noGroup: true, needsYou: false, working: false,
  muted: false, soundOn: true, timeline: false, kids: 0, otherRuns: 0, unreadRuns: 0 };
const keys = (f) => sessionMenuItems({ ...base, ...f }).map(([k]) => k);

test('both ways in open the one menu: right-click in the list and ⋯ in the header', () => {
  const body = (from) => page.slice(from, page.indexOf('\n});', from));
  const rightClick = body(page.indexOf("$('list').addEventListener('contextmenu', (e) => {\n  const r = e.target.closest('.row[data-id]')"));
  assert.match(rightClick, /openSessionMenu\(id, \{ x: e\.clientX, y: e\.clientY \}\)/);
  const head = page.slice(page.indexOf("$('sessMenuBtn').onclick"), page.indexOf("$('sessMenuBtn').onclick") + 300);
  assert.match(head, /openSessionMenu\(s\.id, \{ el: e\.currentTarget \}\)/);
  // Only openSessionMenu draws the items, so nothing else can build a second list that drifts away from it.
  assert.equal([...page.matchAll(/sessionMenuItems\(/g)].length, 2, 'sessionMenuItems is defined once and called once');
  assert.equal([...page.matchAll(/sessionMenuHtml\(/g)].length, 1);
  assert.ok(/m\.innerHTML = sessionMenuHtml\(sessionMenuItems\(ctx\.f\)\)/.test(page));
});

test('the header has a ⋯ button and no longer its own row of buttons', () => {
  assert.ok(page.includes('id="sessMenuBtn"'));
  for (const old of ['restoreBtn', 'continueBtn', 'termBtn', 'endBtn', 'deleteBtn', 'tlBtn', 'convMute', 'editorBtn']) assert.ok(!page.includes(`id="${old}"`), old);
});

test('every action from the old header and the old right-click menu is in it', () => {
  const all = new Set([...keys({}), ...keys({ archived: true, live: false }), ...keys({ midReply: true, parentId: 'p', kids: 2, unreadRuns: 1 })]);
  for (const k of ['newunder', 'archive', 'archive-all', 'restore', 'read', 'unread', 'terminal', 'timeline', 'chime', 'group', 'parent', 'top', 'auto-group', 'rename', 'end', 'delete'])
    assert.ok(all.has(k), k);
});

test('items come and go with the session', () => {
  assert.deepEqual(keys({}), ['newunder', 'hr', 'archive', 'unread', 'pin', 'hr', 'popout', 'terminal', 'timeline', 'chime', 'hr', 'group', 'parent', 'auto-group', 'rename', 'hr', 'end', 'delete']);
  assert.deepEqual(keys({ archived: true, live: false, cwd: '' }), ['restore', 'hr', 'popout', 'timeline', 'chime', 'hr', 'group', 'rename', 'hr', 'delete']);
  assert.ok(!keys({ midReply: true }).includes('continue'), 'Continue moved to the banner over the session');
  assert.ok(!keys({ working: true }).includes('unread'));
  assert.ok(keys({ parentId: 'p' }).includes('top'));
  assert.ok(keys({ pinned: true }).includes('unpin') && !keys({ pinned: true }).includes('pin'), 'a pinned session offers Unpin (#613)');
  const items = sessionMenuItems({ ...base, otherRuns: 2, kids: 3, unreadRuns: 3 });
  assert.equal(items.find(([k]) => k === 'archive')[1], 'Archive all 3 runs');
  assert.equal(items.find(([k]) => k === 'archive-all')[1], 'Archive with the 3 started from it');
  assert.equal(items.find(([k]) => k === 'read')[1], 'Mark 3 runs read');
  const k = items.map(([key]) => key);
  assert.equal(k.indexOf('archive-all') + 1, k.indexOf('archive'), 'Archive with the ones started from it comes right before Archive');
});

test('Pop out opens the session in its own window, which stays on it (#611)', () => {
  assert.ok(keys({}).includes('popout') && keys({ archived: true, live: false }).includes('popout'));
  assert.ok(page.includes("if (act === 'popout') popOut(id, S.client);"));
  assert.ok(page.includes("window.open('/?' + new URLSearchParams({ popout: id, client }), 'docket-popout-' + id,"), 'one window per session, so a second Pop out brings it forward');
  // The pop-out never moves to another session, and never writes which desk or session the main window opens.
  assert.ok(page.includes('async function openSession(id) {\n  if (POPOUT && id !== POPOUT.id) return;'));
  assert.ok(page.includes("S.selected = id; if (!POPOUT) store.set('sel:' + S.client, id);"));
  assert.ok(page.includes('function recordView(c, id) {\n  if (POPOUT) return;'));
  assert.ok(page.includes('if (POPOUT) return initPopout();'));
  assert.ok(!/async function initPopout\(\) \{[^]*?store\.set\('client'[^]*?\n\}/.test(page.slice(page.indexOf('async function initPopout'), page.indexOf('function waitingCount'))));
  assert.ok(page.includes('html.popout aside.side, html.popout aside.tasks'));
});

test('the editors installed here follow Terminal, and need a folder', () => {
  const editors = [{ id: 'vscode', name: 'VS Code' }, { id: 'vs', name: 'Visual Studio' }];
  const items = sessionMenuItems({ ...base, editors });
  const at = items.findIndex(([k]) => k === 'terminal');
  assert.deepEqual(items.slice(at + 1, at + 3).map(([k, l]) => [k, l]), [['editor-vscode', 'Open in VS Code'], ['editor-vs', 'Open in Visual Studio']]);
  assert.ok(!keys({ editors, cwd: '' }).some((k) => k.startsWith('editor-')));
  assert.match(sessionMenuHtml(items), /data-act="editor-vs" title="ctx-editor-vs"/);
});

test('Chime and Timeline show their state', () => {
  const on = (f, k) => sessionMenuItems({ ...base, ...f }).find(([x]) => x === k)[2];
  assert.deepEqual(on({}, 'chime'), { checked: true, disabled: false, stated: true });
  assert.deepEqual(on({ muted: true }, 'chime'), { checked: false, disabled: false, stated: true });
  assert.deepEqual(on({ soundOn: false }, 'chime'), { checked: false, disabled: true, stated: true });
  const label = (f) => sessionMenuItems({ ...base, ...f }).find(([x]) => x === 'chime')[1];
  assert.equal(label({}), '🔔 Chime: on');
  assert.equal(label({ muted: true }), '🔕 Chime: off');
  assert.equal(label({ soundOn: false }), '🔕 Chime: off');
  assert.match(sessionMenuHtml(sessionMenuItems(base)), /data-act="chime"[^>]*><span class="ck"><\/span>🔔 Chime: on/, 'no ✓ when the label says on');
  assert.equal(on({ timeline: true }, 'timeline').checked, true);
  const html = sessionMenuHtml(sessionMenuItems({ ...base, timeline: true }));
  assert.match(html, /role="menuitemcheckbox" data-act="timeline" aria-checked="true"/);
  assert.match(html, /role="menuitemcheckbox" data-act="chime" aria-checked="true"/);
  assert.match(html, /role="menuitem" data-act="delete" title="ctx-delete"/);
  assert.match(sessionMenuHtml(sessionMenuItems({ ...base, soundOn: false })), /data-act="chime" aria-checked="false" disabled title="Sound is off/);
});
