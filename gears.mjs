// Shift mode's gears: for each brand, its models from cheapest to most capable. A Shift session starts on a
// gear and changes model with the shift_gear tool; every brand's engine can change model mid-session (setModel).
// The Codex and Grok names are the ones their programs listed on 2026-10-28 (Codex's models_cache.json in a Codex
// home, `grok models`); when OpenAI or xAI rename a model, change it here.
export const GEARS = {
  claude: [
    { id: 'claude-haiku-5-5', name: 'Haiku 5.5', key: 'haiku' },
    { id: 'claude-sonnet-5-5', name: 'Sonnet 5.5', key: 'sonnet' },
    { id: 'claude-opus-5-5', name: 'Opus 5.5', key: 'opus' },
  ],
  codex: [
    { id: 'gpt-6-luna', name: 'GPT-6 Luna', key: 'luna' },
    { id: 'gpt-6.1-sol', name: 'GPT-6.1 Sol', key: 'sol' },
    { id: 'gpt-6-astra', name: 'GPT-6 Astra', key: 'astra' },
  ],
  grok: [
    { id: 'grok-4.7-build-fast', name: 'Grok 4.7 Build Fast', key: 'fast' },
    { id: 'grok-4.7', name: 'Grok 4.7', key: 'full' },
  ],
};
// An unknown brand counts as Claude, as everywhere in Docket.
export const gearsOf = (brand) => GEARS[brand] || GEARS.claude;
// A gear of that brand, by its model id or its key (haiku, luna, fast...); undefined if it has none by that name.
export const findGear = (brand, name) => gearsOf(brand).find((g) => g.id === name || g.key === name);
// The gear a new Shift session starts on: the one asked for (start_session's start_gear), else the company's start
// gear for that brand (startGear in clients.local.json), else the top one (#635). Lower gears cannot be trusted to
// decide when to shift up (learned several times), so it is better to spend up front on the top gear, which then
// hands cheaper gears only work it has already worked out.
export const topGearOf = (brand) => gearsOf(brand).at(-1);
export const startGearOf = (brand, asked, companyStart) => findGear(brand, asked) || findGear(brand, companyStart) || topGearOf(brand);
// The gear a child session started by another session starts on: its parent's current model, as a gear of the
// child's brand. Same brand, the same gear; another brand, the gear at the same height counted from the top, so a
// parent on its top gear starts the child on the child's top gear. undefined when the parent's model is no gear
// (the account default), and the child then starts on its company's start gear.
export function parentGear(childBrand, parentBrand, parentModel) {
  const own = findGear(childBrand, parentModel);
  if (own) return own.id;
  const pg = gearsOf(parentBrand), i = pg.findIndex((g) => g.id === parentModel);
  if (i < 0) return undefined;
  const cg = gearsOf(childBrand);
  return cg[Math.max(0, cg.length - (pg.length - i))].id;
}
// The settings a session runs with: a new one given no model is in Shift; one picked up again (resumed, or with saved
// settings) keeps its saved model, the account default ('') included. asked: what was sent, already cleaned.
export function sessionSettings(saved, asked = {}, resumed = false) {
  return { permissionMode: 'bypassPermissions', model: !resumed && !saved ? 'shift' : '', effort: '', ...saved, ...asked };
}
// The gear a session has when it is made: its saved one, else for a Shift session its start gear, else none.
export const firstGear = ({ settings, brand, saved, asked, companyStart }) => saved || (settings?.model === 'shift' ? startGearOf(brand, asked, companyStart).id : null);
// A parent raising its child's gear with send_to_session. rec: the child's record (reportsTo, settings, engine,
// gear); companyStart: its company's start gear for its brand, for one with no gear saved. Returns { refused } (the
// message is not sent), { ignored } (sent, gear left alone: a model the user chose), or { from, gear, same }.
export function raiseGear({ callerId, rec, to, companyStart }) {
  if (!rec || rec.reportsTo !== callerId) return { refused: 'it is not a session you started (only your own child sessions can be raised)' };
  if (rec.settings?.model !== 'shift') return { ignored: 'it is not in Shift mode (its model is chosen by the user), so its gear was left as it is' };
  const gears = gearsOf(rec.engine), gear = findGear(rec.engine, to);
  if (!gear) return { refused: `${to} is not one of its gears: ${gears.map((g) => g.key).join(', ')}` };
  const from = findGear(rec.engine, rec.gear) || startGearOf(rec.engine, null, companyStart);
  if (gears.indexOf(gear) < gears.indexOf(from)) return { refused: `it is on ${from.name}, above ${gear.name}, and a parent can only raise a child's gear` };
  return { from, gear, same: from.id === gear.id };
}
// A company's start gears as saved: { brand: key } for the brands with a gear of that key.
export function cleanStartGear(v) {
  const out = {};
  for (const [brand, key] of Object.entries(v && typeof v === 'object' ? v : {})) if (GEARS[brand] && GEARS[brand].some((g) => g.key === key)) out[brand] = key;
  return out;
}
