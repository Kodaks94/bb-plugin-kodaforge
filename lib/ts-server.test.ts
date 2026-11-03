import { chmod, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { resolveTypeScriptServer } from "./ts-server.js";

let base: string;
const pkg = async (dir: string, version: string, files: string[]) => {
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, "package.json"), JSON.stringify({ name: "typescript", version }));
  for (const file of files) {
    await mkdir(path.dirname(path.join(dir, file)), { recursive: true });
    await writeFile(path.join(dir, file), "");
    await chmod(path.join(dir, file), 0o755);
  }
};
const native = `node_modules/@typescript/typescript-${process.platform}-${process.arch}/lib/tsc`;

beforeAll(async () => {
  base = await mkdtemp(path.join(tmpdir(), "ide-ts-"));
  await pkg(path.join(base, "ts5", "node_modules", "typescript"), "5.6.3", ["lib/tsserver.js"]);
  await pkg(path.join(base, "ts7", "node_modules", "typescript"), "7.0.2", ["lib/getExePath.js", native]);
  await pkg(path.join(base, "global7"), "7.0.2", [native]);
  await mkdir(path.join(base, "empty"), { recursive: true });
});
afterAll(() => rm(base, { recursive: true, force: true }));

const withServer = async (_root: string, names: readonly string[]) => (names.includes("typescript-language-server") ? "/bin/tls" : null);
const nothing = async () => null;

describe("resolveTypeScriptServer", () => {
  it("uses the project's TypeScript 5 through typescript-language-server", async () => {
    const server = await resolveTypeScriptServer(path.join(base, "ts5"), withServer, []);
    expect(server).toMatchObject({ command: "/bin/tls", args: ["--stdio"], initializationOptions: {} });
  });

  it("runs the project's TypeScript 7 natively, even without typescript-language-server", async () => {
    const server = await resolveTypeScriptServer(path.join(base, "ts7"), nothing, []);
    expect(server.command).toBe(path.join(base, "ts7", "node_modules", "typescript", native));
    expect(server.args).toEqual(["--lsp", "--stdio"]);
  });

  it("falls back to a global TypeScript 7 and explains when there is nothing", async () => {
    const server = await resolveTypeScriptServer(path.join(base, "empty"), nothing, [path.join(base, "global7")]);
    expect(server.label).toBe("TypeScript 7 (global)");
    await expect(resolveTypeScriptServer(path.join(base, "empty"), nothing, [])).rejects.toThrow(/No TypeScript language server/);
  });

  it("gives typescript-language-server a global TypeScript 5 as fallback", async () => {
    const server = await resolveTypeScriptServer(path.join(base, "empty"), withServer, [path.join(base, "ts5", "node_modules", "typescript")]);
    expect(server.initializationOptions).toEqual({ tsserver: { fallbackPath: path.join(base, "ts5", "node_modules", "typescript", "lib") } });
  });
});
