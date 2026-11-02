// Whether a home folder the setup wizard is about to give a new company already holds a setup: a name like
// Acme lands on <work>\Claude\Acme\claude-home, which may be the signed-in folder someone has used for months.
// Cheap checks only: which sign-in files are there, and how many saved sessions (counted, never read).
import fs from 'node:fs';
import path from 'node:path';

const has = (dir, name) => { try { fs.statSync(path.join(dir, name)); return true; } catch { return false; } };
const list = (dir) => { try { return fs.readdirSync(dir, { withFileTypes: true }); } catch { return []; } };
const json = (file, max = 20e6) => { try { return fs.statSync(file).size <= max ? JSON.parse(fs.readFileSync(file, 'utf8')) : null; } catch { return null; } };
// Files ending in .jsonl down to depth levels below dir (Codex keeps sessions under year\month\day).
function countJsonl(dir, depth) {
  let n = 0;
  for (const d of list(dir)) {
    if (d.isFile() && d.name.endsWith('.jsonl')) n++;
    else if (d.isDirectory() && depth > 1) n += countJsonl(path.join(dir, d.name), depth - 1);
  }
  return n;
}

// What a brand's setup in dir holds: null when it holds none (missing, empty, or only unrelated files), otherwise
// { signedIn, email, sessions }. email is '' when the files don't say.
export function homeInUse(dir, engine = 'claude') {
  if (!dir || !fs.existsSync(dir)) return null;
  if (engine === 'claude') {
    const creds = has(dir, '.credentials.json'), conf = has(dir, '.claude.json'), projects = has(dir, 'projects');
    if (!creds && !conf && !projects) return null;
    const acct = conf ? json(path.join(dir, '.claude.json'))?.oauthAccount : null;
    const sessions = list(path.join(dir, 'projects')).filter((d) => d.isDirectory()).reduce((n, d) => n + countJsonl(path.join(dir, 'projects', d.name), 1), 0);
    return { signedIn: creds || !!acct, email: acct?.emailAddress || '', sessions };
  }
  if (engine === 'codex') {
    const auth = has(dir, 'auth.json'), sessionsDir = has(dir, 'sessions');
    if (!auth && !sessionsDir && !has(dir, 'config.toml')) return null;
    let email = '';
    try { const t = json(path.join(dir, 'auth.json'))?.tokens?.id_token; email = JSON.parse(Buffer.from(t.split('.')[1], 'base64url').toString('utf8')).email || ''; } catch {}
    return { signedIn: auth, email, sessions: countJsonl(path.join(dir, 'sessions'), 4) + countJsonl(path.join(dir, 'archived_sessions'), 1) };
  }
  if (engine === 'grok') {
    const auth = has(dir, 'auth.json'), sessionsDir = has(dir, 'sessions');
    if (!auth && !sessionsDir) return null;
    const a = Object.values(json(path.join(dir, 'auth.json')) || {})[0] || {};
    // Grok keeps one folder per session, under one folder per working folder.
    const sessions = list(path.join(dir, 'sessions')).filter((d) => d.isDirectory())
      .reduce((n, d) => n + list(path.join(dir, 'sessions', d.name)).filter((s) => s.isDirectory()).length, 0);
    return { signedIn: auth, email: typeof a.email === 'string' ? a.email : '', sessions };
  }
  return null;
}

// The nearest free folder beside home: <root>\Acme\claude-home becomes <root>\Acme-2\claude-home (the company folder
// takes the number, so the home keeps its name), <root>\grok_home\Acme becomes <root>\grok_home\Acme-2. Free means it
// does not exist and is not in taken (lower-cased full paths of the homes other companies use).
export function freeHome(home, taken = [], exists = fs.existsSync) {
  const p = path.resolve(home);
  const nested = path.basename(p).toLowerCase() === 'claude-home';
  const named = nested ? path.dirname(p) : p;
  const base = path.basename(named).replace(/-\d+$/, ''), parent = path.dirname(named);
  for (let n = 2; n < 1000; n++) {
    const dir = path.join(parent, `${base}-${n}`), cand = nested ? path.join(dir, path.basename(p)) : dir;
    if (!exists(dir) && !taken.includes(cand.toLowerCase())) return cand;
  }
  return null;
}
