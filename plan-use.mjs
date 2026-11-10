// Which sessions carry Docket's plan rules and plan tools (#605). Plans are on for a desk by default, but only a
// session that uses a plan carries the full rules (prompts/optional/plans.md) and the full tool descriptions: one
// that coordinates a plan, holds a task in one, or was started by a session that coordinates one (a worker told to
// "claim task T2"). Every other session on the desk gets two lines of rules and the same plan tools with one-line
// descriptions; the first plan tool it calls hands it the full rules in its reply, since a session's instructions
// and tool list are fixed when it starts.

// A desk's plan system: 'docket' (Docket's own), 'folder' (another system's, read-only) or 'none'. A desk that never
// chose one ('' or missing) is on Docket's own.
export const plansOnFor = (planSystem) => !planSystem || planSystem === 'docket';

// 'none' (no plans on this desk), 'full' (the session uses a plan) or 'short' (plans are on, this session has none yet).
// own: it coordinates a plan; holds: it holds a task not yet done; parentOwns: the session that started it coordinates one.
export function planUse({ on, own = false, holds = false, parentOwns = false }) {
  if (!on) return 'none';
  return own || holds || parentOwns ? 'full' : 'short';
}

// The two lines a session without a plan gets instead of plans.md.
export const PLAN_HINT = `## Plans

This desk can keep bigger work in Docket's plans: checklists of tasks handed to sessions of their own. Make one with mcp__portal__plan_create when the user asks for a plan, when Docket tells you to use one, or before you start two or more sessions for pieces of one piece of work; its reply carries the rules for working a plan. A brief that names a plan task: claim it with mcp__portal__plan_claim_task first.`;

// The card that offers a plan (#605): shown once, in a session that has just started its second child session (or
// more) and coordinates no plan. offered: the card was already shown there (answered or not), so it never comes back.
export function planOfferDue({ on, own = false, childStarts = 0, offered = false }) {
  return !!on && !own && !offered && childStarts >= 2;
}

// What start_session's reply adds (#651) when a session with no plan of its own has just started its first child
// session: the plan rule reaches it before the next child starts, not only after its first plan tool call.
export function planStartNote({ on, own = false, childStarts = 0 }) {
  if (!on || own || childStarts !== 1) return '';
  return 'This session coordinates no plan. If this is one of several pieces of one piece of work, make a plan with mcp__portal__plan_create before starting the next session, with this piece as a task, and tell this session its task id so it can claim it. A single piece needs no plan.';
}

// What the session is told when the user picks "Use a plan for this work" (the session menu or the card).
export const USE_PLAN_TEXT = 'The user asks to keep the work in this session in a Docket plan. Make one now with mcp__portal__plan_create: a title, a goal, and one task per piece of the work (each with a kind, one of build, test, decision or research, and a brief a fresh session can act on and what done looks like). If child sessions are already doing pieces of it, add their pieces as tasks and tell each child its task id, so it can claim it. The reply of plan_create says how to work the plan.';

// A session that coordinates a plan, however it came to (plan_create, the session menu, a takeover, a handoff), has
// no use for the card that offers one (#839): its open plan-offer cards ({ ev } as saved on the session's record)
// close as 'planned'. Returns the cards' evs that changed.
export function closePlanOffers(cards = [], own = false) {
  if (!own) return [];
  const evs = cards.map((c) => c.ev).filter((ev) => ev?.k === 'plan-offer' && ev.state === 'open');
  for (const ev of evs) ev.state = 'planned';
  return evs;
}
