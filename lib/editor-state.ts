/**
 * Editor groups and their tabs, as a pure reducer. File contents live in Monaco
 * models (one per path, shared by every group), so a path open in two groups
 * shows the same buffer and the same dirty state.
 */

export const MAX_GROUPS = 4;
/** How many closed tabs ⌘⇧T can bring back. */
const MAX_CLOSED = 20;

/** The Agent Network view, opened as an editor tab so it can sit beside code. */
export const AGENTS_TAB = "view:agents";

/** Tabs that aren't files: diffs and views. They have no Monaco model to load or save. */
export function isVirtualTab(path: string): boolean {
  return path.startsWith("diff:") || path.startsWith("view:");
}

export interface Group {
  id: number;
  tabs: string[];
  active: string | null;
  /** Pinned tabs sit first, in this order, and survive Close Others / Close All. */
  pinned: string[];
}

export interface EditorState {
  groups: Group[];
  focused: number;
  nextId: number;
  /** Recently closed tabs, newest last, for Reopen Closed Editor. */
  closed: string[];
}

export type EditorAction =
  | { type: "open"; path: string; toSide?: boolean }
  | { type: "close"; path: string; group: number }
  | { type: "closeEverywhere"; path: string }
  | { type: "activate"; path: string; group: number }
  | { type: "focus"; group: number }
  | { type: "split" }
  /** Drag and drop: into group `to` at `index` (end if omitted). `copy` keeps it in `from` too. */
  | { type: "move"; path: string; from: number; to: number; index?: number; copy?: boolean }
  /** Drop on an editor's edge: a new group inserted at position `at`. */
  | { type: "moveToNewGroup"; path: string; from: number; at: number; copy?: boolean }
  /** Move the focused group's active tab to the next (1) or previous (-1) group, creating one at the end. */
  | { type: "moveActive"; delta: 1 | -1 }
  | { type: "cycle"; delta: 1 | -1 }
  | { type: "togglePin"; path: string; group: number }
  /** Bulk closes skip pinned tabs and any path in `keep` (unsaved ones). */
  | { type: "closeOthers"; path: string; group: number; keep: string[] }
  | { type: "closeRight"; path: string; group: number; keep: string[] }
  | { type: "closeAll"; group: number; keep: string[] }
  | { type: "forgetClosed"; path: string }
  | { type: "rename"; from: string; to: string }
  | { type: "restore"; groups: { tabs: string[]; active: string | null; pinned?: string[] }[]; focused: number };

export const initialEditorState: EditorState = {
  groups: [{ id: 0, tabs: [], active: null, pinned: [] }],
  focused: 0,
  nextId: 1,
  closed: [],
};

export function editorReducer(state: EditorState, action: EditorAction): EditorState {
  switch (action.type) {
    case "open": {
      if (action.toSide && state.groups.length < MAX_GROUPS) {
        const groups = [...state.groups, { id: state.nextId, tabs: [action.path], active: action.path, pinned: [] }];
        return { ...state, groups, focused: groups.length - 1, nextId: state.nextId + 1 };
      }
      const index = action.toSide ? Math.min(state.focused + 1, state.groups.length - 1) : state.focused;
      return {
        ...state,
        focused: index,
        groups: updateGroup(state.groups, index, (group) => ({
          ...group,
          tabs: group.tabs.includes(action.path) ? group.tabs : [...group.tabs, action.path],
          active: action.path,
        })),
      };
    }
    case "activate":
      if (!state.groups[action.group]?.tabs.includes(action.path)) return state;
      return {
        ...state,
        focused: action.group,
        groups: updateGroup(state.groups, action.group, (group) => ({ ...group, active: action.path })),
      };
    case "focus":
      return action.group >= 0 && action.group < state.groups.length ? { ...state, focused: action.group } : state;
    case "close":
      if (!state.groups[action.group]?.tabs.includes(action.path)) return state;
      return dropEmptyGroups({
        ...state,
        closed: remember(state.closed, [action.path]),
        groups: updateGroup(state.groups, action.group, (group) => closeTab(group, action.path)),
      });
    case "closeOthers":
    case "closeRight":
    case "closeAll": {
      const group = state.groups[action.group];
      if (group === undefined) return state;
      const from = action.type === "closeRight" ? group.tabs.indexOf(action.path) + 1 : 0;
      if (action.type === "closeRight" && from === 0) return state;
      const doomed = group.tabs
        .slice(from)
        .filter((tab) => !group.pinned.includes(tab) && !action.keep.includes(tab) && (action.type === "closeAll" || tab !== action.path));
      if (doomed.length === 0) return state;
      let next = group;
      for (const tab of doomed) next = closeTab(next, tab);
      if (action.type !== "closeAll" && next.tabs.includes(action.path)) next = { ...next, active: action.path };
      return dropEmptyGroups({ ...state, focused: action.group, closed: remember(state.closed, doomed), groups: updateGroup(state.groups, action.group, () => next) });
    }
    case "forgetClosed":
      return { ...state, closed: state.closed.filter((path) => path !== action.path) };
    case "togglePin": {
      const group = state.groups[action.group];
      if (!group?.tabs.includes(action.path)) return state;
      const pinned = group.pinned.includes(action.path) ? group.pinned.filter((p) => p !== action.path) : [...group.pinned, action.path];
      return { ...state, groups: updateGroup(state.groups, action.group, (g) => withPinnedFirst({ ...g, pinned })) };
    }
    case "cycle": {
      const group = state.groups[state.focused];
      if (!group || group.tabs.length < 2 || group.active === null) return state;
      const at = group.tabs.indexOf(group.active);
      const active = group.tabs[(at + action.delta + group.tabs.length) % group.tabs.length]!;
      return { ...state, groups: updateGroup(state.groups, state.focused, (g) => ({ ...g, active })) };
    }
    case "move": {
      const source = state.groups[action.from];
      const target = state.groups[action.to];
      if (!source?.tabs.includes(action.path) || target === undefined) return state;
      const copy = action.copy === true && action.from !== action.to;
      let groups = state.groups;
      if (!copy) groups = updateGroup(groups, action.from, (g) => ({ ...closeTab(g, action.path), pinned: g.pinned.filter((p) => p !== action.path) }));
      groups = updateGroup(groups, action.to, (g) => {
        const tabs = g.tabs.filter((tab) => tab !== action.path);
        // Index counts positions before the move; dropping right of yourself shifts by one.
        let index = action.index ?? tabs.length;
        if (action.from === action.to && action.index !== undefined && source.tabs.indexOf(action.path) < action.index) index -= 1;
        tabs.splice(Math.max(0, Math.min(index, tabs.length)), 0, action.path);
        return withPinnedFirst({ ...g, tabs, active: action.path });
      });
      return dropEmptyGroups({ ...state, groups, focused: action.to });
    }
    case "moveToNewGroup": {
      const source = state.groups[action.from];
      if (!source?.tabs.includes(action.path) || state.groups.length >= MAX_GROUPS) return state;
      // Moving a group's only tab out to its own edge would just recreate it.
      if (!action.copy && source.tabs.length === 1) return state;
      let groups = state.groups;
      if (!action.copy) groups = updateGroup(groups, action.from, (g) => ({ ...closeTab(g, action.path), pinned: g.pinned.filter((p) => p !== action.path) }));
      const at = Math.max(0, Math.min(action.at, groups.length));
      groups = [...groups.slice(0, at), { id: state.nextId, tabs: [action.path], active: action.path, pinned: [] }, ...groups.slice(at)];
      return { ...state, groups, focused: at, nextId: state.nextId + 1 };
    }
    case "moveActive": {
      const group = state.groups[state.focused];
      if (group?.active == null) return state;
      const to = state.focused + action.delta;
      if (to < 0) return state;
      if (to >= state.groups.length) return editorReducer(state, { type: "moveToNewGroup", path: group.active, from: state.focused, at: state.groups.length });
      return editorReducer(state, { type: "move", path: group.active, from: state.focused, to });
    }
    case "closeEverywhere":
      return dropEmptyGroups({ ...state, groups: state.groups.map((group) => closeTab(group, action.path)) });
    case "split": {
      const current = state.groups[state.focused];
      if (current?.active == null) return state;
      return editorReducer(state, { type: "open", path: current.active, toSide: true });
    }
    case "restore": {
      // Saved tabs come back minus any that could not be reopened (already filtered).
      const groups = action.groups
        .filter((group) => group.tabs.length > 0)
        .slice(0, MAX_GROUPS)
        .map((group, id) =>
          withPinnedFirst({
            id,
            tabs: group.tabs,
            active: group.active !== null && group.tabs.includes(group.active) ? group.active : group.tabs[0]!,
            pinned: (group.pinned ?? []).filter((path) => group.tabs.includes(path)),
          }),
        );
      if (groups.length === 0) return state;
      return { ...state, groups, focused: Math.min(Math.max(action.focused, 0), groups.length - 1), nextId: groups.length };
    }
    case "rename": {
      const map = (path: string) => remapPath(path, action.from, action.to) ?? path;
      return {
        ...state,
        groups: state.groups.map((group) => ({
          ...group,
          tabs: group.tabs.map(map),
          active: group.active === null ? null : map(group.active),
          pinned: group.pinned.map(map),
        })),
      };
    }
  }
}

function updateGroup(groups: Group[], index: number, update: (group: Group) => Group): Group[] {
  return groups.map((group, i) => (i === index ? update(group) : group));
}

/** Closing the active tab activates its right neighbour, else its left one. */
function closeTab(group: Group, path: string): Group {
  const index = group.tabs.indexOf(path);
  if (index === -1) return group;
  const tabs = group.tabs.filter((tab) => tab !== path);
  const active = group.active === path ? (tabs[index] ?? tabs[index - 1] ?? null) : group.active;
  return { ...group, tabs, active, pinned: group.pinned.filter((tab) => tab !== path) };
}

function remember(closed: string[], paths: string[]): string[] {
  return [...closed.filter((path) => !paths.includes(path)), ...paths].slice(-MAX_CLOSED);
}

/** Pinned tabs first (in pin order), then the rest in their current order. */
function withPinnedFirst(group: Group): Group {
  const pinned = group.pinned.filter((path) => group.tabs.includes(path));
  return { ...group, pinned, tabs: [...pinned, ...group.tabs.filter((path) => !pinned.includes(path))] };
}

function dropEmptyGroups(state: EditorState): EditorState {
  if (state.groups.length === 1) return state;
  const groups = state.groups.filter((group) => group.tabs.length > 0);
  if (groups.length === 0) return { ...state, groups: [state.groups[0]!], focused: 0 };
  const focusedId = state.groups[state.focused]?.id;
  const focused = groups.findIndex((group) => group.id === focusedId);
  return { ...state, groups, focused: focused === -1 ? Math.min(state.focused, groups.length - 1) : focused };
}

/** Where `path` ends up when `from` (a file or a folder) is renamed to `to`; null if unaffected. */
export function remapPath(path: string, from: string, to: string): string | null {
  if (path === from) return to;
  if (path.startsWith(`${from}/`)) return to + path.slice(from.length);
  return null;
}

/** Every path open in any group, once. */
export function openPaths(state: EditorState): string[] {
  return [...new Set(state.groups.flatMap((group) => group.tabs))];
}

/**
 * What to do when the watcher says an open file changed on disk. A clean tab
 * follows the disk silently; a dirty one keeps the user's edits and is flagged,
 * so the next save hits the hash guard and offers Reload or Overwrite.
 */
export function onDiskChange(file: { dirty: boolean; sha256: string }, diskSha256: string | null) {
  if (diskSha256 === file.sha256) return "ignore" as const;
  if (diskSha256 === null) return "deleted" as const;
  return file.dirty ? ("conflict" as const) : ("reload" as const);
}
