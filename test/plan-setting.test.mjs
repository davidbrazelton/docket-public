// The per-desk choice of plan system (#180 step 2): the Inspector's choice, the setup wizard's Plans step, Copy as new
// desk, and the card shown once to each desk with none chosen. The server side is in wizard-brands.test.mjs.
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
  assert.equal(unset.value, 'none');
  assert.equal(unset.note, 'not chosen yet');
  assert.equal(choice('docket').value, 'docket');
  assert.equal(choice('none').note, '');
  assert.equal(choice('folder').value, 'folder');
});

test('a copied desk keeps its plan system', () => {
  assert.ok(DOCKET_KEYS.includes('planSystem'));
  const c = copyEntry({ name: 'A', home: 'C:/a', folder: 'C:/a', planSystem: 'docket' }, { name: 'B', home: 'C:/b' });
  assert.equal(c.planSystem, 'docket');
});

test('the setup wizard has a Plans step, none unless picked, and sends the choice', () => {
  assert.match(page, /const WIZ_STEPS = \['Name', 'AI brand', 'Sessions', 'Plans', 'Folders', 'Sign in', 'Done'\];/);
  assert.match(page, /split: true, plans: 'none',/);
  assert.match(page, /planSystem: w\.plans,/);
  assert.match(page, /if \(w\.step === SPLIT\) \{ w\.step = PLANS;/);
  assert.match(page, /w\.error = ''; w\.step = FOLDERS; return render\(\);/);
});

// showPlanOffer from the page, run on a fake card and desk list.
function offer(clients, current) {
  const fn = page.slice(page.indexOf('let planOfferDone'), page.indexOf("$('planOffer').onclick"));
  assert.ok(fn.includes('function showPlanOffer'), 'showPlanOffer has moved');
  const el = { hidden: true, dataset: {}, innerHTML: '' };
  const esc = (s) => String(s);
  new Function('$', 'S', 'esc', 'tip', fn + '\nshowPlanOffer();')(() => el, { clients, client: current }, esc, () => '');
  return el;
}

test('the card after the update: once per desk with no plan system, the desk on view first, never a remote desk', () => {
  const el = offer([{ id: 'a', name: 'Acme', planSystem: '' }, { id: 'b', name: 'Beta', planSystem: '' }], 'b');
  assert.equal(el.hidden, false);
  assert.equal(el.dataset.client, 'b');
  assert.match(el.innerHTML, /data-plan="docket"/);
  assert.match(el.innerHTML, /data-plan="none"/);
  assert.equal(offer([{ id: 'a', name: 'Acme', planSystem: '' }, { id: 'b', name: 'Beta', planSystem: 'none' }], 'b').dataset.client, 'a');
  assert.equal(offer([{ id: 'a', planSystem: 'docket' }, { id: 'b', planSystem: 'none' }], 'a').hidden, true, 'every desk chose');
  assert.equal(offer([{ id: 'r', name: 'Far', remote: { connected: true } }], 'r').hidden, true, 'a remote desk is asked on its own computer');
});

test('both of the card\'s buttons save a choice on the desk', () => {
  const click = page.slice(page.indexOf("$('planOffer').onclick"), page.indexOf('</script>', page.indexOf("$('planOffer').onclick")));
  assert.match(click, /profile\/switch`, \{ kind: 'plans', key: 'plans', value \}/);
});
