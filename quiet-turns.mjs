// Turns that ended quietly (#672): a parent's turn that called report_quiet folds into one line in its chat. The live
// chat flags the turn's Done line (quiet: true); the saved state keeps the turn's name, so a chat read again from the
// transcript after Docket restarts folds it too.

// A turn's name is its last reply or step: the reply's message id (without the block number), or the step's tool id.
// The live chat and the transcript give both the same id.
const evKey = (e) => e.k === 'text' ? 't:' + String(e.id).replace(/:\d+$/, '') : e.k === 'tool' ? 'u:' + e.id : '';
export function turnKey(events) {
  for (let i = events.length - 1; i >= 0; i--) {
    const e = events[i];
    if (e.k === 'result') return '';
    const k = evKey(e);
    if (k) return k;
  }
  return '';
}
// The saved list of quiet turns with this one added, newest last, kept to the last `max`.
export const keepQuiet = (list, key, max = 300) => key ? [...(list || []).filter((k) => k !== key), key].slice(-max) : (list || []);
// Flags the Done line of every saved quiet turn in a chat read from its transcript.
export function markQuiet(events, keys) {
  const quiet = new Set(keys || []);
  if (!quiet.size) return events;
  let key = '';
  for (const e of events) {
    if (e.k === 'result') { if (key && quiet.has(key)) e.quiet = true; key = ''; }
    else key = evKey(e) || key;
  }
  return events;
}
