// Explain more and Side chat on questions (#1113): what a one-turn, tool-less side call reads about a question the
// session asked (a question form's question, or a numbered Qn in a reply), the words that tell it how to answer, and
// the clipped chat that goes to the session with the person's answer. server.mjs runs the call (explainQuestion).
export const EXPLAIN_MODELS = ['haiku', 'sonnet', 'opus', 'fork'];
export const MODEL_LABELS = { haiku: 'Haiku', sonnet: 'Sonnet', opus: 'Opus', fork: 'Session fork' };
export const TURN_WINDOW = 20; // the person's last 20 messages before the question, with what came between them
export const CONTEXT_CHARS = 32000; // about 8k tokens
export const REPLY_CHARS = 8000; // the reply that asked it, kept whole up to this
export const CHAT_SEND_CHARS = 1500; // how much of a side chat goes to the session with the answer
export const ASK_CHARS = 2000; // one follow-up as typed

const clip = (t, n) => { t = String(t ?? '').trim(); return t.length > n ? t.slice(0, n - 1).trimEnd() + '…' : t; };
const oneLine = (t) => String(t ?? '').replace(/\s+/g, ' ').trim();

// The question as the explainer reads it: { q?, text, header?, options?: [{ label, description }], multi? }.
export function questionText(question = {}) {
  const opts = (Array.isArray(question.options) ? question.options : []).slice(0, 12)
    .map((o) => `- ${clip(oneLine(o?.label ?? o), 200)}${o?.description ? `: ${clip(oneLine(o.description), 400)}` : ''}`);
  return [
    `${question.q ? `Q${question.q}: ` : ''}${clip(question.text, 1500)}`,
    question.header ? `(Heading: ${clip(oneLine(question.header), 100)})` : '',
    opts.length ? `Options${question.multi ? ' (any number can be picked)' : ''}:\n${opts.join('\n')}\n- Other: the person types their own answer` : 'The person answers in their own words.',
  ].filter(Boolean).join('\n');
}

// One chat event as a line of the transcript the explainer reads; '' for what it does not need.
function eventLine(e) {
  if (e.k === 'user' && e.text) return `[${e.from ? 'Message from ' + clip(oneLine(e.from), 60) : 'Person'}] ${clip(e.text, 3000)}`;
  if (e.k === 'text' && e.text) return `[Session] ${clip(e.text, 4000)}`;
  if (e.k === 'tool') {
    const r = e.result ? ` → ${clip(oneLine(e.result), 600)}` : '';
    return `[Tool ${e.name || ''}] ${clip(oneLine(e.label || JSON.stringify(e.input || {})), 300)}${r}`;
  }
  if (e.k === 'permission' && e.tool === 'AskUserQuestion') {
    const qs = (e.input?.questions || []).map((q) => `${oneLine(q.question)}${e.answers?.[q.question] ? ` → ${clip(oneLine(e.answers[q.question]), 300)}` : ''}`);
    return qs.length ? `[Question form${e.state === 'pending' ? '' : ', ' + e.state}] ${qs.join(' / ')}` : '';
  }
  return '';
}

// The conversation up to the question: the reply that asked it whole (to REPLY_CHARS), and before it the last
// TURN_WINDOW turns with their tool steps and results, the newest kept when it is over CONTEXT_CHARS in all.
// askedAt: the id of the event that asked (a reply's text, or the question form); left out, the end of the chat.
export function contextText(events = [], askedAt, { turns = TURN_WINDOW, chars = CONTEXT_CHARS } = {}) {
  const at = askedAt ? events.findIndex((e) => e.id === askedAt) : -1;
  const upto = events.slice(0, at >= 0 ? at + 1 : events.length);
  const users = upto.map((e, i) => (e.k === 'user' ? i : -1)).filter((i) => i >= 0);
  const lastUser = users.length ? users[users.length - 1] : -1;
  const start = users.length > turns ? users[users.length - turns] : 0;
  // The reply that asked: the session's words after the person's last message (a form's own event is left out).
  const reply = clip(upto.slice(lastUser + 1).filter((e) => e.k === 'text' && e.text).map((e) => e.text).join('\n\n'), REPLY_CHARS);
  const before = upto.slice(start, lastUser + 1).map(eventLine).filter(Boolean);
  const steps = upto.slice(lastUser + 1).filter((e) => e.k === 'tool').map(eventLine).filter(Boolean);
  const kept = [];
  let room = chars - reply.length - steps.join('\n').length;
  for (let i = before.length - 1; i >= 0 && room > 0; i--) {
    const line = before[i].length > room ? '…' + before[i].slice(before[i].length - room + 1) : before[i];
    kept.unshift(line); room -= line.length + 1;
  }
  return [
    kept.length < before.length || start > 0 ? '(Earlier conversation left out.)' : '',
    kept.length ? `Conversation before the question:\n${kept.join('\n')}` : '',
    steps.length ? `Steps the session ran in the reply that asked:\n${steps.join('\n')}` : '',
    reply ? `The reply that asked the question:\n${reply}` : '',
  ].filter(Boolean).join('\n\n');
}

export const EXPLAIN_SYSTEM = [
  'You help a person answer a question that an AI work session asked them. You are not that session, and it does not see what you write.',
  'You are read-only: you cannot run tools, change anything, or answer the session for the person.',
  'Never pick an option for the person and never say which one you would choose, even when asked: set out what each choice means and what it depends on, so they can decide.',
  'Use what the conversation shows, and name the facts in it that matter (files, numbers, earlier decisions, what the person said before). When the conversation does not say, say so plainly rather than guessing.',
  'Write plain, short sentences in Markdown, at most about 150 words, with no heading and no preamble.',
  'After the answer, on a last line of its own, write "Follow-ups:" and up to 3 short questions the person might ask next, separated by " | ".',
].join(' ');

// The thread so far, as the explainer reads it: [{ who: 'you' | 'ai', text, model }].
const threadText = (thread = []) => thread.slice(-12).map((m) => `${m.who === 'you' ? 'Person' : MODEL_LABELS[m.model] || 'Explainer'}: ${clip(m.text, 1500)}`).join('\n\n');

// The prompt for one call. mode: 'explain' (why it is asked, what each option changes) or 'chat' (the person's
// latest follow-up). fork: the call resumes the session itself, so it already has the conversation.
export function explainPrompt({ mode, question, context, thread = [], ask = '', fork = false }) {
  const what = mode === 'chat'
    ? `Answer the person's latest question in this side chat about it.${thread.length ? `\n\nThe side chat so far:\n${threadText(thread)}` : ''}\n\nThe person asks: ${clip(ask, ASK_CHARS)}`
    : 'Explain why this question is asked, and what each option would change.';
  const q = `The question the session asked the person:\n${questionText(question)}`;
  if (fork) return `(From Docket: this is a read-only side question from the person, asked in a copy of this session that is thrown away afterwards; nothing here reaches the session itself. ${EXPLAIN_SYSTEM})\n\n${q}\n\n${what}`;
  return `${context ? context + '\n\n' : ''}${q}\n\n${what}`;
}

// The answer, and its suggested follow-ups (the last line "Follow-ups: a | b | c") apart.
export function splitFollowUps(raw = '') {
  const t = String(raw || '').trim(), m = /(?:^|\n)[ \t]*\**Follow[- ]?ups?\**:\**[ \t]*([^\n]*)\s*$/i.exec(t);
  if (!m) return { text: t, followUps: [] };
  const followUps = m[1].split('|').map((x) => oneLine(x).replace(/^[-*\d.)\s]+/, '').replace(/^["“]|["”]$/g, '')).filter((x) => x.length > 3).slice(0, 3).map((x) => clip(x, 140));
  return { text: t.slice(0, m.index).trim(), followUps };
}

// The side chat the session gets with the person's answer to one question, clipped to CHAT_SEND_CHARS, the newest
// kept: { explanation?, thread: [{ who, text, model }] }. '' when there was no chat.
export function sideChatText({ explanation = '', thread = [] } = {}, max = CHAT_SEND_CHARS) {
  const lines = (Array.isArray(thread) ? thread : []).filter((m) => m && m.text)
    .map((m) => `${m.who === 'you' ? 'Person' : MODEL_LABELS[m.model] || 'Explainer'}: ${clip(oneLine(m.text), 500)}`);
  if (!lines.length) return '';
  if (explanation) lines.unshift(`Explanation they read: ${clip(oneLine(explanation), 300)}`);
  const kept = [];
  let room = max;
  for (let i = lines.length - 1; i >= 0; i--) { if (lines[i].length > room) break; kept.unshift(lines[i]); room -= lines[i].length + 1; }
  if (!kept.length) kept.push(clip(lines[lines.length - 1], max));
  return (kept.length < lines.length ? '(earlier part left out)\n' : '') + kept.join('\n');
}
// How the session is told: one note per question, after the answer.
export const sideChatNote = (label, chat) => `(From Docket: before answering ${label}, the person asked about it in a side chat with a read-only explainer (another model; you did not see it). Read it for why they answered as they did:\n${chat})`;
