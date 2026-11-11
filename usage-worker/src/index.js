// Docket's usage counter (#848): a Cloudflare Worker that keeps Docket's anonymous daily counts in D1.
// POST /v1/ping    the app's daily report (usage.mjs); the last one each day per install is kept.
// POST /v1/install one row per finished install, carrying only the platform (install-windows.ps1, install-mac.sh).
// Nothing about the sender (address, headers) is stored.
import { cleanPing, cleanInstall } from './clean.js';

const MAX_BYTES = 4096;
const reply = (status, text = '') => new Response(text, { status, headers: { 'content-type': 'text/plain' } });

async function body(req) {
  const text = await req.text();
  if (text.length > MAX_BYTES) return null;
  try { return JSON.parse(text); } catch { return null; }
}

export default {
  async fetch(req, env) {
    const { pathname } = new URL(req.url);
    if (req.method === 'GET' && pathname === '/') return reply(200, 'Docket usage counter. What it keeps: see "Usage stats" in Docket\'s README.\n');
    if (req.method !== 'POST') return reply(405);
    if (pathname === '/v1/ping') {
      const row = cleanPing(await body(req));
      if (!row) return reply(400);
      const cols = Object.keys(row);
      await env.DB.prepare(`INSERT OR REPLACE INTO pings (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`).bind(...cols.map((c) => row[c])).run();
      return reply(204);
    }
    if (pathname === '/v1/install') {
      const row = cleanInstall(await body(req));
      if (!row) return reply(400);
      await env.DB.prepare('INSERT INTO installer_runs (day, platform) VALUES (?, ?)').bind(new Date().toISOString().slice(0, 10), row.platform).run();
      return reply(204);
    }
    return reply(404);
  },
};
