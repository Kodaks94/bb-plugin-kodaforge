import { expect, it } from "vitest";
import { closeTab, MAX_OPEN, openTab, parseSaved } from "./open-workspaces.js";

it("opens each workspace once, after the active tab", () => {
  let list = openTab([], "project/a");
  list = openTab(list, "project/b");
  list = openTab(list, "environment/c", "project/a");
  expect(list).toEqual(["project/a", "environment/c", "project/b"]);
  expect(openTab(list, "project/a")).toEqual(list);
});

it("drops the oldest tab past the limit, never the one being opened", () => {
  let list: string[] = [];
  for (let i = 0; i < MAX_OPEN + 2; i++) list = openTab(list, `project/p${i}`);
  expect(list).toHaveLength(MAX_OPEN);
  expect(list.at(-1)).toBe(`project/p${MAX_OPEN + 1}`);
  expect(list).not.toContain("project/p0");
});

it("closing the active tab shows its right neighbour, else the left one", () => {
  const list = ["project/a", "project/b", "project/c"];
  expect(closeTab(list, "project/b", "project/b")).toEqual({ list: ["project/a", "project/c"], active: "project/c" });
  expect(closeTab(list, "project/c", "project/c")).toEqual({ list: ["project/a", "project/b"], active: "project/b" });
  expect(closeTab(list, "project/a", "project/c")).toEqual({ list: ["project/b", "project/c"], active: "project/c" });
  expect(closeTab(["project/a"], "project/a", "project/a")).toEqual({ list: [], active: null });
});

it("reads only valid saved keys", () => {
  expect(parseSaved('["project/a","nope","project/a","thread/t1",3]')).toEqual(["project/a", "thread/t1"]);
  expect(parseSaved("{bad")).toEqual([]);
  expect(parseSaved(null)).toEqual([]);
});
