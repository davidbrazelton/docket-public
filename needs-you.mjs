// Whether a session waits on the person: the rules the app saves and reads back after a restart, kept apart from the server so they can be tested.

// Saved as state.sessions[id].waiting, so a restart keeps the orange dot. Unread and asking, or unread and idle with no
// background jobs, or unread and stopped by an error (stoppedNote): the runner may still hold that session, and an
// app restart brings it back idle, which must not read as seen.
export const savedWaiting = ({ unread, status, heldTurn, lastError }) =>
  !!(unread && (status === 'requires_action' || (status === 'idle' && !heldTurn) || (status === 'ended' && lastError)));

// A session the runner still holds after an app restart: unread again when it has a question open, was waiting before
// the restart and is not working now, or may not have had its message.
export const unreadAfterRestart = ({ asks, wasWaiting, busy, unsent }) => !!(asks || (wasWaiting && !busy) || unsent);
