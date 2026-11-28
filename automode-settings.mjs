// The Auto mode rules Docket passes each Claude session (#1262), so Auto mode's check knows what Docket's tools are
// and stops refusing routine steps (closing a finished child, cleaning up a merged worktree).
// Claude Code reads autoMode only from the user's settings, the --settings layer (the SDK's settings option) and policy;
// each list is joined across them, then the first "$defaults" stands for the built-in rules. A list with no
// "$defaults" anywhere replaces the built-ins, so Docket's lists start with it, unless the user's own list for that
// key is non-empty and has none: then they dropped the built-ins on purpose, and Docket keeps that choice.
import fs from 'node:fs';
import path from 'node:path';

export const DOCKET_AUTO_MODE = {
  allow: [
    'Docket (mcp__portal__*) is the user\'s own session manager on this machine. Closing or archiving a child session that reported done is routine and can be undone from the archive; recycle sends files to the Recycle Bin.',
    'After a pull request is merged, removing its clean worktree with git worktree remove (no --force) and deleting its merged branch with git branch -d is routine cleanup the user has standing permission for.',
  ],
  environment: [
    'Docket is the user\'s session manager on this machine; its portal tools (mcp__portal__*) manage the user\'s own sessions.',
  ],
};

// userAutoMode: the autoMode object from the user's own settings (or nothing). Returns Docket's autoMode layer.
export function docketAutoMode(userAutoMode) {
  const user = userAutoMode && typeof userAutoMode === 'object' ? userAutoMode : {};
  const out = {};
  for (const [key, rules] of Object.entries(DOCKET_AUTO_MODE)) {
    const theirs = Array.isArray(user[key]) ? user[key] : [];
    const dropped = theirs.length > 0 && !theirs.includes('$defaults');
    out[key] = dropped ? [...rules] : ['$defaults', ...rules];
  }
  return out;
}

// settings: the settings layer a run already has (the gateway's, or {}). Docket's autoMode lists go after any it holds.
export function withAutoMode(settings, autoMode) {
  const base = settings && typeof settings === 'object' ? settings : {};
  const had = base.autoMode && typeof base.autoMode === 'object' ? base.autoMode : {};
  const merged = { ...had };
  for (const [key, rules] of Object.entries(autoMode)) {
    const before = Array.isArray(had[key]) ? had[key] : [];
    merged[key] = [...before, ...rules.filter((r) => !(r === '$defaults' && before.includes('$defaults')))];
  }
  return { ...base, autoMode: merged };
}

// The autoMode object in a Claude home's settings.json; {} when there is none or it can't be read. sources: the
// desk's settingSources, if it set them; without 'user' Claude Code never reads that file, so it counts as empty.
export function userAutoMode(home, sources) {
  if (Array.isArray(sources) && !sources.includes('user')) return {};
  try {
    const a = JSON.parse(fs.readFileSync(path.join(home, 'settings.json'), 'utf8'))?.autoMode;
    return a && typeof a === 'object' ? a : {};
  } catch { return {}; }
}
