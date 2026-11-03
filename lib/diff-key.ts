/** Diff tabs live in the same tab strips as files, under a key no real path can have. */
export type DiffSide = "working" | "staged";

export function diffKey(path: string, side: DiffSide): string {
  return `diff:${side}:${path}`;
}

export function parseDiffKey(key: string): { path: string; side: DiffSide } | null {
  const match = /^diff:(working|staged):(.+)$/.exec(key);
  return match === null ? null : { side: match[1] as DiffSide, path: match[2]! };
}

/** What the diff compares: unstaged = index vs disk, staged = HEAD vs index. */
export function diffSides(side: DiffSide): { original: "HEAD" | "index"; modified: "index" | "disk" } {
  return side === "working" ? { original: "index", modified: "disk" } : { original: "HEAD", modified: "index" };
}
