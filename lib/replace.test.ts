import { describe, expect, it } from "vitest";
import { applyReplacements, findMatches } from "./replace.js";

const q = (query: string, extra: Partial<{ regex: boolean; matchCase: boolean; wholeWord: boolean }> = {}) => ({
  query,
  regex: false,
  matchCase: true,
  wholeWord: false,
  ...extra,
});

describe("findMatches", () => {
  it("reports line, column and a preview with the replacement", () => {
    const text = "alpha\n  beta gamma beta\n";
    const matches = findMatches(text, q("beta"), { limit: 10, replacement: "BETA" });
    expect(matches.map((m) => [m.line, m.column, m.offset, m.replacement])).toEqual([
      [2, 3, 8, "BETA"],
      [2, 14, 19, "BETA"],
    ]);
    expect(matches[0]!.preview).toBe("  beta gamma beta");
    expect(matches[0]!.previewStart).toBe(2);
  });

  it("expands regex groups in the preview", () => {
    const [match] = findMatches("let foo = 1;", q("let (\\w+)", { regex: true }), { limit: 5, replacement: "const $1" });
    expect(match!.replacement).toBe("const foo");
  });

  it("treats literal queries literally and honours whole word and case", () => {
    expect(findMatches("a.b axb", q("a.b"), { limit: 5 })).toHaveLength(1);
    expect(findMatches("cat concat Cat", q("cat", { wholeWord: true }), { limit: 5 })).toHaveLength(1);
    expect(findMatches("cat Cat", q("cat", { matchCase: false }), { limit: 5 })).toHaveLength(2);
  });

  it("throws on an invalid regex", () => {
    expect(() => findMatches("x", q("(", { regex: true }), { limit: 5 })).toThrow(/regular expression/);
  });
});

describe("applyReplacements", () => {
  it("replaces only the selected matches", () => {
    const text = "one two one two one";
    const all = findMatches(text, q("one"), { limit: 10 });
    const result = applyReplacements(text, q("one"), "1", new Set([all[0]!.offset, all[2]!.offset]));
    expect(result).toEqual({ text: "1 two one two 1", count: 2 });
  });

  it("replaces everything with groups, named groups and $$", () => {
    const query = q("(?<k>\\w+)=(\\d+)", { regex: true });
    expect(applyReplacements("a=1, b=2", query, "$2:$<k>$$", null)).toEqual({ text: "1:a$, 2:b$", count: 2 });
  });

  it("skips offsets that no longer start a match", () => {
    expect(applyReplacements("xx foo", q("foo"), "bar", new Set([0]))).toEqual({ text: "xx foo", count: 0 });
  });

  it("inserts a literal replacement as typed when regex is off", () => {
    expect(applyReplacements("a b", q("a"), "$1$&", null).text).toBe("$1$& b");
  });
});
