// Runnable tasks found in a workspace: Makefile targets and package.json scripts.

export interface Task {
  /** Where it was found, workspace-relative ("Makefile", "frontend/package.json"). */
  file: string;
  kind: "make" | "npm";
  name: string;
  /** The `## description` after a Makefile target, or the script's command. */
  detail: string;
  /** 1-based line of the definition, to jump to it. */
  line: number;
}

const TASK_FILE = /(^|\/)(Makefile|makefile|GNUmakefile|package\.json)$/;

/** Task files at the root or up to two folders down. */
export function taskFiles(paths: readonly string[]): string[] {
  return paths.filter((p) => TASK_FILE.test(p) && p.split("/").length <= 3 && !p.includes("node_modules/")).sort((a, b) => a.split("/").length - b.split("/").length || a.localeCompare(b));
}

/** Explicit targets, in order, with their `## help` text. Pattern rules and variables are skipped. */
export function parseMakefile(file: string, text: string): Task[] {
  const tasks: Task[] = [];
  const seen = new Set<string>();
  text.split("\n").forEach((raw, i) => {
    const match = /^([A-Za-z0-9][A-Za-z0-9_.\-/]*)\s*:(?![=:])([^#]*)(?:##\s*(.*))?$/.exec(raw);
    if (!match || raw.startsWith("\t")) return;
    const name = match[1]!;
    if (name.startsWith(".") || seen.has(name)) return;
    seen.add(name);
    tasks.push({ file, kind: "make", name, detail: (match[3] ?? "").trim(), line: i + 1 });
  });
  return tasks;
}

export function parsePackageScripts(file: string, text: string): Task[] {
  let scripts: Record<string, unknown> = {};
  try {
    scripts = JSON.parse(text).scripts ?? {};
  } catch {
    return [];
  }
  const lines = text.split("\n");
  return Object.entries(scripts)
    .filter((entry): entry is [string, string] => typeof entry[1] === "string")
    .map(([name, command]) => ({
      file,
      kind: "npm" as const,
      name,
      detail: command,
      line: Math.max(1, lines.findIndex((l) => l.includes(JSON.stringify(name))) + 1),
    }));
}

const quote = (s: string) => `'${s.replace(/'/g, `'\\''`)}'`;

/**
 * The argv that runs a task from the workspace root. With a Python environment
 * selected, its bin folder goes first on PATH, which works for venv, uv, Poetry
 * and conda alike without sourcing activation scripts.
 */
export function taskArgv(task: Task, envBin: string | null): string[] {
  const dir = task.file.includes("/") ? task.file.slice(0, task.file.lastIndexOf("/")) : ".";
  const command = task.kind === "make" ? ["make", "-C", dir, task.name] : ["npm", "--prefix", dir, "run", task.name];
  if (envBin === null) return command;
  return ["/bin/sh", "-c", `PATH=${quote(envBin)}:"$PATH" exec "$@"`, "sh", ...command];
}
