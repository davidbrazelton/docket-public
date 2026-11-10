// The one-time card that asks how often a desk's sessions should ask with a form (#850): Never, Default or Often.
// It waits a while after a computer picks up the update, so the person has seen a few sessions ask first: a day after
// this computer first ran it, and once the desk has had a few new sessions of the person's own since then.
export const FORMS_OFFER = { days: 1, sessions: 3 };

// What each choice means, as the card and the Inspector say it.
export const FORMS_CHOICES = [
  ['never', 'Never', 'Sessions ask in plain text, and Docket turns down any form.'],
  ['default', 'Default', "Claude's own way: a form now and then, mostly when it is blocked on a decision."],
  ['often', 'Often', 'Whenever a reply asks you to choose between real options, it comes as a form, with one recommended.'],
];

// Whether a desk's card is due: from is when this computer first ran the update, answer the desk's saved answer (any
// answer, or a choice already made on the Inspector, ends it), sessions the person's new sessions on it since from.
export function formsOfferDue({ from, now = Date.now(), answer, chosen, sessions = 0 }) {
  if (answer || chosen || !from) return false;
  return now - from >= FORMS_OFFER.days * 864e5 && sessions >= FORMS_OFFER.sessions;
}
