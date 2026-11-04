// Plans on by default, carried only by sessions that use one (#605): who gets the full plan rules and tools, the two
// lines everyone else gets, the card that offers a plan, and the session menu item.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { plansOnFor, planUse, PLAN_HINT, planOfferDue, USE_PLAN_TEXT } from '../plan-use.mjs';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const server = fs.readFileSync(path.join(root, 'server.mjs'), 'utf8');
const page = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const plansMd = fs.readFileSync(path.join(root, 'prompts', 'optional', 'plans.md'), 'utf8');

test('plans are on for a desk that never chose, and off for one that chose none or a plan folder', () => {
  assert.equal(plansOnFor(undefined), true);
  assert.equal(plansOnFor(''), true);
  assert.equal(plansOnFor('docket'), true);
  assert.equal(plansOnFor('none'), false);
  assert.equal(plansOnFor('folder'), false);
});

test('a coordinator, a task holder and a child of a coordinator get the full rules and tools; others the short ones', () => {
  assert.equal(planUse({ on: true, own: true }), 'full', 'coordinates a plan');
  assert.equal(planUse({ on: true, holds: true }), 'full', 'holds a task');
  assert.equal(planUse({ on: true, parentOwns: true }), 'full', 'started by a coordinator, so it can claim its task');
  assert.equal(planUse({ on: true }), 'short', 'a plain session on a plans-on desk');
  assert.equal(planUse({ on: false, own: true }), 'none', 'plans off: nothing at all');
});

test('the short rules are two lines, far smaller than plans.md, and say how to start a plan', () => {
  const body = PLAN_HINT.split('\n').filter((l) => l.trim() && !l.startsWith('#'));
  assert.equal(body.length, 1, 'one paragraph under the heading');
  assert.ok(PLAN_HINT.length < plansMd.length / 4, `${PLAN_HINT.length} bytes against plans.md's ${plansMd.length}`);
  assert.match(PLAN_HINT, /mcp__portal__plan_create/);
  assert.match(PLAN_HINT, /mcp__portal__plan_claim_task/);
});

test('the server gives plans.md only to sessions that use a plan, and the short rules to the rest', () => {
  assert.match(server, /return use === 'full' \? optionalPrompt\('plans\.md'\) : use === 'short' \? PLAN_HINT : '';/);
  assert.match(server, /parentOwns: !!pid && all\.some\(\(p\) => p\.coordinator === pid\)/);
});

test('a session without a plan gets one-line plan tool descriptions and no argument notes', () => {
  const defs = server.slice(server.indexOf('function planToolDefs'), server.indexOf('function portalToolDefs'));
  assert.match(defs, /const full = planUseOf\(parent\) === 'full';/);
  assert.match(defs, /const d = \(t, text\) => full \? t\.describe\(text\) : t;/);
  // Every tool's description goes through say(long, short), and every short one is one short line.
  const tools = defs.match(/tool\('plan_\w+',/g);
  assert.equal(tools.length, 11);
  const shorts = [...defs.matchAll(/say\("(?:[^"\\]|\\.)*",\s*(['"])((?:(?!\1)[^\\]|\\.)*)\1\)/g)].map((m) => m[2]);
  assert.equal(shorts.length, 11, 'each plan tool has a short description');
  for (const s of shorts) assert.ok(s.length <= 110 && !s.includes('\n'), s);
  assert.equal(defs.match(/\.describe\(/g).length, 1, 'argument notes only through d(), so a plain session gets none');
});

test('the first plan tool a session without the rules calls hands it plans.md, once', () => {
  const fn = server.slice(server.indexOf('function withPlanRules'), server.indexOf('// The card that offers a plan'));
  assert.match(fn, /ls\.planRules !== 'short'/);
  assert.match(fn, /ls\.planRules = 'given';/);
  assert.match(fn, /optionalPrompt\('plans\.md'\)/);
  assert.match(server, /const reply = \(text, isError = false\) => withPlanRules\(parent,/);
});

test('the card that offers a plan shows once, after the second child session, and never with a plan', () => {
  assert.equal(planOfferDue({ on: true, childStarts: 1 }), false, 'one child is not enough');
  assert.equal(planOfferDue({ on: true, childStarts: 2 }), true, 'the second child');
  assert.equal(planOfferDue({ on: true, childStarts: 3, offered: true }), false, 'shown once: Not now is remembered');
  assert.equal(planOfferDue({ on: true, own: true, childStarts: 2 }), false, 'it already has a plan');
  assert.equal(planOfferDue({ on: false, childStarts: 2 }), false, 'plans off');
  // The app counts the children a session started (not the ones the user started under it) and checks after each.
  const start = server.slice(server.indexOf('function startChild'), server.indexOf('function updateCard'));
  assert.match(start, /rec\.childStarts = \(rec\.childStarts \|\| 0\) \+ 1;/);
  assert.match(start, /if \(ps\) offerPlan\(ps\);/);
  assert.match(server, /rec\.planOffered = true;/);
});

test('the page draws the card, and Use a plan and the session menu item both ask the session for a plan', () => {
  assert.match(page, /case 'plan-offer': \{/);
  assert.match(page, /Keep these sessions in a plan\?/);
  assert.match(page, /data-act="use"\$\{tip\('poffer-use'\)\}>Use a plan</);
  assert.match(page, /data-act="no"\$\{tip\('poffer-no'\)\}>Not now</);
  assert.match(page, /if \(t\.dataset\.act === 'use'\) return usePlan\(id, t\.dataset\.poffer\);/);
  assert.match(page, /if \(act === 'use-plan'\) await usePlan\(id\);/);
  assert.match(page, /\/api\/sessions\/\$\{id\}\/use-plan\?client=/);
  assert.match(server, /if \(action === 'use-plan' && req\.method === 'POST'\)/);
  assert.match(server, /await noticeToSession\(client\.id, id, USE_PLAN_TEXT, \{ byPerson: true \}\);/); // the person pressed it: counts as them acting (#637)
  assert.match(USE_PLAN_TEXT, /mcp__portal__plan_create/);
});

// sessionMenuItems from the page, on made-up facts.
function menu(f) {
  const fn = page.slice(page.indexOf('function sessionMenuItems'), page.indexOf('// A toggle shows ✓ while on'));
  return new Function(fn + '\nreturn sessionMenuItems;')()(f).map((i) => i[0]);
}
test('the session menu has Use a plan for this work only on a plans-on desk, for a session with no plan', () => {
  const base = { archived: false, live: true, cwd: 'C:/x', editors: [], soundOn: true };
  assert.ok(menu({ ...base, plansOn: true, hasPlan: false }).includes('use-plan'));
  assert.ok(!menu({ ...base, plansOn: true, hasPlan: true }).includes('use-plan'), 'it already coordinates one');
  assert.ok(!menu({ ...base, plansOn: false }).includes('use-plan'), 'plans off or a plan folder');
  assert.ok(!menu({ ...base, archived: true, plansOn: true }).includes('use-plan'), 'archived');
  const facts = page.slice(page.indexOf('function sessionMenuFacts'), page.indexOf('function openSessionMenu'));
  assert.match(facts, /plansOn: plansOnDesk\(S\.client\)/);
  assert.match(page, /const plansOnDesk = \(id\) => \{ const c = S\.clients\.find\(\(x\) => x\.id === id\); return !!c && !c\.remote && !\['none', 'folder'\]\.includes\(c\.planSystem\); \};/);
});
