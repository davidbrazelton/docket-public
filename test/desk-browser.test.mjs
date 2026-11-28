// Tests for desk-browser.mjs, the private browser's tool server shared by a desk's sessions (#757). Run with: npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { deskServerArgs, mcpUrl, savedFiles, deskOutputDir, OUTPUT_MAX_BYTES } from '../desk-browser.mjs';
import { userCacheFolder } from '../platform.mjs';

test('the output folder is in the per-user cache folder, not in Docket\'s data, and the test copy has its own (#1284)', () => {
  const cache = userCacheFolder({ platform: 'win32', home: 'C:\\Users\\pat', env: { LOCALAPPDATA: 'C:\\Users\\pat\\AppData\\Local' } });
  const real = deskOutputDir({ cache, dataDir: 'V:\\Repos\\docket\\data', defaultDataDir: 'V:\\Repos\\docket\\data\\', desk: 'acme', platform: 'win32' });
  assert.equal(real, 'C:\\Users\\pat\\AppData\\Local\\Docket\\browser-output\\acme');
  assert.ok(!real.toLowerCase().startsWith('v:\\repos\\docket'));
  assert.equal(deskOutputDir({ cache, dataDir: 'V:\\Repos\\work\\data-dev', defaultDataDir: 'V:\\Repos\\work\\data', desk: 'acme', platform: 'win32' }),
    'C:\\Users\\pat\\AppData\\Local\\Docket\\browser-output-data-dev\\acme');
  assert.equal(deskOutputDir({ cache: userCacheFolder({ platform: 'darwin', home: '/Users/pat', env: {} }), dataDir: '/d/data', defaultDataDir: '/d/data', desk: 'acme', platform: 'darwin' }),
    '/Users/pat/Library/Caches/Docket/browser-output/acme');
});

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
