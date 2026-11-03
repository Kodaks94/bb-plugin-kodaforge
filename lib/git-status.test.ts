import { expect, it } from "vitest";
import { decorateTree, parsePorcelain, withinPrefix } from "./git-status.js";

it("parses porcelain v1 -z with branch, rename and untracked", () => {
  const out = "## main...origin/main [ahead 1]\0 M src/a.ts\0R  new.ts\0old.ts\0?? notes/todo.md\0UU c.ts\0";
  const status = parsePorcelain(out);
  expect(status).toMatchObject({ branch: "main", upstream: "origin/main", ahead: 1, behind: 0 });
  expect(parsePorcelain("## dev...origin/dev [ahead 2, behind 3]\0")).toMatchObject({ ahead: 2, behind: 3 });
  expect(parsePorcelain("## solo\0")).toMatchObject({ branch: "solo", upstream: null });
  expect(status.entries).toEqual([
    { path: "src/a.ts", index: " ", worktree: "M" },
    { path: "new.ts", index: "R", worktree: " ", origPath: "old.ts" },
    { path: "notes/todo.md", index: "?", worktree: "?" },
    { path: "c.ts", index: "U", worktree: "U" },
  ]);
  expect(parsePorcelain("## No commits yet on dev\0").branch).toBe("dev");
});

it("decorates files and their folders with the strongest change", () => {
  const map = decorateTree(parsePorcelain("?? src/new.ts\0 M src/deep/a.ts\0").entries);
  expect(map.get("src/new.ts")).toBe("untracked");
  expect(map.get("src/deep")).toBe("modified");
  expect(map.get("src")).toBe("modified");
});

it("keeps only entries under the workspace's repo prefix", () => {
  const status = withinPrefix(parsePorcelain(" M app/a.ts\0 M other/b.ts\0R  app/n.ts\0old/o.ts\0"), "app/");
  expect(status.entries).toEqual([
    { path: "a.ts", index: " ", worktree: "M" },
    { path: "n.ts", index: "R", worktree: " " },
  ]);
});
