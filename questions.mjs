// Question numbers (#928): every question a session asks the user carries a number never used before in that session
// (Q1, Q2 … Q17), so "Q7 yes" means one thing however many batches of questions came since. Docket keeps the count,
// not the model: it reads the highest Qn in the session's own messages (its replies and its AskUserQuestion forms),
// keeps that in the session's saved record, and tells the session the next number on each turn. A context summary
// therefore cannot send it back to Q1.

// A "Q" and 1 to 3 digits, as a word. A quarter with its year ("Q4 2026", "Q3 '26", "Q1-2027") is not a question.
const Q_RE = /(?<![\w&])Q(\d{1,3})\b(?!\s?['’-]?\s?(?:\d{2}\b|\d{4}\b))/g;

// The question numbers in a piece of text, in order.
export function questionNumbers(text = '') {
  return [...String(text || '').matchAll(Q_RE)].map((m) => Number(m[1])).filter((n) => n > 0);
}

// The question numbers in an assistant message's content blocks: its text, and the questions and headers of an
// AskUserQuestion form.
export function messageNumbers(content = []) {
  const out = [];
  for (const b of Array.isArray(content) ? content : []) {
    if (b?.type === 'text') out.push(...questionNumbers(b.text));
    else if (b?.type === 'tool_use' && b.name === 'AskUserQuestion') for (const q of b.input?.questions || []) out.push(...questionNumbers(q?.header), ...questionNumbers(q?.question));
  }
  return out;
}

// The last number used, after a message: never lower than it was. A number far past the last one (a ticket, a
// spec section) is passed over, so one stray "Q500" does not push every later question there.
export const JUMP = 50;
export function afterMessage(last = 0, content = []) {
  return messageNumbers(content).filter((n) => n <= last + JUMP).reduce((a, n) => Math.max(a, n), last);
}

// The next unused number.
export const nextQuestion = (last = 0) => (Number(last) || 0) + 1;

// The words for the state line on Docket's notes, and the line on every other turn ("(From Docket:", so a chat read
// back from the transcript leaves it out, touches.mjs).
export const questionPart = (last = 0) => `next question Q${nextQuestion(last)}`;
export const questionLine = (last = 0) => `(From Docket: your next question to the user is Q${nextQuestion(last)}.)`;

// Answers given by number in the person's own message (#929): "Q7 keep both", "Q7: keep both, Q9 flag it", one per
// line or one after another. A number counts only where an answer starts: at the start of the message or a line, or
// after a comma, a semicolon or a full stop. "I think Q7 is hard" answers nothing. Each answer runs to the next one.
const ANSWER_AT = /(?:^|\n|[,;.]\s)[ \t]*(?:[-*•]\s+)?\**Q(\d{1,3})\**(?:\s*[:.)=\-–—]|\s)\s*/g;
export function answersIn(text = '') {
  const s = String(text || ''), marks = [...s.matchAll(ANSWER_AT)];
  const out = [];
  marks.forEach((m, i) => {
    const from = m.index + m[0].length, to = i + 1 < marks.length ? marks[i + 1].index + (/^[,;.]/.test(marks[i + 1][0]) ? 1 : 0) : s.length;
    const answer = s.slice(from, to).trim().replace(/[,;]+$/, '').trim();
    const q = Number(m[1]);
    if (q > 0 && answer) out.push({ q, answer });
  });
  // the same number twice: the last answer wins
  return out.filter((a, i) => !out.slice(i + 1).some((b) => b.q === a.q));
}
