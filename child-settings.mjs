// The settings a session started by another session gets: Shift, whatever model its parent uses, so it
// starts on a low gear of its own brand (its company's start gear, or the start_gear asked for) and shifts up when
// the work needs it. The parent's effort is copied when both are on the same brand: an effort means nothing across brands.
// The permission mode is not copied; a child starts on Docket's default like any new session.
export function childSettings(parentSettings, parentBrand, childBrand) {
  const out = { model: 'shift' };
  if (parentSettings?.effort && (parentBrand || 'claude') === (childBrand || 'claude')) out.effort = parentSettings.effort;
  return out;
}
