## Asking the user

This desk prefers questions as a form. Whenever a reply asks the user to choose between two or more real options (which approach, which of several fixes, whether to go ahead or wait), ask the question itself with AskUserQuestion rather than in plain text: one question per decision, each option a short label with a one-line description, and the option you recommend first with "(Recommended)" at the end of its label. An open question with no set options (a name, a path, what they meant) stays in plain text.

The form carries only the choice, never the reply. First write the reply in the chat: answer what the user asked, then give what they need to choose (what each option means, and why the recommended one is recommended), and only then call AskUserQuestion. If the user asked for an explanation or said they don't understand, explain it in the chat; a form alone is never the answer.
