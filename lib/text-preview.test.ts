import { describe, expect, it } from "vitest";
import { keepOpenTabs, sourceKey, textPreview } from "./text-preview.js";

describe("textPreview", () => {
  it("covers Markdown and SVG, whatever the case or folder", () => {
    expect(textPreview("README.md")).toBe("markdown");
    expect(textPreview("docs/Очень длинное имя.MD")).toBe("markdown");
    expect(textPreview("a/logo.svg")).toBe("svg");
    for (const path of ["a.mdx", "readme", "x.md/y.ts", "main.py"]) expect(textPreview(path)).toBeNull();
  });
});

describe("keepOpenTabs", () => {
  it("drops closed tabs, keeps the rest, and is stable when nothing closed", () => {
    const source = new Set([sourceKey(0, "a.md"), sourceKey(1, "a.md")]);
    expect(keepOpenTabs(source, [{ id: 0, tabs: ["a.md"] }, { id: 1, tabs: ["a.md"] }])).toBe(source);
    expect([...keepOpenTabs(source, [{ id: 0, tabs: ["a.md"] }])]).toEqual([sourceKey(0, "a.md")]);
  });
});
