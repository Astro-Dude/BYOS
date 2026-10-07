"use client";

import { useEffect, useMemo, useRef, useState } from "react";

import { DISABLED, NativeCursor, POINTER, TEXT } from "@/components/cursor-native";
import {
  type CursorColor,
  type CursorDesign,
  type CursorSizeName,
  type CursorState,
  cursorSvg,
  SIZE_PX,
} from "@/lib/cursor-design";
import { usePreferences } from "@/lib/preferences";

/**
 * The app's cursor. The designs live in lib/cursor-design.ts; this picks how to
 * show the chosen one.
 *
 * By default the operating system draws it (see cursor-native.tsx), so it moves
 * at exactly system speed. With "Live motion" on, the page draws it instead so
 * it can move: it tilts in 3D with your speed, presses in when you click, and
 * shakes when you click something disabled. A page-drawn cursor trails the mouse
 * by a frame or two, which is why that's opt-in.
 *
 * Fine pointers only: touch devices keep their native behaviour.
 */

const FINE_POINTER = "(hover: hover) and (pointer: fine)";
const REDUCED_MOTION = "(prefers-reduced-motion: reduce)";

// Where the mouse was last seen. Tracked whichever cursor is showing, so when
// Live motion takes over from the OS cursor (which it hides at once) it can
// appear right there, instead of leaving no cursor until the mouse moves.
const lastPointer: { x: number; y: number; target: Element | null } | { x: null } = { x: null };
function trackPointer(e: PointerEvent) {
  if (e.pointerType && e.pointerType !== "mouse") return;
  Object.assign(lastPointer, { x: e.clientX, y: e.clientY, target: e.target });
}

export function Cursor() {
  const { prefs } = usePreferences();
  const [finePointer, setFinePointer] = useState(false);
  // The images bake in the theme's colours, so they're redrawn when it changes.
  const [theme, setTheme] = useState<string | undefined>(undefined);

  useEffect(() => {
    const html = document.documentElement;
    const read = () => setTheme(html.dataset.theme);
    read();
    const watch = new MutationObserver(read);
    watch.observe(html, { attributes: true, attributeFilter: ["data-theme"] });
    return () => watch.disconnect();
  }, []);

  useEffect(() => {
    const mq = window.matchMedia(FINE_POINTER);
    const update = () => setFinePointer(mq.matches);
    update();
    mq.addEventListener("change", update);
    window.addEventListener("pointermove", trackPointer, { passive: true, capture: true });
    return () => {
      mq.removeEventListener("change", update);
      window.removeEventListener("pointermove", trackPointer, { capture: true });
    };
  }, []);

  if (!finePointer || prefs.cursorDesign === "system") return null;
  const look = { design: prefs.cursorDesign, color: prefs.cursorColor, size: prefs.cursorSize, theme };
  if (prefs.cursorMotion) return <LiveCursor {...look} />;
  return <NativeCursor {...look} />;
}

const EXPLICIT: Record<string, CursorState> = {
  default: "default",
  pointer: "pointer",
  text: "text",
  "not-allowed": "disabled",
};

/** Which state an element under the pointer calls for. `data-cursor` on an
 *  element or an ancestor overrides what's detected. */
function stateOf(el: Element | null): CursorState {
  if (!el) return "default";
  const explicit = el.closest("[data-cursor]")?.getAttribute("data-cursor");
  if (explicit && explicit in EXPLICIT) return EXPLICIT[explicit]!;
  if (el.closest(DISABLED)) return "disabled";
  if (el.closest(TEXT)) return "text";
  if (el.closest(POINTER)) return "pointer";
  return "default";
}

// Resting tilt that gives it presence, and how far movement can push it.
const REST_X = 8;
const REST_Y = -8;
const MAX_TILT = 16;

function LiveCursor({
  design,
  color,
  size,
  theme,
}: {
  design: CursorDesign;
  color: CursorColor;
  size: CursorSizeName;
  /** Only a redraw trigger: the colours are read from the theme's tokens. */
  theme?: string;
}) {
  const rootRef = useRef<HTMLDivElement>(null);
  const shakeRef = useRef<HTMLDivElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);

  // One image per state, drawn once per design, colour, size and theme.
  const images = useMemo(() => {
    const px = SIZE_PX[size];
    return {
      default: cursorSvg("default", design, color, px),
      pointer: cursorSvg("pointer", design, color, px),
      text: cursorSvg("text", design, color, px),
      disabled: cursorSvg("disabled", design, color, px),
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- theme: the tokens changed
  }, [design, color, size, theme]);

  useEffect(() => {
    const root = rootRef.current;
    const shake = shakeRef.current;
    const body = bodyRef.current;
    if (!root || !shake || !body) return;
    const html = document.documentElement;
    html.classList.add("has-custom-cursor");
    const reduced = window.matchMedia(REDUCED_MOTION);

    const show = (state: CursorState) => {
      const img = images[state];
      body.innerHTML = img.svg; // our own markup, built from theme tokens
      // Line the image's hot point up with the pointer, and tilt around it.
      body.style.left = `${-img.hotX}px`;
      body.style.top = `${-img.hotY}px`;
      body.style.transformOrigin = `${img.hotX}px ${img.hotY}px`;
    };

    const s = {
      x: -100,
      y: -100,
      lastX: -100,
      lastY: -100,
      vx: 0,
      vy: 0,
      rx: REST_X,
      ry: REST_Y,
      scale: 1,
      pressed: false,
      state: "default" as CursorState,
      target: null as Element | null,
      moved: false,
      visible: false,
      lastFrame: 0,
      idleSince: 0,
    };
    show("default");
    let raf = 0;

    const setVisible = (on: boolean) => {
      if (s.visible === on) return;
      s.visible = on;
      root.style.opacity = on ? "1" : "0";
    };

    // Taking over from the OS cursor: start where the mouse already is.
    if (lastPointer.x !== null) {
      const p = lastPointer as { x: number; y: number; target: Element | null };
      s.x = s.lastX = p.x;
      s.y = s.lastY = p.y;
      s.target = document.elementFromPoint(p.x, p.y) ?? p.target;
      s.moved = true;
      root.style.transform = `translate3d(${p.x}px, ${p.y}px, 0)`;
      setVisible(true);
    }

    const frame = (now: number) => {
      const dt = Math.min(64, now - (s.lastFrame || now - 16.7));
      s.lastFrame = now;
      const still = reduced.matches;

      if (s.moved) {
        s.moved = false;
        const next = stateOf(s.target);
        if (next !== s.state) {
          s.state = next;
          show(next);
        }
      }

      // Velocity in px per 60fps frame, smoothed so one jittery event can't
      // flick it.
      const step = dt / 16.7 || 1;
      const k = 1 - Math.pow(0.7, step);
      s.vx += ((s.x - s.lastX) / step - s.vx) * k;
      s.vy += ((s.y - s.lastY) / step - s.vy) * k;
      s.lastX = s.x;
      s.lastY = s.y;

      const tilt = still || s.state === "text" ? 0 : s.state === "disabled" ? 0.35 : 1;
      const clamp = (v: number) => Math.max(-MAX_TILT, Math.min(MAX_TILT, v));
      const targetRx = (s.state === "text" ? 0 : REST_X) + clamp(-s.vy * 0.6) * tilt;
      const targetRy = (s.state === "text" ? 0 : REST_Y) + clamp(s.vx * 0.6) * tilt;
      const targetScale = s.pressed ? 0.86 : 1;

      const ease = still ? 1 : 1 - Math.pow(1 - 0.35, step);
      s.rx += (targetRx - s.rx) * ease;
      s.ry += (targetRy - s.ry) * ease;
      s.scale += (targetScale - s.scale) * ease;
      body.style.transform = `rotateX(${s.rx.toFixed(2)}deg) rotateY(${s.ry.toFixed(2)}deg) scale(${s.scale.toFixed(3)})`;

      // Stop once settled, so an idle page costs nothing.
      const settled =
        Math.abs(targetRx - s.rx) < 0.05 &&
        Math.abs(targetRy - s.ry) < 0.05 &&
        Math.abs(targetScale - s.scale) < 0.002 &&
        Math.abs(s.vx) < 0.05 &&
        Math.abs(s.vy) < 0.05;
      if (settled) {
        if (!s.idleSince) s.idleSince = now;
        if (now - s.idleSince > 200) {
          raf = 0;
          s.lastFrame = 0;
          return;
        }
      } else {
        s.idleSince = 0;
      }
      raf = requestAnimationFrame(frame);
    };

    const wake = () => {
      s.idleSince = 0;
      if (!raf) raf = requestAnimationFrame(frame);
    };

    const onMove = (e: PointerEvent) => {
      if (e.pointerType && e.pointerType !== "mouse") return;
      if (!s.visible) {
        s.lastX = e.clientX;
        s.lastY = e.clientY;
      }
      s.x = e.clientX;
      s.y = e.clientY;
      // Straight from the event: waiting for the next frame would add lag.
      root.style.transform = `translate3d(${s.x}px, ${s.y}px, 0)`;
      s.target = e.target as Element | null;
      s.moved = true;
      setVisible(true);
      wake();
    };
    const onDown = (e: PointerEvent) => {
      if (e.pointerType && e.pointerType !== "mouse") return;
      s.pressed = true;
      if (s.state === "disabled" && !reduced.matches) {
        shake.animate(
          [
            { transform: "translateX(0)" },
            { transform: "translateX(-3px)" },
            { transform: "translateX(3px)" },
            { transform: "translateX(-2px)" },
            { transform: "translateX(0)" },
          ],
          { duration: 280, easing: "cubic-bezier(0.22, 1, 0.36, 1)" },
        );
      }
      wake();
    };
    const onUp = () => {
      s.pressed = false;
      // Whatever was clicked may have changed what's under the pointer.
      if (s.visible) s.target = document.elementFromPoint(s.x, s.y);
      s.moved = true;
      wake();
    };
    // Leaving the window, or crossing into an iframe that draws its own cursor.
    const onOut = (e: MouseEvent) => {
      const to = e.relatedTarget as Element | null;
      if (!to || to.tagName === "IFRAME") setVisible(false);
    };
    // Content can change under a still pointer.
    const onScroll = () => {
      if (!s.visible) return;
      s.target = document.elementFromPoint(s.x, s.y);
      s.moved = true;
      wake();
    };

    if (s.visible) wake();
    window.addEventListener("pointermove", onMove, { passive: true });
    window.addEventListener("pointerdown", onDown, { passive: true });
    window.addEventListener("pointerup", onUp, { passive: true });
    window.addEventListener("scroll", onScroll, { passive: true, capture: true });
    document.addEventListener("mouseout", onOut);
    window.addEventListener("blur", onUp);

    return () => {
      cancelAnimationFrame(raf);
      html.classList.remove("has-custom-cursor");
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerdown", onDown);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("scroll", onScroll, { capture: true });
      document.removeEventListener("mouseout", onOut);
      window.removeEventListener("blur", onUp);
    };
  }, [images]);

  return (
    <div ref={rootRef} className="byos-cursor" aria-hidden="true">
      <div ref={shakeRef} className="byos-cursor-stage">
        <div ref={bodyRef} className="byos-cursor-body" />
      </div>
    </div>
  );
}
