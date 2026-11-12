// The sites a session waits on in its private browser (needs_signin, #678): the rules, kept apart from the server so they
// can be tested. A session's need is a list of { site, url }, one per site (#1013); saved records from before hold a single
// { site, url }, read here as a list of one. Closing the sign-in window clears only what was signed in to (#1012).

// A cookie domain or host name as the site it belongs to: www.google.com and .google.com are both google.com.
export const siteOf = (host) => String(host || '').replace(/^\./, '').split('.').slice(-2).join('.').toLowerCase();

// The need as a list, whatever shape it was saved in.
export const needList = (need) => (Array.isArray(need) ? need : need?.site ? [need] : []).filter((n) => n?.site);

const sameSite = (a, b) => a.trim().toLowerCase() === b.trim().toLowerCase();

// Asking for a site adds it; asking again for the same site updates its address rather than adding it twice.
export function addNeed(need, add) {
  const list = needList(need);
  const at = list.findIndex((n) => sameSite(n.site, add.site));
  return at < 0 ? [...list, add] : list.map((n, i) => (i === at ? { ...n, ...add, url: add.url || n.url } : n));
}

// Without a site, everything goes; null when nothing is left.
export function dropNeed(need, site) {
  const list = site ? needList(need).filter((n) => !sameSite(n.site, site)) : [];
  return list.length ? list : null;
}

// The site a need's address (or its name, when that is an address) belongs to; '' when it names no host (e.g. "Salesforce").
export function needSite(n) {
  try { if (/^https?:\/\//.test(n.url || '')) return siteOf(new URL(n.url).hostname); } catch {}
  const name = String(n.site || '').replace(/^https?:\/\//, '').split('/')[0];
  return /^[\w-]+(\.[\w-]+)+$/.test(name) ? siteOf(name) : '';
}

// What closing the sign-in window clears: every site of a session that opened it or pressed Done from its card (asked),
// and any other session's site that the window went to (visited: sites as siteOf gives them). The rest stay.
// needs: { sessionId: need }. Returns { sessionId: { cleared: [need], left: [need] | null } } for sessions that lose any.
export function clearedBy(needs, { asked = [], visited = [] } = {}) {
  const ask = new Set(asked), went = new Set(visited), out = {};
  for (const [id, need] of Object.entries(needs || {})) {
    const list = needList(need);
    const cleared = ask.has(id) ? list : list.filter((n) => { const s = needSite(n); return s && went.has(s); });
    if (cleared.length) out[id] = { cleared, left: list.length > cleared.length ? list.filter((n) => !cleared.includes(n)) : null };
  }
  return out;
}

// Sites as a person reads them: "a", "a and b", "a, b and c".
export const siteNames = (list) => { const s = needList(list).map((n) => n.site); return s.length < 2 ? s.join('') : `${s.slice(0, -1).join(', ')} and ${s.at(-1)}`; };
