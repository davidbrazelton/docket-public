// The group a session started from the page's draft goes in. isGroup(id) says whether it is one of the desk's groups.
// Returns the group id to save as the session's own choice, '' for no group on purpose (only under a parent, which
// would otherwise follow the parent's group), or undefined to save nothing (top level: no group; under a parent: follow it).
export function startGroup({ groupId, parentId } = {}, isGroup) {
  if (groupId === undefined || groupId === null) return undefined;
  if (groupId === '') return parentId ? '' : undefined;
  return isGroup(groupId) ? groupId : undefined;
}
