// The pegboard's fields, kept apart from the canvas so they can be tested: drifting clouds that
// lift pegs on their own, a color field that moves through the theme's accents, and smoke puffs
// the pointer leaves behind.

// Distance between peg centers, in CSS pixels.
export const pitch = 22;

// How wide the pointer's brush is, in CSS pixels: both the smoke it lays and the glow under it.
export const brush = pitch * 3.6;

// The glow under the pointer breathes, so the board still answers a pointer held still. It
// swells and eases back about every 1.6 s around the brush's width, so it matches the trail's
// thick end.
const pulseMs = 1600;

export function glow(t: number): { radius: number; strength: number } {
  const swell = (1 - Math.cos((t / pulseMs) * Math.PI * 2)) / 2;
  return { radius: brush * (0.85 + 0.3 * swell), strength: 0.7 + 0.25 * swell };
}

export type Cell = { col: number; row: number };
export type Point = { x: number; y: number };

export function pegCenter({ col, row }: Cell): Point {
  return { x: col * pitch + pitch / 2, y: row * pitch + pitch / 2 };
}

// 1 at 0, easing to 0 at 1 and beyond: how a lift fades with distance.
export function soften(x: number): number {
  const t = Math.max(0, 1 - x);
  return t * t * (3 - 2 * t);
}

function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = Math.max(0, Math.min(1, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

const fract = (x: number) => x - Math.floor(x);

// --- Noise ---------------------------------------------------------------------------------

function hash(x: number, y: number, z: number): number {
  let h = Math.imul(x, 374761393) ^ Math.imul(y, 668265263) ^ Math.imul(z, 1440662683);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

const fade = (t: number) => t * t * t * (t * (t * 6 - 15) + 10);
const mix = (a: number, b: number, t: number) => a + (b - a) * t;

// Smooth 3D value noise in [0, 1]: two axes of the board and one of time.
export function noise3(x: number, y: number, z: number): number {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const zi = Math.floor(z);
  const u = fade(x - xi);
  const v = fade(y - yi);
  const w = fade(z - zi);
  const corner = (dx: number, dy: number, dz: number) => hash(xi + dx, yi + dy, zi + dz);
  return mix(
    mix(mix(corner(0, 0, 0), corner(1, 0, 0), u), mix(corner(0, 1, 0), corner(1, 1, 0), u), v),
    mix(mix(corner(0, 0, 1), corner(1, 0, 1), u), mix(corner(0, 1, 1), corner(1, 1, 1), u), v),
    w,
  );
}

// Three octaves, each turned to a different angle, so the lattice the noise is built on never
// lines up with the peg grid and clouds come out round rather than boxy.
function fbm(x: number, y: number, z: number): number {
  return (
    noise3(x * 0.8 - y * 0.6, x * 0.6 + y * 0.8, z) * 0.55 +
    noise3((x * 0.28 + y * 0.96) * 2.1 + 17, (y * 0.28 - x * 0.96) * 2.1 + 31, z * 1.7) * 0.3 +
    noise3((x * 0.5 - y * 0.87) * 4.3 + 7, (x * 0.87 + y * 0.5) * 4.3 - 11, z * 2.3) * 0.15
  );
}

// --- Clouds and color ----------------------------------------------------------------------

// How much the drifting clouds lift the peg at (x, y) at time `t` (ms): broad soft banks, at
// most a little under half way, so the pointer's smoke still stands out against them.
export const cloudLift = 0.42;

export function cloud(x: number, y: number, t: number): number {
  return (
    smoothstep(0.5, 0.78, fbm(x / 380 + t / 70_000, y / 380 + t / 160_000, t / 24_000)) * cloudLift
  );
}

// Where the peg at (x, y) sits on the accent ramp at time `t`, in [0, 1). The field drifts and
// the whole ramp slowly turns, so the same peg moves through every accent over time.
export function hueAt(x: number, y: number, t: number): number {
  return fract(fbm(x / 420 + 50, y / 420 - 20, t / 8_000) * 2.2 + t / 40_000);
}

// --- Accent ramp ---------------------------------------------------------------------------

type Oklch = { l: number; c: number; h: number };

export function parseOklch(value: string): Oklch | null {
  const match = /^oklch\(\s*([\d.]+)(%?)\s+([\d.]+)\s+([\d.]+)/.exec(value.trim());
  if (!match) return null;
  const l = Number(match[1]) / (match[2] ? 100 : 1);
  return { l, c: Number(match[3]), h: Number(match[4]) };
}

// The accents blended into a loop of `steps` colors each, so a peg changing accent fades through
// the colors between rather than jumping. Accents that aren't oklch are used as they are.
export function accentRamp(accents: string[], steps = 16): string[] {
  const parsed = accents.map(parseOklch);
  if (parsed.some((color) => color === null)) return accents;
  const colors = parsed as Oklch[];
  const ramp: string[] = [];
  colors.forEach((from, index) => {
    const to = colors[(index + 1) % colors.length]!;
    const turn = ((to.h - from.h + 540) % 360) - 180;
    for (let step = 0; step < steps; step++) {
      const t = step / steps;
      const l = mix(from.l, to.l, t).toFixed(3);
      const c = mix(from.c, to.c, t).toFixed(3);
      const h = (((from.h + turn * t) % 360) + 360) % 360;
      ramp.push(`oklch(${l} ${c} ${h.toFixed(1)})`);
    }
  });
  return ramp;
}

// --- Smoke ---------------------------------------------------------------------------------

// The pointer's smoke as a density per peg, not as particles, so there is no limit on how much
// can be drawn: a long scribble lingers as long as a short one, and a frame costs the same
// however much smoke is on the board. Each frame the density drifts along a slow swirl and the
// pointer's wake, spreads to its neighbours and thins away.
export type Smoke = {
  cols: number;
  rows: number;
  density: Float32Array;
  // The pointer's wake, in px/ms, which carries the smoke on in the direction it was drawn.
  vx: Float32Array;
  vy: Float32Array;
  // Scratch space for the step, kept so a frame allocates nothing.
  next: Float32Array;
};

export function createSmoke(cols: number, rows: number): Smoke {
  const size = cols * rows;
  return {
    cols,
    rows,
    density: new Float32Array(size),
    vx: new Float32Array(size),
    vy: new Float32Array(size),
    next: new Float32Array(size),
  };
}

// How dense the brush's smoke can get. Density above 1 shows as fully lifted, so a heavy stroke
// holds at full strength for a while before it fades.
const maxDensity = 3;
// Density halves roughly every second, so a stroke holds briefly and is gone in a few seconds.
const thinMs = 1400;
const spreadMs = 2500;
const wakeMs = 700;

// Lays smoke along the pointer's path since the last frame, and stirs a wake in its direction.
// The amount scales with the distance covered, so a slow stroke and a fast one leave about the
// same density per pixel.
export function splat(smoke: Smoke, from: Point, to: Point, elapsedMs: number): void {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const length = Math.hypot(dx, dy);
  if (length === 0) return;
  const amount = 1.8 * Math.min(1, length / pitch);
  const speed = Math.min(0.35, length / Math.max(elapsedMs, 1)) * 0.3;
  const wx = (dx / length) * speed;
  const wy = (dy / length) * speed;
  const { cols, rows, density, vx, vy } = smoke;
  const minCol = Math.max(0, Math.floor((Math.min(from.x, to.x) - brush) / pitch));
  const maxCol = Math.min(cols - 1, Math.floor((Math.max(from.x, to.x) + brush) / pitch));
  const minRow = Math.max(0, Math.floor((Math.min(from.y, to.y) - brush) / pitch));
  const maxRow = Math.min(rows - 1, Math.floor((Math.max(from.y, to.y) + brush) / pitch));
  for (let row = minRow; row <= maxRow; row++) {
    for (let col = minCol; col <= maxCol; col++) {
      const weight = soften(distanceToPath(pegCenter({ col, row }), from, to) / brush);
      if (weight === 0) continue;
      const i = row * cols + col;
      density[i] = Math.min(maxDensity, density[i]! + amount * weight);
      vx[i] = vx[i]! + (wx - vx[i]!) * weight * 0.5;
      vy[i] = vy[i]! + (wy - vy[i]!) * weight * 0.5;
    }
  }
}

export function distanceToPath(peg: Point, from: Point, to: Point): number {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const length = dx * dx + dy * dy;
  const t =
    length === 0
      ? 0
      : Math.max(0, Math.min(1, ((peg.x - from.x) * dx + (peg.y - from.y) * dy) / length));
  return Math.hypot(peg.x - (from.x + t * dx), peg.y - (from.y + t * dy));
}

function sample(field: Float32Array, cols: number, rows: number, col: number, row: number) {
  const c = Math.max(0, Math.min(cols - 1.001, col));
  const r = Math.max(0, Math.min(rows - 1.001, row));
  const c0 = Math.floor(c);
  const r0 = Math.floor(r);
  const u = c - c0;
  const v = r - r0;
  const i = r0 * cols + c0;
  const right = c0 + 1 < cols ? 1 : 0;
  const down = r0 + 1 < rows ? cols : 0;
  return mix(
    mix(field[i]!, field[i + right]!, u),
    mix(field[i + down]!, field[i + down + right]!, u),
    v,
  );
}

// Moves the smoke on by `elapsedMs`: carried along the wake and a slow swirl that rises a little,
// spread to its neighbours, and thinned.
export function stepSmoke(smoke: Smoke, t: number, elapsedMs: number): void {
  const { cols, rows, density, vx, vy, next } = smoke;
  const thin = Math.exp(-elapsedMs / thinMs);
  const spread = 1 - Math.exp(-elapsedMs / spreadMs);
  const calm = Math.exp(-elapsedMs / wakeMs);

  // Carried: each peg takes the density from where its smoke came from.
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const i = row * cols + col;
      const angle = noise3(col / 9, row / 9, t / 9_000) * Math.PI * 4;
      const flowX = vx[i]! + Math.cos(angle) * 0.012;
      const flowY = vy[i]! + Math.sin(angle) * 0.012 - 0.004;
      next[i] = sample(
        density,
        cols,
        rows,
        col - (flowX * elapsedMs) / pitch,
        row - (flowY * elapsedMs) / pitch,
      );
    }
  }

  // Spread and thinned; the wake calms.
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const i = row * cols + col;
      const here = next[i]!;
      const left = col > 0 ? next[i - 1]! : here;
      const right = col < cols - 1 ? next[i + 1]! : here;
      const up = row > 0 ? next[i - cols]! : here;
      const down = row < rows - 1 ? next[i + cols]! : here;
      const settled = here + ((left + right + up + down) / 4 - here) * spread;
      density[i] = settled * thin < 0.002 ? 0 : settled * thin;
      vx[i] = vx[i]! * calm;
      vy[i] = vy[i]! * calm;
    }
  }
}

// Smoke thinner than this doesn't show, so as a stroke fades its thin edges drop out first and
// the trail narrows towards its core the further it is from the pointer.
const taper = 0.7;

// How far the smoke lifts the peg at index `i`: dense smoke saturates at fully lifted, so a
// thick stroke stays bright and then dissolves rather than dimming from the start.
export function smokeLift(smoke: Smoke, i: number): number {
  return 1 - Math.exp(-1.8 * Math.max(0, smoke.density[i]! - taper));
}

// --- Calm zones ----------------------------------------------------------------------------

// A soft oval around something that must stay readable over the board, such as the wordmark:
// pegs inside it are muted, easing back to full strength just beyond its edge.
export type CalmZone = { x: number; y: number; rx: number; ry: number };

type Box = { left: number; top: number; width: number; height: number };

// Room around the element's box, so dots don't crowd its edges.
const calmPadding = pitch * 1.2;
const calmFade = 0.9;

export function calmZone(box: Box): CalmZone {
  return {
    x: box.left + box.width / 2,
    y: box.top + box.height / 2,
    // An oval through the box's corners, plus padding.
    rx: (box.width / 2) * Math.SQRT2 + calmPadding,
    ry: (box.height / 2) * Math.SQRT2 + calmPadding,
  };
}

// How far inside a calm zone the peg at (x, y) is: 1 inside, easing to 0 by `calmFade` of
// the zone's radius beyond its edge.
export function calmAt(x: number, y: number, zones: CalmZone[]): number {
  let calm = 0;
  for (const zone of zones) {
    const distance = Math.hypot((x - zone.x) / zone.rx, (y - zone.y) / zone.ry);
    calm = Math.max(calm, 1 - smoothstep(1, 1 + calmFade, distance));
  }
  return calm;
}
