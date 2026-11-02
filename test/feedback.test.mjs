// The 🔨 feedback button (#552): what a report carries, that nothing private gets into it, and that a send that did
// not go never says it did. Run with: npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { reduceText, cleanPageFacts, docketFacts, buildReport, cleanDestination, destinationInfo, sendReport, VIEWS } from '../feedback.mjs';

// A computer full of things that must never leave it: desk and client names, folders, sign-ins, session words.
const SECRETS = ['Acme Roofing', 'Initech', 'C:\\Users\\bob', '/Users/bob', 'acme-secret', 'bob@acme.com', 'sk-ant-api03-SECRETSECRET', 'Fix the payroll export',
  'arn:aws:iam', 'remote-secret-123', 'gw.acme.internal', 'payroll.xlsx', 'Bob Smith desk'];
const clients = [
  { id: 'acme', name: 'Acme Roofing', home: 'C:\\Users\\bob\\acme-secret\\claude', folder: 'C:\\Users\\bob\\Projects', awsProfile: 'arn:aws:iam', gateway: { url: 'https://gw.acme.internal' }, email: 'bob@acme.com' },
  { id: 'init', name: 'Initech', home: '/Users/bob/initech', codexHome: '/Users/bob/codex', remote: { address: '10.0.0.4:4402', secret: 'remote-secret-123' } },
  { id: 'b', name: 'Bob Smith desk' },
];
const live = [
  { id: 's1', client: 'acme', title: 'Fix the payroll export', cwd: 'C:\\Users\\bob\\Projects\\payroll', status: 'running', lastText: 'opened payroll.xlsx', email: 'bob@acme.com' },
  { id: 's2', client: 'init', title: 'Initech notes', cwd: '/Users/bob/initech', status: 'idle' },
  { id: 's3', client: 'init', title: 'old', status: 'ended' },
];
const state = { stallStop: false, autoPause: true, updates: { mode: 'auto' }, remoteControl: { on: true, secret: 'remote-secret-123', desk: 'acme' }, sessions: { s1: { title: 'Fix the payroll export' } }, feedback: { url: 'https://relay.example/x', key: 'acme-secret' } };
const page = {
  view: 'session', inGroup: true, viewport: { w: 1280, h: 800 }, screen: { w: 1920, h: 1080 }, dpr: 1.5, platform: 'Windows',
  browser: { name: 'Microsoft Edge', version: '131' }, device: 'desktop', ua: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/131.0 Edg/131.0', tz: 'America/Chicago', lang: 'en-US',
  online: true, theme: 'dark', at: '2026-11-02T15:00:00.000Z',
  // things a changed or broken page might add, which must be dropped
  title: 'Fix the payroll export', cwd: 'C:\\Users\\bob\\Projects', desk: 'Acme Roofing', email: 'bob@acme.com',
};

test('a report carries every field the issue lists', () => {
  const r = buildReport({ description: 'Let me pin a session', name: 'Dana', page, docket: docketFacts({ version: '1.111.0', commit: 'abc1234', clients, live, state, os: 'win32' }) });
  const f = r.fields;
  for (const k of ['description', 'name', 'view', 'version', 'commit', 'viewport', 'screen', 'dpr', 'platform', 'browser', 'device', 'ua', 'tz', 'lang', 'online', 'at', 'features', 'brands', 'sessionsOpen', 'sessionsWorking'])
    assert.ok(k in f, `no ${k}`);
  assert.equal(f.description, 'Let me pin a session');
  assert.equal(f.name, 'Dana');
  assert.equal(f.view, 'session');
  assert.equal(f.version, '1.111.0'); assert.equal(f.commit, 'abc1234');
  assert.deepEqual(f.viewport, { w: 1280, h: 800 }); assert.equal(f.dpr, 1.5);
  assert.equal(f.ua, page.ua, 'the raw user agent goes as it is');
  assert.deepEqual(f.brands, ['claude', 'codex']);
  assert.deepEqual(f.features, { stopStuckSteps: false, continueAfterCrash: true, pauseOnSleep: true, updates: 'automatic', remoteConnection: true, paused: false });
  assert.equal(f.sessionsOpen, 2); assert.equal(f.sessionsWorking, 1);
  assert.equal(f.desks, 3); assert.equal(f.remoteDesks, 1);
  assert.match(r.title, /^Feedback: Let me pin a session$/);
  assert.match(r.body, /Let me pin a session\n\n— Dana/);
  assert.match(r.body, /\| view \| session \|/);
});

test('no session words, paths, sign-ins, desk or client names get into a report', () => {
  const r = buildReport({ description: 'Pinning please', name: '', page, docket: docketFacts({ version: '1.111.0', commit: 'abc1234', clients, live, state, os: 'win32' }) });
  const out = JSON.stringify(r);
  for (const x of SECRETS) assert.ok(!out.includes(x) && !out.includes(JSON.stringify(x).slice(1, -1)), `"${x}" got into the report`);
  assert.ok(!/[A-Z]:\\\\|\/Users\/|\/home\//.test(out), 'a path got into the report');
  assert.equal(r.fields.name, '');
  assert.match(r.body, /— anonymous/);
});

test('page fields that are not on the list, or not what they should be, are dropped', () => {
  const f = cleanPageFacts({ ...page, view: 'C:\\Users\\bob', platform: 'C:\\Windows', browser: { name: '/Users/bob/app', version: '1/2' }, tz: '../../etc', lang: 'en-US; path=C:\\x', at: 'C:\\x', dpr: 'lots', viewport: { w: 'x', h: 1 }, device: 'toaster', theme: 'C:' });
  assert.deepEqual(Object.keys(f).sort(), ['at', 'browser', 'device', 'dpr', 'inGroup', 'lang', 'online', 'platform', 'screen', 'theme', 'tz', 'ua', 'view', 'viewport'].sort());
  assert.equal(f.view, 'other'); assert.equal(f.platform, ''); assert.deepEqual(f.browser, { name: '', version: '' });
  assert.equal(f.tz, ''); assert.equal(f.lang, ''); assert.equal(f.at, ''); assert.equal(f.dpr, null); assert.equal(f.viewport, null); assert.equal(f.device, ''); assert.equal(f.theme, '');
  assert.deepEqual(cleanPageFacts(undefined).view, 'other');
  assert.ok(VIEWS.includes('desk-inspector') && VIEWS.includes('session-list'));
});

test('keys and phone numbers in the message are reduced before it goes', () => {
  assert.equal(reduceText('my key is sk-ant-api03-abcdefghijklmnop ok'), 'my key is [key removed] ok');
  assert.equal(reduceText('token ghp_abcdefghijklmnopqrstuvwxyz0123'), 'token [key removed]');
  assert.equal(reduceText('call 214-555-0187 please'), 'call [phone ending 0187] please');
  assert.equal(reduceText('call (214) 555-0187'), 'call [phone ending 0187]');
  assert.equal(reduceText('version 1.110.0 on port 4401'), 'version 1.110.0 on port 4401', 'ordinary numbers stay');
  const r = buildReport({ description: 'text me at 214 555 0187', name: 'Dana 2145550187', page: {}, docket: {} });
  assert.ok(!JSON.stringify(r).includes('555'), JSON.stringify(r));
});

test('the destination is set per computer, with no default, and its key never goes back to the page', () => {
  assert.equal(cleanDestination(undefined), null);
  assert.equal(cleanDestination({}), null);
  assert.equal(cleanDestination({ url: 'not a url' }), null);
  assert.equal(cleanDestination({ url: 'http://relay.example/x' }), null, 'plain http only to this computer');
  assert.equal(cleanDestination({ url: 'https://user:pw@relay.example/x' }), null);
  assert.equal(cleanDestination({ url: 'file:///C:/x' }), null);
  assert.deepEqual(cleanDestination({ url: 'http://localhost:4499/fb' }), { url: 'http://localhost:4499/fb' });
  assert.deepEqual(cleanDestination({ url: ' https://relay.example/x ', key: ' k1 ' }), { url: 'https://relay.example/x', key: 'k1' });
  assert.deepEqual(destinationInfo(cleanDestination({ url: 'https://relay.example/x', key: 'k1' })), { url: 'https://relay.example/x', hasKey: true });
  assert.deepEqual(destinationInfo(null), { url: '', hasKey: false });
  // nothing in the code names a destination of its own
  const src = fs.readFileSync(new URL('../feedback.mjs', import.meta.url), 'utf8') + fs.readFileSync(new URL('../server.mjs', import.meta.url), 'utf8');
  assert.ok(!/feedback[^\n]*https:\/\/(?!\/)[a-z]/i.test(src.split('\n').filter((l) => /feedback/i.test(l) && !/^\s*\/\//.test(l)).join('\n')), 'a feedback address is written into the code');
});

const report = buildReport({ description: 'hi', name: '', page: {}, docket: {} });
const dest = { url: 'https://relay.example/fb', key: 'k1' };
const netErr = (code) => () => { const e = new TypeError('fetch failed'); e.cause = Object.assign(new Error(code), { code }); throw e; };

test('with no destination set, nothing is sent and it says so', async () => {
  let called = false;
  const r = await sendReport(null, report, { fetch: () => { called = true; } });
  assert.equal(called, false);
  assert.equal(r.ok, false); assert.equal(r.kind, 'unset');
  assert.match(r.message, /not set up/);
});

test('a send with no network says so and keeps the message, never claiming it went', async () => {
  const r = await sendReport(dest, report, { fetch: netErr('ENOTFOUND') });
  assert.equal(r.ok, false); assert.equal(r.kind, 'offline'); assert.equal(r.code, 'ENOTFOUND');
  assert.match(r.message, /^Not sent/); assert.match(r.message, /kept/);
  const down = await sendReport(dest, report, { fetch: netErr('ECONNREFUSED') });
  assert.equal(down.ok, false); assert.equal(down.kind, 'unreachable'); assert.match(down.message, /^Not sent: relay\.example is not answering \(ECONNREFUSED\)/);
  const slow = await sendReport(dest, report, { fetch: () => { throw Object.assign(new Error('t'), { name: 'TimeoutError' }); } });
  assert.equal(slow.ok, false); assert.match(slow.message, /took too long/);
});

test('a send the destination refuses shows its error code and never claims it went', async () => {
  const answer = (status, body, statusText = '') => async () => ({ ok: status >= 200 && status < 300, status, statusText, json: async () => body });
  const r = await sendReport(dest, report, { fetch: answer(403, { error: 'bad key' }, 'Forbidden') });
  assert.equal(r.ok, false); assert.equal(r.kind, 'refused'); assert.equal(r.code, 403);
  assert.match(r.message, /^Not sent: relay\.example refused it with error 403 Forbidden: bad key/);
  const busy = await sendReport(dest, report, { fetch: answer(429, null, 'Too Many Requests') });
  assert.equal(busy.ok, false); assert.equal(busy.code, 429); assert.match(busy.message, /429/);
});

test('a send the destination takes says where it went, and sends the report with the key', async () => {
  let got;
  const r = await sendReport(dest, report, { fetch: async (url, opt) => { got = { url, opt }; return { ok: true, status: 201, json: async () => ({ html_url: 'https://github.com/o/r/issues/9' }) }; } });
  assert.deepEqual(r, { ok: true, where: 'relay.example', link: 'https://github.com/o/r/issues/9' });
  assert.equal(got.url, dest.url); assert.equal(got.opt.method, 'POST'); assert.equal(got.opt.headers.authorization, 'Bearer k1');
  assert.deepEqual(JSON.parse(got.opt.body), report);
  const plain = await sendReport({ url: 'https://relay.example/fb' }, report, { fetch: async (u, opt) => { got = opt; return { ok: true, status: 204, json: async () => { throw new Error('empty'); } }; } });
  assert.deepEqual(plain, { ok: true, where: 'relay.example' });
  assert.ok(!('authorization' in got.headers), 'no key, no header');
});

// The page's own half: run feedbackFacts from index.html with a pretend browser.
const pageText = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const a = pageText.indexOf('// ---------- feedback'), b = pageText.indexOf('// end of feedback');
assert.ok(a > 0 && b > a, 'the feedback part of index.html has moved or lost its markers');
const feedbackFacts = new Function(pageText.slice(a, b) + '\nreturn feedbackFacts;')();
const win = { innerWidth: 1200, innerHeight: 700, screen: { width: 1920, height: 1080 }, devicePixelRatio: 1.25, location: { href: 'http://localhost:4400/#acme/s1' }, document: { title: 'Fix the payroll export' } };

test('the page sends only the listed fields, and they survive the app cleaning them', () => {
  const edge = { userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131.0.0.0 Safari/537.36 Edg/131.0.0.0', platform: 'Win32', language: 'en-US', onLine: true,
    userAgentData: { platform: 'Windows', mobile: false, brands: [{ brand: 'Not A Brand', version: '24' }, { brand: 'Chromium', version: '131' }, { brand: 'Microsoft Edge', version: '131' }] } };
  const f = feedbackFacts(edge, win, { view: 'session', inGroup: true, theme: 'light' });
  assert.deepEqual(Object.keys(f).sort(), ['at', 'browser', 'device', 'dpr', 'inGroup', 'lang', 'online', 'platform', 'screen', 'theme', 'tz', 'ua', 'view', 'viewport'].sort());
  assert.deepEqual(f.browser, { name: 'Microsoft Edge', version: '131' });
  assert.equal(f.device, 'desktop'); assert.equal(f.platform, 'Windows');
  assert.ok(!JSON.stringify(f).includes('payroll') && !JSON.stringify(f).includes('acme'), 'the address or title of the page got in');
  const c = cleanPageFacts(f);
  for (const k of ['view', 'viewport', 'screen', 'dpr', 'platform', 'browser', 'device', 'ua', 'lang', 'online', 'theme', 'inGroup']) assert.deepEqual(c[k], f[k], k);
  assert.ok(c.at && c.tz !== undefined);
});

test('the page tells Safari, Firefox and phones apart from the raw user agent', () => {
  const safari = feedbackFacts({ userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Safari/605.1.15', platform: 'MacIntel', maxTouchPoints: 0, language: 'en-US' }, win);
  assert.deepEqual(safari.browser, { name: 'Safari', version: '18.1' }); assert.equal(safari.device, 'desktop'); assert.equal(safari.platform, 'MacIntel');
  const ipad = feedbackFacts({ userAgent: safari.ua, platform: 'MacIntel', maxTouchPoints: 5 }, win);
  assert.equal(ipad.device, 'tablet');
  const ff = feedbackFacts({ userAgent: 'Mozilla/5.0 (X11; Linux x86_64; rv:132.0) Gecko/20100101 Firefox/132.0', platform: 'Linux x86_64' }, win);
  assert.deepEqual(ff.browser, { name: 'Firefox', version: '132.0' });
  const phone = feedbackFacts({ userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 Version/18.1 Mobile/15E148 Safari/604.1', platform: 'iPhone' }, win);
  assert.equal(phone.device, 'phone');
});
