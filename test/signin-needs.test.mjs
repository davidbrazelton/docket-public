// Tests for signin-needs.mjs: several sites per session (#1013), and Done clearing only what was signed in to (#1012).
// Run with: npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { needList, addNeed, dropNeed, needSite, clearedBy, siteNames } from '../signin-needs.mjs';

const sendgrid = { site: 'SendGrid', url: 'https://app.sendgrid.com/login' };
const aws = { site: 'AWS console (Route 53)', url: 'https://console.aws.amazon.com/route53' };
const google = { site: 'Google Admin', url: 'https://admin.google.com' };

test('a record saved with one { site, url } reads as a list of one', () => {
  assert.deepEqual(needList(sendgrid), [sendgrid]);
  assert.deepEqual(needList([sendgrid, aws]), [sendgrid, aws]);
  assert.deepEqual(needList(undefined), []);
  assert.deepEqual(needList({}), []);
});

test('a second site is added, not put in place of the first', () => {
  assert.deepEqual(addNeed(addNeed(null, sendgrid), aws), [sendgrid, aws]);
  assert.deepEqual(addNeed(sendgrid, aws), [sendgrid, aws], 'the old shape takes a second site too');
});

test('asking again for the same site updates it rather than adding it twice', () => {
  const list = addNeed([sendgrid, aws], { site: 'sendgrid ', url: 'https://app.sendgrid.com/' });
  assert.equal(list.length, 2);
  assert.equal(list[0].url, 'https://app.sendgrid.com/');
  assert.equal(addNeed([sendgrid], { site: 'SendGrid', url: '' })[0].url, sendgrid.url, 'no address keeps the one it had');
});

test('connected with a site clears that site; without one clears them all', () => {
  assert.deepEqual(dropNeed([sendgrid, aws], 'SendGrid'), [aws]);
  assert.equal(dropNeed([sendgrid], 'SendGrid'), null);
  assert.equal(dropNeed([sendgrid, aws], ''), null);
  assert.deepEqual(dropNeed(sendgrid, 'other.com'), [sendgrid], 'the old shape too');
});

test('a need belongs to the site of its address, or of its name when that is one', () => {
  assert.equal(needSite(aws), 'amazon.com');
  assert.equal(needSite({ site: 'www.github.com' }), 'github.com');
  assert.equal(needSite({ site: 'Salesforce' }), '');
});

test('Done from one session leaves another session waiting on a different site (#1012)', () => {
  const needs = { email: [google], sendgrid: [sendgrid] };
  const out = clearedBy(needs, { asked: new Set(['email']), visited: new Set(['google.com']) });
  assert.deepEqual(Object.keys(out), ['email']);
  assert.deepEqual(out.email, { cleared: [google], left: null });
});

test('a site the window went to clears it for any session waiting on it, and only that site', () => {
  const needs = { a: [sendgrid, aws], b: [google] };
  const out = clearedBy(needs, { visited: ['amazon.com'] });
  assert.deepEqual(out, { a: { cleared: [aws], left: [sendgrid] } });
});

test('signing in to one of a session\'s two sites from the 🌐 leaves the other', () => {
  const out = clearedBy({ a: [sendgrid, google] }, { visited: ['sendgrid.com'] });
  assert.deepEqual(out.a, { cleared: [sendgrid], left: [google] });
});

test('the session whose card opened the window loses all its sites; a site with no address needs that card', () => {
  const sf = { site: 'Salesforce' };
  assert.deepEqual(clearedBy({ a: [sendgrid, sf] }, { asked: ['a'] }).a, { cleared: [sendgrid, sf], left: null });
  assert.deepEqual(clearedBy({ a: [sf] }, { visited: ['salesforce.com'] }), {});
  assert.deepEqual(clearedBy({ a: sendgrid }, { asked: ['a'] }).a.cleared, [sendgrid], 'the old shape too');
});

test('closing a window nobody signed in to clears nothing', () => {
  assert.deepEqual(clearedBy({ a: [sendgrid], b: [google] }, {}), {});
});

test('sites read as a list', () => {
  assert.equal(siteNames([sendgrid]), 'SendGrid');
  assert.equal(siteNames([sendgrid, google]), 'SendGrid and Google Admin');
  assert.equal(siteNames([sendgrid, google, aws]), 'SendGrid, Google Admin and AWS console (Route 53)');
});
