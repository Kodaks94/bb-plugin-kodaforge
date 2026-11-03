// Host-side search across a workspace: list candidate files, then match each.
import { createHash } from "node:crypto";
import { lstat, readdir, readFile } from "node:fs/promises";
import path from "node:path";
import type { SearchQuery } from "./text-search.js";
import { findMatches, type TextMatch } from "./replace.js";
import { run } from "./run.js";

export const MAX_SEARCH_FILE_BYTES = 1024 * 1024;

export interface SearchOptions {
  query: SearchQuery;
  replacement?: string;
  /** Comma-separated globs, VS Code style: "src/**, *.ts". Empty = everything. */
  include: string;
  exclude: string;
  excludedNames: readonly string[];
  maxMatches: number;
  timeLimitMs: number;
  signal?: AbortSignal;
}

export interface FileResult {
  path: string;
  sha256: string;
  matches: TextMatch[];
}

export interface SearchResult {
  files: FileResult[];
  matchCount: number;
  searchedFiles: number;
  truncated: boolean;
}

/** `*` within a segment, `**` across segments, `?` one character; a bare pattern matches at any depth. */
export function globToRegExp(glob: string): RegExp {
  let pattern = glob.trim().replace(/\\/g, "/");
  if (!pattern.includes("/")) pattern = `**/${pattern}`;
  if (pattern.endsWith("/")) pattern += "**";
  let source = "";
  for (let i = 0; i < pattern.length; i++) {
    const char = pattern[i]!;
    if (char === "*" && pattern[i + 1] === "*") {
      const slash = pattern[i + 2] === "/";
      source += slash ? "(?:.*/)?" : ".*";
      i += slash ? 2 : 1;
    } else if (char === "*") source += "[^/]*";
    else if (char === "?") source += "[^/]";
    else source += char.replace(/[.+^${}()|[\]\\]/g, "\\$&");
  }
  // A folder pattern ("src") also matches everything under it.
  return new RegExp(`^${source}(?:/.*)?$`);
}

function globFilter(list: string): ((file: string) => boolean) | null {
  const globs = list.split(",").map((glob) => glob.trim()).filter(Boolean);
  if (globs.length === 0) return null;
  const patterns = globs.map(globToRegExp);
  return (file) => patterns.some((pattern) => pattern.test(file));
}

/** Tracked and untracked-but-not-ignored files when the root is in git; otherwise a walk. */
export async function listCandidates(root: string, excludedNames: readonly string[]): Promise<string[]> {
  const excluded = new Set(excludedNames);
  const isExcluded = (file: string) => file.split("/").some((part) => excluded.has(part)) || excludedNames.some((name) => name.includes("/") && file.startsWith(`${name}/`));
  const git = await run("git", ["ls-files", "-z", "--cached", "--others", "--exclude-standard"], { cwd: root }).catch(() => null);
  if (git !== null && git.code === 0) {
    return [...new Set(git.stdout.split("\0").filter(Boolean))].filter((file) => !isExcluded(file));
  }
  const files: string[] = [];
  const walk = async (dir: string, prefix: string) => {
    for (const entry of await readdir(dir, { withFileTypes: true }).catch(() => [])) {
      const relative = prefix === "" ? entry.name : `${prefix}/${entry.name}`;
      if (excluded.has(entry.name) || isExcluded(relative)) continue;
      if (entry.isDirectory()) await walk(path.join(dir, entry.name), relative);
      else if (entry.isFile()) files.push(relative);
      if (files.length > 200_000) return;
    }
  };
  await walk(root, "");
  return files;
}

export async function searchWorkspace(root: string, options: SearchOptions): Promise<SearchResult> {
  const started = Date.now();
  const include = globFilter(options.include);
  const exclude = globFilter(options.exclude);
  const candidates = (await listCandidates(root, options.excludedNames)).filter(
    (file) => (include === null || include(file)) && (exclude === null || !exclude(file)),
  );
  candidates.sort();
  const result: SearchResult = { files: [], matchCount: 0, searchedFiles: 0, truncated: false };
  for (const file of candidates) {
    if (options.signal?.aborted) break;
    if (result.matchCount >= options.maxMatches || Date.now() - started > options.timeLimitMs) {
      result.truncated = true;
      break;
    }
    const absolute = path.join(root, file);
    const info = await lstat(absolute).catch(() => null);
    // Symlinks are skipped: they could lead outside the workspace.
    if (info === null || !info.isFile() || info.size > MAX_SEARCH_FILE_BYTES) continue;
    const bytes = await readFile(absolute).catch(() => null);
    if (bytes === null || bytes.subarray(0, 8000).includes(0)) continue;
    result.searchedFiles++;
    const text = bytes.toString("utf8");
    const matches = findMatches(text, options.query, {
      limit: options.maxMatches - result.matchCount,
      replacement: options.replacement,
    });
    if (matches.length === 0) continue;
    result.matchCount += matches.length;
    result.files.push({ path: file, sha256: createHash("sha256").update(bytes).digest("hex"), matches });
  }
  return result;
}
