// What the counter keeps from a send: only the fields Docket's usage.mjs sends, each checked and capped, or null for
// anything else. Kept apart from the Worker so test/usage.test.mjs can try it.
export const PLATFORMS = ['windows', 'mac', 'other'];
export const GEAR_KEYS = ['haiku', 'sonnet', 'opus', 'luna', 'sol', 'astra', 'fast', 'full'];
const ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const VERSION = /^\d{1,4}\.\d{1,4}\.\d{1,4}$/;
const n = (v) => (Number.isInteger(v) && v >= 0 ? Math.min(v, 100000) : 0);
const dayMs = (d) => Date.parse(d + 'T00:00:00Z');

// now: Date.now() at the counter. A day more than two days off the counter's own is refused.
export function cleanPing(b, now = Date.now()) {
  if (!b || typeof b !== 'object' || b.v !== 1) return null;
  if (!ID.test(b.id) || !DAY.test(b.day) || !DAY.test(b.firstSeen) || !VERSION.test(b.version) || !PLATFORMS.includes(b.platform)) return null;
  if (Math.abs(dayMs(b.day) - now) > 2 * 86400000 || dayMs(b.firstSeen) > dayMs(b.day)) return null;
  const s = b.sessions || {}, d = b.desks || {}, p = b.pages || {}, g = b.gears || {};
  const gears = {};
  for (const k of GEAR_KEYS) if (n(g[k])) gears[k] = n(g[k]);
  return {
    install_id: b.id, day: b.day, version: b.version, platform: b.platform, first_seen: b.firstSeen,
    sessions_claude: n(s.claude), sessions_codex: n(s.codex), sessions_grok: n(s.grok),
    children: n(b.children), shift_sessions: n(b.shiftSessions), gears: JSON.stringify(gears),
    plans: n(b.plans), ask: n(b.ask), handoff: n(b.handoff), pages_usage: n(p.usage), pages_plans: n(p.plans),
    desks: n(d.total), desks_claude: n(d.claude), desks_codex: n(d.codex), desks_grok: n(d.grok),
    remote_desks: n(b.remoteDesks), groups_count: n(b.groups), schedules: n(b.schedules), signin_desks: n(b.signinDesks),
    remote_control: b.remoteControl === true ? 1 : 0,
    update_mode: b.updateMode === 'off' ? 'off' : 'auto',
    theme: ['light', 'dark'].includes(b.theme) ? b.theme : 'system',
    received_at: new Date(now).toISOString(),
  };
}

export const cleanInstall = (b) => (b && PLATFORMS.includes(b.platform) ? { platform: b.platform } : null);
