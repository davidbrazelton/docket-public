// Handing a session off to a fresh one: the same work, continued in a new conversation that
// takes the old one's place in the list. A session raises the card with the propose_handoff tool, or,
// for a company whose profile sets handoffPattern, by writing a reply that matches it.

// The title a brief asks for: its first "Title: ..." line, or ''.
export function titleFromBrief(brief) {
  const m = String(brief || '').match(/^\s*Title:\s*(.+?)\s*$/im);
  return m ? m[1].slice(0, 80) : '';
}

// The brief in a reply that matches a company's handoffPattern ({ marker, block }), or null.
// marker is a regular expression (read line by line, so ^ and $ fit a line); the brief is the first
// fenced block after it. "first fenced block after the marker" is the only kind of block so far.
export function matchHandoff(text, pattern) {
  if (!pattern?.marker || !text) return null;
  if (pattern.block && pattern.block !== 'first fenced block after the marker') return null;
  let re;
  try { re = new RegExp(pattern.marker, 'm'); } catch { return null; }
  const s = String(text).replace(/\r/g, '');
  const m = re.exec(s);
  if (!m) return null;
  const after = s.slice(m.index + m[0].length);
  const fence = after.match(/^[ \t]*(`{3,}|~{3,})[^\n]*\n([\s\S]*?)^[ \t]*\1[ \t]*$/m);
  const brief = fence ? fence[2].replace(/\n$/, '').trim() : '';
  return brief || null;
}

// The events of the turn that just finished: everything after the previous turn's end.
export function turnEvents(events) {
  let i = events.length;
  while (i > 0 && events[i - 1].k !== 'result') i--;
  return events.slice(i);
}

// The handoff a finished turn's reply asks for through the company's pattern, or null. Null too when
// the session already raised a handoff card in that turn (the tool and the pattern both fired).
export function handoffFromTurn(events, pattern) {
  if (!pattern?.marker) return null;
  const turn = turnEvents(events);
  if (turn.some((e) => e.k === 'handoff')) return null;
  const text = turn.filter((e) => e.k === 'text').map((e) => e.text).join('\n\n');
  const brief = matchHandoff(text, pattern);
  return brief ? { brief, title: titleFromBrief(brief) } : null;
}

// Where the new session goes: under the old one's parent (the top level when it has none), reporting
// where the old one reported, and in the old one's own group when it chose one.
// rec: the old session's saved record; parentId: its parent now (null at the top level).
export function handoffPlace(rec = {}, parentId = null) {
  return {
    parentId: parentId || null,
    reportsTo: rec.reportsTo || null,
    groupId: !parentId && rec.groupId !== undefined ? rec.groupId : undefined,
  };
}

// The old session's own child sessions go with the work: each moves under the new session and reports to it.
// kids: [{ id, title, rec, running }] (rec: the child's saved record, or undefined for one known only to the
// desktop app; running: still open in Docket). Returns each child's record as it is to be saved, and the line
// for the new session's first message that names them ('' when there are none).
export function handoffChildren(kids = [], oldId, newId) {
  const moved = kids.map((k) => {
    const rec = { ...(k.rec || {}), parentId: newId, reportsTo: newId };
    if (rec.replyTo === oldId || rec.replyTo === newId) delete rec.replyTo; // work the old one sent now reports here too
    return { id: k.id, rec, running: !!k.running };
  });
  const list = kids.map((k) => `"${k.title || 'Untitled'}" (id ${k.id}, ${k.running ? 'still running' : 'not running'})`);
  const context = list.length
    ? ` Its child sessions are now yours: they are listed under you and report to you: ${list.join('; ')}.`
    : '';
  return { moved, context };
}

// The old session's plans go with the work too (#667): each plan it coordinates gets the new session as coordinator,
// and each task it holds that is not done or dropped gets the new session as holder, since the new one carries on that
// same work (a done task keeps the session that did it). plans: the desk's plans (plans.mjs). Returns the plans to
// take over, the tasks to move as [{ plan, tasks: [task ids] }], and the line for the new session's first message.
export function handoffPlans(plans = [], oldId) {
  const coordinated = plans.filter((p) => oldId && p.coordinator === oldId);
  const held = plans.map((p) => ({ plan: p, tasks: p.tasks.filter((t) => oldId && t.holder === oldId && t.state !== 'done' && t.state !== 'dropped') }))
    .filter((h) => h.tasks.length);
  const parts = [];
  if (coordinated.length) parts.push(` You are now the coordinator of the plan${coordinated.length > 1 ? 's' : ''} it coordinated: ${coordinated.map((p) => `${p.id} "${p.title}"`).join('; ')}.`);
  if (held.length) parts.push(` The plan tasks it held are now yours: ${held.flatMap((h) => h.tasks.map((t) => `${h.plan.id}/${t.id} "${t.title}"`)).join('; ')}.`);
  const ids = new Set([...coordinated.map((p) => p.id), ...held.map((h) => h.plan.id)]);
  if (parts.length) parts.push(` Read ${ids.size > 1 ? 'them' : 'it'} with mcp__portal__plan_read before you carry on.`);
  return { coordinated, held: held.map((h) => ({ plan: h.plan.id, tasks: h.tasks.map((t) => t.id) })), context: parts.join('') };
}

// A handoffPattern as saved in a company's profile, tidied, or undefined when it is not usable.
export function cleanHandoffPattern(p) {
  if (!p || typeof p !== 'object') return undefined;
  const marker = String(p.marker || ''); // not trimmed: a space at either end is part of what it matches
  if (!marker.trim()) return undefined;
  try { new RegExp(marker, 'm'); } catch { return undefined; }
  return { marker, block: 'first fenced block after the marker' };
}

// A chat read again from the conversation file (after Docket restarts, or for a saved session) has no
// cards in it, so the saved cards go back in: right after the tool call that raised the card (tool: its
// id), else the call whose result names the card, else after the reply it was raised from (anchor: the start of that
// reply). cards: [{ ev, anchor, tool }]; a card already in the chat is left where it is.
// After a compaction the file gives back only what follows the last boundary, so a card made before it has no place
//. It never goes under the latest reply as if it were new: an answered one goes at the top of the chat, an
// open one (still waiting on the person) at the end; both are marked earlier, so the page can say so.
export const isOpenCard = (ev) => ev.state === 'open' || ev.state === 'pending' || ev.archive === 'offered';
export function weaveCards(events, cards = []) {
  const out = events.slice();
  let top = 0; // where the next answered card with no place goes, so they keep their saved order
  for (const { ev, anchor, tool } of cards) {
    if (!ev || out.some((e) => e.k === ev.k && e.id === ev.id)) continue;
    let i = tool ? out.findIndex((e) => e.k === 'tool' && e.id === tool) : -1;
    if (i < 0) i = out.findIndex((e) => e.k === 'tool' && String(e.result || '').includes(ev.id));
    if (i < 0 && anchor) i = out.findLastIndex((e) => e.k === 'text' && String(e.text || '').startsWith(anchor));
    if (i >= 0) { delete ev.earlier; out.splice(i + 1, 0, ev); if (i < top) top++; continue; }
    ev.earlier = true;
    if (isOpenCard(ev)) out.push(ev);
    else out.splice(top++, 0, ev);
  }
  return out;
}
