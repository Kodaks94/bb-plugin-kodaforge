import { expect, it } from "vitest";
import { run } from "./run.js";
import { parseMakefile, parsePackageScripts, taskArgv, taskFiles } from "./tasks.js";

it("finds task files near the root, shallow first", () => {
  expect(taskFiles(["src/a.ts", "frontend/package.json", "Makefile", "a/b/c/Makefile", "node_modules/x/package.json", "package.json"])).toEqual([
    "Makefile",
    "package.json",
    "frontend/package.json",
  ]);
});

it("parses Makefile targets with ## help, skipping variables, specials and recipes", () => {
  const text = [
    ".PHONY: test lint",
    "PY := python3",
    "CC ?= gcc",
    "test: deps ## Run the test suite",
    "\tpytest -q",
    "lint:",
    "\truff check .",
    "build/out.o: src.c",
    "deps::",
    "test: more",
  ].join("\n");
  expect(parseMakefile("Makefile", text).map((t) => [t.name, t.detail, t.line])).toEqual([
    ["test", "Run the test suite", 4],
    ["lint", "", 6],
    ["build/out.o", "", 8],
  ]);
});

it("parses package.json scripts with their lines", () => {
  const text = '{\n  "name": "x",\n  "scripts": {\n    "dev": "vite",\n    "test": "vitest run"\n  }\n}';
  expect(parsePackageScripts("web/package.json", text).map((t) => [t.name, t.detail, t.line])).toEqual([
    ["dev", "vite", 4],
    ["test", "vitest run", 5],
  ]);
  expect(parsePackageScripts("p.json", "{bad")).toEqual([]);
});

it("runs from the right folder, with the selected env first on PATH", async () => {
  const make = { file: "backend/Makefile", kind: "make" as const, name: "test", detail: "", line: 1 };
  expect(taskArgv(make, null)).toEqual(["make", "-C", "backend", "test"]);
  const npm = { file: "package.json", kind: "npm" as const, name: "dev", detail: "", line: 1 };
  expect(taskArgv(npm, null)).toEqual(["npm", "--prefix", ".", "run", "dev"]);
  // The PATH prefix really applies, even for a bin path with a quote in it.
  const argv = taskArgv({ ...npm }, "/tmp/it's env/bin");
  expect(argv.slice(4)).toEqual(["npm", "--prefix", ".", "run", "dev"]);
  const out = await run(argv[0]!, [...argv.slice(1, 4), "/usr/bin/printenv", "PATH"], { cwd: "/" });
  expect(out.stdout.startsWith("/tmp/it's env/bin:")).toBe(true);
});
