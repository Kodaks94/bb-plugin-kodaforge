import { expect, it } from "vitest";
import { resolvePythonDebugger } from "./debug-adapter.js";

it("prefers the project's virtualenv Python that has debugpy", async () => {
  const find = async (_root: string, names: readonly string[]) => (names[0] === "python3" ? "/usr/bin/python3" : null);
  const withDebugpy = new Set(["/w/.venv/bin/python", "/usr/bin/python3"]);
  const server = await resolvePythonDebugger("/w", find, async (python) => withDebugpy.has(python));
  expect(server).toMatchObject({ command: "/w/.venv/bin/python", args: ["-m", "debugpy.adapter"], python: "/w/.venv/bin/python" });
});

it("falls back to PATH, and explains when debugpy is missing", async () => {
  const find = async (_root: string, names: readonly string[]) => (names[0] === "python3" ? "/usr/bin/python3" : null);
  expect((await resolvePythonDebugger("/w", find, async (p) => p === "/usr/bin/python3")).python).toBe("/usr/bin/python3");
  await expect(resolvePythonDebugger("/w", find, async () => false)).rejects.toThrow(/pip install debugpy/);
});
