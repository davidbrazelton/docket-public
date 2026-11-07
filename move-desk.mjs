// Move sessions' records to another desk, after their transcript files were moved from one desk's Claude home to
// another's (a separate, manual step). The desk list, search and opening follow the files; Docket's own records do
// not: the session's desk and group (portal state), its cost rows (the usage index), and the desk-keyed touches, pins
// and dragged places. This rewrites those, in memory, and touches no file. Running it again changes nothing more.
// Kept apart from server.mjs so the tests can try it on made-up records.

// state: { sessions, touched, pins, places }; usage: id -> { client, rows: [{ Client }] }.
// groupId: a group of the target desk (checked by the caller), or '' / undefined to drop a group not of that desk.
// isLive(id): the session is open in Docket, and is skipped. groupIds: the target desk's group ids.
export function moveDesk(state, usage, { from, to, ids, groupId, groupIds = [], isLive = () => false }) {
  if (!from || !to || from === to) throw new Error('Give two different desks, from and to');
  if (groupId && !groupIds.includes(groupId)) throw new Error(`${groupId} is not a group of desk ${to}`);
  const results = [];
  for (const id of [...new Set(ids)]) {
    if (typeof id !== 'string' || !id || id.length > 100) { results.push({ id, result: 'skipped', why: 'not a session id' }); continue; }
    if (isLive(id)) { results.push({ id, result: 'skipped', why: 'open in Docket: close it, then move it' }); continue; }
    const rec = state.sessions[id], u = usage[id];
    const owner = rec?.client || u?.client;
    if (owner && owner !== from && owner !== to) { results.push({ id, result: 'skipped', why: `its records are on desk ${owner}` }); continue; }
    const kept = !!(state.touched?.[from]?.[id] || state.pins?.[from]?.includes(id) || state.places?.[from]?.includes(id));
    if (!rec && !u && !kept && !groupId) { results.push({ id, result: 'skipped', why: 'no records of it' }); continue; }
    const changed = [];
    // The session's desk and group
    const next = { ...(rec || {}), client: to };
    if (groupId) next.groupId = groupId;
    else if (next.groupId && !groupIds.includes(next.groupId)) delete next.groupId;
    if (!rec || rec.client !== to) changed.push('desk');
    if ((rec?.groupId || '') !== (next.groupId || '')) changed.push('group');
    if (changed.length) state.sessions[id] = next;
    // Its costs
    if (u && (u.client !== to || (u.rows || []).some((r) => r.Client !== to))) {
      usage[id] = { ...u, client: to, rows: (u.rows || []).map((r) => ({ ...r, Client: to })) };
      changed.push('costs');
    }
    // Touched, pinned, dragged place
    if (state.touched?.[from]?.[id]) {
      const at = state.touched[from][id], there = (state.touched[to] ||= {});
      there[id] = Math.max(there[id] || 0, at);
      delete state.touched[from][id];
      changed.push('touched');
    }
    if (state.pins?.[from]?.includes(id)) {
      state.pins[from] = state.pins[from].filter((x) => x !== id);
      const there = (state.pins[to] ||= []);
      if (!there.includes(id)) there.push(id);
      changed.push('pin');
    }
    // A dragged place is a spot among the old desk's rows, so it is let go: on the new desk it sits by its start time.
    if (state.places?.[from]?.includes(id)) {
      state.places[from] = state.places[from].filter((x) => x !== id);
      changed.push('place');
    }
    results.push(changed.length ? { id, result: 'moved', changed } : { id, result: 'unchanged' });
  }
  return { results, changed: results.some((r) => r.result === 'moved') };
}
