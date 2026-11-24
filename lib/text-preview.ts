/** Text files that open as a preview, with their source one click away. */
export type TextPreview = "markdown" | "svg";

export function textPreview(path: string): TextPreview | null {
  if (/\.(md|markdown|mdown)$/i.test(path)) return "markdown";
  return /\.svg$/i.test(path) ? "svg" : null;
}

/** Whether a tab shows its preview: per group, so source and preview can sit side by side. */
export function sourceKey(groupId: number, path: string): string {
  return `${groupId}:${path}`;
}

/** Forget the choice for tabs that are gone. Returns the same set when nothing changed. */
export function keepOpenTabs(source: ReadonlySet<string>, groups: readonly { id: number; tabs: readonly string[] }[]): ReadonlySet<string> {
  const open = new Set(groups.flatMap((group) => group.tabs.map((path) => sourceKey(group.id, path))));
  const kept = [...source].filter((key) => open.has(key));
  return kept.length === source.size ? source : new Set(kept);
}
