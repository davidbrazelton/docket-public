// Tests for desk-browser.mjs, the private browser's tool server shared by a desk's sessions (#757). Run with: npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { deskServerArgs, mcpUrl, savedFiles, OUTPUT_MAX_BYTES } from '../desk-browser.mjs';

test('the server runs isolated and headless, with the desk sign-ins, one output folder and absolute file paths', () => {
  assert.deepEqual(deskServerArgs({ cli: 'cli.js', storage: 'S.json', outDir: 'OUT' }), ['cli.js', '--isolated', '--headless',
    '--storage-state', 'S.json', '--output-dir', 'OUT', '--file-paths', 'absolute', '--output-max-size', String(OUTPUT_MAX_BYTES)]);
});

test('the address is localhost, which Playwright allows by default', () => {
  assert.equal(mcpUrl(4321), 'http://localhost:4321/mcp');
});

test('finds Windows files in the output folder, whatever their letter case, ending at the link', () => {
  const out = 'C:\\Docket\\data\\browser-output\\acme';
  const text = '### Result\n- [Screenshot of viewport](c:\\docket\\DATA\\browser-output\\acme\\page-1.png)\n'
    + '- [Snapshot](C:\\Docket\\data\\browser-output\\acme\\snap shot.yml)\n'
    + 'again: C:\\Docket\\data\\browser-output\\acme\\page-1.png\n';
  assert.deepEqual(savedFiles(text, out, 'win32'), [out + '\\page-1.png', out + '\\snap shot.yml']);
});

test('finds posix files, keeps letter case, and skips paths that leave the folder', () => {
  const out = '/home/d/out';
  const text = '[a](/home/d/out/a.png) [b](/home/d/OUT/b.png) [c](/home/d/out/../secret.txt) "/home/d/out/sub/c.yml"';
  assert.deepEqual(savedFiles(text, out, 'linux'), ['/home/d/out/a.png', '/home/d/out/sub/c.yml']);
});

test('names nothing when the result has no file in the folder', () => {
  assert.deepEqual(savedFiles('Navigated to https://example.com', '/out', 'linux'), []);
  assert.deepEqual(savedFiles(undefined, '/out', 'linux'), []);
});
