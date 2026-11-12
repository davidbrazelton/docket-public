// ---------- a session's Docket tool list (#923) ----------
// A session's Docket tools are listed once, when its process starts (tools-helper.mjs asks the app). Docket saves the
// names it got and compares them with the names it would get now: a desk setting (Plans, screen control, the pilot) or
// a Docket update may have changed them since, and then the session starts again, with resume, to load them.

// The names a session is shown: those not hidden, sorted, so two lists compare as they are.
export const toolNames = (defs) => defs.filter((t) => !t.hidden).map((t) => t.name).sort();

// Tools that come and go together are named as one.
const FAMILIES = [['plan tools', /^plan_/], ['screen tools', /^(screen_shot|mouse_|key_)/], ['autopilot tools', /^pilot_/]];
function describe(names) {
  const parts = [], left = new Set(names);
  for (const [name, re] of FAMILIES) {
    const hit = names.filter((n) => re.test(n));
    if (!hit.length) continue;
    parts.push(name);
    for (const n of hit) left.delete(n);
  }
  return [...parts, ...left].join(', ');
}

// What changed between the names a session got (had: undefined before its process listed them) and the names it
// would get now, as a short line ("plan tools added"), or null when nothing did.
export function toolChange(had, now) {
  if (!Array.isArray(had)) return null;
  const added = now.filter((n) => !had.includes(n)), removed = had.filter((n) => !now.includes(n));
  if (!added.length && !removed.length) return null;
  return [added.length && `${describe(added)} added`, removed.length && `${describe(removed)} removed`].filter(Boolean).join('; ');
}

// Why Docket restarts a session for its tools: the change, Refresh in its menu, or both. null when neither.
export function toolRestartWhy(change, refresh) {
  if (change) return `to load its Docket tools: ${change}`;
  return refresh ? 'because the user pressed Refresh' : null;
}
