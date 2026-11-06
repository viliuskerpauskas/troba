import { describe, expect, it } from "vitest";
import {
  accentRamp,
  calmAt,
  calmZone,
  cloud,
  cloudLift,
  createSmoke,
  distanceToPath,
  glow,
  hueAt,
  noise3,
  parseOklch,
  pegCenter,
  pitch,
  type Smoke,
  smokeLift,
  soften,
  splat,
  stepSmoke,
} from "./pegboard";

describe("pegCenter", () => {
  it("puts the peg in the middle of its cell", () => {
    expect(pegCenter({ col: 2, row: 1 })).toEqual({ x: pitch * 2.5, y: pitch * 1.5 });
  });
});

describe("soften", () => {
  it("is full at the center and nothing at the edge", () => {
    expect(soften(0)).toBe(1);
    expect(soften(0.5)).toBe(0.5);
    expect(soften(1)).toBe(0);
    expect(soften(2)).toBe(0);
  });
});

describe("noise3", () => {
  it("stays in [0, 1] and gives the same value for the same point", () => {
    for (let i = 0; i < 200; i++) {
      const value = noise3(i * 0.37, i * 0.71, i * 0.13);
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThanOrEqual(1);
    }
    expect(noise3(1.5, 2.5, 3.5)).toBe(noise3(1.5, 2.5, 3.5));
  });

  it("changes smoothly between nearby points", () => {
    expect(Math.abs(noise3(4.2, 7.1, 0.3) - noise3(4.201, 7.1, 0.3))).toBeLessThan(0.01);
  });
});

describe("cloud", () => {
  it("lifts some pegs and leaves most at rest, never past cloudLift", () => {
    const lifts = [];
    for (let col = 0; col < 120; col++) {
      for (let row = 0; row < 60; row++) lifts.push(cloud(col * pitch, row * pitch, 0));
    }
    expect(Math.max(...lifts)).toBeGreaterThan(0.1);
    expect(Math.max(...lifts)).toBeLessThanOrEqual(cloudLift);
    expect(lifts.filter((lift) => lift === 0).length).toBeGreaterThan(lifts.length / 2);
  });

  it("drifts over time", () => {
    const sky = (t: number) =>
      Array.from({ length: 200 }, (_, i) => cloud((i % 20) * pitch, Math.floor(i / 20) * pitch, t));
    expect(sky(20_000)).not.toEqual(sky(0));
  });
});

describe("hueAt", () => {
  it("moves the same peg through different colors over time", () => {
    const seen = new Set<number>();
    for (let t = 0; t < 40_000; t += 2_000) seen.add(Math.floor(hueAt(300, 200, t) * 5));
    expect(seen.size).toBeGreaterThan(2);
  });
});

describe("parseOklch", () => {
  it("reads the theme's oklch colors", () => {
    expect(parseOklch("oklch(0.8 0.105 261)")).toEqual({ l: 0.8, c: 0.105, h: 261 });
    expect(parseOklch("oklch(80% 0.1 30)")).toEqual({ l: 0.8, c: 0.1, h: 30 });
    expect(parseOklch("#ff0000")).toBeNull();
  });
});

describe("accentRamp", () => {
  const accents = ["oklch(0.8 0.1 350)", "oklch(0.6 0.2 10)"];

  it("starts each stretch at an accent and blends to the next", () => {
    const ramp = accentRamp(accents, 4);
    expect(ramp).toHaveLength(8);
    expect(ramp[0]).toBe("oklch(0.800 0.100 350.0)");
    expect(ramp[4]).toBe("oklch(0.600 0.200 10.0)");
  });

  it("turns the short way round the hue circle", () => {
    expect(accentRamp(accents, 4)[2]).toBe("oklch(0.700 0.150 0.0)");
  });

  it("uses colors it can't read as they are", () => {
    expect(accentRamp(["red", "blue"])).toEqual(["red", "blue"]);
  });
});

describe("distanceToPath", () => {
  it("measures to the nearest point along the pointer's path", () => {
    expect(distanceToPath({ x: 50, y: 10 }, { x: 0, y: 0 }, { x: 100, y: 0 })).toBe(10);
    expect(distanceToPath({ x: 103, y: 4 }, { x: 0, y: 0 }, { x: 100, y: 0 })).toBe(5);
    expect(distanceToPath({ x: 3, y: 4 }, { x: 0, y: 0 }, { x: 0, y: 0 })).toBe(5);
  });
});

describe("smoke", () => {
  const cols = 60;
  const rows = 40;
  const at = (col: number, row: number) => row * cols + col;
  const peg = (col: number, row: number) => pegCenter({ col, row });
  const run = (smoke: Smoke, ms: number) => {
    for (let t = 0; t < ms; t += 16) stepSmoke(smoke, t, 16);
  };

  it("lays smoke along the pointer's path and not far from it", () => {
    const smoke = createSmoke(cols, rows);
    splat(smoke, peg(10, 20), peg(30, 20), 16);
    expect(smokeLift(smoke, at(20, 20))).toBeGreaterThan(0.5);
    expect(smokeLift(smoke, at(50, 5))).toBe(0);
  });

  it("lays none when the pointer hasn't moved", () => {
    const smoke = createSmoke(cols, rows);
    splat(smoke, peg(10, 10), peg(10, 10), 16);
    expect(smoke.density.every((d) => d === 0)).toBe(true);
  });

  it("keeps every stroke, however much is drawn", () => {
    const smoke = createSmoke(cols, rows);
    for (let row = 2; row < rows - 2; row += 3) {
      for (let col = 2; col < cols - 2; col += 2)
        splat(smoke, peg(col, row), peg(col + 2, row), 16);
    }
    run(smoke, 1_000);
    for (let row = 2; row < rows - 2; row += 3) {
      expect(smokeLift(smoke, at(20, row))).toBeGreaterThan(0.5);
    }
  });

  it("lingers, spreads to its neighbours, then clears", () => {
    const smoke = createSmoke(cols, rows);
    for (let i = 0; i < 6; i++) splat(smoke, peg(28, 20), peg(32, 20), 16);
    run(smoke, 1_000);
    expect(smokeLift(smoke, at(30, 20))).toBeGreaterThan(0.6);
    // Beyond the brush, so only spreading reaches it.
    expect(smoke.density[at(30, 24)]).toBeGreaterThan(0);
    run(smoke, 15_000);
    expect(smoke.density.every((d) => d === 0)).toBe(true);
  });

  it("narrows as it fades, so the oldest part of a trail is the thinnest", () => {
    const smoke = createSmoke(cols, rows);
    for (let i = 0; i < 6; i++) splat(smoke, peg(20, 20), peg(40, 20), 16);
    const width = () => {
      let rowsLifted = 0;
      for (let row = 0; row < rows; row++) if (smokeLift(smoke, at(30, row)) > 0) rowsLifted++;
      return rowsLifted;
    };
    const fresh = width();
    run(smoke, 2_000);
    const older = width();
    expect(older).toBeGreaterThan(0);
    expect(older).toBeLessThan(fresh);
  });

  it("is carried on in the direction it was drawn", () => {
    const smoke = createSmoke(cols, rows);
    for (let i = 0; i < 5; i++) splat(smoke, peg(10, 20), peg(18, 20), 16);
    // Pegs the same distance past the stroke's end and before its start.
    const density = (col: number) => smoke.density[at(col, 20)]!;
    expect(density(20)).toBeCloseTo(density(8));
    run(smoke, 600);
    expect(density(20)).toBeGreaterThan(density(8) * 1.5);
  });
});

describe("calm zones", () => {
  const zone = calmZone({ left: 100, top: 100, width: 80, height: 40 });

  it("covers the element with room to spare", () => {
    expect(zone.x).toBe(140);
    expect(zone.y).toBe(120);
    expect(zone.rx).toBeGreaterThan(40);
    expect(zone.ry).toBeGreaterThan(20);
  });

  it("is fully calm over the element and its corners", () => {
    expect(calmAt(140, 120, [zone])).toBe(1);
    expect(calmAt(100, 100, [zone])).toBe(1);
    expect(calmAt(180, 140, [zone])).toBe(1);
  });

  it("eases back to full motion away from it", () => {
    const edge = calmAt(140 + zone.rx * 1.4, 120, [zone]);
    expect(edge).toBeGreaterThan(0);
    expect(edge).toBeLessThan(1);
    expect(calmAt(140 + zone.rx * 3, 120, [zone])).toBe(0);
    expect(calmAt(500, 500, [])).toBe(0);
  });
});

describe("glow", () => {
  it("breathes in and out while the pointer is held still", () => {
    const samples = Array.from({ length: 32 }, (_, i) => glow(i * 50));
    const radii = samples.map((sample) => sample.radius);
    const strengths = samples.map((sample) => sample.strength);
    expect(Math.max(...radii) - Math.min(...radii)).toBeGreaterThan(pitch);
    expect(Math.max(...strengths) - Math.min(...strengths)).toBeGreaterThan(0.2);
    expect(Math.max(...strengths)).toBeLessThan(1);
  });

  it("repeats", () => {
    expect(glow(400 + 1600).radius).toBeCloseTo(glow(400).radius);
    expect(glow(400 + 1600).strength).toBeCloseTo(glow(400).strength);
  });
});
