// Resting an idle session: the rules, kept apart from the server so they can be tested.
// A Claude session left idle keeps its whole process tree (claude, its MCP servers, a browser) in memory for as long as
// it is open. Past the set time Docket lets that go (restSession in server.mjs): the session stays in the list with its
// chat, marked resting, and its next message starts it again with resume. The default, 60 minutes, matches the 1-hour
// prompt cache, so a resume after that costs no more than carrying on would have.

export const REST_DEFAULT = 60;

// The minutes setting: a whole number from 0 (never) up to a week; anything else is the default.
export function restMinutes(v) {
  const n = Number(v);
  return v === undefined || v === null || v === '' || !Number.isFinite(n) || n < 0 ? REST_DEFAULT : Math.min(Math.round(n), 7 * 24 * 60);
}

// Whether a live session may rest now. Only a Claude session (its own transcript resumes it; Grok and Codex keep their
// chat in Docket's copy, see keepsChat) that is idle with nothing under way or waiting on the person, and has been
// quiet for the set time. now and lastActivity in ms.
export function restDue(s, { minutes = REST_DEFAULT, now = Date.now(), runningJobs = 0, signInOpen = false, paused = false } = {}) {
  if (!minutes || paused) return false;
  if ((s.engine || 'claude') !== 'claude') return false;
  if (s.status !== 'idle' || s.resting || s.waking || s.reloading || s.compacting) return false;
  if (runningJobs > 0 || s.heldTurn || s.asks > 0 || signInOpen) return false;
  return now - (s.lastActivity || now) >= minutes * 60000;
}
