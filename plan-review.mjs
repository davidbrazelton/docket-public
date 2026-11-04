// The one-time review nudge (#661): when the plan rules change (PLAN_RULES_VERSION in plans.mjs), each open plan's
// coordinator is asked, once, to check its own plan against them with the plan tools. The nudge only sends a
// message: it changes no plan file and starts no session. A coordinator that is closed gets it once it is open
// again; until the coordinator marks the review done (plan_review_done), the plan shows "needs review".
import { PLAN_RULES_VERSION, reviewDue } from './plans.mjs';

// How often Docket sends one nudge, at most: one at a time, so many plans never wake their coordinators at once.
export const REVIEW_EVERY_MS = 30000;

// Whether a nudge for this plan was already sent to its coordinator at this rules version (at most one pending).
export const reviewSent = (plan, sent, version = PLAN_RULES_VERSION) => {
  const r = sent?.[plan.id];
  return !!r && r.version === version && r.to === plan.coordinator;
};

// The next plan to nudge, or null: due for review, with a coordinator, not already sent to that coordinator at this
// version, and with that coordinator open and free now (canReach). One per call, so a caller on a timer is paced.
export function nextReview({ plans, sent = {}, canReach, version = PLAN_RULES_VERSION }) {
  return plans.find((p) => reviewDue(p, version) && p.coordinator && !reviewSent(p, sent, version) && canReach(p.coordinator)) || null;
}

// The message the coordinator gets. It asks for repairs with the plan tools, never for work to be redone.
export function reviewText(plan, version = PLAN_RULES_VERSION) {
  return `Docket's plan rules have changed since plan ${plan.id} ("${plan.title}"), which you coordinate, was made. Please review that plan against the current rules (version ${version}) and repair it with the plan tools. Read it first with mcp__portal__plan_read. Check:
- One job per task. A task that bundles several jobs is split: add one task per job with mcp__portal__plan_add_tasks, the first of them with "replaces" naming the old task.
- Steps only the user can do (a sign-in, a decision, money, something they asked to do themselves) are their own tasks marked for_user: set it on an existing task with mcp__portal__plan_update_task, or on the new tasks of a split.
- A task waiting on something outside Docket that is not the user (a colleague, a vendor, a date, another team's work) has the state waiting_outside with waits_on saying what it waits on (mcp__portal__plan_update_task), not waiting_on_user.
- The goal still says what done looks like for the whole plan; if the finish line moved, change it with mcp__portal__plan_set_goal.
Change only how the plan is written down. Do not redo, restart or reopen any work, start no sessions for this, and leave tasks that are done or dropped as they are. When you have checked it, mark the review done with mcp__portal__plan_review_done, also when nothing needed changing. Then carry on with what you were doing.`;
}
