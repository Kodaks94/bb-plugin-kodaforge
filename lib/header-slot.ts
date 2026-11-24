/**
 * BB's shared title bar has room on the right for a page's own content. The page draws its
 * workspace tabs and panel switches there instead of a second bar below it. BB renders that
 * content apart from the page (and once per split pane), so the two meet here.
 */
const slots = new Set<HTMLElement>();
const listeners = new Set<() => void>();
let version = 0;

export function registerSlot(slot: HTMLElement): () => void {
  slots.add(slot);
  version++;
  listeners.forEach((listener) => listener());
  return () => {
    slots.delete(slot);
    version++;
    listeners.forEach((listener) => listener());
  };
}

export function subscribeSlots(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export const slotsVersion = () => version;

/** The title bar over `page`: the one that shares its closest pane, in this order of nearness. */
export function slotFor<T extends { parentElement: T | null; contains(node: never): boolean }>(page: T, candidates: Iterable<T>): T | null {
  const all = [...candidates];
  for (let around = page.parentElement; around !== null; around = around.parentElement) {
    const inside = all.filter((slot) => around.contains(slot as never));
    if (inside.length === 1) return inside[0]!;
    // Two title bars under the first common ancestor: no telling which is this page's.
    if (inside.length > 1) return null;
  }
  return null;
}

export const currentSlots = (): Iterable<HTMLElement> => slots;

/** Narrower than this, the title bar has no room and the page keeps its own bar. */
export const MIN_HEADER_WIDTH = 760;
/** Left to the bar itself: the name, BB's own buttons, and a stretch that drags the window. */
export const HEADER_RESERVE = 300;
