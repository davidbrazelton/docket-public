// The speakers' troubles in plain words (#1226): what the Speakers part of Sound and microphone help found, and the
// "Can't hear it?" steps, in Windows or macOS words. Read aloud can look busy and still be silent (the tab or the
// browser muted, the default output a dock or monitor with no speakers, the volume at zero), so the dialog plays a test
// tone and tells "Docket is not speaking" from "the computer is not playing sound". No page or browser here, so
// test/talk-sound.test.mjs tries it on any computer; talk.mjs runs the checks in the page and draws the part.

// Chrome's stand-ins for the OS's own picks, not devices of their own.
export const virtualDevice = (d) => d.deviceId === 'default' || d.deviceId === 'communications';

// The output to send sound to: the one picked before while the browser still lists it, else '' (the default). outputs
// null: the browser does not list outputs (Safari), so the pick is kept.
export function sinkFor(want, outputs) {
  if (!want) return '';
  if (!outputs) return want;
  return outputs.some((d) => d.deviceId === want) ? want : '';
}

// The checks, for the list: [{ ok: true|false|null, text }] (null: not known, or only to note).
// hasAudio: the page can make sound (Web Audio). state: the AudioContext's state ('' when none is made yet). outputs:
// the audio outputs the browser lists (null when it lists none at all). canPick: the browser can send this page's
// sound to a chosen output. sink: the output picked ('' the default). system: Read aloud uses this computer's own voice
// (speechSynthesis), which plays through the default output whatever is picked. played: the test tone or sample's outcome, if one ran:
// 'played' | 'blocked' (the browser refused to play) | 'failed'.
export function soundChecks({ hasAudio, state, outputs, canPick, sink = '', system = false, played } = {}) {
  if (!hasAudio) return [{ ok: false, text: 'This browser gives this page no way to play sound. Use a current Chrome, Edge or Safari.' }];
  const real = outputs?.filter((d) => !virtualDevice(d)) || null, named = real?.filter((d) => d.label) || [];
  const picked = sink && real?.find((d) => d.deviceId === sink);
  return [
    { ok: state === 'running' ? true : state === 'suspended' ? false : null,
      text: state === 'running' ? 'The browser lets this page play sound.'
        : state === 'suspended' ? 'The browser has not let this page play sound yet. Press Play test tone: browsers keep a page silent until you press something on it.'
        : state === 'closed' ? 'This page\'s sound was shut. Reload the page.' : 'Nothing has played on this page yet: press Play test tone.' },
    ...(real ? [{ ok: real.length ? true : false, text: !real.length ? 'The browser lists no speakers or headphones on this computer.'
      : named.length ? `Outputs the browser sees: ${named.map((d) => d.label).join(', ')}.`
      : `The browser sees ${real.length === 1 ? 'one output' : `${real.length} outputs`}; their names show once this page may use the microphone.` }]
      : [{ ok: null, text: 'This browser does not list the computer\'s outputs, so sound goes to the computer\'s default output.' }]),
    ...(canPick || !real ? [] : [{ ok: null, text: 'This browser cannot send a page\'s sound to a chosen output: change the computer\'s default output instead.' }]),
    ...(sink && real && !picked ? [{ ok: null, text: 'The output picked before is not connected, so sound goes to the default.' }] : []),
    ...(system ? [{ ok: null, text: `Read aloud uses this computer's own voice, which the browser always plays through the computer's default output${sink ? ', not the one picked here' : ''}. Pick a natural voice in 🎙▾ to use the output picked here.` }] : []),
    ...(played === 'played' ? [{ ok: true, text: `The browser played it${picked ? ` to ${picked.label || 'the output picked'}` : sink ? '' : ' to the default output'}. Heard nothing? Then the computer is not passing it on: see below.` }]
      : played === 'blocked' ? [{ ok: false, text: 'The browser would not play it. Press Play test tone again; if it still says this, allow sound for this site (the icon at the left of the address bar > Sound > Allow).' }]
      : played === 'failed' ? [{ ok: false, text: 'It would not play: the output picked may have just gone. Pick Default and try again.' }] : []),
  ];
}

// The OS settings pages a button can open (the browser asks first): Windows' ms-settings: pages, macOS's Sound pane.
export const OPEN = {
  win: { mixer: ['Open Volume mixer', 'ms-settings:apps-volume'], sound: ['Open Sound settings', 'ms-settings:sound'] },
  mac: { sound: ['Open Sound settings', 'x-apple.systempreferences:com.apple.preference.sound?output'] },
};

// "Can't hear it?": the things to check, in this computer's words, most likely first: [{ text, open?: [label, href] }].
export function soundSteps({ mac = false, state = '', system = false } = {}) {
  const o = OPEN[mac ? 'mac' : 'win'];
  return [
    ...(state === 'suspended' ? [{ text: 'Press Play test tone: the browser keeps a page silent until it is pressed.' }] : []),
    { text: mac ? 'Is the tab muted? In Chrome or Edge, right-click the Docket tab: if it says Unmute site, choose it. In Safari, a crossed-out speaker in the tab or the address bar is muted: click it.'
      : 'Is the tab muted? Right-click the Docket tab: if it says Unmute site (Unmute tab in Edge), choose it.' },
    ...(mac ? [] : [{ text: 'Is the browser muted? In Settings > System > Sound > Volume mixer, check your browser is listed, not muted, and not at zero.', open: o.mixer }]),
    mac ? { text: 'Is sound going somewhere else? In System Settings > Sound > Output, choose the speakers or headphones you listen on, and check Output volume and Mute. A monitor or dock can be chosen even when it has no speakers.', open: o.sound }
      : { text: 'Is sound going somewhere else? In Settings > System > Sound > Output, choose the speakers or headset you listen on. A monitor, dock or unplugged headset can be the choice even when it has no speakers. Under All sound devices, check yours is Allowed.', open: o.sound },
    { text: mac ? 'Is the volume up? Use the volume keys or the Sound control in the menu bar, and check Bluetooth headphones are connected to this Mac.'
      : 'Is the volume up? Use the speaker icon in the taskbar or the volume keys, and check the speakers or headset are turned on and plugged in.' },
    ...(mac ? [] : [{ text: 'Using this computer through Remote Desktop? Its sound plays where you sit only with Remote Desktop Connection > Local Resources > Remote audio settings > Play on this computer.' }]),
    ...(system ? [{ text: 'Read aloud with this computer\'s own voice? It plays through the default output, so set that output in Sound settings, or pick a natural voice in 🎙▾.' }] : []),
    { text: 'Then press Play test tone again.' },
  ];
}

// Keeping the speakers awake while Read aloud talks (#1250). After 30 s of silence (samples all zero) Chrome pauses the
// page's audio output and starts it again only when sound comes, and Bluetooth headsets, USB speakers and monitors
// mute themselves after a short silence too: either way the first sound after quiet is lost while the output wakes,
// and with gaps between sentences (the natural voice making the next one) words partway through come out cut. So
// while it reads, a hiss far too quiet to hear (about -70 dB) plays under it, from LEAD_MS before the first sound until
// TAIL_MS after the last, gaps included.
export const WAKE = { leadMs: 400, tailMs: 5000, level: 3e-4 };
// The hiss, one second at rate: never a zero sample, never above level. Seeded, so it is the same each time.
export function wakeNoise(rate, level = WAKE.level) {
  const out = new Float32Array(Math.max(1, Math.round(rate)));
  let s = 0x2545f491;
  for (let i = 0; i < out.length; i++) {
    s ^= s << 13; s ^= s >>> 17; s ^= s << 5;
    const r = (s >>> 0) / 4294967296; // 0..1
    out[i] = (r < 0.5 ? -1 : 1) * level * (0.5 + Math.abs(r - 0.5));
  }
  return out;
}
// How long the first sound still has to wait for the output to wake: awakeAt is when the hiss began (0: not playing).
export const leadLeft = (awakeAt, now, lead = WAKE.leadMs) => (awakeAt ? Math.max(0, Math.round(awakeAt + lead - now)) : lead);
