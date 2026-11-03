// Format on save, on the host: ruff for Python, prettier for TS/JS.
import { findBinary } from "./lsp-host.js";
import { run } from "./run.js";

export type FormatResult =
  | { status: "formatted"; content: string; tool: string }
  | { status: "unsupported" }
  | { status: "unavailable"; reason: string }
  | { status: "failed"; reason: string };

export function formatterFor(path: string): { names: string[]; args: (path: string) => string[] } | null {
  if (/\.(py|pyi)$/i.test(path)) return { names: ["ruff"], args: (p) => ["format", "--stdin-filename", p, "-"] };
  if (/\.(ts|tsx|js|jsx|mjs|cjs|mts|cts)$/i.test(path)) return { names: ["prettier"], args: (p) => ["--stdin-filepath", p] };
  return null;
}

export async function formatFile(root: string, path: string, content: string): Promise<FormatResult> {
  const formatter = formatterFor(path);
  if (formatter === null) return { status: "unsupported" };
  const binary = await findBinary(root, formatter.names);
  if (binary === null) return { status: "unavailable", reason: `${formatter.names[0]} is not installed in the project or on PATH` };
  const result = await run(binary, formatter.args(path), { cwd: root, input: content, timeoutMs: 15_000 });
  if (result.code !== 0) return { status: "failed", reason: result.stderr.trim().split("\n").slice(0, 3).join(" ") || `exit ${result.code}` };
  return { status: "formatted", content: result.stdout, tool: formatter.names[0]! };
}
