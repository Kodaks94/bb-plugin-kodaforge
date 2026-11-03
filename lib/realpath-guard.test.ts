import { mkdtemp, mkdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { checkRealPath } from "./realpath-guard.js";

let base: string;
let root: string;

beforeAll(async () => {
  base = await mkdtemp(path.join(tmpdir(), "ide-guard-"));
  root = path.join(base, "repo");
  await mkdir(path.join(root, "src"), { recursive: true });
  await writeFile(path.join(root, "src", "a.ts"), "a");
  await writeFile(path.join(base, "secret.txt"), "s");
  await symlink(path.join(base, "secret.txt"), path.join(root, "leak.txt"));
  await symlink(base, path.join(root, "outside"));
  await symlink(path.join(root, "src"), path.join(root, "inside"));
});
afterAll(() => rm(base, { recursive: true, force: true }));

describe("checkRealPath", () => {
  it("accepts files, new files and in-root symlinks", async () => {
    expect(await checkRealPath(root, "src/a.ts")).toEqual({ ok: true });
    expect(await checkRealPath(root, "src/new/deep.ts")).toEqual({ ok: true });
    expect(await checkRealPath(root, "inside/a.ts")).toEqual({ ok: true });
  });

  it("rejects .. and symlinks that leave the root", async () => {
    expect((await checkRealPath(root, "../secret.txt")).ok).toBe(false);
    expect((await checkRealPath(root, "leak.txt")).ok).toBe(false);
    expect((await checkRealPath(root, "outside/secret.txt")).ok).toBe(false);
    expect((await checkRealPath(root, "outside/new-file.txt")).ok).toBe(false);
  });
});
