// claude.ai connectors on and off per desk (#1189). A desk hides a connector, or some of its tools, with lines in
// permissions.deny of <home>/settings.json: a whole server by its prefix (mcp__claude_ai_<Server>), one tool by its full
// name (mcp__claude_ai_<Server>__<tool>). Claude Code takes a deny change in while it runs, within seconds and in the
// same turn, so no session restarts for it (config-watch.mjs counts permissions as live).
// Which tools a connector has is known only from sessions that had them: Docket keeps every claude.ai tool name it has
// seen per desk (the catalog), since a hidden tool is missing from every later session's list.
import { mcpName } from './setup-size.mjs';

export const PREFIX = 'mcp__claude_ai_';
// A connector's key, as it shows in its tool names: "claude.ai Google Drive" or "Google Drive" -> Google_Drive.
export const serverKey = (name) => mcpName(String(name).replace(/^claude\.ai\s+/i, '').trim());
export const serverLine = (key) => PREFIX + key;
// The name to show for a key: Google_Drive -> Google Drive.
export const serverName = (key) => key.replace(/_/g, ' ');
// The connector a tool name belongs to, or null for a name that is not a claude.ai tool.
export function serverOf(name) {
  if (typeof name !== 'string' || !name.startsWith(PREFIX)) return null;
  const rest = name.slice(PREFIX.length), i = rest.indexOf('__');
  return i < 0 ? rest : rest.slice(0, i);
}
// The tool's own name: mcp__claude_ai_Slack__slack_send_message -> slack_send_message.
export const toolShort = (name) => name.slice(PREFIX.length + serverOf(name).length + 2);

// What a deny list hides: { servers: Set of keys, tools: Set of full names }. mcp__claude_ai_X and mcp__claude_ai_X__*
// both hide the whole server.
export function hiddenOf(deny) {
  const servers = new Set(), tools = new Set();
  for (const e of Array.isArray(deny) ? deny : []) {
    const key = serverOf(e);
    if (!key) continue;
    const rest = e.slice(PREFIX.length + key.length);
    if (!rest || rest === '__*') servers.add(key); else tools.add(e);
  }
  return { servers, tools };
}
const isServerLine = (e, key) => e === serverLine(key) || e === `${serverLine(key)}__*`;

// Adds tool names to a desk's catalog ({ [key]: [names] }, edited in place). Returns the names that were new.
export function learnTools(catalog, names) {
  const added = [];
  for (const n of names || []) {
    const key = serverOf(n);
    if (!key || n.length <= PREFIX.length + key.length + 2) continue;
    const list = (catalog[key] ||= []);
    if (!list.includes(n)) { list.push(n); list.sort(); added.push(n); }
  }
  return added;
}

// Every connector the desk knows of, with what is on: [{ key, name, on, tools: [{ name, short, on }] }], by name.
// catalog: the tools seen; connected: connector names from the account file (claudeAiMcpEverConnected).
export function connectorList({ deny = [], catalog = {}, connected = [] } = {}) {
  const hid = hiddenOf(deny), keys = new Set([...Object.keys(catalog), ...connected.map(serverKey), ...hid.servers]);
  for (const t of hid.tools) keys.add(serverOf(t));
  return [...keys].filter(Boolean).sort((a, b) => a.localeCompare(b)).map((key) => {
    const names = [...new Set([...(catalog[key] || []), ...[...hid.tools].filter((t) => serverOf(t) === key)])].sort();
    return { key, name: serverName(key), on: !hid.servers.has(key), tools: names.map((n) => ({ name: n, short: toolShort(n), on: !hid.tools.has(n) })) };
  });
}

// Finds a connector by what a person or session calls it ("Google Calendar", "google_calendar", "claude.ai Slack").
export function findConnector(list, name) {
  const want = serverKey(name).toLowerCase();
  return list.find((c) => c.key.toLowerCase() === want) || null;
}
// Finds a tool of a connector by its full or short name.
export function findTool(conn, name) {
  const n = String(name || '').trim().toLowerCase();
  return conn?.tools.find((t) => t.name.toLowerCase() === n || t.short.toLowerCase() === n) || null;
}

// The deny list after one switch: { deny, did } (did: a sentence for what changed, or '' when nothing did).
// A connector switch is its prefix line only, so the tool lines under it are kept for when it comes back on. Turning
// on one tool of a hidden connector brings the connector back with its other known tools hidden one by one, so only
// that tool appears.
export function switchDeny(deny, { conn, tool, on }) {
  const list = [...(Array.isArray(deny) ? deny : [])], name = conn.name;
  if (!tool) {
    if (on) {
      const out = list.filter((e) => !isServerLine(e, conn.key));
      return { deny: out, did: out.length === list.length ? '' : `Turned on ${name}${conn.tools.some((t) => !t.on) ? ` (${conn.tools.filter((t) => !t.on).length} of its tools stay hidden one by one)` : ''}.` };
    }
    if (!conn.on) return { deny: list, did: '' };
    return { deny: [...list, serverLine(conn.key)], did: `Turned off ${name}.` };
  }
  if (!on) {
    if (!tool.on || !conn.on) return { deny: list, did: '' };
    return { deny: [...list, tool.name], did: `Turned off ${tool.short} (${name}).` };
  }
  let out = list.filter((e) => e !== tool.name);
  if (!conn.on) {
    out = out.filter((e) => !isServerLine(e, conn.key));
    const others = conn.tools.filter((t) => t.name !== tool.name && t.on).map((t) => t.name);
    out.push(...others);
    return { deny: out, did: `Turned on ${tool.short}: ${name} was hidden, so it is back with ${others.length ? `its other ${others.length} known tools still hidden` : 'all of its tools, since Docket knows no others of it'}.` };
  }
  return { deny: out, did: out.length === list.length ? '' : `Turned on ${tool.short} (${name}).` };
}

// ---------- the default for a new desk ----------
// A new desk starts with the claude.ai tools that send, change or delete hidden; search, read, get and list stay on.
// A tool's name is split into words; any changing word hides it, else a reading word keeps it on, and a name with
// neither is hidden (unsure means hidden).
export const CHANGING = ['send', 'create', 'update', 'delete', 'trash', 'untrash', 'forward', 'reply', 'label', 'unlabel', 'mark', 'unmark',
  'schedule', 'upload', 'add', 'respond', 'share', 'edit', 'remove', 'move', 'copy', 'rename', 'set', 'write', 'post', 'invite', 'archive',
  'approve', 'cancel', 'submit', 'publish', 'apply', 'insert', 'append', 'modify', 'patch', 'put', 'save', 'import', 'assign', 'certify', 'uncertify',
  'comment', 'react', 'reaction', 'pin', 'unpin', 'complete', 'close', 'merge', 'transfer', 'pay', 'book', 'accept', 'decline', 'join', 'leave'];
export const READING = ['search', 'read', 'get', 'list', 'fetch', 'find', 'query', 'view', 'lookup', 'describe'];
const words = (short) => short.replace(/([a-z])([A-Z])/g, '$1_$2').toLowerCase().split(/[^a-z]+/).filter(Boolean);
export function changes(short) {
  const w = words(short);
  if (w.some((x) => CHANGING.includes(x))) return true;
  return !w.some((x) => READING.includes(x));
}
// The deny lines the default adds for these tool names (full names): the changing ones not already hidden.
export function defaultDeny(deny, names) {
  const hid = hiddenOf(deny);
  return names.filter((n) => serverOf(n) && !hid.servers.has(serverOf(n)) && !hid.tools.has(n) && changes(toolShort(n)));
}

// The line in a session's rules on a desk that hides connectors, or '' when it hides none.
export function hiddenRule(deny) {
  const hid = hiddenOf(deny);
  const by = new Map();
  for (const t of hid.tools) { const k = serverOf(t); if (!hid.servers.has(k)) by.set(k, (by.get(k) || 0) + 1); }
  const parts = [...[...hid.servers].map((k) => `${serverName(k)} (all of it)`), ...[...by].map(([k, n]) => `${n} ${serverName(k)} tool${n === 1 ? '' : 's'}`)];
  if (!parts.length) return '';
  return `This desk hides some claude.ai connector tools on purpose, to keep each session's start small: ${parts.join(', ')}. A tool missing for that reason is off, not broken: when the user asks for it or their task needs it, turn it on with mcp__portal__connectors and say which you turned on.`;
}
