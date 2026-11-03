import { resolveWithinRoot } from "./paths.js";

/** Bigger files open read-only: Monaco gets slow and a save round-trip is costly. */
export const MAX_EDITABLE_BYTES = 2 * 1024 * 1024;

export interface Target {
  root: string;
  hostId: string;
}

/** The slice of bb.sdk.files this module uses, so tests can fake it. */
export interface FilesApi {
  read(args: { hostId: string; path: string; rootPath: string }): Promise<{
    content: string;
    contentEncoding: string;
    sha256: string;
    sizeBytes: number;
  }>;
  write(args: {
    hostId: string;
    path: string;
    rootPath: string;
    content: string;
    contentEncoding: "utf8";
    expectedSha256?: string | null;
  }): Promise<
    | { outcome: "written"; sha256: string; sizeBytes: number }
    | { outcome: "conflict"; currentSha256: string | null }
  >;
  mkdir(args: { hostId: string; path: string; rootPath: string; recursive?: boolean }): Promise<unknown>;
  move(args: { hostId: string; sourcePath: string; destinationPath: string; rootPath: string }): Promise<unknown>;
  remove(args: { hostId: string; path: string; rootPath: string; recursive?: boolean }): Promise<unknown>;
}

export type CheckPath = (
  target: Target,
  relativePath: string,
) => Promise<{ ok: true } | { ok: false; reason: string }>;

export type ReadResult =
  | { kind: "text"; content: string; sha256: string; sizeBytes: number; readOnly: boolean }
  | { kind: "binary"; sizeBytes: number; sha256: string };

export type WriteResult =
  | { outcome: "written"; sha256: string; sizeBytes: number }
  | { outcome: "conflict"; currentSha256: string | null };

export function createWorkspaceFiles(files: FilesApi, checkPath: CheckPath) {
  async function guard(target: Target, relativePath: string): Promise<string> {
    if (relativePath.trim() === "") throw new Error("A file path is required");
    const absolutePath = resolveWithinRoot(target.root, relativePath);
    const verdict = await checkPath(target, relativePath);
    if (!verdict.ok) throw new Error(verdict.reason);
    return absolutePath;
  }

  /** Mutations may never target the workspace root itself. */
  async function guardEntry(target: Target, relativePath: string): Promise<string> {
    const path = await guard(target, relativePath);
    if (path === resolveWithinRoot(target.root, "")) throw new Error("The workspace root itself cannot be changed");
    return path;
  }

  return {
    async read(target: Target, relativePath: string): Promise<ReadResult> {
      const path = await guard(target, relativePath);
      const file = await files.read({ hostId: target.hostId, path, rootPath: target.root });
      if (file.contentEncoding !== "utf8") {
        return { kind: "binary", sizeBytes: file.sizeBytes, sha256: file.sha256 };
      }
      return {
        kind: "text",
        content: file.content,
        sha256: file.sha256,
        sizeBytes: file.sizeBytes,
        readOnly: file.sizeBytes > MAX_EDITABLE_BYTES,
      };
    },

    /**
     * Compare-and-swap save. `expectedSha256` is the hash the edit started from;
     * null means "create, the file must not exist". There is deliberately no
     * unconditional write: Overwrite after a conflict passes the current hash.
     */
    async write(
      target: Target,
      relativePath: string,
      content: string,
      expectedSha256: string | null,
    ): Promise<WriteResult> {
      if (Buffer.byteLength(content, "utf8") > MAX_EDITABLE_BYTES) {
        throw new Error("File is too large to save from the editor");
      }
      const path = await guard(target, relativePath);
      const result = await files.write({
        hostId: target.hostId,
        path,
        rootPath: target.root,
        content,
        contentEncoding: "utf8",
        expectedSha256,
      });
      return result.outcome === "conflict"
        ? { outcome: "conflict", currentSha256: result.currentSha256 }
        : { outcome: "written", sha256: result.sha256, sizeBytes: result.sizeBytes };
    },

    async mkdir(target: Target, relativePath: string): Promise<void> {
      const path = await guardEntry(target, relativePath);
      await files.mkdir({ hostId: target.hostId, path, rootPath: target.root, recursive: true });
    },

    /** Rename or move; BB refuses to replace an existing destination. */
    async move(target: Target, from: string, to: string): Promise<void> {
      const sourcePath = await guardEntry(target, from);
      const destinationPath = await guardEntry(target, to);
      await files.move({ hostId: target.hostId, sourcePath, destinationPath, rootPath: target.root });
    },

    async remove(target: Target, relativePath: string): Promise<void> {
      const path = await guardEntry(target, relativePath);
      await files.remove({ hostId: target.hostId, path, rootPath: target.root, recursive: true });
    },
  };
}
