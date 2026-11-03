import { expect, it } from "vitest";
import { diffKey, diffSides, parseDiffKey } from "./diff-key.js";

it("round-trips diff keys and rejects plain paths", () => {
  expect(parseDiffKey(diffKey("src/a b.ts", "staged"))).toEqual({ path: "src/a b.ts", side: "staged" });
  expect(parseDiffKey("diff/notes.md")).toBeNull();
  expect(diffSides("working")).toEqual({ original: "index", modified: "disk" });
});
