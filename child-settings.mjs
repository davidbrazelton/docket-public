// The settings a session started by another session gets: Shift, whatever model its parent uses, so it
// starts on a low gear of its own brand (its company's start gear, or the start_gear asked for) and shifts up when
// the work needs it. The parent's effort is copied when both are on the same brand: an effort means nothing across brands.
// The parent's permission mode is copied too (#1220), except Plan, which would leave the child unable to do its job, and
// Bypass: both leave the child on the desk's default (deskMode), which is Auto once a hook has blocked Bypass there.
export function childSettings(parentSettings, parentBrand, childBrand) {
  const out = { model: 'shift' };
  const mode = parentSettings?.permissionMode;
  if (mode && mode !== 'plan' && mode !== 'bypassPermissions') out.permissionMode = mode;
  if (parentSettings?.effort && (parentBrand || 'claude') === (childBrand || 'claude')) out.effort = parentSettings.effort;
  return out;
}
