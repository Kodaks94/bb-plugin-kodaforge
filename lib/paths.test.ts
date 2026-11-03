import { describe, expect, it } from "vitest";
import { relativeToRoot, resolveWithinRoot } from "./paths.js";

describe("resolveWithinRoot", () => {
  it("joins a relative path onto a POSIX root", () => {
    expect(resolveWithinRoot("/work/app", "src/index.ts")).toBe(
      "/work/app/src/index.ts",
    );
  });

  it("uses backslashes for a Windows root", () => {
    expect(resolveWithinRoot("C:\\work\\app", "src/index.ts")).toBe(
      "C:\\work\\app\\src\\index.ts",
    );
  });

  it("refuses a path that climbs out of the root", () => {
    expect(() => resolveWithinRoot("/work/app", "../secrets.env")).toThrow(
      /escapes the workspace/,
    );
  });

  it("refuses a traversal buried mid-path", () => {
    expect(() => resolveWithinRoot("/work/app", "src/../../etc/passwd")).toThrow(
      /escapes the workspace/,
    );
  });

  it("treats an absolute-looking relative path as root-relative", () => {
    expect(resolveWithinRoot("/work/app", "/src/index.ts")).toBe(
      "/work/app/src/index.ts",
    );
  });

  it("returns the root itself for an empty or dot path", () => {
    expect(resolveWithinRoot("/work/app", ".")).toBe("/work/app");
  });
});

describe("relativeToRoot", () => {
  it("strips the root and normalises separators", () => {
    expect(relativeToRoot("C:\\work", "C:\\work\\src\\a.ts")).toBe("src/a.ts");
  });
});


describe("resolveWithinRoot on a Windows root written with forward slashes", () => {
  it("resolves rather than reporting an escape", () => {
    // BB reports whatever the host stored; a drive-letter root can arrive with
    // either separator, and the containment check is textual.
    expect(resolveWithinRoot("C:/Users/dev/app", "README.md")).toBe(
      "C:\\Users\\dev\\app\\README.md",
    );
  });

  it("still refuses a traversal from that root", () => {
    expect(() => resolveWithinRoot("C:/Users/dev/app", "../other/x")).toThrow(
      /escapes the workspace/,
    );
  });

  it("keeps a backslash in a POSIX file name as part of the name", () => {
    // On POSIX `\` is a legal character, so it must not act as a separator.
    expect(resolveWithinRoot("/work/app", "odd\\name.txt")).toBe(
      "/work/app/odd\\name.txt",
    );
  });

  it("treats a backslash as a separator on a Windows root", () => {
    expect(resolveWithinRoot("C:\\work", "src\\a.ts")).toBe("C:\\work\\src\\a.ts");
  });

  it("collapses redundant separators", () => {
    expect(resolveWithinRoot("/work/app/", "src//index.ts")).toBe(
      "/work/app/src/index.ts",
    );
  });
});
