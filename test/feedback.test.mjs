// The Suggest a feature button (#552, #563): what a report carries, that nothing private gets into it, that it is
// filed as a GitHub Issue only with a repo and token set on this computer, the daily limit, and that a send that did
// not go never says it did. Run with: npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { reduceText, cleanPageFacts, docketFacts, buildReport, cleanDestination, destinationInfo, sendReport, VIEWS,
  installId, isInstallId, today, sentToday, limitReached, countSend, limitMessage, DAILY_LIMIT } from '../feedback.mjs';

// A computer full of things that must never leave it: desk and client names, folders, sign-ins, session words.
const SECRETS = ['Acme Roofing', 'Initech', 'C:\\Users\\bob', '/Users/bob', 'acme-secret', 'bob@acme.com', 'sk-ant-api03-SECRETSECRET', 'Fix the payroll export',
  'arn:aws:iam', 'remote-secret-123', 'gw.acme.internal', 'payroll.xlsx', 'Bob Smith desk', 'github_pat_SECRETTOKEN0123456789'];
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
const state = { stallStop: false, autoPause: true, updates: { mode: 'auto' }, remoteControl: { on: true, secret: 'remote-secret-123', desk: 'acme' }, sessions: { s1: { title: 'Fix the payroll export' } },
  feedback: { repo: 'acme/secret-repo', token: 'github_pat_SECRETTOKEN0123456789' }, installId: '0a1b2c3d' };
const page = {
  view: 'session', inGroup: true, viewport: { w: 1280, h: 800 }, screen: { w: 1920, h: 1080 }, dpr: 1.5, platform: 'Windows',
  browser: { name: 'Microsoft Edge', version: '131' }, device: 'desktop', ua: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/131.0 Edg/131.0', tz: 'America/Chicago', lang: 'en-US',
  online: true, theme: 'dark', at: '2026-11-02T15:00:00.000Z',
  // things a changed or broken page might add, which must be dropped
  title: 'Fix the payroll export', cwd: 'C:\\Users\\bob\\Projects', desk: 'Acme Roofing', email: 'bob@acme.com',
};
const facts = () => docketFacts({ version: '1.112.0', commit: 'abc1234', clients, live, state, os: 'win32', install: state.installId });

test('a report carries every field the issue lists', () => {
  const r = buildReport({ description: 'Let me pin a session', name: 'Dana', page, docket: facts() });
  const f = r.fields;
  for (const k of ['description', 'name', 'view', 'version', 'commit', 'install', 'viewport', 'screen', 'dpr', 'platform', 'browser', 'device', 'ua', 'tz', 'lang', 'online', 'at', 'features', 'brands', 'sessionsOpen', 'sessionsWorking'])
    assert.ok(k in f, `no ${k}`);
  assert.equal(f.description, 'Let me pin a session');
  assert.equal(f.name, 'Dana');
  assert.equal(f.view, 'session');
  assert.equal(f.version, '1.112.0'); assert.equal(f.commit, 'abc1234'); assert.equal(f.install, '0a1b2c3d');
  assert.deepEqual(f.viewport, { w: 1280, h: 800 }); assert.equal(f.dpr, 1.5);
  assert.equal(f.ua, page.ua, 'the raw user agent goes as it is');
  assert.deepEqual(f.brands, ['claude', 'codex']);
  assert.deepEqual(f.features, { stopStuckSteps: false, continueAfterCrash: true, pauseOnSleep: true, updates: 'automatic', remoteConnection: true, paused: false });
  assert.equal(f.sessionsOpen, 2); assert.equal(f.sessionsWorking, 1);
  assert.equal(f.desks, 3); assert.equal(f.remoteDesks, 1);
  assert.match(r.title, /^Feedback: Let me pin a session$/);
  assert.match(r.body, /Let me pin a session\n\n— Dana/);
  assert.match(r.body, /\| view \| session \|/);
  assert.match(r.body, /\| install \| 0a1b2c3d \|/);
});

test('no session words, paths, sign-ins, tokens, desk or client names get into a report', () => {
  const r = buildReport({ description: 'Pinning please', name: '', page, docket: facts() });
  const out = JSON.stringify(r);
  for (const x of SECRETS) assert.ok(!out.includes(x) && !out.includes(JSON.stringify(x).slice(1, -1)), `"${x}" got into the report`);
  assert.ok(!out.includes('secret-repo'), 'the repo name got into the report');
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

test('the install ID is random, made once, and says nothing about the computer', () => {
  const s = {};
  const id = installId(s);
  assert.ok(isInstallId(id), id); assert.equal(s.installId, id);
  assert.equal(installId(s), id, 'made once');
  assert.notEqual(installId({}), id, 'another install gets another');
  assert.equal(installId({ installId: 'C:\\Users\\bob' }).length, 8, 'a bad saved one is replaced');
  assert.equal(docketFacts({ install: 'C:\\Users\\bob' }).install, '');
});

test('each install sends at most the daily limit, counted by this computer\'s date', () => {
  const day = today(new Date(2026, 10, 2, 23, 59));
  assert.equal(day, '2026-11-02');
  assert.equal(sentToday(undefined, day), 0);
  let sent;
  for (let i = 0; i < DAILY_LIMIT; i++) { assert.equal(limitReached(sent, day), false, `send ${i + 1}`); sent = countSend(sent, day); }
  assert.deepEqual(sent, { day, count: DAILY_LIMIT });
  assert.equal(limitReached(sent, day), true);
  assert.equal(limitReached(sent, '2026-11-03'), false, 'a new day starts again');
  assert.deepEqual(countSend(sent, '2026-11-03'), { day: '2026-11-03', count: 1 });
  assert.match(limitMessage(), /^Not sent: .*10 reports today.*kept/);
});

test('the destination is a repo and token set per computer, with no default, and the token never goes back to the page', () => {
  const tok = 'github_pat_11AAAA0123456789abcdef';
  assert.equal(cleanDestination(undefined), null);
  assert.equal(cleanDestination({}), null);
  assert.equal(cleanDestination({ repo: 'someone/docket' }), null, 'no token, nothing set');
  assert.equal(cleanDestination({ token: tok }), null, 'no repo, nothing set');
  assert.equal(cleanDestination({ repo: 'docket', token: tok }), null);
  assert.equal(cleanDestination({ repo: '../../etc/passwd', token: tok }), null);
  assert.equal(cleanDestination({ repo: 'a/b', token: 'short' }), null);
  assert.equal(cleanDestination({ repo: 'a/b', token: 'has spaces in it 0123456789' }), null);
  assert.equal(cleanDestination({ url: 'https://relay.example/x', key: 'k' }), null, 'a relay saved by 1.111.0 reads as not set');
  assert.deepEqual(cleanDestination({ repo: ' https://github.com/someone/docket.git ', token: ` ${tok} ` }), { repo: 'someone/docket', token: tok });
  assert.deepEqual(destinationInfo(cleanDestination({ repo: 'o/r', token: tok })), { repo: 'o/r', hasToken: true });
  assert.deepEqual(destinationInfo(null), { repo: '', hasToken: false });
  // no token and no repo of its own is written into the code
  for (const f of ['../feedback.mjs', '../server.mjs', '../index.html']) {
    const src = fs.readFileSync(new URL(f, import.meta.url), 'utf8');
    assert.ok(!/\b(gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,})/.test(src), `a GitHub token is in ${f}`);
    assert.ok(!/repo:\s*['"](?!owner\/name['"])[\w-]+\/[\w.-]+['"]/.test(src), `a feedback repo is written into ${f}`);
  }
});

const report = buildReport({ description: 'hi', name: '', page: {}, docket: {} });
const dest = { repo: 'o/r', token: 'github_pat_11AAAA0123456789abcdef' };
const netErr = (code) => () => { const e = new TypeError('fetch failed'); e.cause = Object.assign(new Error(code), { code }); throw e; };
const answer = (status, body) => async () => ({ ok: status >= 200 && status < 300, status, json: async () => body });

test('with no repo and token set, nothing is sent and it says so', async () => {
  let called = false;
  const r = await sendReport(null, report, { fetch: () => { called = true; } });
  assert.equal(called, false);
  assert.equal(r.ok, false); assert.equal(r.kind, 'unset');
  assert.match(r.message, /not set up/);
});

test('a send with no network says so and keeps the message, never claiming it went', async () => {
  const r = await sendReport(dest, report, { fetch: netErr('ENOTFOUND') });
  assert.equal(r.ok, false); assert.equal(r.kind, 'offline'); assert.equal(r.code, 'ENOTFOUND');
  assert.match(r.message, /^Not sent: this computer could not reach GitHub \(ENOTFOUND: no network\)/); assert.match(r.message, /kept/);
  const slow = await sendReport(dest, report, { fetch: () => { throw Object.assign(new Error('t'), { name: 'TimeoutError' }); } });
  assert.equal(slow.ok, false); assert.match(slow.message, /^Not sent: GitHub took too long/);
});

test('a send GitHub refuses shows its error code and what it said, and never claims it went', async () => {
  const cases = { 401: /token is not accepted/, 403: /may not create issues/, 404: /repo was not found/, 410: /Issues are turned off/, 422: /would not take/, 500: /did not create/ };
  for (const [code, why] of Object.entries(cases)) {
    const r = await sendReport(dest, report, { fetch: answer(+code, { message: 'Bad credentials' }) });
    assert.equal(r.ok, false, code); assert.equal(r.kind, 'refused'); assert.equal(r.code, +code);
    assert.match(r.message, new RegExp(`^Not sent: error ${code}, `)); assert.match(r.message, why); assert.match(r.message, /GitHub said: "Bad credentials"/); assert.match(r.message, /kept/);
  }
  const ok200 = await sendReport(dest, report, { fetch: answer(200, {}) });
  assert.equal(ok200.ok, false, 'only 201 Created counts as filed');
});

test('a report GitHub files says where it went, and goes to the repo\'s Issues with the token', async () => {
  let got;
  const r = await sendReport(dest, report, { fetch: async (url, opt) => { got = { url, opt }; return { ok: true, status: 201, json: async () => ({ number: 9, html_url: 'https://github.com/o/r/issues/9' }) }; } });
  assert.deepEqual(r, { ok: true, where: 'o/r as Issue #9', link: 'https://github.com/o/r/issues/9', number: 9 });
  assert.equal(got.url, 'https://api.github.com/repos/o/r/issues'); assert.equal(got.opt.method, 'POST');
  assert.equal(got.opt.headers.authorization, `Bearer ${dest.token}`);
  assert.deepEqual(JSON.parse(got.opt.body), { title: report.title, body: report.body });
  const odd = await sendReport(dest, report, { fetch: answer(201, { number: 3, html_url: 'https://evil.example/x' }) });
  assert.equal(odd.link, undefined, 'a link not on github.com is not shown');
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

test('the button is a speech bubble, not the Hammer', () => {
  const btn = pageText.match(/<button[^>]*id="feedbackBtn"[^>]*>([\s\S]*?)<\/button>/);
  assert.ok(btn, 'no feedbackBtn');
  assert.match(btn[1], /^<svg[^>]*aria-hidden="true"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5/);
  assert.ok(!pageText.includes('🔨'), 'a 🔨 is still on the page');
});
