import { describe, expect, it, vi } from "vitest";
import { currentSlots, registerSlot, slotFor, slotsVersion, subscribeSlots } from "./header-slot.js";

interface Node { parentElement: Node | null; contains(node: Node): boolean }
function node(parent: Node | null): Node {
  const self: Node = {
    parentElement: parent,
    contains(other: Node | null) {
      for (let at = other; at !== null; at = at.parentElement) if (at === self) return true;
      return false;
    },
  };
  return self;
}

describe("slotFor", () => {
  it("finds the title bar of the page's own pane", () => {
    const root = node(null);
    const [left, right] = [node(root), node(root)];
    const [leftBar, rightBar] = [node(node(left)), node(node(right))];
    expect(slotFor(node(node(left)), [leftBar, rightBar])).toBe(leftBar);
    expect(slotFor(node(node(right)), [leftBar, rightBar])).toBe(rightBar);
  });
  it("gives none when there is no bar, or no telling which", () => {
    const root = node(null);
    expect(slotFor(node(root), [])).toBeNull();
    expect(slotFor(node(root), [node(root), node(root)])).toBeNull();
    // A page in a pane without a bar must not borrow another pane's when several exist.
    const [a, b, c] = [node(root), node(root), node(root)];
    expect(slotFor(node(c), [node(a), node(b)])).toBeNull();
  });
});

describe("registerSlot", () => {
  it("tells listeners when a bar comes and goes", () => {
    const listener = vi.fn();
    const stop = subscribeSlots(listener);
    const before = slotsVersion();
    const leave = registerSlot({} as HTMLElement);
    expect([...currentSlots()]).toHaveLength(1);
    leave();
    stop();
    registerSlot({} as HTMLElement)();
    expect([...currentSlots()]).toHaveLength(0);
    expect(listener).toHaveBeenCalledTimes(2);
    expect(slotsVersion()).toBe(before + 4);
  });
});
