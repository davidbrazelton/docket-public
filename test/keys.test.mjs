// Keyboard shortcuts (#1089): the one table, how a key press is read on Windows and on a Mac, how keys read in Help
// and the menus, and the command palette's matching. Runs the platform and keys parts of index.html on their own.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const page = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const part = (from, to) => {
  const a = page.indexOf(from), b = page.indexOf(to);
  assert.ok(a > 0 && b > a, `the part of index.html from "${from}" has moved or lost its markers`);
  return page.slice(a, b);
};
const code = part('// ---------- platform', '// end of platform') + part('// ---------- keys', '// end of keys');
const { KEYMAP, keyText, shortcutText, keyMatches, shortcutFor, fuzzyScore } = new Function('globalThis', code
  + '\nreturn { KEYMAP, keyText, shortcutText, keyMatches, shortcutFor, fuzzyScore };')({ navigator: { platform: 'Win32' } });

// A keydown as the browser gives it: key and code, and the modifiers held.
const box = { tagName: 'TEXTAREA' }, row = { tagName: 'DIV' }; // where the cursor is: a text box, or not
const press = (key, mods = {}, code = /^[a-z]$/i.test(key) ? 'Key' + key.toUpperCase() : /^\d$/.test(key) ? 'Digit' + key : key) =>
  ({ key, code, ctrlKey: false, metaKey: false, altKey: false, shiftKey: false, ...mods });

test('every shortcut has an id, keys and words, and no two shortcuts share a key', () => {
  const ids = new Set();
  for (const k of KEYMAP) {
    assert.ok(k.id && !ids.has(k.id), `id ${k.id} is set once`); ids.add(k.id);
    assert.ok(k.keys.length && k.label, `${k.id} has keys and a label`);
    assert.ok(k.fixed || [true, false, 'nav'].includes(k.typing), `${k.id} says whether it fires while typing`);
  }
  for (const mac of [false, true]) {
    const seen = new Map();
    for (const k of KEYMAP.filter((x) => !x.fixed)) for (const c of (mac && k.mac) || k.keys) {
      assert.ok(!seen.has(c), `${c} is both ${seen.get(c)} and ${k.id}`); seen.set(c, k.id);
    }
  }
});

test('the keys the browser keeps for itself are never used: Ctrl+N, T, W, Tab, PgUp, PgDn and Ctrl+1…9', () => {
  for (const k of KEYMAP) for (const c of [...k.keys, ...(k.mac || [])]) {
    assert.doesNotMatch(c, /^Mod\+(N|T|W|Tab|PageUp|PageDown|1-9|Shift\+(N|T|W|Tab))$/, `${k.id} uses ${c}`);
  }
});

test('keys read the Windows way and the Mac way', () => {
  assert.equal(keyText('Mod+Shift+P', false), 'Ctrl+Shift+P');
  assert.equal(keyText('Mod+Shift+P', true), '⇧⌘P');
  assert.equal(keyText('Mod+Alt+N', true), '⌥⌘N');
  assert.equal(keyText('Alt+ArrowUp', false), 'Alt+Up');
  assert.equal(keyText('Alt+ArrowUp', true), '⌥↑');
  assert.equal(keyText('Alt+1-9', false), 'Alt+1…9');
  assert.equal(keyText('Mod+Click', true), '⌘+click');
  assert.equal(keyText('Mod+Click', false), 'Ctrl+click');
  assert.equal(keyText('Alt+Click', true), '⌥+click');
  assert.equal(keyText('RightClick', false), 'Right-click');
  assert.equal(shortcutText('palette', false), 'Ctrl+Shift+P, F1');
  assert.equal(shortcutText('archive', false), 'Delete');
  assert.equal(shortcutText('archive', true), '⌘⌫');
  assert.equal(shortcutText('nothing', false), '');
});

test('Ctrl is the Windows key and ⌘ the Mac one, with modifiers matched exactly', () => {
  assert.equal(keyMatches(press('p', { ctrlKey: true, shiftKey: true }), 'Mod+Shift+P', false), true);
  assert.equal(keyMatches(press('P', { metaKey: true, shiftKey: true }), 'Mod+Shift+P', true), true);
  assert.equal(keyMatches(press('p', { ctrlKey: true, shiftKey: true }), 'Mod+Shift+P', true), false, 'Ctrl is not ⌘ on a Mac');
  assert.equal(keyMatches(press('p', { ctrlKey: true }), 'Mod+Shift+P', false), false, 'Shift missing');
  assert.equal(keyMatches(press('p', { ctrlKey: true, shiftKey: true }), 'Mod+P', false), false, 'Shift extra');
  assert.equal(keyMatches(press('F2', { ctrlKey: true }), 'F2', false), false, 'a bare key wants no Ctrl');
});

test('letters and digits are read from where the key sits, so Alt and Option still match', () => {
  assert.equal(keyMatches(press('ñ', { altKey: true, metaKey: true }, 'KeyN'), 'Mod+Alt+N', true), true); // ⌥ changes the letter typed
  assert.equal(keyMatches(press('¡', { altKey: true }, 'Digit1'), 'Alt+1-9', true), 1);
  assert.equal(keyMatches(press('3', { altKey: true }), 'Alt+1-9', false), 3);
  assert.equal(keyMatches(press('0', { altKey: true }), 'Alt+1-9', false), false, '0 is no desk');
  assert.equal(keyMatches(press('?', { shiftKey: true }, 'Slash'), '?', false), true, '? needs Shift on most keyboards');
});

test('while typing in a box only the shortcuts meant for it fire, and Option keys stay the text box\'s on a Mac', () => {
  const id = (e, mac, typing) => shortcutFor(e, mac, typing ? box : row)?.id || null;
  assert.equal(id(press('?', { shiftKey: true }, 'Slash'), false, true), null);
  assert.equal(id(press('?', { shiftKey: true }, 'Slash'), false, false), 'help');
  assert.equal(id(press('F2'), false, true), null);
  assert.equal(id(press('Delete'), false, true), null);
  assert.equal(id(press('Delete'), false, false), 'archive');
  assert.equal(id(press('Backspace', { metaKey: true }), true, false), 'archive');
  assert.equal(id(press('Backspace', { metaKey: true }), true, true), null, '⌘⌫ deletes a line in a text box');
  assert.equal(id(press('p', { ctrlKey: true }), false, true), 'quickOpen');
  assert.equal(id(press('l', { metaKey: true }), true, true), 'focusPrompt');
  assert.equal(id(press('ArrowUp', { altKey: true }), false, true), 'prevSession');
  assert.equal(id(press('ArrowUp', { altKey: true }), true, true), null);
  assert.equal(id(press('ArrowLeft', { altKey: true }), true, false), 'back');
  assert.deepEqual(shortcutFor(press('2', { altKey: true }), false, row), { id: 'desk', n: 2 });
  assert.equal(id(press('Escape'), false, false), null, 'Esc stays with what it closes');
  assert.equal(id(press('Enter', { ctrlKey: true }), false, false), null);
});

test('the palette finds by letters in order, whole words first', () => {
  assert.equal(fuzzyScore('', 'anything'), 0);
  assert.equal(fuzzyScore('xyz', 'New session'), null);
  assert.ok(fuzzyScore('new', 'New session') > fuzzyScore('new', 'Renew it'), 'start of the text beats the middle of a word');
  assert.ok(fuzzyScore('ses', 'New session') > fuzzyScore('ses', 'Assess'));
  assert.ok(fuzzyScore('ns', 'New session') !== null);
  assert.ok(fuzzyScore('nse', 'New session') > fuzzyScore('nse', 'Answer'), 'word starts count');
  assert.equal(fuzzyScore('SESSION', 'new session') > 0, true, 'case does not matter');
});
