/** Tiny tactile feedback: a soft click and a light vibration on taps.
 *
 *  Sounds are synthesised with Web Audio (a few milliseconds of filtered noise
 *  or a short tone), so there are no files to load and nothing to cache. The
 *  audio context starts on the first tap, as browsers require.
 *
 *  Haptics: Android browsers have navigator.vibrate. iPhone Safari doesn't, but
 *  since iOS 18 toggling a native `<input type="checkbox" switch>` plays the
 *  system haptic, so a hidden one is clicked through its label inside the same
 *  user gesture. Desktops simply get the sound.
 *
 *  Whether either runs is set by `configureFeedback` (Settings → Appearance). */

export type Cue = "tap" | "soft" | "toggle" | "success" | "error";

let sound = true;
let haptics = true;

export function configureFeedback(opts: { sound: boolean; haptics: boolean }) {
  sound = opts.sound;
  haptics = opts.haptics;
}

let ctx: AudioContext | null = null;
let noise: AudioBuffer | null = null;

function audio(): AudioContext | null {
  if (typeof window === "undefined") return null;
  if (!ctx) {
    const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();
    // 40ms of white noise, reused for every click.
    noise = ctx.createBuffer(1, Math.ceil(ctx.sampleRate * 0.04), ctx.sampleRate);
    const data = noise.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
  }
  if (ctx.state === "suspended") void ctx.resume();
  return ctx;
}

/** A short filtered noise burst: the "tick". */
function click(ac: AudioContext, at: number, freq: number, gain: number, length = 0.018) {
  if (!noise) return;
  const src = ac.createBufferSource();
  src.buffer = noise;
  const band = ac.createBiquadFilter();
  band.type = "bandpass";
  band.frequency.value = freq;
  band.Q.value = 1.4;
  const g = ac.createGain();
  g.gain.setValueAtTime(gain, at);
  g.gain.exponentialRampToValueAtTime(0.0001, at + length);
  src.connect(band).connect(g).connect(ac.destination);
  src.start(at);
  src.stop(at + length + 0.01);
}

/** A soft sine blip, for the success and error cues. */
function blip(ac: AudioContext, at: number, from: number, to: number, gain: number, length = 0.07) {
  const osc = ac.createOscillator();
  osc.type = "sine";
  osc.frequency.setValueAtTime(from, at);
  osc.frequency.exponentialRampToValueAtTime(to, at + length);
  const g = ac.createGain();
  g.gain.setValueAtTime(0.0001, at);
  g.gain.exponentialRampToValueAtTime(gain, at + 0.008);
  g.gain.exponentialRampToValueAtTime(0.0001, at + length);
  osc.connect(g).connect(ac.destination);
  osc.start(at);
  osc.stop(at + length + 0.02);
}

function play(cue: Cue) {
  const ac = audio();
  if (!ac) return;
  const t = ac.currentTime + 0.002;
  if (cue === "tap") click(ac, t, 3200, 0.16);
  else if (cue === "soft") click(ac, t, 2600, 0.07, 0.012);
  else if (cue === "toggle") {
    click(ac, t, 2400, 0.14);
    click(ac, t + 0.045, 3600, 0.1);
  } else if (cue === "success") {
    blip(ac, t, 880, 1180, 0.05);
    blip(ac, t + 0.07, 1180, 1480, 0.045);
  } else blip(ac, t, 300, 210, 0.07, 0.12);
}

let iosSwitch: HTMLLabelElement | null = null;

/** The hidden native switch whose toggle plays iOS's haptic. */
function iosHaptic() {
  if (!iosSwitch) {
    const label = document.createElement("label");
    label.setAttribute("aria-hidden", "true");
    label.dataset.noFeedback = ""; // its own click mustn't play a cue (and loop)
    label.style.cssText = "position:fixed;width:1px;height:1px;opacity:0;pointer-events:none;overflow:hidden;left:-9px;top:-9px";
    const input = document.createElement("input");
    input.type = "checkbox";
    input.setAttribute("switch", "");
    input.tabIndex = -1;
    label.appendChild(input);
    document.body.appendChild(label);
    iosSwitch = label;
  }
  iosSwitch.click();
}

const PATTERN: Record<Cue, number | number[]> = {
  tap: 6,
  soft: 3,
  toggle: 10,
  success: [8, 40, 8],
  error: [18, 50, 18],
};

let last = 0;

/** Play a cue. Taps closer than 40ms apart are merged, so a click that also
 *  fires a programmatic click doesn't stutter. */
export function feedback(cue: Cue = "tap") {
  if (typeof window === "undefined") return;
  const now = performance.now();
  if ((cue === "tap" || cue === "soft") && now - last < 40) return;
  last = now;
  if (sound) {
    try {
      play(cue);
    } catch {
      /* audio unavailable: silent */
    }
  }
  if (haptics) {
    if (typeof navigator.vibrate === "function") navigator.vibrate(PATTERN[cue]);
    else if (/iP(hone|ad|od)/.test(navigator.userAgent) || (navigator.maxTouchPoints > 1 && /Mac/.test(navigator.userAgent))) {
      try {
        iosHaptic();
      } catch {
        /* no haptics here */
      }
    }
  }
}

/** Which cue a click on this element should play, or null for none.
 *  Controls get their own cue; anything else that acts like one (a file row,
 *  a card) taps; a click anywhere else on the page gets a softer tick, so
 *  every click answers. */
export function cueFor(target: EventTarget | null): Cue | null {
  if (!(target instanceof Element)) return null;
  if (target.closest("[data-no-feedback]")) return null;
  const el = target.closest(
    'button, a[href], [role="switch"], [role="tab"], [role="radio"], [role="menuitem"], [role="menuitemradio"], [role="option"], [role="checkbox"], input[type="checkbox"], input[type="radio"], summary, label',
  );
  if (el) {
    if (el instanceof HTMLButtonElement && el.disabled) return null;
    if (el.getAttribute("aria-disabled") === "true") return null;
    const role = el.getAttribute("role");
    const type = (el as HTMLInputElement).type;
    if (role === "switch" || role === "radio" || role === "tab" || role === "menuitemradio" || type === "checkbox" || type === "radio")
      return "toggle";
    // A label just forwards to its control, which plays its own cue.
    if (el.tagName === "LABEL" && el.querySelector("input,button")) return null;
    return "tap";
  }
  // Clickable rows and cards are divs with handlers, marked the way the
  // cursor reads them (`cursor-pointer`, a button or link role).
  if (target.closest('.cursor-pointer, [role="button"], [role="link"]')) return "tap";
  return "soft";
}
