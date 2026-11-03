import { describe, expect, it } from "vitest";
import { editorReducer, remapPath, initialEditorState, onDiskChange, openPaths, type EditorAction } from "./editor-state.js";

const run = (...actions: EditorAction[]) => actions.reduce(editorReducer, initialEditorState);

describe("editor groups", () => {
  it("opens tabs once and activates them", () => {
    const state = run({ type: "open", path: "a" }, { type: "open", path: "b" }, { type: "open", path: "a" });
    expect(state.groups[0]).toMatchObject({ tabs: ["a", "b"], active: "a" });
  });

  it("splits the active tab into a new group, up to three", () => {
    let state = run({ type: "open", path: "a" }, { type: "split" });
    expect(state.groups.map((g) => g.tabs)).toEqual([["a"], ["a"]]);
    expect(state.focused).toBe(1);
    state = editorReducer(editorReducer(state, { type: "split" }), { type: "split" });
    expect(state.groups).toHaveLength(3);
  });

  it("closing activates the neighbour and drops an emptied split", () => {
    let state = run({ type: "open", path: "a" }, { type: "open", path: "b" }, { type: "open", path: "c" });
    state = editorReducer(state, { type: "activate", path: "b", group: 0 });
    state = editorReducer(state, { type: "close", path: "b", group: 0 });
    expect(state.groups[0]).toMatchObject({ tabs: ["a", "c"], active: "c" });
    state = editorReducer(state, { type: "open", path: "z", toSide: true });
    state = editorReducer(state, { type: "close", path: "z", group: 1 });
    expect(state.groups).toHaveLength(1);
    expect(state.focused).toBe(0);
  });

  it("closeEverywhere and rename touch every group", () => {
    let state = run({ type: "open", path: "a" }, { type: "split" }, { type: "open", path: "b" });
    state = editorReducer(state, { type: "rename", from: "a", to: "a2" });
    expect(openPaths(state)).toEqual(["a2", "b"]);
    state = editorReducer(state, { type: "closeEverywhere", path: "a2" });
    expect(openPaths(state)).toEqual(["b"]);
  });
});

describe("onDiskChange", () => {
  it("reloads clean tabs, flags dirty ones, ignores our own save", () => {
    expect(onDiskChange({ dirty: false, sha256: "1" }, "2")).toBe("reload");
    expect(onDiskChange({ dirty: true, sha256: "1" }, "2")).toBe("conflict");
    expect(onDiskChange({ dirty: true, sha256: "1" }, "1")).toBe("ignore");
    expect(onDiskChange({ dirty: false, sha256: "1" }, null)).toBe("deleted");
  });
});

it("rename follows a renamed folder", () => {
  expect(remapPath("src/a/b.ts", "src/a", "lib")).toBe("lib/b.ts");
  expect(remapPath("src/ab.ts", "src/a", "lib")).toBeNull();
  const state = run({ type: "open", path: "src/a/b.ts" }, { type: "rename", from: "src/a", to: "lib" });
  expect(state.groups[0]).toMatchObject({ tabs: ["lib/b.ts"], active: "lib/b.ts" });
});
