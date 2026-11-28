// Claude Code's own interactive commands typed in a Docket chat (#1234). In a terminal, /permissions, /model, /mcp and
// the rest draw a menu and ask more choices there; a Docket session runs without a terminal, so Docket answers them
// itself: it opens its own view for the command, or says in the chat that it only works in a terminal and what to
// use instead. The page (index.html, as /terminal-commands.mjs) and the server (the / pick list) share this table.

// name -> { open, what, remote? } or { instead }.
//   open: what the page opens (index.html termOpen); what: the pick list's line for it.
//   remote: false when that view works only on the computer with the desk (a Remote Desks page then says so).
//   instead: for a command with no Docket view, what to use, said after "only works in a terminal".
const INSPECTOR = { remote: false };
export const TERMINAL_COMMANDS = {
  permissions: { open: 'permissions', what: 'Opens Docket\'s Permissions dialog: the allow, ask and deny rules and the permission mode' },
  'allowed-tools': { same: 'permissions' },
  model: { open: 'model', what: 'Opens the model picker under the message box' },
  effort: { open: 'effort', what: 'Opens the effort picker under the message box' },
  plan: { open: 'mode', what: 'Opens the permission mode picker under the message box (Plan mode is one of its choices)' },
  mcp: { open: 'mcp', what: 'Opens Connected services in the Details panel' },
  todos: { open: 'tasks', what: 'Opens Tasks in the Details panel' },
  tasks: { same: 'todos' },
  bashes: { same: 'todos' },
  config: { open: 'inspector:switches', what: 'Opens the desk\'s Inspector at Switches', ...INSPECTOR },
  settings: { same: 'config' },
  memory: { open: 'inspector:memory', what: 'Opens the desk\'s Inspector at Memory', ...INSPECTOR },
  agents: { open: 'inspector:skills', what: 'Opens the desk\'s Inspector at Skills, commands, agents and plugins', ...INSPECTOR },
  skills: { same: 'agents' },
  plugin: { same: 'agents' },
  plugins: { same: 'agents' },
  marketplace: { open: 'inspector:sources', what: 'Opens the desk\'s Inspector at Plugin sources', ...INSPECTOR },
  hooks: { open: 'inspector:hooks', what: 'Opens the desk\'s Inspector at Hooks', ...INSPECTOR },
  status: { open: 'inspector:', what: 'Opens the desk\'s Inspector', ...INSPECTOR },
  usage: { open: 'usage', what: 'Opens AI Usage (☰ > Gauges)', ...INSPECTOR },
  stats: { same: 'usage' },
  help: { open: 'help', what: 'Opens Docket\'s Instructions (☰ > Help)' },
  resume: { open: 'sessions', what: 'Opens the Sessions list, where every past session is' },
  clear: { instead: 'start a fresh conversation with + New session; this one stays in the list.' },
  reset: { same: 'clear' },
  new: { same: 'clear' },
  exit: { instead: 'nothing needs closing: Docket keeps the session. Archive it from its menu when you are done with it.' },
  quit: { same: 'exit' },
  login: { instead: 'sign in with the brand icon in the top bar.' },
  logout: { same: 'login' },
  theme: { instead: 'pick light or dark under ☰ > Docket settings > Theme.' },
  rename: { instead: 'rename the session from its menu.' },
  ide: { instead: 'open the folder in an editor from the session\'s menu.' },
  rewind: { instead: 'tell the session what to undo in a message.' },
  checkpoint: { same: 'rewind' },
  'add-dir': { instead: 'tell the session which other folder to work in, or start a session in that folder.' },
  'output-style': { instead: 'tell the session how to write in a message, or put it in the desk\'s instructions (Inspector > Instructions).' },
  export: { instead: 'copy what you need from the chat; the whole conversation is saved in the desk\'s Claude home.' },
  copy: { same: 'export' },
  // terminal settings, with nothing like them in a page
  vim: { instead: '' }, 'terminal-setup': { instead: '' }, statusline: { instead: '' }, keybindings: { instead: '' },
  doctor: { instead: '' }, upgrade: { instead: '' }, 'privacy-settings': { instead: '' }, 'install-github-app': { instead: '' },
};
// The ones a session runs itself through the Agent SDK (they answer in the chat): never taken over here.
const SDK_RUNS = new Set(['compact', 'context', 'cost', 'init', 'review', 'security-review', 'pr-comments', 'release-notes']);

// The table's entry for name (a "same" one followed), with its name; null for a command not in the table.
export function termEntry(name) {
  let e = TERMINAL_COMMANDS[name], n = name;
  if (e?.same) { n = e.same; e = TERMINAL_COMMANDS[n]; }
  return e ? { ...e, name: n } : null;
}
// What typing /name does in a Docket chat. own: the session's own skills and commands (the desk's, its plugins'), never
// Claude Code's built-in ones, which it lists too but cannot run without a terminal (sent, /model only reaches the model
// as text). terminal: the ones the session itself marks as needing a terminal. One of its own is sent to it, even one
// named like a menu (a skill called hooks), unless it is marked; a menu in the table, or a marked one, is Docket's.
// Returns null to send it, else { name, open?, what?, remote?, instead? }; instead is '' when Docket knows no other way.
export function termCommand(name, own = [], terminal = []) {
  name = String(name || '').toLowerCase();
  if (!name || SDK_RUNS.has(name)) return null;
  const term = new Set(terminal), runs = new Set(own);
  if (runs.has(name) && !term.has(name)) return null;
  const e = termEntry(name);
  if (e) return e;
  return term.has(name) ? { name, instead: '' } : null;
}
// The pick list's rows for them: every one Docket takes over for this session (own and terminal as for termCommand).
export function termRows(own = [], terminal = []) {
  const out = [];
  for (const n of [...new Set([...Object.keys(TERMINAL_COMMANDS), ...terminal])]) {
    const t = termCommand(n, own, terminal);
    if (t) out.push({ name: n, detail: t.open ? t.what : 'Works only in a terminal; Docket says what to use instead', view: t.open ? 'open' : 'note' });
  }
  return out;
}
// "/name args" -> name, for the message typed; '' for anything else.
export const typedCommand = (text) => (String(text || '').match(/^\/([a-z][\w-]*)(?:\s|$)/i) || [])[1]?.toLowerCase() || '';
// The chat note for a command with no Docket view.
export const termNote = (t) => `/${t.name} is one of Claude Code's terminal menus, so it only works in Claude Code in a terminal (Terminal ▾ opens one in this folder)`
  + (t.instead ? `. Instead, ${t.instead}` : '. Docket has nothing in its place.');

// ---------- /permissions: the rules in settings.json ----------
export const RULE_LISTS = ['allow', 'ask', 'deny'];
// A rule as Claude Code writes it: a tool name (Bash, mcp__server__tool, mcp__server__*), optionally with what it
// applies to in brackets: Bash(npm run test:*), Read(./secrets/**), WebFetch(domain:example.com).
export function ruleError(rule) {
  const r = String(rule ?? '').trim();
  if (!r) return 'Type a rule, such as Bash(npm run test:*) or WebFetch';
  if (r.length > 500) return 'That rule is too long';
  if (/[\r\n]/.test(r)) return 'A rule is one line';
  if (!/^[A-Za-z][\w-]*(\*)?(\(.+\))?$/.test(r)) return 'A rule is a tool name, with what it applies to in brackets if you like: Bash(git status), Edit(src/**), mcp__server__tool';
  return '';
}
