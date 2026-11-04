import { describe, expect, it } from "vitest";
import { editorReducer, remapPath, initialEditorState, onDiskChange, openPaths, type EditorAction } from "./editor-state.js";

const run = (...actions: EditorAction[]) => actions.reduce(editorReducer, initialEditorState);

describe("editor groups", () => {
  it("opens tabs once and activates them", () => {
    const state = run({ type: "open", path: "a" }, { type: "open", path: "b" }, { type: "open", path: "a" });
    expect(state.groups[0]).toMatchObject({ tabs: ["a", "b"], active: "a" });
  });

  it("splits the active tab into a new group, up to four", () => {
    let state = run({ type: "open", path: "a" }, { type: "split" });
    expect(state.groups.map((g) => g.tabs)).toEqual([["a"], ["a"]]);
    expect(state.focused).toBe(1);
    state = [1, 2, 3].reduce((current) => editorReducer(current, { type: "split" }), state);
    expect(state.groups).toHaveLength(4);
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

it("restores saved groups, dropping empty ones and fixing a missing active tab", () => {
  const state = editorReducer(initialEditorState, {
    type: "restore",
    groups: [{ tabs: ["a", "b"], active: "b" }, { tabs: [], active: null }, { tabs: ["c"], active: "gone" }],
    focused: 5,
  });
  expect(state.groups).toEqual([
    { id: 0, tabs: ["a", "b"], active: "b", pinned: [] },
    { id: 1, tabs: ["c"], active: "c", pinned: [] },
  ]);
  expect(state.focused).toBe(1);
  expect(editorReducer(initialEditorState, { type: "restore", groups: [], focused: 0 })).toBe(initialEditorState);
});

describe("tab management", () => {
  const three = () => run({ type: "open", path: "a" }, { type: "open", path: "b" }, { type: "open", path: "c" });
  const tabs = (state: ReturnType<typeof run>) => state.groups.map((g) => g.tabs);

  it("reorders by drag within a group, either direction", () => {
    expect(tabs(editorReducer(three(), { type: "move", path: "c", from: 0, to: 0, index: 0 }))).toEqual([["c", "a", "b"]]);
    expect(tabs(editorReducer(three(), { type: "move", path: "a", from: 0, to: 0, index: 3 }))).toEqual([["b", "c", "a"]]);
    expect(tabs(editorReducer(three(), { type: "move", path: "a", from: 0, to: 0, index: 2 }))).toEqual([["b", "a", "c"]]);
  });

  it("drags into another group, or copies with alt, and drops an emptied group", () => {
    let state = editorReducer(three(), { type: "open", path: "z", toSide: true });
    expect(tabs(editorReducer(state, { type: "move", path: "a", from: 0, to: 1, index: 0 }))).toEqual([["b", "c"], ["a", "z"]]);
    expect(tabs(editorReducer(state, { type: "move", path: "a", from: 0, to: 1, copy: true }))).toEqual([["a", "b", "c"], ["z", "a"]]);
    state = editorReducer(state, { type: "move", path: "z", from: 1, to: 0 });
    expect(tabs(state)).toEqual([["a", "b", "c", "z"]]);
    expect(state.focused).toBe(0);
  });

  it("drops on an edge to split left or right, but not a group's only tab", () => {
    const right = editorReducer(three(), { type: "moveToNewGroup", path: "b", from: 0, at: 1 });
    expect(tabs(right)).toEqual([["a", "c"], ["b"]]);
    expect(right.focused).toBe(1);
    expect(tabs(editorReducer(three(), { type: "moveToNewGroup", path: "b", from: 0, at: 0 }))).toEqual([["b"], ["a", "c"]]);
    const lone = run({ type: "open", path: "a" });
    expect(editorReducer(lone, { type: "moveToNewGroup", path: "a", from: 0, at: 1 })).toBe(lone);
    expect(tabs(editorReducer(lone, { type: "moveToNewGroup", path: "a", from: 0, at: 1, copy: true }))).toEqual([["a"], ["a"]]);
  });

  it("moves the active tab to the next group, making one when needed", () => {
    let state = editorReducer(three(), { type: "moveActive", delta: 1 });
    expect(tabs(state)).toEqual([["a", "b"], ["c"]]);
    state = editorReducer(state, { type: "moveActive", delta: -1 });
    expect(tabs(state)).toEqual([["a", "b", "c"]]);
  });

  it("pins tabs first and keeps them through bulk closes; unsaved ones are kept too", () => {
    let state = editorReducer(three(), { type: "togglePin", path: "c", group: 0 });
    expect(state.groups[0]).toMatchObject({ tabs: ["c", "a", "b"], pinned: ["c"] });
    expect(tabs(editorReducer(state, { type: "closeOthers", path: "a", group: 0, keep: [] }))).toEqual([["c", "a"]]);
    expect(tabs(editorReducer(state, { type: "closeAll", group: 0, keep: ["b"] }))).toEqual([["c", "b"]]);
    expect(tabs(editorReducer(state, { type: "closeRight", path: "c", group: 0, keep: [] }))).toEqual([["c"]]);
    state = editorReducer(state, { type: "togglePin", path: "c", group: 0 });
    expect(state.groups[0]!.pinned).toEqual([]);
  });

  it("remembers closed tabs for reopening, newest last", () => {
    let state = editorReducer(three(), { type: "close", path: "a", group: 0 });
    state = editorReducer(state, { type: "closeOthers", path: "b", group: 0, keep: [] });
    expect(state.closed).toEqual(["a", "c"]);
    expect(editorReducer(state, { type: "forgetClosed", path: "c" }).closed).toEqual(["a"]);
  });

  it("cycles tabs with wrap-around", () => {
    expect(editorReducer(three(), { type: "cycle", delta: 1 }).groups[0]!.active).toBe("a");
    expect(editorReducer(three(), { type: "cycle", delta: -1 }).groups[0]!.active).toBe("b");
  });
});
