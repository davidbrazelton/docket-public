// The on/off switches on a desk's profile page that each change one setting, never a single hook in a
// settings file: a Claude plugin (enabledPlugins in <home>/settings.json), what Grok takes from Claude
// ([compat.claude] in <grokHome>/config.toml), and which Claude settings layers a session loads (settingSources).
// The file edits touch only the named key and keep the rest of the file as it was.
import fs from 'node:fs';

// ---------- Claude settings layers (the SDK's settingSources) ----------
export const LAYERS = ['user', 'project', 'local'];
// A desk's list as saved: the layers its sessions load, in order, or undefined for all three (Claude Code's default).
export function cleanSettingSources(v) {
  if (!Array.isArray(v)) return undefined;
  const out = LAYERS.filter((l) => v.includes(l));
  return out.length === LAYERS.length ? undefined : out;
}

// ---------- Claude plugins: enabledPlugins in a settings.json ----------
// The members of the JSON object whose { is at text[open]: [{ key, start (of its key), from, to (its value) }], and
// where its } is. The text is already known to be valid JSON.
function members(text, open) {
  const out = [];
  let i = open + 1;
  const ws = () => { while (/\s/.test(text[i])) i++; };
  const str = () => { const s = i++; while (text[i] !== '"') i += text[i] === '\\' ? 2 : 1; i++; return JSON.parse(text.slice(s, i)); };
  const value = () => {
    if (text[i] === '"') return str();
    if (text[i] === '{' || text[i] === '[') {
      let depth = 0;
      do { if (text[i] === '"') { str(); continue; } if ('{['.includes(text[i])) depth++; else if ('}]'.includes(text[i])) depth--; i++; } while (depth);
      return;
    }
    while (i < text.length && !/[\s,}\]]/.test(text[i])) i++;
  };
  for (;;) {
    ws();
    if (text[i] === '}') return { list: out, close: i };
    if (text[i] === ',') { i++; ws(); }
    const start = i, key = str(); ws(); i++; ws();
    const from = i; value();
    out.push({ key, start, from, to: i });
  }
}
// The file's text with enabledPlugins[key] set to on, edited in place: only that one value changes, or one line is
// added, and everything else in the file stays exactly as it was. A missing file becomes one holding only this.
// Throws on a file that is not a JSON settings object, so nothing is written over it.
export function setPluginOn(text, key, on) {
  const val = on ? 'true' : 'false';
  if (!String(text || '').trim()) return JSON.stringify({ enabledPlugins: { [key]: !!on } }, null, 2) + '\n';
  const j = JSON.parse(text);
  if (!j || typeof j !== 'object' || Array.isArray(j)) throw new Error('settings.json does not hold a settings object');
  if (j.enabledPlugins !== undefined && (typeof j.enabledPlugins !== 'object' || Array.isArray(j.enabledPlugins) || j.enabledPlugins === null)) throw new Error('enabledPlugins in settings.json is not a list of plugins');
  const eol = text.includes('\r\n') ? '\r\n' : '\n';
  const lineIndent = (at) => text.slice(text.lastIndexOf('\n', at - 1) + 1, at).match(/^[ \t]*/)[0];
  // An object written over several lines gets a new member on a line of its own, at its last member's indent.
  const multi = (obj) => text.slice(obj.list[0].start, obj.close).includes('\n');
  const after = (obj, member) => { const last = obj.list[obj.list.length - 1];
    return text.slice(0, last.to) + (multi(obj) ? `,${eol}${lineIndent(last.start)}` : ', ') + member + text.slice(last.to); };
  const pair = `${JSON.stringify(key)}: ${val}`;
  const top = members(text, text.indexOf('{'));
  const ep = top.list.find((m) => m.key === 'enabledPlugins');
  let out;
  if (ep) {
    const inner = members(text, ep.from), had = [...inner.list].reverse().find((m) => m.key === key); // the last one counts
    out = had ? text.slice(0, had.from) + val + text.slice(had.to)
      : inner.list.length ? after(inner, pair) : text.slice(0, ep.from) + `{ ${pair} }` + text.slice(inner.close + 1);
  } else if (top.list.length) {
    const ind = lineIndent(top.list[top.list.length - 1].start);
    out = after(top, multi(top) ? `"enabledPlugins": {${eol}${ind}${ind || '  '}${pair}${eol}${ind}}` : `"enabledPlugins": { ${pair} }`);
  } else out = text.slice(0, top.close) + `"enabledPlugins": { ${pair} }` + text.slice(top.close);
  // The edit must read back as the file with just that one change; if not, the whole file is written out instead.
  const want = { ...j, enabledPlugins: { ...(j.enabledPlugins || {}), [key]: !!on } };
  try { if (JSON.stringify(JSON.parse(out)) === JSON.stringify(want)) return out; } catch {}
  const body = JSON.stringify(want, null, (text.match(/\n([ \t]+)"/) || [])[1] || 2).replace(/\n/g, eol);
  return /\r?\n\s*$/.test(text) ? body + eol : body;
}
export function writePluginOn(file, key, on) {
  let text = ''; try { text = fs.readFileSync(file, 'utf8'); } catch (e) { if (e.code !== 'ENOENT') throw e; }
  const bom = text.charCodeAt(0) === 0xFEFF ? text[0] : ''; // kept as it was
  fs.writeFileSync(file, bom + setPluginOn(text.slice(bom.length), key, on));
}

// ---------- Grok: [compat.claude] in config.toml ----------
// What Grok takes from Claude's own setup unless told not to. Unset means Grok's default: it takes it.
export const GROK_COMPAT = ['hooks', 'rules', 'skills', 'agents', 'mcps', 'sessions'];
const HEADER = /^\s*\[\s*([^\]]*?)\s*\]\s*(#.*)?$/;
const keyLine = (key, prefix = '') => new RegExp(`^(\\s*${prefix.replace(/\./g, '\\.')}${key}\\s*=\\s*)([^#\\s]*)(.*)$`);
// Where each line sits: the table it is in ('' before the first header).
function tables(lines) {
  let t = '';
  return lines.map((l) => { const m = l.match(HEADER); if (m) t = /^\s*\[\[/.test(l) ? '[[array]]' : m[1].replace(/["'\s]/g, ''); return t; });
}
// Where a key is set: the line and what comes before the key on it ('[compat.claude] hooks', '[compat] claude.hooks'
// or 'compat.claude.hooks' before any table).
function findKey(lines, at, key) {
  const forms = [['compat.claude', ''], ['compat', 'claude.'], ['', 'compat.claude.']];
  for (const [table, prefix] of forms) {
    const re = keyLine(key, prefix);
    const i = lines.findIndex((l, n) => at[n] === table && !HEADER.test(l) && re.test(l));
    if (i >= 0) return { i, re };
  }
  return null;
}
// Forms this does not edit: compat or compat.claude as an inline table ({ ... }), where a new key would not belong.
function inlineForm(lines, at) {
  return lines.some((l, n) => (at[n] === '' && /^\s*compat(\.claude)?\s*=/.test(l)) || (at[n] === 'compat' && /^\s*claude\s*=/.test(l)));
}
// { hooks: true | false | undefined, ... } as config.toml sets them.
export function readGrokCompat(text) {
  const lines = String(text || '').split(/\r?\n/), at = tables(lines), out = {};
  for (const k of GROK_COMPAT) {
    const f = findKey(lines, at, k);
    const v = f && lines[f.i].match(f.re)[2];
    out[k] = v === 'true' ? true : v === 'false' ? false : undefined;
  }
  return out;
}
// The text with that one key set: its own line edited where it already is, else added at the end of [compat.claude],
// else a new [compat.claude] table at the end of the file. Nothing else changes.
export function setGrokCompat(text, key, on) {
  if (!GROK_COMPAT.includes(key)) throw new Error(`${key} is not one of Grok's [compat.claude] settings`);
  const src = String(text || ''), eol = src.includes('\r\n') ? '\r\n' : '\n';
  const lines = src.split(/\r?\n/), at = tables(lines), val = on ? 'true' : 'false';
  const f = findKey(lines, at, key);
  if (f) { lines[f.i] = lines[f.i].replace(f.re, (_, a, _v, rest) => a + val + rest); return lines.join(eol); }
  if (inlineForm(lines, at)) throw new Error('config.toml sets compat as an inline table; change it there by hand');
  const head = lines.findIndex((l, n) => HEADER.test(l) && at[n] === 'compat.claude');
  if (head >= 0) {
    let last = head; // after the table's last setting, before any blank lines or comments that lead into the next table
    for (let n = head + 1; n < lines.length && at[n] === 'compat.claude' && !HEADER.test(lines[n]); n++) if (lines[n].trim() && !lines[n].trim().startsWith('#')) last = n;
    lines.splice(last + 1, 0, `${key} = ${val}`);
    return lines.join(eol);
  }
  const end = src === '' || /\r?\n$/.test(src) ? src : src + eol;
  return `${end}${end.trim() ? eol : ''}[compat.claude]${eol}${key} = ${val}${eol}`;
}
export function writeGrokCompat(file, key, on) {
  let text = ''; try { text = fs.readFileSync(file, 'utf8'); } catch (e) { if (e.code !== 'ENOENT') throw e; }
  fs.writeFileSync(file, setGrokCompat(text, key, on));
}
