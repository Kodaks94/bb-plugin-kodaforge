// Koda, KodaForge's bear cub, as a 16×14 pixel grid. Each mood swaps the eye and
// mouth pixels; everything else is shared. In the Agent Network Koda wears sunglasses over the eyes.

export type Mood = "idle" | "blink" | "working" | "happy" | "worried" | "sleepy";

export const PALETTE: Record<string, string> = {
  o: "#2b1a10", // outline
  b: "#9a6438", // fur
  d: "#6b3f22", // inner ear
  m: "#e8c79f", // muzzle
  n: "#20140c", // nose
  e: "#20140c", // eye
  w: "#ffffff", // eye shine
  p: "#e98f86", // blush
  s: "#6fc3f2", // sweat
  z: "#9db4c8", // sleep z
  y: "#ffd34d", // spark (working)
  g: "#14161c", // sunglasses lens
  l: "#5f7487", // lens glint
};

const BASE = [
  "..oo........oo..",
  ".obbo......obbo.",
  ".obdbooooooobdbo",
  ".obbbbbbbbbbbbo.",
  "obbbbbbbbbbbbbbo",
  "obbbbbbbbbbbbbbo",
  "obbbbbbbbbbbbbbo",
  "obbpbbmmmmbbpbbo",
  "obbbbmmnnmmbbbbo",
  "obbbbmmmmmmbbbbo",
  ".obbbbmmmmbbbbo.",
  "..obbbbbbbbbbo..",
  "...oooooooooo...",
  "................",
];

type Patch = [row: number, col: number, color: string][];

const EYES: Record<"open" | "closed" | "happy" | "side", Patch> = {
  open: [[5, 4, "e"], [5, 5, "w"], [6, 4, "e"], [6, 5, "e"], [5, 10, "e"], [5, 11, "w"], [6, 10, "e"], [6, 11, "e"]],
  closed: [[6, 4, "o"], [6, 5, "o"], [6, 10, "o"], [6, 11, "o"]],
  happy: [[5, 4, "o"], [5, 5, "o"], [6, 3, "o"], [6, 6, "o"], [5, 10, "o"], [5, 11, "o"], [6, 9, "o"], [6, 12, "o"]],
  side: [[5, 5, "e"], [5, 4, "w"], [6, 4, "e"], [6, 5, "e"], [5, 11, "e"], [5, 10, "w"], [6, 10, "e"], [6, 11, "e"]],
};

const MOUTH: Record<"line" | "smile" | "frown" | "o", Patch> = {
  line: [[9, 7, "o"], [9, 8, "o"]],
  smile: [[9, 6, "o"], [9, 9, "o"], [10, 7, "o"], [10, 8, "o"]],
  frown: [[10, 6, "o"], [10, 9, "o"], [9, 7, "o"], [9, 8, "o"]],
  o: [[9, 7, "o"], [9, 8, "o"], [10, 7, "o"], [10, 8, "o"]],
};

const EXTRAS: Partial<Record<Mood, Patch>> = {
  worried: [[3, 14, "s"], [4, 14, "s"], [4, 15, "s"], [5, 14, "s"]],
  sleepy: [[0, 6, "z"], [0, 7, "z"], [0, 8, "z"], [1, 7, "z"], [2, 6, "z"], [2, 7, "z"], [2, 8, "z"]],
  working: [[0, 7, "y"], [1, 6, "y"], [1, 8, "y"], [2, 7, "y"]],
};

// Lenses over both eyes, a bridge between them and arms out to the fur; the mouth and extras still show the mood.
const SUNGLASSES: Patch = [
  [5, 2, "o"], [5, 3, "g"], [5, 4, "l"], [5, 5, "g"], [5, 6, "g"], [5, 7, "o"], [5, 8, "o"],
  [5, 9, "g"], [5, 10, "l"], [5, 11, "g"], [5, 12, "g"], [5, 13, "o"],
  [6, 3, "g"], [6, 4, "g"], [6, 5, "g"], [6, 6, "g"], [6, 9, "g"], [6, 10, "g"], [6, 11, "g"], [6, 12, "g"],
];

const FACES: Record<Mood, { eyes: keyof typeof EYES; mouth: keyof typeof MOUTH }> = {
  idle: { eyes: "open", mouth: "line" },
  blink: { eyes: "closed", mouth: "line" },
  working: { eyes: "side", mouth: "o" },
  happy: { eyes: "happy", mouth: "smile" },
  worried: { eyes: "open", mouth: "frown" },
  sleepy: { eyes: "closed", mouth: "o" },
};

export function spriteFor(mood: Mood, { sunglasses = false }: { sunglasses?: boolean } = {}): string[] {
  const grid = BASE.map((row) => row.split(""));
  const face = FACES[mood];
  for (const [row, col, color] of [...EYES[face.eyes], ...(sunglasses ? SUNGLASSES : []), ...MOUTH[face.mouth], ...(EXTRAS[mood] ?? [])]) {
    grid[row]![col] = color;
  }
  return grid.map((row) => row.join(""));
}

/** Horizontal runs per row, so the SVG draws a few dozen rects, not 224. */
export function runs(grid: readonly string[]): { x: number; y: number; w: number; color: string }[] {
  const out: { x: number; y: number; w: number; color: string }[] = [];
  grid.forEach((row, y) => {
    let x = 0;
    while (x < row.length) {
      const char = row[x]!;
      let end = x + 1;
      while (end < row.length && row[end] === char) end++;
      if (char !== ".") out.push({ x, y, w: end - x, color: PALETTE[char]! });
      x = end;
    }
  });
  return out;
}

/** What Koda feels, from the IDE's state; the first match wins. */
export function moodFor(state: {
  conflict: boolean;
  errors: number;
  busy: boolean;
  celebrating: boolean;
  idleMs: number;
}): Mood {
  if (state.celebrating) return "happy";
  if (state.conflict || state.errors > 0) return "worried";
  if (state.busy) return "working";
  if (state.idleMs > 3 * 60_000) return "sleepy";
  return "idle";
}
