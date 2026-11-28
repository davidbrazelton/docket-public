// A session's own rough "how far along" (#1053): the count of a checklist it keeps itself, done of total, and the
// step it is on. Reported with report_progress at natural breaks, kept per session in the app, shown muted in the
// list's plan column. A session that never reports shows nothing, never a made-up number.

export const STEP_MAX = 60; // the step is a few words; the hover shows it whole, the Step view cuts it shorter
export const PROGRESS_STALE = 3 * 3600e3; // an estimate this long unchanged says nothing about the work any more

// The stored form of a report, or an error message for the session. done may pass total by a slip: kept at total.
export function progressOf({ done, total, step } = {}, now = Date.now()) {
  const d = Number(done), t = Number(total);
  if (!Number.isInteger(t) || t < 1) return { error: 'total must be a whole number of 1 or more: the items on your checklist' };
  if (!Number.isInteger(d) || d < 0) return { error: 'done must be a whole number of 0 or more: the items you have finished' };
  const s = String(step || '').replace(/\s+/g, ' ').trim().slice(0, STEP_MAX);
  return { progress: { done: Math.min(d, t), total: t, ...(s ? { step: s } : {}), at: now } };
}

// Whether a kept estimate still means something: there, and reported within PROGRESS_STALE.
export const progressFresh = (p, now = Date.now()) => !!p && p.total > 0 && now - (p.at || 0) < PROGRESS_STALE;
