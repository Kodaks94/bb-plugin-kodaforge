// Finds a Python that has debugpy, project environments first, and the command
// that runs its Debug Adapter Protocol server over stdio.
import path from "node:path";
import type { ServerCommand } from "./ts-server.js";
import { run } from "./run.js";

type Find = (root: string, names: readonly string[]) => Promise<string | null>;

export async function pythonCandidates(root: string, find: Find): Promise<string[]> {
  const local = [".venv", "venv", "env"].map((dir) => path.join(root, dir, "bin", "python"));
  const onPath = await Promise.all(["python3", "python"].map((name) => find(root, [name])));
  return [...new Set([...local, ...onPath.filter((p): p is string => p !== null)])];
}

export async function resolvePythonDebugger(
  root: string,
  find: Find,
  hasDebugpy: (python: string) => Promise<boolean> = async (python) =>
    (await run(python, ["-c", "import debugpy"], { cwd: root, timeoutMs: 15_000 }).catch(() => ({ code: 1 }))).code === 0,
): Promise<ServerCommand & { python: string }> {
  for (const python of await pythonCandidates(root, find)) {
    if (await hasDebugpy(python)) {
      return { command: python, args: ["-m", "debugpy.adapter"], initializationOptions: {}, label: "debugpy", python };
    }
  }
  throw new Error("No Python with debugpy found. Install it in the project environment: pip install debugpy");
}
