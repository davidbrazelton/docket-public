// Tests for setup-size.mjs: what a desk's sessions load at start, what went unused, and when to offer. Run with: npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  SETUP_OFFER, frontmatter, measureFiles, scanFile, measureUse, assess, quickStart, costPerToken,
  checkDue, setupOfferKind, headlines, setupBrief, projectName,
} from '../setup-size.mjs';

const DAY = 864e5, NOW = Date.now();
const iso = (ms) => new Date(ms).toISOString();

// A fake desk: a Claude home, its account file, a project folder with a big CLAUDE.md, and two transcripts.
function fakeDesk() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'setup-size-'));
  const home = path.join(root, 'home'), proj = path.join(root, 'proj'), config = path.join(root, 'claude.json');
  const put = (f, text, ageDays) => {
    fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, text);
    if (ageDays) { const t = (NOW - ageDays * DAY) / 1000; fs.utimesSync(f, t, t); }
  };
  put(path.join(home, 'CLAUDE.md'), '# Rules\nBe brief.\n');
  put(path.join(proj, 'CLAUDE.md'), `# Project\n${'A rule that goes on and on. '.repeat(400)}\n`);
  put(path.join(home, 'projects', projectName(proj), 'memory', 'MEMORY.md'), '- [One](one.md) — a memory\n');
  put(path.join(home, 'skills', 'used-skill', 'SKILL.md'), `---\nname: used-skill\ndescription: >\n  ${'Use when the user asks for the used thing. '.repeat(8)}\n---\nBody\n`, 100);
  put(path.join(home, 'skills', 'idle-skill', 'SKILL.md'), '---\nname: idle-skill\ndescription: "Never asked for"\n---\nBody\n', 100);
  put(path.join(home, 'skills', 'fresh-skill', 'SKILL.md'), '---\nname: fresh-skill\ndescription: Added yesterday\n---\nBody\n', 1);
  put(path.join(home, 'skills', 'manual-skill', 'SKILL.md'), '---\nname: manual-skill\ndescription: Only by hand\ndisable-model-invocation: true\n---\n', 100);
  put(path.join(home, 'commands', 'deploy.md'), '---\ndescription: Ship it\n---\n', 100);
  put(config, JSON.stringify({ mcpServers: { db: {}, idle: {}, broken: {}, portal: {} } }));

  const t = iso(NOW - DAY);
  const lines = (...xs) => xs.map((x) => JSON.stringify({ timestamp: t, ...x })).join('\n') + '\n';
  const delta = { type: 'attachment', attachment: { type: 'deferred_tools_delta', addedNames: ['mcp__db__query', 'mcp__db__drop', 'mcp__idle__ping', 'mcp__portal__recycle'], failedMcpServers: [{ name: 'broken', error: 'timed out' }] } };
  const dir = path.join(home, 'projects', projectName(proj));
  put(path.join(dir, 'a.jsonl'), lines(
    { type: 'user', cwd: proj, message: { content: '<command-name>/deploy</command-name>' } },
    delta,
    { type: 'assistant', message: { content: [{ type: 'tool_use', id: 't1', name: 'Skill', input: { skill: 'used-skill' } }] } },
    { type: 'assistant', message: { content: [{ type: 'tool_use', id: 't2', name: 'mcp__db__query', input: {} }] } },
  ));
  put(path.join(dir, 'b.jsonl'), lines({ type: 'user', cwd: proj, message: { content: 'hello' } }, delta));
  return { root, home, proj, config, files: [path.join(dir, 'a.jsonl'), path.join(dir, 'b.jsonl')], project: projectName(proj) };
}

async function measure(d, perToken = 0) {
  const sessions = [];
  for (const f of d.files) sessions.push({ project: d.project, scan: await scanFile(f) });
  const use = measureUse(sessions, NOW - SETUP_OFFER.usedDays * DAY, NOW);
  const files = measureFiles({ home: d.home, config: d.config, folders: use.folders });
  return { use, files, report: assess(files, use, { perToken, own: ['portal', 'playwright'], now: NOW }) };
}
const item = (report, name) => report.items.find((x) => x.name === name);

test('frontmatter reads folded descriptions, quotes and the manual-only flag', () => {
  assert.equal(frontmatter('---\nname: a\ndescription: >\n  one\n  two\n---\n').description, 'one two');
  assert.equal(frontmatter('---\ndescription: "quoted"\n---\n').description, 'quoted');
  assert.equal(frontmatter('---\ndisable-model-invocation: true\n---\n').modelOff, true);
  assert.equal(frontmatter('no frontmatter').name, '');
});

test('the transcripts give the folder, the skills, commands and MCP tools used, and failing servers', async () => {
  const d = fakeDesk();
  const { use } = await measure(d);
  assert.equal(use.sessions, 2);
  assert.equal(use.folders.length, 1);
  assert.equal(path.resolve(use.folders[0].dir), path.resolve(d.proj));
  assert.equal(use.skills.get('used-skill'), 1);
  assert.equal(use.commands.get('deploy'), 1);
  assert.equal(use.mcp.get('mcp__db__query'), 1);
  assert.equal(use.failed.get('broken').sessions, 2);
  assert.deepEqual(use.tools.get('db'), ['mcp__db__query', 'mcp__db__drop']);
  fs.rmSync(d.root, { recursive: true }); // a temporary test folder
});

test('each item gets the right status, and Docket\'s own MCP servers are left out', async () => {
  const d = fakeDesk();
  const { report, files } = await measure(d, 0.001);
  assert.equal(item(report, 'idle-skill').status, 'unused');
  assert.equal(item(report, 'used-skill').status, 'long');
  assert.equal(item(report, 'fresh-skill').status, 'new');
  assert.equal(item(report, 'manual-skill'), undefined);
  // The test folder is under the user's own home: ~/.claude's skills are not this desk's project skills.
  assert.deepEqual(report.items.filter((x) => x.kind === 'skill').map((x) => x.name).sort(), ['fresh-skill', 'idle-skill', 'used-skill']);
  assert.equal(item(report, 'deploy').status, 'used');
  const big = report.items.find((x) => x.kind === 'claude-md' && x.path === path.join(d.proj, 'CLAUDE.md'));
  assert.equal(big.status, 'big');
  assert.equal(big.slim, big.tokens - SETUP_OFFER.bigFileTokens);
  assert.equal(item(report, 'MEMORY.md').status, 'ok');
  assert.equal(item(report, 'db').status, 'part');
  assert.equal(item(report, 'db').unused, 1);
  assert.equal(item(report, 'idle').status, 'unused');
  assert.equal(item(report, 'broken').status, 'failing');
  assert.equal(item(report, 'portal'), undefined);
  assert.ok(report.slim >= big.slim);
  assert.ok(report.slimMonthly > 0);
  assert.ok(quickStart(files) > SETUP_OFFER.bigFileTokens);
  const lines = headlines(report).map((l) => l.text);
  assert.match(lines[0], /CLAUDE\.md is/);
  fs.rmSync(d.root, { recursive: true });
});

test('the session brief fills every placeholder of the shipped prompt', async () => {
  const d = fakeDesk();
  const { report } = await measure(d, 0.001);
  const template = fs.readFileSync(new URL('../prompts/optional/setup-slim.md', import.meta.url), 'utf8');
  const brief = setupBrief(template, { desk: 'Test', home: d.home, config: d.config, folder: d.proj, backup: path.join(d.home, 'setup-backup', '2026-11-06'), report, perToken: 0.001 });
  assert.doesNotMatch(brief, /\{[a-zA-Z]+\}/);
  assert.match(brief, /idle-skill/);
  assert.match(brief, /fails to connect: timed out/);
  assert.match(brief, /\$1\.00 a month/);
  fs.rmSync(d.root, { recursive: true });
});

test('cost per token counts a cache read per main call and a cache write per session', () => {
  const rates = (m) => (m === 'x' ? { cacheRead: 1, cacheWrite5m: 10, cacheWrite1h: 20 } : null);
  const rows = [
    { Source: 'main', Model: 'x', Turns: 10, SessionId: 'a', CacheCreate: 0 },
    { Source: 'main', Model: 'x', Turns: 10, SessionId: 'b', CacheCreate: 10, CacheCreate1h: 10 },
    { Source: 'subagent', Model: 'x', Turns: 99, SessionId: 'c' },
    { Source: 'main', Model: 'other', Turns: 99, SessionId: 'd' },
  ];
  const c = costPerToken(rows, rates, 30);
  // reads 20 × 1, writes (10×10 + 10×20) / 20 calls × 2 sessions = 30; per million tokens
  assert.equal(c.perToken, 50 / 1e6);
  assert.equal(c.calls, 20);
  assert.equal(c.sessions, 2);
  assert.equal(costPerToken([], rates).perToken, 0);
});

test('a full check runs weekly, or early after a jump in start size', () => {
  assert.equal(checkDue({ last: null, quick: 0, now: NOW }), true);
  assert.equal(checkDue({ last: { at: NOW - 8 * DAY, quick: 5000 }, quick: 5000, now: NOW }), true);
  assert.equal(checkDue({ last: { at: NOW - DAY, quick: 5000 }, quick: 5500, now: NOW }), false);
  assert.equal(checkDue({ last: { at: NOW - DAY, quick: 5000 }, quick: 8000, now: NOW }), true);
  assert.equal(checkDue({ last: { at: NOW - DAY, quick: 20000 }, quick: 22500, now: NOW }), false); // under 20%
});

test('the card shows first, waits 30 days after Not now, and returns early on a noticeable change', () => {
  const report = { slim: 4000, slimMonthly: 2, start: 9000 };
  assert.equal(setupOfferKind({ report: { slim: 500, slimMonthly: 1, start: 5000 }, now: NOW }), null);
  assert.equal(setupOfferKind({ report: { slim: 500, slimMonthly: 12, start: 5000 }, now: NOW }), 'first');
  assert.equal(setupOfferKind({ report, now: NOW }), 'first');
  const later = { answer: 'later', at: NOW - 5 * DAY, slim: 4000, start: 9000 };
  assert.equal(setupOfferKind({ report, answer: later, now: NOW }), null);
  assert.equal(setupOfferKind({ report: { ...report, slim: 4500 }, answer: later, now: NOW }), null);
  assert.equal(setupOfferKind({ report: { ...report, slim: 5200 }, answer: later, now: NOW }), 'changed');
  assert.equal(setupOfferKind({ report: { ...report, start: 12000 }, answer: later, now: NOW }), 'changed');
  assert.equal(setupOfferKind({ report, answer: { ...later, at: NOW - 31 * DAY }, now: NOW }), 'again');
});
