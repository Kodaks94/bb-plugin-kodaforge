// Finds the Python environments a workspace can use, VS Code style: venvs inside
// the workspace first (venv, uv, Poetry's in-project .venv), then conda, pyenv,
// Poetry's cache, and Python on PATH. Each is checked by running it.
import { access, readdir, readFile, realpath } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import { run } from "./run.js";

export type EnvKind = "venv" | "uv" | "conda" | "pyenv" | "poetry" | "system";

export interface PythonEnv {
  python: string;
  kind: EnvKind;
  name: string;
  version: string;
  /** Inside the workspace (preferred by default). */
  local: boolean;
  /** Shell line that activates it in a terminal, if there is one. */
  activate: string | null;
}

export interface Deps {
  exec(cmd: string, args: string[], cwd: string): Promise<{ code: number | null; stdout: string }>;
  find(name: string): Promise<string | null>;
  home: string;
}

const exists = (p: string) => access(p).then(() => true, () => false);
const quote = (s: string) => `'${s.replace(/'/g, `'\\''`)}'`;
const SKIP = new Set(["node_modules", ".git", "dist", "build", "__pycache__"]);

async function venvKind(dir: string): Promise<EnvKind> {
  const cfg = await readFile(path.join(dir, "pyvenv.cfg"), "utf8").catch(() => "");
  return /^uv\s*=/m.test(cfg) ? "uv" : "venv";
}

/** Folders with a pyvenv.cfg at the root or one level down. */
async function workspaceVenvs(root: string): Promise<string[]> {
  const found: string[] = [];
  const scan = async (dir: string, depth: number) => {
    for (const entry of await readdir(dir, { withFileTypes: true }).catch(() => [])) {
      if (!entry.isDirectory() || SKIP.has(entry.name)) continue;
      const sub = path.join(dir, entry.name);
      if (await exists(path.join(sub, "pyvenv.cfg"))) found.push(sub);
      else if (depth < 1) await scan(sub, depth + 1);
    }
  };
  await scan(root, 0);
  return found;
}

async function children(dir: string): Promise<string[]> {
  return (await readdir(dir, { withFileTypes: true }).catch(() => [])).filter((e) => e.isDirectory()).map((e) => path.join(dir, e.name));
}

export async function discoverPythonEnvs(root: string, deps: Deps = defaultDeps()): Promise<PythonEnv[]> {
  const versionOf = async (python: string) => {
    if (!(await exists(python))) return null;
    const out = await deps.exec(python, ["-c", "import sys;print('%d.%d.%d'%sys.version_info[:3])"], root).catch(() => null);
    const version = out?.code === 0 ? out.stdout.trim() : "";
    return /^\d+\.\d+\.\d+$/.test(version) ? version : null;
  };
  const candidates: Omit<PythonEnv, "version">[] = [];
  const add = (python: string, kind: EnvKind, name: string, local: boolean, activate: string | null) =>
    candidates.push({ python, kind, name, local, activate });

  for (const dir of await workspaceVenvs(root)) {
    add(path.join(dir, "bin", "python"), await venvKind(dir), path.relative(root, dir), true, `source ${quote(path.join(dir, "bin", "activate"))}`);
  }

  const conda = await deps.find("conda");
  if (conda) {
    const out = await deps.exec(conda, ["env", "list", "--json"], root).catch(() => null);
    try {
      for (const env of (JSON.parse(out?.stdout ?? "{}").envs ?? []) as string[]) {
        add(path.join(env, "bin", "python"), "conda", `conda: ${path.basename(env)}`, false, `conda activate ${quote(env)}`);
      }
    } catch {
      // conda printed something that isn't JSON; skip conda
    }
  }

  for (const dir of await children(path.join(deps.home, ".pyenv", "versions"))) {
    add(path.join(dir, "bin", "python"), "pyenv", `pyenv: ${path.basename(dir)}`, false, null);
  }

  // Poetry names cache envs "<project>-<hash>-py3.x".
  const slug = path.basename(root).toLowerCase().replace(/[^a-z0-9]+/g, "-");
  for (const cache of [path.join(deps.home, "Library", "Caches", "pypoetry", "virtualenvs"), path.join(deps.home, ".cache", "pypoetry", "virtualenvs")]) {
    for (const dir of await children(cache)) {
      if (!path.basename(dir).toLowerCase().startsWith(`${slug}-`)) continue;
      add(path.join(dir, "bin", "python"), "poetry", `poetry: ${path.basename(dir)}`, false, `source ${quote(path.join(dir, "bin", "activate"))}`);
    }
  }

  for (const name of ["python3", "python"]) {
    const found = await deps.find(name);
    if (found) add(found, "system", `system: ${found}`, false, null);
  }

  // Only interpreters that actually run. PATH entries are often symlinks to the same
  // binary, so system ones are deduped by real path; venvs are always kept.
  const seen = new Set<string>();
  const envs: PythonEnv[] = [];
  for (const env of await Promise.all(candidates.map(async (env) => ({ ...env, version: await versionOf(env.python) })))) {
    if (env.version === null) continue;
    const key = env.kind === "system" ? await realpath(env.python).catch(() => env.python) : env.python;
    if (seen.has(key)) continue;
    seen.add(key);
    envs.push({ ...env, version: env.version });
  }
  return envs.sort((a, b) => Number(b.local) - Number(a.local));
}

function defaultDeps(): Deps {
  return {
    exec: (cmd, args, cwd) => run(cmd, args, { cwd, timeoutMs: 15_000 }),
    find: async (name) => {
      for (const dir of [...(process.env.PATH ?? "").split(path.delimiter), "/opt/homebrew/bin", "/usr/local/bin", path.join(homedir(), ".local", "bin"), "/opt/anaconda3/bin", path.join(homedir(), "miniconda3", "bin"), path.join(homedir(), "anaconda3", "bin")]) {
        if (dir && (await exists(path.join(dir, name)))) return path.join(dir, name);
      }
      return null;
    },
    home: homedir(),
  };
}
