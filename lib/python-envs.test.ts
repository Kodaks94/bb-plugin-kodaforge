import { createHash } from "node:crypto";
import { chmod, mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, expect, it } from "vitest";
import { discoverPythonEnvs, type Deps } from "./python-envs.js";

let base: string;
let poetryHash: string;
let subHash: string;
const fakePython = async (file: string, version: string) => {
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, `#!/bin/sh\necho ${version}\n`);
  await chmod(file, 0o755);
};

beforeAll(async () => {
  base = await mkdtemp(path.join(tmpdir(), "ide-py-"));
  const root = path.join(base, "My Shop");
  await fakePython(path.join(root, ".venv", "bin", "python"), "3.12.4");
  await writeFile(path.join(root, ".venv", "pyvenv.cfg"), "home = /usr/bin\nuv = 0.5.0\n");
  await fakePython(path.join(root, "backend", "venv", "bin", "python"), "3.11.9");
  await writeFile(path.join(root, "backend", "venv", "pyvenv.cfg"), "home = /usr/bin\n");
  await fakePython(path.join(root, "node_modules", "x", "venv", "bin", "python"), "3.0.0");
  await writeFile(path.join(root, "node_modules", "x", "venv", "pyvenv.cfg"), "");
  await fakePython(path.join(base, "home", ".pyenv", "versions", "3.10.14", "bin", "python"), "3.10.14");
  // Named after the pyproject name, not the folder; matched by Poetry's hash of the real path.
  poetryHash = createHash("sha256").update(await realpath(root)).digest("base64url").slice(0, 8);
  await fakePython(path.join(base, "home", ".cache", "pypoetry", "virtualenvs", `shop-api-${poetryHash}-py3.12`, "bin", "python"), "3.12.1");
  await writeFile(path.join(root, "backend", "pyproject.toml"), "");
  subHash = createHash("sha256").update(await realpath(path.join(root, "backend"))).digest("base64url").slice(0, 8);
  await fakePython(path.join(base, "home", ".cache", "pypoetry", "virtualenvs", `api-${subHash}-py3.11`, "bin", "python"), "3.11.2");
  await fakePython(path.join(base, "home", ".cache", "pypoetry", "virtualenvs", "my-shop-AbC12345-py3.12", "bin", "python"), "3.12.1");
  await fakePython(path.join(base, "conda", "envs", "ml", "bin", "python"), "3.9.18");
  await fakePython(path.join(base, "bin", "python3"), "3.13.0");
  await fakePython(path.join(base, "bin", "broken"), "not-a-version");
});
afterAll(() => rm(base, { recursive: true, force: true }));

it("finds workspace venvs first, then conda, pyenv, this project's poetry env, and PATH", async () => {
  const root = path.join(base, "My Shop");
  const deps: Deps = {
    home: path.join(base, "home"),
    find: async (name) => (name === "python3" ? path.join(base, "bin", "python3") : name === "conda" ? "/fake/conda" : null),
    exec: async (cmd, args) => {
      if (cmd === "/fake/conda") return { code: 0, stdout: JSON.stringify({ envs: [path.join(base, "conda", "envs", "ml")] }) };
      const { run } = await import("./run.js");
      return run(cmd, args, { cwd: base });
    },
  };
  const envs = await discoverPythonEnvs(root, deps);
  expect(envs.map((e) => [e.kind, e.name, e.version, e.local])).toEqual([
    ["uv", ".venv", "3.12.4", true],
    ["venv", "backend/venv", "3.11.9", true],
    ["conda", "conda: ml", "3.9.18", false],
    ["pyenv", "pyenv: 3.10.14", "3.10.14", false],
    ["poetry", `poetry: shop-api-${poetryHash}-py3.12`, "3.12.1", false],
    ["poetry", `poetry: api-${subHash}-py3.11`, "3.11.2", false],
    ["system", `system: ${path.join(base, "bin", "python3")}`, "3.13.0", false],
  ]);
  expect(envs[0]!.activate).toBe(`source '${path.join(root, ".venv", "bin", "activate")}'`);
  expect(envs.find((e) => e.kind === "conda")!.activate).toMatch(/^conda activate '/);
  expect(envs.find((e) => e.kind === "pyenv")!.activate).toBe(`export PATH='${path.join(base, "home", ".pyenv", "versions", "3.10.14", "bin")}':"$PATH"`);
});
