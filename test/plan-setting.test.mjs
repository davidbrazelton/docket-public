// The per-desk choice of plan system (#180 step 2): the Inspector's choice, the setup wizard's Plans step, Copy as new
// desk, and the entry in What's new and suggestions for each desk with none chosen. The server side is in wizard-brands.test.mjs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildProfile } from '../profile.mjs';
import { DOCKET_KEYS, copyEntry } from '../copy-company.mjs';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const page = fs.readFileSync(path.join(root, 'index.html'), 'utf8');

test('the Inspector shows the plan system as a choice, with what the desk has now', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'docket-plans-'));
  const choice = (planSystem) => buildProfile({ id: 't', name: 'T', home, folder: home, ...(planSystem ? { planSystem } : {}) }, { isDefaultHome: false })
    .sections.find((s) => s.id === 'switches').groups.find((g) => g.title === 'Plans').items[0].toggle;
  const unset = choice();
  assert.equal(unset.kind, 'plans');
  assert.deepEqual(unset.options.map(([v]) => v), ['docket', 'folder', 'none'], 'the plan folder is a real third choice (#180 step 3)');
  assert.equal(unset.value, 'docket', 'on by default (#605)');
  assert.equal(unset.note, 'on by default');
  assert.equal(choice('docket').value, 'docket');
  assert.equal(choice('none').note, '');
  assert.equal(choice('folder').value, 'folder');
});

test('a copied desk keeps its plan system', () => {
  assert.ok(DOCKET_KEYS.includes('planSystem'));
  const c = copyEntry({ name: 'A', home: 'C:/a', folder: 'C:/a', planSystem: 'docket' }, { name: 'B', home: 'C:/b' });
  assert.equal(c.planSystem, 'docket');
});

test('the setup wizard has a Plans step, Docket\'s plans unless another is picked, and sends the choice', () => {
  assert.match(page, /const WIZ_STEPS = \['Name', 'AI brand', 'Sessions', 'Plans', 'Folders', 'Sign in', 'Talk & voice', 'Display', 'Done'\];/);
  assert.match(page, /split: true, plans: 'docket',/);
  assert.match(page, /On by default: it costs nothing until a session uses a plan\./);
  assert.match(page, /planSystem: w\.planAnswer === 'convert' \? 'none' : w\.plans,/);
  assert.match(page, /if \(w\.step === SPLIT\) \{ w\.step = PLANS;/);
  assert.match(page, /w\.error = ''; w\.step = FOLDERS; return render\(\);/);
});

// The plans entry of What's new and suggestions (#1168), from the page, run on a fake desk list.
function entry() {
  const at = page.indexOf('\n  plans: { sec: '), body = page.slice(at + 1, page.indexOf('\n  // The 1-hour prompt cache', at));
  assert.ok(at > 0 && body.includes('switchPlans'), 'the plans entry has moved');
  return body;
}
function plans(clients, current) {
  const onRemoteTab = () => !!clients.find((c) => c.id === current)?.remote;
  const S = { clients, client: current };
  const k = new Function('S', 'esc', 'tip', 'sgHere', 'sgDesk', 'sgBack', 'switchPlans', `return { ${entry().replace(/,\s*$/, '')} }.plans;`)(
    S, String, () => '', () => !onRemoteTab(), (id) => clients.find((c) => c.id === id)?.name, () => '', async (id, to) => to);
  return k;
}

test('the plans entry: once per desk with no plan system, never a remote desk, and a plan switch card only while one waits', () => {
  const k = plans([{ id: 'a', name: 'Acme', planSystem: '' }, { id: 'b', name: 'Beta', planSystem: '' }], 'b');
  assert.equal(k.sec, 'new');
  const items = k.items();
  assert.deepEqual(items.map((i) => i.client), ['a', 'b']);
  assert.match(items[1].title, /Plans are on for Beta/);
  const html = k.draw(items[1]);
  assert.match(html, /data-plan="docket"/);
  assert.match(html, /data-plan="none"/);
  assert.match(html, /They cost nothing until a session uses a plan/);
  assert.deepEqual(plans([{ id: 'a', name: 'Acme', planSystem: '' }, { id: 'b', name: 'Beta', planSystem: 'none' }], 'b').items().map((i) => i.client), ['a']);
  assert.equal(plans([{ id: 'a', planSystem: 'docket' }, { id: 'b', planSystem: 'none' }], 'a').items().length, 0, 'every desk chose');
  assert.equal(plans([{ id: 'a', name: 'Acme', planSystem: '' }, { id: 'r', name: 'Far', remote: { connected: true } }], 'r').items().length, 0, 'nor a desk here while a remote tab is open (#1108)');
  // the corner card is only for a switch waiting to finish
  const fn = page.slice(page.indexOf('function showPlanOffer'), page.indexOf("$('planOffer').onclick"));
  const el = { hidden: false, dataset: {}, innerHTML: '' };
  new Function('$', 'S', 'esc', 'tip', 'onRemoteTab', fn + '\nshowPlanOffer();')(() => el, { clients: [{ id: 'a', name: 'Acme', planSystem: '' }], client: 'a' }, String, () => '', () => false);
  assert.equal(el.hidden, true);
});

test('both of the entry\'s buttons save a choice on the desk', async () => {
  const k = plans([{ id: 'a', name: 'Acme', planSystem: '' }], 'a'), it = k.items()[0];
  const press = (plan) => k.click({ target: { closest: () => ({ dataset: { plan } }) } }, it);
  assert.deepEqual(await press('docket'), { note: 'Kept on', ok: true });
  assert.deepEqual(await press('none'), { note: 'Turned off', ok: false });
  // through the plan switch (#700): a warning first when the choice leaves plans behind, else saved at once
  assert.match(page, /api\(`\/api\/clients\/\$\{id\}\/plan-switch`, \{ to, action[ ,]/);
});
