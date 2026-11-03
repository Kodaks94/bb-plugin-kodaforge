import { realpath } from "node:fs/promises";
import path from "node:path";
import { resolveWithinRoot } from "./paths.js";

/**
 * The lexical guard in paths.ts stops `..`; this one stops symlinks. It resolves
 * the deepest part of the path that exists (a new file's parent, say) and
 * checks the real location is still under the real root.
 */
export async function checkRealPath(
  root: string,
  relativePath: string,
): Promise<{ ok: true } | { ok: false; reason: string }> {
  let target: string;
  try {
    target = resolveWithinRoot(root, relativePath);
  } catch (error) {
    return { ok: false, reason: (error as Error).message };
  }
  const realRoot = await realpath(root);
  let probe = target;
  for (;;) {
    try {
      const real = await realpath(probe);
      return isInside(realRoot, real)
        ? { ok: true }
        : { ok: false, reason: `Path leaves the workspace through a symlink: ${relativePath}` };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      const parent = path.dirname(probe);
      if (parent === probe) return { ok: false, reason: "Workspace root is missing" };
      probe = parent;
    }
  }
}

export function isInside(realRoot: string, realTarget: string): boolean {
  if (realTarget === realRoot) return true;
  const prefix = realRoot.endsWith(path.sep) ? realRoot : realRoot + path.sep;
  return realTarget.startsWith(prefix);
}
