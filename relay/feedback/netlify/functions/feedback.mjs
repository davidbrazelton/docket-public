// The host's side of the relay (Netlify Functions): reads the request, keeps the day's counts in Netlify Blobs, and
// leaves every decision to relay.mjs. The token and repo come from the site's environment variables (README.md).
import { getStore } from '@netlify/blobs';
import { handle } from '../../relay.mjs';

export default async (req, context) => {
  let body = null;
  try { body = await req.json(); } catch {}
  const blobs = getStore({ name: 'feedback-limits', consistency: 'strong' });
  const store = { get: (key) => blobs.get(key), set: (key, n) => blobs.set(key, String(n)) };
  const r = await handle({ method: req.method, body, ip: context.ip, store, token: process.env.FEEDBACK_GITHUB_TOKEN, repo: process.env.FEEDBACK_REPO });
  return Response.json(r.body, { status: r.status });
};

export const config = { path: '/v1/suggest' };
