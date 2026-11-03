/**
 * The native watcher may report absolute or root-relative paths; the app keys
 * tabs by root-relative forward-slash paths. Null for anything outside the root.
 */
export function toRelativeChange(root: string, changed: string): string | null {
  const normal = changed.replace(/\\/g, "/");
  const base = root.replace(/\\/g, "/").replace(/\/+$/, "");
  if (normal === base) return null;
  if (normal.startsWith(base + "/")) return normal.slice(base.length + 1);
  if (/^([a-zA-Z]:)?\//.test(normal)) return null;
  return normal.replace(/^\.\//, "");
}
