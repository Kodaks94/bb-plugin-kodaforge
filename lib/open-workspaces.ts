/**
 * The workspaces open as tabs in the KodaForge page, by route key ("project/<id>",
 * "environment/<id>", "thread/<id>"). Pure, so it can be tested and saved.
 */
export const MAX_OPEN = 8;
const KEY = /^(project|environment|thread)\/[^/\s]{1,200}$/;

export function isWorkspaceKey(value: unknown): value is string {
  return typeof value === "string" && KEY.test(value);
}

/** Open `key` (once), placed after the active tab; the oldest tab drops off past the limit. */
export function openTab(list: readonly string[], key: string, after: string | null = null): string[] {
  if (list.includes(key)) return [...list];
  const at = after !== null && list.includes(after) ? list.indexOf(after) + 1 : list.length;
  const next = [...list.slice(0, at), key, ...list.slice(at)];
  while (next.length > MAX_OPEN) next.splice(next.findIndex((k) => k !== key), 1);
  return next;
}

/** Close `key`; returns the new list and which tab to show next (its right neighbour, else left). */
export function closeTab(list: readonly string[], key: string, active: string): { list: string[]; active: string | null } {
  const index = list.indexOf(key);
  if (index === -1) return { list: [...list], active };
  const next = list.filter((k) => k !== key);
  if (active !== key) return { list: next, active };
  return { list: next, active: next[index] ?? next[index - 1] ?? null };
}

/** Read a saved list, keeping only well-formed, unique keys. */
export function parseSaved(raw: string | null): string[] {
  try {
    const value = JSON.parse(raw ?? "[]");
    return Array.isArray(value) ? [...new Set(value.filter(isWorkspaceKey))].slice(0, MAX_OPEN) : [];
  } catch {
    return [];
  }
}
