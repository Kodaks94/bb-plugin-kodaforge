import { mkdtemp, mkdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { globToRegExp, searchWorkspace } from "./search-files.js";

let root: string;
const base = { include: "", exclude: "", excludedNames: ["node_modules"], maxMatches: 100, timeLimitMs: 5000 };
const query = (text: string) => ({ query: text, regex: false, matchCase: true, wholeWord: false });

beforeAll(async () => {
  root = await mkdtemp(path.join(tmpdir(), "ide-search-"));
  await mkdir(path.join(root, "src", "deep"), { recursive: true });
  await mkdir(path.join(root, "node_modules", "x"), { recursive: true });
  await writeFile(path.join(root, "src", "a.ts"), "const needle = 1;\nneedle();\n");
  await writeFile(path.join(root, "src", "deep", "b.py"), "needle = 2\n");
  await writeFile(path.join(root, "node_modules", "x", "c.js"), "needle");
  await writeFile(path.join(root, "bin.dat"), Buffer.from([110, 101, 0, 101, 100]));
  await symlink("/etc/hosts", path.join(root, "link"));
});
afterAll(() => rm(root, { recursive: true, force: true }));

describe("searchWorkspace", () => {
  it("finds matches, skipping excluded dirs, binaries and symlinks", async () => {
    const result = await searchWorkspace(root, { ...base, query: query("needle"), replacement: "pin" });
    expect(result.files.map((f) => f.path)).toEqual(["src/a.ts", "src/deep/b.py"]);
    expect(result.matchCount).toBe(3);
    expect(result.files[0]!.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(result.files[0]!.matches[1]).toMatchObject({ line: 2, column: 1, replacement: "pin" });
  });

  it("honours include/exclude globs and the match limit", async () => {
    expect((await searchWorkspace(root, { ...base, query: query("needle"), include: "*.py" })).files.map((f) => f.path)).toEqual(["src/deep/b.py"]);
    expect((await searchWorkspace(root, { ...base, query: query("needle"), exclude: "src/deep" })).files.map((f) => f.path)).toEqual(["src/a.ts"]);
    const limited = await searchWorkspace(root, { ...base, query: query("needle"), maxMatches: 2 });
    expect(limited.matchCount).toBe(2);
    expect(limited.truncated).toBe(true);
  });
});

it("globToRegExp", () => {
  expect(globToRegExp("*.ts").test("a/b/c.ts")).toBe(true);
  expect(globToRegExp("src/**/*.ts").test("src/a/b.ts")).toBe(true);
  expect(globToRegExp("src/**/*.ts").test("src/b.ts")).toBe(true);
  expect(globToRegExp("src/*.ts").test("src/a/b.ts")).toBe(false);
  expect(globToRegExp("docs").test("docs/readme.md")).toBe(true);
});
