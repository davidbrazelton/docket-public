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

// The last number used, after a message: never lower than it was. Only a number the message asks with counts (askedIn,
// #1006): one it only mentions ("next question number is Q10") is not used up. A number far past the last one (a
// ticket, a spec section) is passed over, so one stray "Q500" does not push every later question there.
export const JUMP = 50;
export function afterMessage(last = 0, content = []) {
  return askedIn(content).map((a) => a.q).filter((n) => n <= (Number(last) || 0) + JUMP).reduce((a, n) => Math.max(a, n), Number(last) || 0);
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

// ---------- open questions (#989) ----------
// On a desk set to Highlight + track, Docket keeps each session's open questions: asked and not yet closed, as
// [{ q, text, opts?, at, faint? }] in its saved record (openQ). The chat's tray and the row's question count read it.
// Tick + clear: a question closes when the person answers it by number, answers its form, or presses ✓. One the person
// replied after without its number fades (faint), and clears once the session's next reply does not ask it again.
export const QUESTION_LEVELS = ['off', 'highlight', 'track'];
const CLIP = 220, MAX_OPEN = 30;
const plain = (t = '') => String(t).replace(/\*\*|__|`/g, '').replace(/\s+/g, ' ').trim();
const clip = (t) => (t.length > CLIP ? t.slice(0, CLIP - 1).trimEnd() + '…' : t);

// The question a line asks (#989, #1006). A line that starts with its number and asks: "Q5: Keep it?", "**Q5.** Keep
// it?", "- Q5 keep it?". Or, inside the line, a sentence that ends with "?" and holds that one number: "Should I keep it
// (Q5)?". Not a mention: no "?" ("Q5 opened in the tray."), a sentence about the numbering ("is the next question
// number Q10?"), a line quoting an answer ("Q5 answered: …"), a quarter with its year ("Q4 2026 sales"), or a bare "Q5".
// The page's copy (askedOn in index.html) reads a paragraph's text the same way, so the chat highlights what is tracked.
const ABOUT_NUMBERS = /\bnext\s+(?:question\s+)?numbers?\b|\bnext\s+question\s+(?:is|would|will|comes?)\b|\bquestion\s+numbers?\b|\bno\s+(?:open\s+)?questions?\b/i;
export function askedOn(line = '') {
  const l = String(line || ''), m = /^\s*(?:[-*+•]\s+|\d+[.)]\s+)?[*_]*Q(\d{1,3})\b[*_]*\s*[:.)\-–—]?[*_]*\s*([\s\S]*)$/.exec(l);
  if (m) {
    const rest = m[2].trim();
    if (!rest || /^(?:already\s+)?answered\b/i.test(rest) || /^['’-]?\s?(?:\d{2}|\d{4})\b/.test(rest)) return null;
    return rest.includes('?') && !ABOUT_NUMBERS.test(rest) ? { q: Number(m[1]), text: clip(plain(rest)) } : null;
  }
  for (const s of l.split(/(?<=[.!?])\s+/)) {
    if (!/\?[*_"'”’)\]]*$/.test(s.trim()) || ABOUT_NUMBERS.test(s)) continue;
    const n = questionNumbers(s);
    if (n.length === 1) return { q: n[0], text: clip(plain(s.replace(/^\s*(?:[-*+•]\s+|\d+[.)]\s+|#+\s+)/, ''))) };
  }
  return null;
}

// What an assistant message asks: its lines that ask (askedOn, one question a line) and its form questions (with
// their options). A number only mentioned is not asked (#1006): it opens nothing and is not used up.
export function askedIn(content = []) {
  const out = [], seen = new Set();
  const add = (x) => { if (x.q > 0 && !seen.has(x.q)) { seen.add(x.q); out.push(x); } };
  for (const b of Array.isArray(content) ? content : []) {
    if (b?.type === 'text') for (const l of String(b.text || '').split('\n')) { const a = askedOn(l); if (a) add(a); }
    else if (b?.type === 'tool_use' && b.name === 'AskUserQuestion') for (const q of b.input?.questions || []) {
      const n = [...questionNumbers(q?.header), ...questionNumbers(q?.question)][0];
      if (n) add({ q: n, text: clip(plain(String(q?.question || '').replace(/^\s*\**Q\d{1,3}\b\**\s*[:.)\-–—]?\s*/, ''))), opts: (q?.options || []).map((o) => String(o?.label || '')).filter(Boolean) });
    }
  }
  return out;
}

// The open list after an assistant message: a new number opens; a faint one asked again is bright again (and takes a
// form's options). A number already used and closed is not opened again.
export function openAfterAsk(open = [], content = [], last = 0, at = Date.now()) {
  let out = open;
  for (const a of askedIn(content)) {
    const i = out.findIndex((x) => x.q === a.q);
    if (i >= 0) {
      if (out[i].faint) { out = out.slice(); const { faint, ...rest } = out[i]; out[i] = { ...rest, ...(a.opts ? { opts: a.opts } : {}) }; }
      continue;
    }
    if (a.q <= last || a.q > last + JUMP) continue;
    out = [...out, { q: a.q, text: a.text, ...(a.opts?.length ? { opts: a.opts } : {}), at }];
  }
  return out.length > MAX_OPEN ? out.slice(-MAX_OPEN) : out;
}

// The open list after the person's own message: answered by number closes; every other open question fades.
export function openAfterReply(open = [], text = '') {
  const answered = new Set(answersIn(text).map((a) => a.q));
  const out = open.filter((x) => !answered.has(x.q)).map((x) => (x.faint ? x : { ...x, faint: true }));
  return out.length === open.length && out.every((x, i) => x === open[i]) ? open : out;
}

// Closed by number: a form answered, or ✓ by hand.
export function openWithout(open = [], nums = []) {
  const out = open.filter((x) => !nums.includes(x.q));
  return out.length === open.length ? open : out;
}

// The session's reply has ended: what is still faint was not asked again, so it clears.
export function openAfterTurn(open = []) {
  const out = open.filter((x) => !x.faint);
  return out.length === open.length ? open : out;
}

// The words for the row's question tag (#989): "question" with none open, "1 question", "2 questions".
export const questionsWord = (n = 0) => (n > 0 ? `${n} question${n === 1 ? '' : 's'}` : 'question');

// Whether a reply asks the user a numbered question (#993): a line that asks, read as askedOn does ("Q7: Keep both?",
// "**Q7** …?", "Should I keep it (Q7)?"). Such a reply waits on the user even when more text follows the questions.
export const asksByNumber = (text = '') => String(text || '').split('\n').some((l) => askedOn(l));
