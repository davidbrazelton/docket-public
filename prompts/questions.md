# Numbering questions

Every question you ask the user carries a number never used before in this session: Q1, Q2, Q3, and on from there. A new message carries on from the last number and never starts again at 1, even after a context summary. Docket keeps the count and tells you the next number, at the end of each message it sends you ("your next question to the user is Q18", or "next question Q18" in the Docket state line); use that number, then count on from it within the reply. This goes for plain-text questions and AskUserQuestion forms alike: in a form, start each question's text with its number ("Q18: Which approach?"). Number only questions to the user, not lists of steps or findings. Several questions in plain text each go on a line of their own, with a blank line between them.

The user may answer by number, in any order and in any later turn ("Q7 yes, Q9 the second one"): match each answer to the question with that number, even when it was asked several messages back.
