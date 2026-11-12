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
  muted: false, soundOn: true, timeline: false, kids: 0, otherRuns: 0, unreadRuns: 0, chat: { steps: true, look: 'notes', notes: true, msgs: true, done: true } };
const keys = (f) => sessionMenuItems({ ...base, ...f }).map(([k]) => k);
const view = (f) => sessionMenuItems({ ...base, ...f }).find(([k]) => k === 'view')[2].sub;
const subKeys = (f) => view(f).map(([k]) => k);

test('both ways in open the one menu: right-click in the list and ⋯ in the header', () => {
  const body = (from) => page.slice(from, page.indexOf('\n});', from));
  const rightClick = body(page.indexOf("$('list').addEventListener('contextmenu', (e) => {\n  const r = e.target.closest('.row[data-id]')"));
  assert.match(rightClick, /openSessionMenu\(id, \{ x: e\.clientX, y: e\.clientY \}\)/);
  const head = page.slice(page.indexOf("$('sessMenuBtn').onclick"), page.indexOf("$('sessMenuBtn').onclick") + 300);
  assert.match(head, /openSessionMenu\(s\.id, \{ el: e\.currentTarget \}\)/);
  // Only openSessionMenu draws the items, so nothing else can build a second list that drifts away from it.
  assert.equal([...page.matchAll(/sessionMenuItems\(/g)].length, 2, 'sessionMenuItems is defined once and called once');
  assert.equal([...page.matchAll(/sessionMenuHtml\(/g)].length, 2, 'drawn in one place, and by itself for a group like View');
  assert.ok(page.includes('${sessionMenuHtml(o.sub)}'));
  assert.ok(/m\.innerHTML = sessionMenuHtml\(sessionMenuItems\(ctx\.f\)\)/.test(page));
});

test('the header has a ⋯ button and no longer its own row of buttons', () => {
  assert.ok(page.includes('id="sessMenuBtn"'));
  for (const old of ['restoreBtn', 'continueBtn', 'termBtn', 'endBtn', 'deleteBtn', 'tlBtn', 'convMute', 'editorBtn']) assert.ok(!page.includes(`id="${old}"`), old);
});

test('every action from the old header and the old right-click menu is in it', () => {
  const all = new Set([...keys({}), ...keys({ archived: true, live: false }), ...keys({ midReply: true, parentId: 'p', kids: 2, unreadRuns: 1 }), ...subKeys({})]);
  for (const k of ['newunder', 'archive', 'archive-all', 'restore', 'read', 'unread', 'terminal', 'timeline', 'chime', 'group', 'parent', 'top', 'auto-group', 'rename', 'end', 'delete'])
    assert.ok(all.has(k), k);
});

test('items come and go with the session', () => {
  assert.deepEqual(keys({}), ['newunder', 'hr', 'archive', 'unread', 'pin', 'hr', 'popout', 'terminal', 'view', 'chime', 'hr', 'group', 'parent', 'auto-group', 'rename', 'hr', 'refresh', 'end', 'delete']);
  assert.deepEqual(keys({ archived: true, live: false, cwd: '' }), ['restore', 'hr', 'popout', 'view', 'chime', 'hr', 'group', 'rename', 'hr', 'delete']);
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
  assert.ok(page.includes('async function openSession(id, auto = \'\') {\n  if (POPOUT && id !== POPOUT.id) return;'));
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
  assert.equal(view({ timeline: true }).find(([x]) => x === 'timeline')[2].checked, true);
  const html = sessionMenuHtml(sessionMenuItems({ ...base, timeline: true }));
  assert.match(html, /role="menuitemcheckbox" data-act="timeline" aria-checked="true"/);
  assert.match(html, /role="menuitemcheckbox" data-act="chime" aria-checked="true"/);
  assert.match(html, /role="menuitem" data-act="delete" title="ctx-delete"/);
  assert.match(sessionMenuHtml(sessionMenuItems({ ...base, soundOn: false })), /data-act="chime" aria-checked="false" disabled title="Sound is off/);
});

// View › Chat (#709): checkmarks for what shows, how steps look, and presets that set them.
const DEF = { steps: true, look: 'notes', notes: true, msgs: true, done: true };
const viewHtml = (chat, f = {}) => sessionMenuHtml(view({ chat, ...f }));
const act = (html, k) => html.match(new RegExp(`<button[^>]*data-act="${k}"[^>]*>.*?</button>`))?.[0] || '';

test('View holds the presets, the checkmarks with how steps look under Steps, and the timeline (#709)', () => {
  assert.ok(!keys({}).includes('timeline'), 'Timeline in the chat moved under View');
  assert.deepEqual(subKeys({ chat: DEF }), ['head', 'presets', 'hr', 'show-steps', 'look-group', 'look-notes', 'look-line', 'look-open',
    'show-notes', 'show-msgs', 'show-done', 'timeline', 'foot']);
  const html = sessionMenuHtml(sessionMenuItems({ ...base, chat: DEF }));
  assert.match(html, /<div class="sub-wrap"><button role="menuitem" class="sub-btn" data-sub="view" aria-haspopup="menu" aria-expanded="false" title="ctx-view">/);
  assert.match(html, /<div class="ctx sub" role="menu" aria-label="View" hidden><div class="sub-h">Chat<\/div><div class="ctx-presets" role="group" aria-label="Presets">/);
  for (const k of ['steps', 'notes', 'msgs', 'done']) assert.match(act(html, 'show-' + k), /role="menuitemcheckbox" data-act="show-[a-z]+" aria-checked="true" title="ctx-show-[a-z]+"><span class="ck">✓/);
  assert.match(act(html, 'look-notes'), /role="menuitemradio" data-act="look-notes" class="ind" aria-checked="true"[^>]*><span class="ck">✓<\/span>Grouped with notes/);
  for (const k of ['group', 'line', 'open']) assert.match(act(html, 'look-' + k), /aria-checked="false" title="ctx-look-/);
  assert.match(html, /<div class="sub-f">Always shown: your messages, final replies, and anything that needs you/);
});

test('a preset shows as on while the checkmarks match it, and Custom once they do not (#709)', () => {
  const on = (chat) => [...viewHtml(chat).matchAll(/class="chip-tgl on[^"]*"[^>]*>([^<]+)</g)].map((m) => m[1]);
  assert.deepEqual(on(DEF), ['Default']);
  assert.deepEqual(on({ ...DEF, look: 'open' }), ['Everything']);
  assert.deepEqual(on({ steps: false, look: 'line', notes: false, msgs: false, done: false }), ['Replies only'], 'with Steps off, how they look does not count');
  assert.deepEqual(on({ ...DEF, done: false }), ['Custom']);
  assert.deepEqual(on({ ...DEF, look: 'line' }), ['Custom']);
  assert.deepEqual(on({ ...DEF, steps: false }), ['Custom']);
  assert.match(viewHtml(DEF), /<button class="chip-tgl on" data-act="preset-default" aria-pressed="true" title="ctx-preset-default">Default<\/button>/);
  assert.ok(!viewHtml(DEF).includes('Custom'));
  assert.match(viewHtml(DEF, { timeline: true }), /data-act="preset-default" aria-pressed="true"/, 'Timeline is no part of a preset');
});

test('how steps look is greyed out with Steps off, and Grouped with notes with Notes off (#709)', () => {
  let html = viewHtml({ ...DEF, steps: false });
  for (const k of ['group', 'notes', 'line', 'open']) assert.match(act(html, 'look-' + k), /disabled title="Tick Steps to choose how they look"/);
  html = viewHtml({ ...DEF, notes: false });
  assert.match(act(html, 'look-notes'), /disabled title="Tick Notes too: with Notes off this is the same as Grouped"/);
  for (const k of ['group', 'line', 'open']) assert.ok(!act(html, 'look-' + k).includes('disabled'), k);
});

// The background steps part of index.html, run with a store holding what was saved.
const stepsPart = page.slice(page.indexOf('// ---------- background steps (#688)'), page.indexOf('S.openSteps = new Set();'));
const menuPart = page.slice(page.indexOf('const CHAT_LOOKS'), page.indexOf('// View › in the session menu'));
const chatFns = (saved) => new Function('store', 'S', '$', menuPart + stepsPart + '\nreturn { chatView, chatViewChange, CHAT_PRESETS, chatPreset };')(
  { get: (k, d) => (k in saved ? saved[k] : d), set: (k, v) => { saved[k] = v; } }, {}, () => null);

test('Default is the start, and picks saved before #709 carry over', () => {
  const v = (saved) => chatFns(saved).chatView();
  assert.deepEqual(v({}), DEF, 'nothing picked: Default');
  assert.deepEqual(v({ stepsView: 'expand' }), { ...DEF, look: 'open' }, 'expand: Everything');
  assert.equal(chatFns({}).chatPreset(v({ stepsView: 'expand' })), 'everything');
  assert.deepEqual(v({ stepsView: 'line' }), { ...DEF, look: 'line' });
  assert.deepEqual(v({ stepsView: 'narrate' }), { ...DEF, look: 'group' });
  assert.deepEqual(v({ stepsView: 'group' }), DEF);
  assert.deepEqual(v({ stepsView: 'hide' }), { ...DEF, steps: false }, 'hide: Steps off, the rest ticked');
  assert.deepEqual(v({ steps: 'group' }), { ...DEF, look: 'group' }, 'the #688 Group is Grouped');
  assert.deepEqual(v({ steps: 'line' }), { ...DEF, look: 'line' });
  assert.deepEqual(v({ steps: 'group', stepsView: 'group' }), DEF, 'a pick made since #706 wins');
  assert.deepEqual(v({ stepsView: 'gone' }), DEF);
  assert.deepEqual(v({ stepsView: 'hide', chatView: { ...DEF, done: false } }), { ...DEF, done: false }, 'a pick made since #709 wins');
  assert.deepEqual(v({ chatView: { msgs: false, look: 'gone' } }), { ...DEF, msgs: false }, 'what is missing or unknown reads as Default');
});

test('a click on a preset sets every checkmark, and one on a checkmark or a look changes just that (#709)', () => {
  const { chatViewChange: ch, CHAT_PRESETS: P } = chatFns({});
  const all = (act, v = DEF) => ({ ...v, ...ch(act, v) });
  assert.deepEqual(all('preset-everything'), { ...DEF, look: 'open' });
  assert.deepEqual(all('preset-default', { steps: false, look: 'line', notes: false, msgs: false, done: false }), DEF);
  assert.deepEqual(all('preset-replies'), { steps: false, look: 'notes', notes: false, msgs: false, done: false }, 'Replies only keeps how steps looked, for when Steps is ticked again');
  assert.deepEqual(all('show-done'), { ...DEF, done: false });
  assert.deepEqual(all('show-msgs', { ...DEF, msgs: false }), DEF);
  assert.deepEqual(all('look-line'), { ...DEF, look: 'line' });
  assert.equal(P.length, 3);
});

test('the chat leaves out what a checkmark turns off, and a run of steps folds across it (#709)', () => {
  const css = page.slice(page.indexOf('/* View > Chat in the session menu (#709)'), page.indexOf('.steps, .sreport {'));
  for (const sel of ['#events.steps-hide details.tool', '#events.steps-hide details.steps', '#events.notes-hide .reply.narr', '#events.done-hide .done-line',
    '#events.msgs-hide .msg-user[data-from]', '#events.msgs-hide .msg-user[data-from] + .msg-when', '#events.msgs-hide .sreport',
    '#events.msgs-hide .child-report:not(.waiting)', '#events.msgs-hide .qfold']) assert.ok(css.includes(sel), sel);
  assert.ok(page.includes("<div class=\"child-report${ev.waiting ? ' waiting' : ''}\">"), 'a child waiting on you always shows');
  assert.ok(page.includes("else if (!el.matches('.tl-w') && !hiddenHere(el)) flush();"));
  assert.ok(page.includes("look = v.steps ? (v.look === 'notes' && !v.notes ? 'group' : v.look) : ''"), 'Grouped with notes acts as Grouped with Notes off');
  assert.ok(!/stepsMode|STEP_MODES|ctx-steps-/.test(page), 'the old Background steps names are gone');
});
