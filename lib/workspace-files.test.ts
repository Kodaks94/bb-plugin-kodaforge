import { describe, expect, it, vi } from "vitest";
import { createWorkspaceFiles, MAX_EDITABLE_BYTES, type FilesApi } from "./workspace-files.js";

const target = { root: "/work/repo", hostId: "host_1" };

function fakeFiles(disk: Map<string, string>): FilesApi {
  const sha = (text: string) => `sha:${text}`;
  return {
    read: vi.fn(async ({ path }) => {
      const content = disk.get(path);
      if (content === undefined) throw new Error("ENOENT");
      return { content, contentEncoding: "utf8", sha256: sha(content), sizeBytes: content.length };
    }),
    write: vi.fn(async ({ path, content, expectedSha256 }) => {
      const current = disk.get(path);
      const currentSha = current === undefined ? null : sha(current);
      if (expectedSha256 !== undefined && expectedSha256 !== currentSha) {
        return { outcome: "conflict" as const, currentSha256: currentSha };
      }
      disk.set(path, content);
      return { outcome: "written" as const, sha256: sha(content), sizeBytes: content.length };
    }),
    mkdir: vi.fn(async () => undefined),
    move: vi.fn(async ({ sourcePath, destinationPath }) => {
      if (disk.has(destinationPath)) throw new Error("destination exists");
      disk.set(destinationPath, disk.get(sourcePath)!);
      disk.delete(sourcePath);
    }),
    remove: vi.fn(async ({ path }) => void disk.delete(path)),
  };
}

const allow = async () => ({ ok: true as const });

describe("hash-guarded save", () => {
  it("saves when the file is unchanged since it was read", async () => {
    const disk = new Map([["/work/repo/a.ts", "one"]]);
    const files = createWorkspaceFiles(fakeFiles(disk), allow);
    const read = await files.read(target, "a.ts");
    expect(read.kind).toBe("text");
    const result = await files.write(target, "a.ts", "two", read.sha256);
    expect(result).toEqual({ outcome: "written", sha256: "sha:two", sizeBytes: 3 });
    expect(disk.get("/work/repo/a.ts")).toBe("two");
  });

  it("reports a conflict when an agent changed the file, then Overwrite succeeds with the current hash", async () => {
    const disk = new Map([["/work/repo/a.ts", "one"]]);
    const files = createWorkspaceFiles(fakeFiles(disk), allow);
    const read = await files.read(target, "a.ts");
    disk.set("/work/repo/a.ts", "agent edit");
    const conflict = await files.write(target, "a.ts", "mine", read.sha256);
    expect(conflict).toEqual({ outcome: "conflict", currentSha256: "sha:agent edit" });
    expect(disk.get("/work/repo/a.ts")).toBe("agent edit");
    if (conflict.outcome !== "conflict") throw new Error("expected conflict");
    const overwrite = await files.write(target, "a.ts", "mine", conflict.currentSha256);
    expect(overwrite.outcome).toBe("written");
    expect(disk.get("/work/repo/a.ts")).toBe("mine");
  });

  it("create-only write (null hash) refuses to clobber an existing file", async () => {
    const disk = new Map([["/work/repo/a.ts", "one"]]);
    const files = createWorkspaceFiles(fakeFiles(disk), allow);
    expect((await files.write(target, "a.ts", "x", null)).outcome).toBe("conflict");
    expect((await files.write(target, "b.ts", "x", null)).outcome).toBe("written");
  });

  it("rejects paths outside the root before touching the disk", async () => {
    const api = fakeFiles(new Map());
    const files = createWorkspaceFiles(api, allow);
    await expect(files.write(target, "../etc/passwd", "x", null)).rejects.toThrow(/escapes/);
    await expect(files.read(target, "src/../../x")).rejects.toThrow(/escapes/);
    expect(api.write).not.toHaveBeenCalled();
  });

  it("rejects what the host's symlink check rejects", async () => {
    const api = fakeFiles(new Map([["/work/repo/link", "x"]]));
    const files = createWorkspaceFiles(api, async () => ({ ok: false, reason: "symlink escape" }));
    await expect(files.read(target, "link")).rejects.toThrow("symlink escape");
    expect(api.read).not.toHaveBeenCalled();
  });

  it("opens files over 2 MB read-only and refuses to save them", async () => {
    const big = "x".repeat(MAX_EDITABLE_BYTES + 1);
    const files = createWorkspaceFiles(fakeFiles(new Map([["/work/repo/big.log", big]])), allow);
    const read = await files.read(target, "big.log");
    expect(read.kind === "text" && read.readOnly).toBe(true);
    await expect(files.write(target, "big.log", big, read.sha256)).rejects.toThrow(/too large/);
  });
});

describe("tree mutations", () => {
  it("moves and removes inside the root, never the root itself", async () => {
    const disk = new Map([["/work/repo/a.ts", "a"]]);
    const api = fakeFiles(disk);
    const files = createWorkspaceFiles(api, allow);
    await files.move(target, "a.ts", "src/b.ts");
    expect([...disk.keys()]).toEqual(["/work/repo/src/b.ts"]);
    await expect(files.move(target, "src/b.ts", "../b.ts")).rejects.toThrow(/escapes/);
    await expect(files.remove(target, ".")).rejects.toThrow(/root itself/);
    await expect(files.remove(target, "/")).rejects.toThrow(/root itself/);
    await files.remove(target, "src/b.ts");
    expect(disk.size).toBe(0);
    await files.mkdir(target, "x/y");
    expect(api.mkdir).toHaveBeenCalledWith({ hostId: "host_1", path: "/work/repo/x/y", rootPath: "/work/repo", recursive: true });
  });
});
