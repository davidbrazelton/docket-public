// Where a new company's home folders go by default. Kept apart from server.mjs so the tests can try it.
import path from 'node:path';
import { isInside } from './grok-home.mjs';

// Claude homes go as <root>\<Name>\claude-home, beside the ones already set up. With no company home to sit beside (a
// fresh install), the wizard uses <working folder>\Claude; failing that, the root is the person's own user folder, <user>\Docket, never wherever Docket was downloaded
// (C:\Temp, Downloads). docket is Docket's own folder, which a home never goes inside: the page then uses
// <Name>-company instead, and a fresh root that would sit inside it (Docket cloned to <user>\Docket) moves aside.
// Grok and Codex homes go under that same root, <root>\grok_home\<Name> and <root>\codex_home\<Name>, whether or not
// companies exist yet: every company has a Claude home, so a root that moved them once the first company was
// made sent the second company's homes somewhere other than the first's.
export function homeRootsFor(clients, docket, userHome, win = process.platform === 'win32' || process.platform === 'darwin') {
  const beside = clients.map((c) => path.resolve(c.home)).find((h) => path.basename(h).toLowerCase() === 'claude-home' && !isInside(h, docket, win));
  // Only a Grok or Codex home named after its company (<root>\Acme) shows the pattern; one named otherwise is left out.
  const named = (key) => clients.filter((c) => c[key] && path.basename(path.resolve(c[key])).toLowerCase() === c.name.toLowerCase()).map((c) => path.dirname(path.resolve(c[key])))[0];
  const claude = beside ? path.dirname(path.dirname(beside))
    : [path.join(userHome, 'Docket'), path.join(userHome, 'Docket desks')].find((r) => !isInside(r, docket, win)) || path.dirname(docket);
  // fresh: no company home to sit beside, so the wizard puts new homes next to the working folder chosen,
  // <work>\Claude\<Name>\claude-home, and these roots are only its fallback when it has no working folder to go by.
  const grok = named('grokHome'), codex = named('codexHome');
  return { claude, grok: grok || path.join(claude, 'grok_home'), codex: codex || path.join(claude, 'codex_home'), docket, sep: path.sep, fresh: !beside && !grok && !codex };
}
