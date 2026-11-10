// How often a desk's sessions ask with a form (#850): Never / Default / Often. Never and Often add a prompts/optional
// file (session-rules.mjs), Never also turns a form down in askPermission, and a one-time card asks a while after the
// update (forms-offer.mjs).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ruleFiles, ruleText, FORMS } from '../session-rules.mjs';
import { formsOfferDue, FORMS_OFFER, FORMS_CHOICES } from '../forms-offer.mjs';
import { DOCKET_KEYS } from '../copy-company.mjs';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const dir = path.join(root, 'prompts');
const names = fs.readdirSync(dir);
const read = (f) => fs.readFileSync(path.join(root, f), 'utf8');

test('Default adds nothing; Never and Often add their own file, for top-level and child sessions alike', () => {
  for (const child of [false, true]) {
    const plain = ruleFiles(names, { child });
    assert.deepEqual(ruleFiles(names, { child, forms: 'default' }), plain);
    assert.deepEqual(ruleFiles(names, { child, forms: 'never' }), [...plain, 'optional/forms-never.md']);
    assert.deepEqual(ruleFiles(names, { child, forms: 'often' }), [...plain, 'optional/forms-often.md']);
    assert.deepEqual(ruleFiles(names, { child, forms: 'sometimes' }), plain, 'an unknown level adds nothing');
  }
});

test('the instructions say what each level means', () => {
  const never = ruleText(dir, { forms: 'never' }), often = ruleText(dir, { forms: 'often' }), def = ruleText(dir, {});
  assert.ok(never.includes('Do not use AskUserQuestion') && never.includes('plain text'));
  assert.ok(never.includes('even where other instructions say to end with AskUserQuestion'), 'Never covers the forms Docket asks for');
  assert.ok(often.includes('two or more real options') && often.includes('(Recommended)'));
  for (const t of ['This desk asks questions in plain text', 'This desk prefers questions as a form']) assert.ok(!def.includes(t), `default leaves out: ${t}`);
});

test('the card is due a day after the update, after a few new sessions, and never once answered', () => {
  const from = Date.parse('2026-11-09T12:00:00Z'), day = FORMS_OFFER.days * 864e5, n = FORMS_OFFER.sessions;
  assert.equal(formsOfferDue({ from, now: from + day - 1, sessions: n }), false, 'not before a day');
  assert.equal(formsOfferDue({ from, now: from + day, sessions: n - 1 }), false, 'not before a few sessions');
  assert.equal(formsOfferDue({ from, now: from + day, sessions: n }), true);
  for (const answer of ['never', 'default', 'often', 'dismiss', 'inspector'].map((a) => ({ answer: a, at: from })))
    assert.equal(formsOfferDue({ from, now: from + 30 * day, sessions: 50, answer }), false, answer.answer);
  assert.equal(formsOfferDue({ from, now: from + day, sessions: n, chosen: true }), false, 'a level chosen on the Inspector');
  assert.equal(formsOfferDue({ from: 0, now: from, sessions: n }), false);
});

test('the choices are the three levels, Default in the middle', () => {
  assert.deepEqual(FORMS, ['never', 'default', 'often']);
  assert.deepEqual(FORMS_CHOICES.map(([v]) => v), FORMS);
});

test('the server wires it up: rules, the deny, the switch, the card, and a copied desk keeps it', () => {
  const server = read('server.mjs'), profile = read('profile.mjs'), page = read('index.html');
  assert.ok(server.includes('forms: formsOf(clientById(s.client))'), 'sessionRules passes the level');
  const ask = server.slice(server.indexOf('function askPermission('), server.indexOf('return new Promise', server.indexOf('function askPermission(')));
  assert.ok(ask.includes("toolName === 'AskUserQuestion'") && ask.includes("=== 'never'") && ask.includes("behavior: 'deny'"), 'Never turns a form down');
  assert.ok(server.includes("kind === 'forms'") && profile.includes("kind: 'forms'"), 'the Inspector switch');
  assert.ok(server.includes("p === '/api/forms-offers/answer'") && page.includes("api('/api/forms-offers/answer'"), 'the card');
  assert.ok(page.includes('id="formsOffer"') && page.includes("m.t === 'forms-offers'"));
  assert.ok(DOCKET_KEYS.includes('questionForms'));
});
