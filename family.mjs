// A session's place in its family as a coordinator sees it (#717): list_sessions, close_session and the
// "last open session" note all ask here, so they agree with each other and with the session list.
// parentOf(id) is the parent link the list nests by (set_parent moves included); isOpen(id) says whether a
// session is still in the list (not archived, not deleted).

// The nearest open session above id: its parent, or, when that one is archived, the first open one further up.
// A child of an archived session still belongs to the session that started that one.
export function openParent(id, parentOf, isOpen) {
  const seen = new Set([id]);
  for (let p = parentOf(id); p && !seen.has(p); p = parentOf(p)) {
    if (isOpen(p)) return p;
    seen.add(p);
  }
  return null;
}

// Every open session below root, children and grandchildren, depth first: [{ id, parent, depth }], where parent
// is its nearest open parent. ids: the desk's sessions.
export function openFamily(root, ids, parentOf, isOpen) {
  const kids = new Map();
  for (const id of new Set(ids)) {
    if (id === root || !isOpen(id)) continue;
    const p = openParent(id, parentOf, isOpen);
    if (p) (kids.get(p) || kids.set(p, []).get(p)).push(id);
  }
  const out = [], seen = new Set([root]);
  const walk = (pid, depth) => { for (const k of kids.get(pid) || []) if (!seen.has(k)) { seen.add(k); out.push({ id: k, parent: pid, depth }); walk(k, depth + 1); } };
  walk(root, 1);
  return out;
}

// What close_session adds after closing a child. left: the open sessions still under the caller
// ([{ id, title, state }], state 'working', 'waiting' or 'done'). Only with none left was that the last one.
export function closedNote(left = []) {
  const done = ' if your own job is now complete, call mark_turn with label "done" (not report_quiet) before your final reply, and make that reply the closing message; if something is still left for the user, say what.';
  if (!left.length) return ' That was your last open session:' + done;
  const list = left.map((k) => `"${k.title || 'Untitled'}" (id ${k.id}, ${k.state})`).join('; ');
  if (left.every((k) => k.state === 'done')) return ` None of your sessions is still working or waiting on the user, but ${left.length} under you ${left.length === 1 ? 'is' : 'are'} still open: ${list}. Close each one that is done, or leave it for the user; then,` + done;
  return ` Still open under you: ${list}.`;
}
