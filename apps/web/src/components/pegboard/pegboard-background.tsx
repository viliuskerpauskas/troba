"use client";

import { useEffect, useRef } from "react";
import {
  accentRamp,
  calmAt,
  type CalmZone,
  calmZone,
  cloud,
  createSmoke,
  hueAt,
  pegCenter,
  pitch,
  glow,
  type Point,
  type Smoke,
  smokeLift,
  soften,
  splat,
  stepSmoke,
} from "./pegboard";

const restRadius = 1.5;
const liftedRadius = 6.5;
// Below this a peg is drawn at rest, so the faint edges of the clouds cost nothing.
const visibleLift = 0.03;
// In a calm zone pegs still move, but grow less and show fainter, so text over them reads
// clearly without leaving a hole in the board.
const calmSize = 0.55;
const calmDim = 0.6;
// A lifted peg replaces its grey rest dot rather than covering it, so it never shows less than
// about a rest dot's weight: fainter and the peg would seem to blink out as it starts to lift.
const minLiftedAlpha = 0.5;
const accentVars = ["--chart-1", "--chart-2", "--chart-3", "--chart-4", "--chart-5"];

type Colors = { peg: string; ramp: string[] };

function readColors(): Colors {
  const style = getComputedStyle(document.documentElement);
  return {
    peg: style.getPropertyValue("--input").trim(),
    ramp: accentRamp(accentVars.map((name) => style.getPropertyValue(name).trim())),
  };
}

// A pegboard of dots behind the page. Clouds drift across it, lifting pegs into the theme's
// accents, and the pointer leaves smoke that swirls, spreads and fades. Pegs around elements
// marked data-pegboard-calm are muted, so text over the board stays readable. Each frame works out how
// far every peg is lifted and draws the board on one canvas, since a wide screen holds thousands
// of pegs.
export function PegboardBackground() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const context = canvas?.getContext("2d");
    if (!canvas || !context) return;

    const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)");
    const darkScheme = matchMedia("(prefers-color-scheme: dark)");
    let colors = readColors();
    let width = 0;
    let height = 0;
    let cols = 0;
    let rows = 0;
    // Per peg, how much of it is still at rest: lifts combine as 1 - (1 - a)(1 - b), so
    // overlapping smoke and cloud deepen without ever passing fully lifted.
    let rest = new Float32Array(0);
    let pointer: Point | null = null;
    let previous: Point | null = null;
    let smoke: Smoke = createSmoke(0, 0);
    // Per peg, how far inside a zone around a [data-pegboard-calm] element it is, worked out again
    // only when one of them moves or resizes.
    let calm = new Float32Array(0);
    let zonesKey = "";
    let frame = 0;
    let last = 0;

    function lift(x: number, y: number, radius: number, strength: number) {
      const minCol = Math.max(0, Math.floor((x - radius) / pitch));
      const maxCol = Math.min(cols - 1, Math.floor((x + radius) / pitch));
      const minRow = Math.max(0, Math.floor((y - radius) / pitch));
      const maxRow = Math.min(rows - 1, Math.floor((y + radius) / pitch));
      for (let row = minRow; row <= maxRow; row++) {
        for (let col = minCol; col <= maxCol; col++) {
          const center = pegCenter({ col, row });
          const amount = strength * soften(Math.hypot(center.x - x, center.y - y) / radius);
          if (amount > 0) rest[row * cols + col]! *= 1 - amount;
        }
      }
    }

    function updateCalm() {
      const zones: CalmZone[] = [];
      for (const element of document.querySelectorAll("[data-pegboard-calm]")) {
        zones.push(calmZone(element.getBoundingClientRect()));
      }
      const key = `${cols}x${rows}:${zones.map((z) => `${z.x},${z.y},${z.rx},${z.ry}`).join(";")}`;
      if (key === zonesKey) return;
      zonesKey = key;
      for (let row = 0; row < rows; row++) {
        for (let col = 0; col < cols; col++) {
          const { x, y } = pegCenter({ col, row });
          calm[row * cols + col] = calmAt(x, y, zones);
        }
      }
    }

    function draw(t: number) {
      updateCalm();
      for (let row = 0; row < rows; row++) {
        for (let col = 0; col < cols; col++) {
          const { x, y } = pegCenter({ col, row });
          const i = row * cols + col;
          rest[i] = (1 - cloud(x, y, t)) * (1 - smokeLift(smoke, i));
        }
      }
      if (pointer) {
        const { radius, strength } = glow(t);
        lift(pointer.x, pointer.y, radius, strength);
      }
      const amountAt = (i: number) => (1 - rest[i]!) * (1 - calm[i]! * calmSize);

      // Grey dots only for the pegs at rest; a lifted peg draws its colored dot alone.
      context!.clearRect(0, 0, width, height);
      context!.globalAlpha = 1;
      context!.fillStyle = colors.peg;
      context!.beginPath();
      for (let row = 0; row < rows; row++) {
        for (let col = 0; col < cols; col++) {
          if (amountAt(row * cols + col) >= visibleLift) continue;
          const { x, y } = pegCenter({ col, row });
          context!.moveTo(x + restRadius, y);
          context!.arc(x, y, restRadius, 0, Math.PI * 2);
        }
      }
      context!.fill();

      for (let row = 0; row < rows; row++) {
        for (let col = 0; col < cols; col++) {
          const i = row * cols + col;
          const amount = amountAt(i);
          if (amount < visibleLift) continue;
          const { x, y } = pegCenter({ col, row });
          // Eased, so the growth slows as it reaches full size.
          const eased = 1 - (1 - amount) ** 3;
          const ramp = colors.ramp;
          const alpha = Math.min(1, eased * 1.2) * (1 - calm[i]! * calmDim);
          context!.globalAlpha = Math.max(minLiftedAlpha, alpha);
          context!.fillStyle = ramp[Math.floor(hueAt(x, y, t) * ramp.length) % ramp.length]!;
          context!.beginPath();
          context!.arc(x, y, restRadius + (liftedRadius - restRadius) * eased, 0, Math.PI * 2);
          context!.fill();
        }
      }
    }

    function tick(now: number) {
      // Capped, so a frame after the tab was hidden doesn't fling the smoke.
      const elapsed = last ? Math.min(now - last, 50) : 16;
      last = now;
      if (pointer && previous) splat(smoke, previous, pointer, elapsed);
      previous = pointer;
      stepSmoke(smoke, now, elapsed);
      draw(now);
      frame = requestAnimationFrame(tick);
    }

    function start() {
      cancelAnimationFrame(frame);
      last = 0;
      if (reducedMotion.matches) {
        // A still sky, and no smoke.
        smoke = createSmoke(cols, rows);
        pointer = null;
        draw(0);
      } else {
        frame = requestAnimationFrame(tick);
      }
    }

    function resize() {
      const ratio = window.devicePixelRatio || 1;
      width = window.innerWidth;
      height = window.innerHeight;
      cols = Math.ceil(width / pitch);
      rows = Math.ceil(height / pitch);
      rest = new Float32Array(cols * rows);
      calm = new Float32Array(cols * rows);
      zonesKey = "";
      smoke = createSmoke(cols, rows);
      canvas!.width = Math.round(width * ratio);
      canvas!.height = Math.round(height * ratio);
      context!.setTransform(ratio, 0, 0, ratio, 0, 0);
      if (reducedMotion.matches) draw(0);
    }

    // Mouse and pen through pointer events. Touch is left to the touch events below: a browser
    // that takes over a drag (to scroll or zoom) cancels its pointer events part way through,
    // but keeps sending touchmove.
    function onPointerMove(event: PointerEvent) {
      if (reducedMotion.matches || event.pointerType === "touch") return;
      pointer = { x: event.clientX, y: event.clientY };
    }

    function onPointerLeave(event: PointerEvent) {
      if (event.pointerType === "touch") return;
      release();
    }

    // A new touch starts its own stroke, rather than one drawn from where the last touch ended.
    function onTouch(event: TouchEvent) {
      const touch = event.touches[0];
      if (reducedMotion.matches || !touch) return;
      if (event.type === "touchstart") previous = null;
      pointer = { x: touch.clientX, y: touch.clientY };
    }

    // No hover on a touch screen, so the glow goes with the finger.
    function onTouchEnd(event: TouchEvent) {
      if (event.touches.length === 0) release();
    }

    function release() {
      pointer = null;
      previous = null;
    }

    function onSchemeChange() {
      colors = readColors();
      if (reducedMotion.matches) draw(0);
    }

    resize();
    start();
    window.addEventListener("resize", resize);
    window.addEventListener("pointermove", onPointerMove, { passive: true });
    document.documentElement.addEventListener("pointerleave", onPointerLeave);
    window.addEventListener("touchstart", onTouch, { passive: true });
    window.addEventListener("touchmove", onTouch, { passive: true });
    window.addEventListener("touchend", onTouchEnd, { passive: true });
    window.addEventListener("touchcancel", onTouchEnd, { passive: true });
    darkScheme.addEventListener("change", onSchemeChange);
    reducedMotion.addEventListener("change", start);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("resize", resize);
      window.removeEventListener("pointermove", onPointerMove);
      document.documentElement.removeEventListener("pointerleave", onPointerLeave);
      window.removeEventListener("touchstart", onTouch);
      window.removeEventListener("touchmove", onTouch);
      window.removeEventListener("touchend", onTouchEnd);
      window.removeEventListener("touchcancel", onTouchEnd);
      darkScheme.removeEventListener("change", onSchemeChange);
      reducedMotion.removeEventListener("change", start);
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      aria-hidden
      className="pointer-events-none fixed inset-0 -z-10 size-full"
    />
  );
}
