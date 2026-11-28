// Docket's pages never show the browser's own alert, confirm or prompt boxes, nor a "Leave site?" box:
// messages go in tell() and questions in ask() or dialog() (index.html), which fit the page.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const dir = new URL('../', import.meta.url);
const pages = fs.readdirSync(dir).filter((f) => /\.(html|js)$/.test(f));
const NATIVE = /(?<![\w$.])(?:window\.|self\.|globalThis\.)?(alert|confirm|prompt)\(|window\.(alert|confirm|prompt)\b|onbeforeunload|['"]beforeunload['"]|showModalDialog/;

test('no page uses a native browser dialog', () => {
  assert.ok(pages.includes('index.html'));
  const hits = [];
  for (const f of pages) fs.readFileSync(new URL(f, dir), 'utf8').split('\n').forEach((line, i) => {
    if (NATIVE.test(line)) hits.push(`${f}:${i + 1}: ${line.trim().slice(0, 120)}`);
  });
  assert.deepEqual(hits, [], 'use tell() for a message and ask() for a question instead');
});

test('the guard sees the usual ways of calling one', () => {
  for (const bad of ['alert(err.message);', 'if (!confirm("Sure?")) return;', 'const n = prompt("Name");', 'window.confirm(x)',
    "window.addEventListener('beforeunload', f)", 'window.onbeforeunload = f;', 'x => alert(1)'])
    assert.ok(NATIVE.test(bad), bad);
  for (const ok of ['tell(err.message);', 'await ask("Sure?")', 'if (a.confirm) go();', "role='alert'", 'needsPrompt(x)', 'confirmed(x)', 'a permission prompt (the dot)'])
    assert.ok(!NATIVE.test(ok), ok);
});
