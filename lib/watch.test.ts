import { expect, it } from "vitest";
import { toRelativeChange } from "./watch.js";

it("maps watcher paths to root-relative ones", () => {
  expect(toRelativeChange("/w/repo", "/w/repo/src/a.ts")).toBe("src/a.ts");
  expect(toRelativeChange("/w/repo/", "src/a.ts")).toBe("src/a.ts");
  expect(toRelativeChange("/w/repo", "/w/repo")).toBeNull();
  expect(toRelativeChange("/w/repo", "/w/repo2/x")).toBeNull();
  expect(toRelativeChange("C:\\w\\repo", "C:\\w\\repo\\a.ts")).toBe("a.ts");
});
