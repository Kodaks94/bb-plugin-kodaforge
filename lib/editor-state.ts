/**
 * Editor groups and their tabs, as a pure reducer. File contents live in Monaco
 * models (one per path, shared by every group), so a path open in two groups
 * shows the same buffer and the same dirty state.
 */

export const MAX_GROUPS = 3;

export interface Group {
  id: number;
  tabs: string[];
  active: string | null;
}

export interface EditorState {
  groups: Group[];
  focused: number;
  nextId: number;
}

export type EditorAction =
  | { type: "open"; path: string; toSide?: boolean }
  | { type: "close"; path: string; group: number }
  | { type: "closeEverywhere"; path: string }
  | { type: "activate"; path: string; group: number }
  | { type: "focus"; group: number }
  | { type: "split" }
  | { type: "rename"; from: string; to: string };

export const initialEditorState: EditorState = {
  groups: [{ id: 0, tabs: [], active: null }],
  focused: 0,
  nextId: 1,
};

export function editorReducer(state: EditorState, action: EditorAction): EditorState {
  switch (action.type) {
    case "open": {
      if (action.toSide && state.groups.length < MAX_GROUPS) {
        const groups = [...state.groups, { id: state.nextId, tabs: [action.path], active: action.path }];
        return { groups, focused: groups.length - 1, nextId: state.nextId + 1 };
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
      return dropEmptyGroups({
        ...state,
        groups: updateGroup(state.groups, action.group, (group) => closeTab(group, action.path)),
      });
    case "closeEverywhere":
      return dropEmptyGroups({ ...state, groups: state.groups.map((group) => closeTab(group, action.path)) });
    case "split": {
      const current = state.groups[state.focused];
      if (current?.active == null) return state;
      return editorReducer(state, { type: "open", path: current.active, toSide: true });
    }
    case "rename": {
      const map = (path: string) => remapPath(path, action.from, action.to) ?? path;
      return {
        ...state,
        groups: state.groups.map((group) => ({
          ...group,
          tabs: group.tabs.map(map),
          active: group.active === null ? null : map(group.active),
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
  return { ...group, tabs, active };
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
