/**
 * The Explorer's context menu, open to other plugins on the page (docs/explorer-menu.md):
 * when it opens, a "kodaforge:explorer-menu" event is dispatched on window, and listeners
 * may push items (reveal in the system file manager, open in another editor…) into
 * `detail.items`.
 */
export const EXPLORER_MENU_EVENT = "kodaforge:explorer-menu";
/** Grows only if a listener written for an older one could misread the detail. */
export const EXPLORER_MENU_VERSION = 1;
const MAX_ADDED = 8;

export interface ExplorerMenuItem {
  label: string;
  run(): unknown;
}

export interface ExplorerMenuDetail {
  version: number;
  /** The machine the workspace is on. */
  hostId: string;
  /** Absolute path on that machine. */
  path: string;
  kind: "file" | "directory";
  items: ExplorerMenuItem[];
}

/** A workspace path as an absolute one, in the host's own flavour. */
export function absolutePath(root: string, relativePath: string): string {
  const windows = /^[a-zA-Z]:[\\/]/.test(root) || root.startsWith("\\\\");
  const separator = windows ? "\\" : "/";
  const base = root.length > 1 && /[\\/]$/.test(root) && !/^[a-zA-Z]:[\\/]$/.test(root) ? root.slice(0, -1) : root;
  if (relativePath === "") return base;
  const tail = windows ? relativePath.replace(/\//g, "\\") : relativePath;
  return /[\\/]$/.test(base) ? base + tail : base + separator + tail;
}

/**
 * Items other plugins add for this entry, in the order they were pushed. A listener that
 * throws adds nothing (dispatchEvent reports it and goes on); an item that fails, at once or
 * later, reaches `onError`, so neither can break the menu.
 */
export function addedItems(
  target: EventTarget,
  entry: Omit<ExplorerMenuDetail, "items" | "version">,
  onError: (label: string, error: unknown) => void,
): ExplorerMenuItem[] {
  const items: unknown[] = [];
  target.dispatchEvent(new CustomEvent(EXPLORER_MENU_EVENT, { detail: { version: EXPLORER_MENU_VERSION, ...entry, items } }));
  return items
    .filter(
      (item): item is ExplorerMenuItem =>
        typeof item === "object" && item !== null && typeof (item as ExplorerMenuItem).label === "string" && typeof (item as ExplorerMenuItem).run === "function",
    )
    .slice(0, MAX_ADDED)
    .map((item) => ({
      label: item.label.slice(0, 80),
      run: () => {
        void (async () => item.run())().catch((error: unknown) => onError(item.label, error));
      },
    }));
}
