import { describe, expect, it } from "vitest";
import { addTerminal, emptyLayout, focusTerminal, MAX_SPLITS, removeTerminal, restoreLayout, visibleGroup } from "./terminal-groups.js";

describe("terminal layout", () => {
  it("adds tabs and splits beside the focused terminal, up to the limit", () => {
    let layout = addTerminal(emptyLayout, "a", false);
    layout = addTerminal(layout, "b", false);
    layout = focusTerminal(layout, "a");
    layout = addTerminal(layout, "a2", true);
    expect(layout.groups).toEqual([["a", "a2"], ["b"]]);
    expect(visibleGroup(layout)).toEqual(["a", "a2"]);
    for (let i = 3; i <= MAX_SPLITS + 1; i++) layout = addTerminal(layout, `a${i}`, true);
    expect(layout.groups[0]).toHaveLength(MAX_SPLITS);
    expect(layout.groups).toHaveLength(3);
  });

  it("removing moves focus to a neighbour and drops empty groups", () => {
    let layout = addTerminal(addTerminal(addTerminal(emptyLayout, "a", false), "a2", true), "b", false);
    layout = focusTerminal(layout, "a2");
    layout = removeTerminal(layout, "a2");
    expect(layout).toEqual({ groups: [["a"], ["b"]], focused: "a" });
    layout = removeTerminal(layout, "a");
    expect(layout).toEqual({ groups: [["b"]], focused: "b" });
    expect(removeTerminal(layout, "b")).toEqual({ groups: [], focused: null });
  });

  it("restores a saved layout from live terminals", () => {
    const saved = { groups: [["a", "gone", "c"], ["d"]], focused: "gone" };
    expect(restoreLayout(saved, ["c", "a", "new"])).toEqual({ groups: [["a", "c"], ["new"]], focused: "a" });
    expect(restoreLayout(null, ["x"])).toEqual({ groups: [["x"]], focused: "x" });
  });
});
