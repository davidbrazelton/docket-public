// Dragging a session in the list moves its whole family with it. This finds that family.
// rows: [{ id, parentId }]. Returns the ids of every session under id, all the way down, never id
// itself, and stops on a loop in the parent links rather than going round it.
export function familyBelow(rows, id) {
  const kids = new Map();
  for (const r of rows) if (r.parentId && r.parentId !== r.id) (kids.get(r.parentId) || kids.set(r.parentId, []).get(r.parentId)).push(r.id);
  const out = [], seen = new Set([id]);
  for (let i = 0, todo = [id]; i < todo.length; i++)
    for (const k of kids.get(todo[i]) || []) if (!seen.has(k)) { seen.add(k); out.push(k); todo.push(k); }
  return out;
}
