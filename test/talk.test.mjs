// Tests for the comments waiting on the user: which threads and comments on linked pull requests and tickets
// put the speech bubble on a session's row. Run with: npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { prTalk, adoThreadLasts, ghPrTalkOf, ghIssueLast, adoItemLast, adoItemNewestComment, adoMe, ticketUnread } from '../links.mjs';

test('a pull request waits on the user for open threads and comments by someone else, newer than when last opened', () => {
  const tim = { by: 'Pat', byMe: false, at: 2000 }, mine = { by: 'Dana', byMe: true, at: 3000 }, unknown = { by: 'Pat', byMe: null, at: 4000 };
  assert.deepEqual(prTalk({ threads: [tim, mine, { ...tim, at: 2500 }], comment: null }), { threads: 2, comment: false, by: 'Pat', at: 2500 });
  assert.deepEqual(prTalk({ threads: [], comment: tim }), { threads: 0, comment: true, by: 'Pat', at: 2000 });
  assert.equal(prTalk({ threads: [mine], comment: mine }), null); // the user replied last
  assert.equal(prTalk({ threads: [unknown], comment: unknown }), null); // who "me" is is not known
  assert.equal(prTalk({ threads: [tim], comment: tim }, 2000), null); // opened from Details since
  assert.deepEqual(prTalk({ threads: [tim, { ...tim, at: 5000 }] }, 2000), { threads: 1, comment: false, by: 'Pat', at: 5000 });
  assert.equal(prTalk(undefined), null);
  assert.equal(prTalk(null), null);
});

test('Azure DevOps threads: active ones, by their newest comment from a person, never system or build-service ones', () => {
  const me = 'me-1', person = (id, name, at, more = {}) => ({ author: { id, displayName: name, uniqueName: `${name}@x.com` }, publishedDate: at, commentType: 'text', content: 'secret', ...more });
  const build = { author: { id: 'b', displayName: 'Project Collection Build Service (x)' } /* no uniqueName on threads */, publishedDate: '2026-10-30T14:07:12Z', commentType: 'text' };
  const threads = [
    { id: 1, status: 'active', comments: [person('me-1', 'Dana', '2026-10-30T10:00:00Z'), person('t', 'Pat', '2026-10-30T11:00:00Z')] },
    { id: 2, status: 'active', comments: [person('t', 'Pat', '2026-10-30T10:00:00Z'), person('me-1', 'Dana', '2026-10-30T12:00:00Z')] }, // replied
    { id: 3, status: 'fixed', comments: [person('t', 'Pat', '2026-10-30T13:00:00Z')] }, // resolved
    { id: 4, comments: [{ ...person('t', 'Pat', '2026-10-30T13:00:00Z'), commentType: 'system' }] }, // a vote or push, no status
    { id: 5, status: 'active', comments: [build] }, // the AI review's summary
    { id: 6, status: 'active', comments: [build, person('t', 'Pat', '2026-10-30T15:00:00Z')] }, // a person answered the bot
    { id: 7, status: 'active', isDeleted: true, comments: [person('t', 'Pat', '2026-10-30T13:00:00Z')] },
    { id: 8, status: 'active', comments: [person('t', 'Pat', '2026-10-30T13:00:00Z', { isDeleted: true })] },
  ];
  const lasts = adoThreadLasts(threads, me);
  assert.deepEqual(lasts, [{ by: 'Pat', byMe: false, at: Date.parse('2026-10-30T11:00:00Z') }, { by: 'Dana', byMe: true, at: Date.parse('2026-10-30T12:00:00Z') },
    { by: 'Pat', byMe: false, at: Date.parse('2026-10-30T15:00:00Z') }]);
  assert.equal(JSON.stringify(lasts).includes('secret'), false);
  assert.deepEqual(prTalk({ threads: lasts }), { threads: 2, comment: false, by: 'Pat', at: Date.parse('2026-10-30T15:00:00Z') });
  assert.equal(adoThreadLasts(threads, '')[0].byMe, null);
  assert.deepEqual(adoThreadLasts(null, me), []);
});

test('GitHub pull requests: unresolved review threads by their newest comment, and the newest conversation comment not by a bot', () => {
  const c = (login, at, type = 'User') => ({ author: { __typename: type, login }, createdAt: at });
  const d = {
    reviewThreads: { nodes: [
      { isResolved: false, comments: { nodes: [c('tim', '2026-10-30T11:00:00Z')] } },
      { isResolved: true, comments: { nodes: [c('tim', '2026-10-30T12:00:00Z')] } },
      { isResolved: false, comments: { nodes: [c('PatSmith', '2026-10-30T13:00:00Z')] } },
      { isResolved: false, comments: { nodes: [] } }] },
    comments: { nodes: [c('tim', '2026-10-30T09:00:00Z'), c('github-actions', '2026-10-30T14:00:00Z', 'Bot')] },
  };
  const t = ghPrTalkOf(d, 'patsmith'); // logins match whatever their case
  assert.deepEqual(t, { threads: [{ by: 'tim', byMe: false, at: Date.parse('2026-10-30T11:00:00Z') }, { by: 'PatSmith', byMe: true, at: Date.parse('2026-10-30T13:00:00Z') }],
    comment: { by: 'tim', byMe: false, at: Date.parse('2026-10-30T09:00:00Z') } });
  assert.deepEqual(prTalk(t), { threads: 1, comment: true, by: 'tim', at: Date.parse('2026-10-30T11:00:00Z') });
  assert.deepEqual(prTalk(t, Date.parse('2026-10-30T10:00:00Z')), { threads: 1, comment: false, by: 'tim', at: Date.parse('2026-10-30T11:00:00Z') });
  assert.equal(ghPrTalkOf({ comments: { nodes: [{ author: null, createdAt: '2026-10-30T09:00:00Z' }] } }, 'me').comment.by, 'ghost'); // a deleted account
  assert.deepEqual(ghPrTalkOf({}, 'me'), { threads: [], comment: null });
});

test('GitHub issues and Azure DevOps work items: the newest comment, unread as Jira tickets are', async () => {
  const issue = { comments: { nodes: [{ author: { __typename: 'User', login: 'tim' }, createdAt: '2026-10-30T09:00:00Z' }, { author: { __typename: 'Bot', login: 'dependabot' }, createdAt: '2026-10-30T10:00:00Z' }] } };
  const last = ghIssueLast(issue, 'me');
  assert.deepEqual(last, { by: 'tim', byMe: false, at: Date.parse('2026-10-30T09:00:00Z') });
  assert.equal(ticketUnread({ lastComment: last }, undefined), true);
  assert.equal(ticketUnread({ lastComment: last }, last.at), false);
  assert.equal(ticketUnread({ lastComment: ghIssueLast(issue, 'TIM') }), false); // mine
  assert.equal(ghIssueLast({ comments: { nodes: [] } }, 'me'), null);

  const asked = [];
  const fetchFn = async (url) => {
    asked.push(url);
    if (url.endsWith('/_apis/connectionData')) return { ok: true, json: async () => ({ authenticatedUser: { id: 'me-1' } }) };
    return { ok: true, json: async () => ({ comments: [{ createdBy: { id: 'b', displayName: 'Project Collection Build Service (x)', uniqueName: 'Build\\a6', descriptor: 'svc.Mj' }, createdDate: '2026-10-30T10:00:00Z' },
      { createdBy: { id: 't', displayName: 'Pat', uniqueName: 'tim@x.com', descriptor: 'aad.Mz' }, createdDate: '2026-10-30T09:00:00Z', text: 'secret' }] }) };
  };
  const base = 'https://dev.azure.com/example';
  assert.equal(await adoMe({ base, pat: 'p', fetchFn }), 'me-1');
  const c = await adoItemNewestComment({ base, project: 'P Q', id: 12, pat: 'p', me: 'me-1', fetchFn });
  assert.equal(asked[1], 'https://dev.azure.com/example/P%20Q/_apis/wit/workItems/12/comments?$top=10&order=desc&api-version=7.1-preview.4');
  assert.deepEqual(c, { by: 'Pat', byMe: false, at: Date.parse('2026-10-30T09:00:00Z') });
  assert.equal(adoItemLast({ createdBy: { id: 'me-1', displayName: 'Dana', uniqueName: 'd@x.com' }, createdDate: '2026-10-30T09:00:00Z' }, 'me-1').byMe, true);
  assert.equal(adoItemLast({ createdBy: { id: 't', uniqueName: 't@x.com' }, createdDate: '2026-10-30T09:00:00Z' }, '').byMe, null);
  assert.equal(adoItemLast({ createdBy: { id: 't' }, createdDate: '2026-10-30T09:00:00Z' }, 'me-1'), null); // no uniqueName: a service
  assert.equal(adoItemLast({ createdBy: { id: 'b', uniqueName: 'Build\\a6' }, createdDate: '2026-10-30T09:00:00Z' }, 'me-1'), null); // the build service
  assert.equal(adoItemLast(null, 'me-1'), null);
});
