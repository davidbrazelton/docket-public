// The microphone's troubles in plain words (#1224): what a failed getUserMedia means, the short line Talk shows for it,
// and the fix steps the Microphone help dialog lists, in Windows or macOS words. No page or browser here, so
// test/talk-mic.test.mjs tries every kind on any computer; talk.mjs runs the checks in the page (the browser may be on
// another computer, reached through Remote Desks) and draws the dialog.

// The audio Talk asks for: the picked microphone as `ideal`, so one that is gone falls back to the default instead
// of failing.
export const micAudio = (deviceId = '') => ({ channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true, ...(deviceId ? { deviceId: { ideal: deviceId } } : {}) });

// The kind of a failure, from the error (or its absence) and the page: insecure, nomedia, notfound, blocked, system
// (blocked by the computer's own settings), busy, gone (the picked one, when asked for exactly), other.
export function micKind(err, { secure = true, hasMedia = true } = {}) {
  if (!secure) return 'insecure';
  if (!hasMedia) return 'nomedia';
  const name = err?.name || '', msg = String(err?.message || '');
  if (name === 'NotFoundError' || name === 'DevicesNotFoundError') return 'notfound';
  if (name === 'NotAllowedError' || name === 'PermissionDeniedError' || name === 'SecurityError') return /system/i.test(msg) ? 'system' : 'blocked';
  if (name === 'NotReadableError' || name === 'TrackStartError' || name === 'AbortError') return 'busy';
  if (name === 'OverconstrainedError' || name === 'ConstraintNotSatisfiedError') return 'gone';
  return 'other';
}

// Talk's line for each kind, short: the Microphone help link beside it says the rest.
export function micLine(kind, err) {
  return {
    insecure: 'The microphone works only on a secure page: open Docket at https:// or at localhost.',
    nomedia: 'This browser gives this page no microphone. Use a current Chrome, Edge or Safari.',
    notfound: 'The browser finds no microphone on this computer. Plug one in, or check it is turned on.',
    blocked: 'The microphone is blocked for this page. Allow it at the left of the address bar, then hold the key again.',
    system: 'The computer\'s privacy settings keep the browser from the microphone.',
    busy: 'The microphone would not start: another app may be using it.',
    gone: 'The microphone picked for Talk is not connected.',
  }[kind] || `The microphone did not start${err?.message ? `: ${err.message}` : ''}.`;
}

// A microphone that looks like a Bluetooth headset or speakerphone, by the name the browser gives it (#1228).
export const isBluetooth = (label) => /bluetooth|hands-?free|headset|airpods|buds\b|jabra|\bbose\b|soundcore|\bwh-|\bwf-|speakerphone/i.test(String(label || ''));
export const BLUETOOTH_NOTE = 'This microphone looks like a Bluetooth one. Many give their microphone to one connected computer at a time, so a second computer listening to it may hear nothing, and while it is open the sound drops to call quality.';
// What the help dialog's checks found, for its list: [{ ok: true|false|null, text }] (null: not known). using: the
// name of the microphone the test recording opened.
export function micChecks({ secure, hasMedia, permission, inputs, kind, level, using = '' }) {
  const named = inputs?.filter((d) => d.label) || [];
  return [
    { ok: !!secure, text: secure ? 'The page is secure, so the browser may offer the microphone.' : 'The page is not secure (plain http on another address), so the browser offers no microphone.' },
    ...(secure ? [{ ok: !!hasMedia, text: hasMedia ? 'The browser can reach microphones.' : 'This browser has no microphone support for pages.' }] : []),
    ...(hasMedia ? [{ ok: permission === 'denied' ? false : permission === 'granted' ? true : null,
      text: permission === 'granted' ? 'This page may use the microphone.' : permission === 'denied' ? 'The microphone is blocked for this page in the browser.' : 'The browser will ask before this page uses the microphone.' }] : []),
    ...(hasMedia && inputs ? [{ ok: inputs.length > 0, text: !inputs.length ? 'The browser sees no microphone at all.'
      : named.length ? `Microphones the browser sees: ${named.map((d) => d.label).join(', ')}.` : `The browser sees ${inputs.length === 1 ? 'one microphone' : `${inputs.length} microphones`}; their names show once the page may use one.` }] : []),
    ...(hasMedia && kind !== undefined ? [{ ok: kind === null, text: kind === null ? `A test recording started${using ? ` with ${using}` : ''}${level > 0.02 ? ' and hears sound' : '; speak to see the level move'}.` : `A test recording did not start: ${micLine(kind)}` }] : []),
    ...(kind === null && isBluetooth(using) ? [{ ok: null, text: BLUETOOTH_NOTE }] : []),
  ];
}

// The OS settings pages a button can open (the browser asks first): Windows' ms-settings: pages, macOS's System
// Settings panes.
export const OPEN = {
  win: { privacy: ['Open Microphone privacy settings', 'ms-settings:privacy-microphone'], sound: ['Open Sound settings', 'ms-settings:sound'] },
  mac: { privacy: ['Open Microphone privacy settings', 'x-apple.systempreferences:com.apple.preference.security?Privacy_Microphone'], sound: ['Open Sound settings', 'x-apple.systempreferences:com.apple.preference.sound?input'] },
};

// The fix steps for a kind, in this computer's words: [{ text, open?: [label, href] }].
export function micSteps(kind, { mac = false, permission = '' } = {}) {
  const o = OPEN[mac ? 'mac' : 'win'];
  const sound = mac ? { text: 'In System Settings > Sound > Input, check a microphone is listed and its level moves when you speak.', open: o.sound }
    : { text: 'In Settings > System > Sound > Input, check a microphone is listed and not turned off (under All sound devices, choose it and Allow).', open: o.sound };
  const privacy = mac ? { text: 'In System Settings > Privacy & Security > Microphone, turn on your browser, then quit and reopen the browser.', open: o.privacy }
    : { text: 'In Settings > Privacy & security > Microphone, turn on Microphone access and Let desktop apps access your microphone. Chrome and Edge report "no microphone" while these are off.', open: o.privacy };
  const site = { text: 'At the left of the address bar, click the icon, set Microphone to Allow, and reload the page if the browser asks.' };
  const again = { text: 'Then press Try again.' };
  switch (kind) {
    case 'insecure': return [{ text: 'Browsers give the microphone only to secure pages. Open Docket on its own computer at http://localhost, or at an https:// address; a plain http:// address of another computer cannot use one.' }];
    case 'nomedia': return [{ text: 'Open Docket in a current Chrome, Edge or Safari; this browser does not let pages use a microphone.' }];
    case 'notfound': return [
      { text: mac ? 'Plug in a microphone or headset. A Mac mini, or a laptop closed on a dock, has none of its own.' : 'Plug in a microphone or headset. A laptop closed on a dock, or a desktop, may have none of its own.' },
      sound, privacy,
      ...(mac ? [] : [{ text: 'In Device Manager > Audio inputs and outputs, enable the microphone if it shows as disabled.' },
        { text: 'Using this computer through Remote Desktop? Turn on its microphone: Remote Desktop Connection > Local Resources > Remote audio settings > Record from this computer.' }]),
      again];
    case 'blocked': return [site, ...(permission === 'denied' ? [] : [privacy]), again];
    case 'system': return [privacy, again];
    case 'busy': return [
      { text: mac ? 'Close other apps using the microphone (a call in Zoom or Teams, another browser tab). The orange dot at the top of the screen shows one is on.' : 'Close other apps using the microphone (a call in Teams or Zoom, another browser tab). Settings > Privacy & security > Microphone lists the apps that used it recently.', open: o.privacy },
      { text: 'Unplug the microphone or headset and plug it in again.' }, sound, again];
    case null: return [{ text: 'Check the right microphone is picked above, and that it is not muted (a switch on a headset, or the volume in Sound settings).', open: o.sound }];
    case 'gone': return [{ text: 'Pick another microphone above, or Default, then press Try again.' }];
    default: return [sound, privacy, site, again];
  }
}
