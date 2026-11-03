/**
 * Terminal layout, VS Code style: tabs ("groups"), each holding up to four
 * terminals split side by side. Pure, so it can be tested and saved per workspace.
 */
export const MAX_SPLITS = 4;

export interface TerminalLayout {
  groups: string[][];
  /** The focused terminal; its group is the visible one. */
  focused: string | null;
}

export const emptyLayout: TerminalLayout = { groups: [], focused: null };

/** Add a terminal as a new tab, or split it into the focused terminal's group. */
export function addTerminal(layout: TerminalLayout, id: string, split: boolean): TerminalLayout {
  const index = groupIndexOf(layout, layout.focused);
  if (split && index !== -1 && layout.groups[index]!.length < MAX_SPLITS) {
    const groups = layout.groups.map((group, i) => {
      if (i !== index) return group;
      const at = group.indexOf(layout.focused!) + 1;
      return [...group.slice(0, at), id, ...group.slice(at)];
    });
    return { groups, focused: id };
  }
  return { groups: [...layout.groups, [id]], focused: id };
}

/** Remove a terminal; an emptied group goes, and focus moves to a neighbour. */
export function removeTerminal(layout: TerminalLayout, id: string): TerminalLayout {
  const index = groupIndexOf(layout, id);
  if (index === -1) return layout;
  const group = layout.groups[index]!;
  const position = group.indexOf(id);
  const remaining = group.filter((t) => t !== id);
  const groups = remaining.length === 0 ? layout.groups.filter((_, i) => i !== index) : layout.groups.map((g, i) => (i === index ? remaining : g));
  if (layout.focused !== id) return { groups, focused: layout.focused };
  const focused =
    remaining.length > 0
      ? remaining[Math.min(position, remaining.length - 1)]!
      : (groups[Math.min(index, groups.length - 1)]?.[0] ?? null);
  return { groups, focused };
}

export function focusTerminal(layout: TerminalLayout, id: string): TerminalLayout {
  return groupIndexOf(layout, id) === -1 ? layout : { ...layout, focused: id };
}

export function visibleGroup(layout: TerminalLayout): string[] {
  return layout.groups[groupIndexOf(layout, layout.focused)] ?? layout.groups[0] ?? [];
}

/** Rebuild a saved layout from the terminals still alive; new ones become their own tabs. */
export function restoreLayout(saved: TerminalLayout | null, alive: readonly string[]): TerminalLayout {
  const live = new Set(alive);
  const groups = (saved?.groups ?? []).map((group) => group.filter((id) => live.has(id))).filter((group) => group.length > 0);
  const placed = new Set(groups.flat());
  for (const id of alive) if (!placed.has(id)) groups.push([id]);
  const focused = saved?.focused && live.has(saved.focused) ? saved.focused : (groups[0]?.[0] ?? null);
  return { groups, focused };
}

function groupIndexOf(layout: TerminalLayout, id: string | null): number {
  return id === null ? -1 : layout.groups.findIndex((group) => group.includes(id));
}
