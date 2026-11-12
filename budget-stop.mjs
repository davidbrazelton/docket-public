// A desk's daily budget as a stop (#959): the rules, kept apart from the server so they can be tested.
// The budget is the one set on Manage desk (#270), in dollars at API prices. When the desk's spend today reaches it,
// a turn already running finishes, but new turns on that desk are held (sendToSession in server.mjs) until the
// person chooses Continue today, raises or clears the budget, or the day ends.

// The computer's own calendar day, the same day Usage's Today and the corner's spend use.
export const today = (d = new Date()) => d.toLocaleDateString('en-CA');

// The desk's record in state.budgetStops: { day, continued, held: [...] }. continued: the person chose Continue
// today on that day, so the stop is lifted until the day ends.
export const continuedToday = (rec, day) => !!rec?.continued && rec.day === day;

// Whether new turns on the desk are held now.
export const budgetStopped = ({ budget, spent, rec, day }) => budget > 0 && spent >= budget && !continuedToday(rec, day);

const dollars = (n) => '$' + Number(n || 0).toFixed(2);

// The line put in a session's chat when its message is held.
export function heldLine({ budget, spent, system = false, from = '' }) {
  const what = from === 'session' ? 'A message from another session' : from === 'brief' ? 'This session\'s brief' : system ? 'A message from Docket' : 'Your message';
  return `${what} is held, not sent: this desk's daily budget of ${dollars(budget)} is reached (${dollars(spent)} spent today). It goes when you choose Continue today or raise the budget in the banner, or at the start of tomorrow.`;
}

// What a session using start_session or send_to_session is told when the desk is stopped.
export const toolNotice = ({ budget, spent }) =>
  `This desk's daily budget of ${dollars(budget)} is reached (${dollars(spent)} spent today), so the message is held and no turn has started. It runs once the user chooses Continue today or raises the budget, or at the start of tomorrow. Do not send it again; say so in your reply.`;

// Held messages, in the order they came, to send now that the stop is lifted.
export function release(rec) {
  const held = rec?.held || [];
  if (rec) rec.held = [];
  return held;
}
