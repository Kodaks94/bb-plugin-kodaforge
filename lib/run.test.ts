import { expect, it } from "vitest";
import { run } from "./run.js";

it("survives a program that exits without reading its input", async () => {
  const big = "x".repeat(4 * 1024 * 1024);
  const result = await run(process.execPath, ["-e", "process.exit(3)"], { cwd: process.cwd(), input: big });
  expect(result.code).toBe(3);
});

it("passes input through and captures output", async () => {
  const result = await run(process.execPath, ["-e", "process.stdin.pipe(process.stdout)"], { cwd: process.cwd(), input: "hello" });
  expect(result).toMatchObject({ code: 0, stdout: "hello" });
});
