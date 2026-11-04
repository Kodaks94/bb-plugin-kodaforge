import { expect, it } from "vitest";
import { moodFor, PALETTE, runs, spriteFor, type Mood } from "./koda-sprite.js";

it("every mood is a 16×14 grid using only palette colours", () => {
  for (const mood of ["idle", "blink", "working", "happy", "worried", "sleepy"] as Mood[]) {
    const grid = spriteFor(mood);
    expect(grid).toHaveLength(14);
    for (const row of grid) {
      expect(row).toHaveLength(16);
      for (const char of row) expect(char === "." || char in PALETTE).toBe(true);
    }
  }
  expect(spriteFor("happy")).not.toEqual(spriteFor("idle"));
});

it("draws rows as merged runs", () => {
  expect(runs(["..oo", "bbb."])).toEqual([
    { x: 2, y: 0, w: 2, color: PALETTE.o },
    { x: 0, y: 1, w: 3, color: PALETTE.b },
  ]);
});

it("picks the mood by priority", () => {
  const calm = { conflict: false, errors: 0, busy: false, celebrating: false, idleMs: 0 };
  expect(moodFor(calm)).toBe("idle");
  expect(moodFor({ ...calm, busy: true })).toBe("working");
  expect(moodFor({ ...calm, busy: true, errors: 2 })).toBe("worried");
  expect(moodFor({ ...calm, errors: 2, celebrating: true })).toBe("happy");
  expect(moodFor({ ...calm, idleMs: 4 * 60_000 })).toBe("sleepy");
});

it("wears sunglasses only when asked (the Agent Network's sun)", () => {
  expect(spriteFor("idle").join("")).not.toContain("g");
  expect(spriteFor("idle", { sunglasses: true }).join("")).toContain("g");
});
