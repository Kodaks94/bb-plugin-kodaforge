import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { run } from "./run.js";
import { branches, commit, discard, showFile, stage, stash, switchBranch, unstage } from "./git-ops.js";
import { parsePorcelain } from "./git-status.js";

let root: string;
const status = async () => parsePorcelain((await run("git", ["status", "--porcelain=v1", "-z", "-b"], { cwd: root })).stdout);

beforeAll(async () => {
  root = await mkdtemp(path.join(tmpdir(), "ide-git-"));
  await run("git", ["init", "-q", "-b", "main"], { cwd: root });
  await run("git", ["config", "user.email", "t@example.com"], { cwd: root });
  await run("git", ["config", "user.name", "Test"], { cwd: root });
  await writeFile(path.join(root, "a.txt"), "one\n");
  await writeFile(path.join(root, "-weird.txt"), "dash\n");
});
afterAll(() => rm(root, { recursive: true, force: true }));

describe("git ops", () => {
  it("stages and unstages before the first commit, including a dash-named file", async () => {
    await stage(root, ["a.txt", "-weird.txt"]);
    expect((await status()).entries.map((e) => e.index + e.worktree + e.path).sort()).toEqual(["A -weird.txt", "A a.txt"]);
    await unstage(root, ["-weird.txt"]);
    expect((await status()).entries.find((e) => e.path === "-weird.txt")?.index).toBe("?");
  });

  it("commits with a multi-line message and shows HEAD vs index vs disk", async () => {
    const result = await commit(root, "first\n\nbody line", false);
    expect(result.summary).toMatch(/first/);
    await writeFile(path.join(root, "a.txt"), "two\n");
    await stage(root, ["a.txt"]);
    await writeFile(path.join(root, "a.txt"), "three\n");
    expect(await showFile(root, "a.txt", "HEAD")).toBe("one\n");
    expect(await showFile(root, "a.txt", "index")).toBe("two\n");
    expect(await readFile(path.join(root, "a.txt"), "utf8")).toBe("three\n");
    expect(await showFile(root, "nope.txt", "HEAD")).toBeNull();
    await expect(commit(root, "   ", false)).rejects.toThrow(/message/);
  });

  it("refuses paths outside the root and option-like branch names", async () => {
    await expect(stage(root, ["../x"])).rejects.toThrow(/escapes/);
    await expect(switchBranch(root, "--orphan", true)).rejects.toThrow(/valid branch/);
    await expect(switchBranch(root, "bad..name", true)).rejects.toThrow(/valid branch/);
  });

  it("creates, lists and switches branches", async () => {
    await commit(root, "second", true);
    await switchBranch(root, "feature/x", true);
    expect((await branches(root)).current).toBe("feature/x");
    await switchBranch(root, "main", false);
    const list = await branches(root);
    expect(list.current).toBe("main");
    expect(list.local.sort()).toEqual(["feature/x", "main"]);
    await expect(switchBranch(root, "missing", false)).rejects.toThrow(/No branch/);
  });
});

describe("discard and stash", () => {
  it("discards tracked edits and deletes untracked files", async () => {
    await writeFile(path.join(root, "a.txt"), "scratch\n");
    await writeFile(path.join(root, "new.txt"), "new\n");
    await discard(root, ["a.txt"], ["new.txt"]);
    const entries = (await status()).entries.map((e) => e.path);
    expect(entries).not.toContain("a.txt");
    expect(entries).not.toContain("new.txt");
    await expect(discard(root, ["../outside"], [])).rejects.toThrow(/escapes/);
  });

  it("stashes (with untracked), lists, pops and drops", async () => {
    await writeFile(path.join(root, "a.txt"), "stashed\n");
    await writeFile(path.join(root, "u.txt"), "u\n");
    const afterPush = await stash(root, "push", { message: "wip" });
    expect(afterPush).toHaveLength(1);
    expect(afterPush[0]!.message).toMatch(/wip/);
    expect((await status()).entries).toHaveLength(0);
    expect(await stash(root, "pop", { ref: "stash@{0}" })).toHaveLength(0);
    expect(await readFile(path.join(root, "a.txt"), "utf8")).toBe("stashed\n");
    await stash(root, "push", {});
    expect(await stash(root, "drop", {})).toHaveLength(0);
    await expect(stash(root, "apply", { ref: "--all" })).rejects.toThrow(/Not a stash/);
  });
});
