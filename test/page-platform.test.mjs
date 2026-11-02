// The page's Windows and Mac choices: which words, keys and install commands it picks, and how a click
// or a key is read. Runs the platform and tips parts of index.html with a pretend browser of each kind.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { presentFileText } from '../platform.mjs';

const page = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const part = (from, to) => {
  const a = page.indexOf(from), b = page.indexOf(to);
  assert.ok(a > 0 && b > a, `the part of index.html from "${from}" has moved or lost its markers`);
  return page.slice(a, b);
};
const platform = part('// ---------- platform', '// end of platform');
const tips = part('// ---------- tips', '// end of tips');
const escLine = page.split('\n').find((l) => l.startsWith('const esc = '));
// The page as a browser with this navigator would run it.
const load = (navigator) => new Function('globalThis', 'soundTip', escLine + '\n' + platform + '\n' + tips
  + '\nreturn { isMac, osWords, picksKey, isTextField, navKeysOn, OS, tipText };')({ navigator }, () => 'sound');
const WIN = { platform: 'Win32', userAgentData: { platform: 'Windows' } };
const MAC = { platform: 'MacIntel', userAgentData: { platform: 'macOS' } };

test('the page knows a Mac from either way the browser says so, and anything else is Windows', () => {
  const { isMac } = load(WIN);
  assert.equal(isMac(MAC), true);
  assert.equal(isMac({ platform: 'MacIntel' }), true); // Safari has no userAgentData
  assert.equal(isMac({ userAgentData: { platform: 'macOS' }, platform: '' }), true);
  assert.equal(isMac(WIN), false);
  assert.equal(isMac({ platform: 'Win32' }), false);
  assert.equal(isMac(undefined), false);
});

test('Windows keeps its words, keys and install commands exactly as before', () => {
  const { OS, tipText } = load(WIN);
  assert.equal(OS.mac, false);
  assert.equal(tipText('back'), 'Back to the session you viewed before (Alt+Left). Right-click for the steps behind, to jump several at once');
  assert.equal(tipText('fwd'), 'Forward again to the session you went back from (Alt+Right). Right-click for the steps ahead');
  assert.equal(tipText('terminal'), "Open a terminal in this desk's folder, signed in as this desk");
  assert.equal(tipText('ctx-terminal'), "Open a terminal in this session's folder, signed in as this desk");
  assert.equal(tipText('row'), 'Click to open it. Right-click for archive, group, rename and more. Ctrl+click or Shift+click picks several at once.');
  assert.equal(tipText('pv-open'), 'Open the file in the program Windows uses for it, like Excel or Word');
  assert.equal(tipText('pv-folder'), 'Show in File Explorer');
  assert.equal(tipText('pf-show'), 'Show this file in File Explorer');
  assert.equal(tipText('term-folder'), 'The folder the terminal opens in');
  assert.equal(tipText('term-open'), 'Open the terminal');
  assert.equal(OS.caps, 'Windows ignores capital letters');
  assert.deepEqual(OS.install, {
    claude: 'irm https://claude.ai/install.ps1 | iex',
    aws: 'winget install -e --id Amazon.AWSCLI',
    grok: 'irm https://x.ai/cli/install.ps1 | iex',
    codex: 'winget install -e --id OpenAI.Codex',
  });
  const help = new Function('globalThis', 'soundTip', escLine + '\n' + platform + '\n' + tips + '\nreturn TIP_ROWS;')({ navigator: WIN }, () => '');
  assert.equal(help['kbd-nav'][1], 'Alt+← and Alt+→');
  assert.equal(help['term-folder'][1], 'Open in');
});

test('a Mac gets Terminal, Finder, ⌘ and ⌥ Option, and Mac install commands', () => {
  const { OS, tipText } = load(MAC);
  assert.equal(OS.mac, true);
  assert.equal(tipText('back'), 'Back to the session you viewed before (⌥ Option+←). Right-click for the steps behind, to jump several at once');
  assert.equal(tipText('terminal'), "Open a terminal in this desk's folder, signed in as this desk");
  assert.match(tipText('row'), /⌘\+click or Shift\+click picks several/);
  assert.equal(tipText('pv-folder'), 'Show in Finder');
  assert.equal(tipText('pf-show'), 'Show this file in Finder');
  assert.equal(tipText('term-open'), 'Open the terminal');
  assert.match(OS.caps, /Mac/);
  const help = new Function('globalThis', 'soundTip', escLine + '\n' + platform + '\n' + tips + '\nreturn TIP_ROWS;')({ navigator: MAC }, () => '');
  assert.equal(help['kbd-nav'][1], '⌥ Option+← and ⌥ Option+→');
  assert.equal(help['term-folder'][1], 'Open in');
  // No Windows words or commands are left anywhere in the Mac tips or install commands.
  const all = Object.values(help).flat().filter((x) => typeof x === 'string').join('\n') + '\n' + Object.values(OS.install).join('\n');
  assert.doesNotMatch(all, /PowerShell|File Explorer|Windows|Ctrl\+|\bAlt\+|winget|irm |\.ps1/);
  assert.equal(OS.install.claude, 'curl -fsSL https://claude.ai/install.sh | bash');
  assert.equal(OS.install.grok, 'curl -fsSL https://x.ai/cli/install.sh | bash');
  assert.equal(OS.install.codex, 'npm install -g @openai/codex');
  assert.match(OS.install.aws, /AWSCLIV2\.pkg/);
});

test('Ctrl+click picks on Windows; on a Mac it is a right-click, so only ⌘+click picks', () => {
  const { picksKey } = load(WIN);
  const click = (k) => ({ ctrlKey: false, metaKey: false, ...k });
  assert.equal(picksKey(click({ ctrlKey: true }), false), true);
  assert.equal(picksKey(click({ metaKey: true }), false), true);
  assert.equal(picksKey(click({}), false), false);
  assert.equal(picksKey(click({ ctrlKey: true }), true), false);
  assert.equal(picksKey(click({ metaKey: true }), true), true);
  assert.match(page, /if \(OS\.mac && e\.ctrlKey && !e\.metaKey\) return;/, 'the list no longer skips a Mac Ctrl+click');
});

test('Back and Forward keys: always on Windows; on a Mac not while typing, where ⌥ Option+arrows move by word', () => {
  const { navKeysOn, isTextField } = load(WIN);
  const box = { tagName: 'TEXTAREA' }, field = { tagName: 'INPUT' }, editable = { tagName: 'DIV', isContentEditable: true }, row = { tagName: 'DIV' };
  for (const el of [box, field, editable]) {
    assert.equal(isTextField(el), true);
    assert.equal(navKeysOn(false, el), true);
    assert.equal(navKeysOn(true, el), false);
  }
  assert.equal(isTextField(row), false);
  assert.equal(navKeysOn(true, row), true);
  assert.equal(navKeysOn(true, null), true);
  assert.match(page, /!navKeysOn\(OS\.mac, document\.activeElement\)\) return;/, 'the Back/Forward keys no longer check where the cursor is');
});

test('the page never bounces or swipes Back a page', () => {
  assert.match(page, /html, body \{ overscroll-behavior: none; overscroll-behavior-x: none; \}/);
});

test('the present_file tool names File Explorer on Windows and Finder on a Mac', () => {
  assert.equal(presentFileText('win32'), "Show the user files you produced. They appear in the portal's Files list for this session and as a card in the chat, where the user can open each one or show it in File Explorer. Use full Windows paths.");
  assert.match(presentFileText('darwin'), /show it in Finder\. Use full paths, starting with \/\.$/);
  assert.doesNotMatch(presentFileText('darwin'), /Windows|Explorer/);
});

test('install-mac.sh passes the Azure DevOps token on to Docket when it is set', () => {
  const sh = fs.readFileSync(new URL('../install-mac.sh', import.meta.url), 'utf8');
  assert.match(sh, /\$\{AZURE_DEVOPS_EXT_PAT:\+<key>AZURE_DEVOPS_EXT_PAT<\/key><string>\$\(esc "\$AZURE_DEVOPS_EXT_PAT"\)<\/string>\}/);
  assert.match(sh, /chmod 600 "\$plist"/);
});
