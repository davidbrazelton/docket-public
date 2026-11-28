// Whether a Docket hook should do nothing: the company turned it off (Docket puts the names in DOCKET_HOOKS_OFF, comma
// separated, when it starts a session), or this is not a Docket session at all (DOCKET_ENGINE unset: a Grok home keeps
// Docket's hook file, so grok run from a terminal with that home sees it too).
export function isOff(name, env = process.env) {
  if (!env.DOCKET_ENGINE) return true;
  return String(env.DOCKET_HOOKS_OFF || '').split(',').map((s) => s.trim()).includes(name);
}
