/** One changed path from `git status --porcelain=v1 -z -b`. */
export interface GitEntry {
  path: string;
  /** Index (staged) status letter; " " when unchanged, "?" when untracked. */
  index: string;
  /** Working-tree (unstaged) status letter. */
  worktree: string;
  origPath?: string;
}

export interface GitStatus {
  branch: string | null;
  /** e.g. "origin/main"; null when the branch has no upstream. */
  upstream?: string | null;
  ahead?: number;
  behind?: number;
  entries: GitEntry[];
}

export function parsePorcelain(output: string): GitStatus {
  const fields = output.split("\0");
  let branch: string | null = null;
  let upstream: string | null = null;
  let ahead = 0;
  let behind = 0;
  const entries: GitEntry[] = [];
  for (let i = 0; i < fields.length; i++) {
    const field = fields[i]!;
    if (field === "") continue;
    if (field.startsWith("## ")) {
      const head = field.slice(3);
      branch = head.startsWith("No commits yet on ")
        ? head.slice("No commits yet on ".length)
        : head.startsWith("HEAD (no branch)")
          ? null
          : head.split("...")[0]!.split(" ")[0]!;
      const tracking = /\.\.\.(\S+)(?: \[(.*)\])?/.exec(head);
      if (tracking) {
        upstream = tracking[1]!;
        ahead = Number(/ahead (\d+)/.exec(tracking[2] ?? "")?.[1] ?? 0);
        behind = Number(/behind (\d+)/.exec(tracking[2] ?? "")?.[1] ?? 0);
      }
      continue;
    }
    const index = field[0]!;
    const worktree = field[1]!;
    const entry: GitEntry = { path: field.slice(3), index, worktree };
    // Renames and copies carry the original path as the next field.
    if (index === "R" || index === "C") entry.origPath = fields[++i];
    entries.push(entry);
  }
  return { branch, upstream, ahead, behind, entries };
}

/** Keep entries under the workspace's repo prefix (e.g. "packages/app/"), made workspace-relative. */
export function withinPrefix(status: GitStatus, prefix: string): GitStatus {
  if (prefix === "") return status;
  const entries: GitEntry[] = [];
  for (const { origPath, ...entry } of status.entries) {
    if (!entry.path.startsWith(prefix)) continue;
    const moved = { ...entry, path: entry.path.slice(prefix.length) };
    // An original path outside the workspace is dropped; the entry stays.
    entries.push(origPath?.startsWith(prefix) ? { ...moved, origPath: origPath.slice(prefix.length) } : moved);
  }
  return { ...status, entries };
}

export type Decoration = "modified" | "added" | "deleted" | "untracked" | "conflict" | "renamed";

const CONFLICTS = new Set(["DD", "AU", "UD", "UA", "DU", "AA", "UU"]);

export function decorationOf(entry: GitEntry): Decoration {
  const xy = entry.index + entry.worktree;
  if (CONFLICTS.has(xy)) return "conflict";
  if (xy === "??") return "untracked";
  if (entry.index === "R") return "renamed";
  if (entry.index === "A") return "added";
  if (entry.index === "D" || entry.worktree === "D") return "deleted";
  return "modified";
}

const RANK: Record<Decoration, number> = { conflict: 5, modified: 4, deleted: 3, renamed: 2, added: 1, untracked: 0 };

/** Decorations for files and, VS Code style, for every folder containing them. */
export function decorateTree(entries: readonly GitEntry[]): Map<string, Decoration> {
  const result = new Map<string, Decoration>();
  for (const entry of entries) {
    const decoration = decorationOf(entry);
    const path = entry.path.replace(/\/$/, "");
    result.set(path, decoration);
    const parts = path.split("/");
    for (let i = parts.length - 1; i > 0; i--) {
      const folder = parts.slice(0, i).join("/");
      const current = result.get(folder);
      if (current === undefined || RANK[decoration] > RANK[current]) result.set(folder, decoration);
    }
  }
  return result;
}
