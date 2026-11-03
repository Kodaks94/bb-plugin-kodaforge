// Picks the TypeScript language server for a workspace, VS Code's order:
// the project's own TypeScript first, then a global one. TypeScript 5 runs
// through typescript-language-server (tsserver); TypeScript 7, the native Go
// port, is its own LSP server (`tsc --lsp --stdio`).
import { access, readFile, realpath } from "node:fs/promises";
import path from "node:path";

export interface ServerCommand {
  command: string;
  args: string[];
  initializationOptions: Record<string, unknown>;
  label: string;
}

type Find = (root: string, names: readonly string[]) => Promise<string | null>;

const exists = (file: string) => access(file).then(() => true, () => false);

async function majorVersion(packageDir: string): Promise<number | null> {
  try {
    const { version } = JSON.parse(await readFile(path.join(packageDir, "package.json"), "utf8"));
    return Number(String(version).split(".")[0]);
  } catch {
    return null;
  }
}

/** The native executable of a TypeScript 7 package (nested or hoisted platform package). */
export async function nativeExecutable(packageDir: string, platform = process.platform, arch = process.arch): Promise<string | null> {
  const name = `typescript-${platform}-${arch}`;
  for (const candidate of [
    path.join(packageDir, "node_modules", "@typescript", name, "lib", "tsc"),
    path.join(packageDir, "..", "@typescript", name, "lib", "tsc"),
  ]) {
    if (await exists(candidate)) return candidate;
  }
  return null;
}

/** What a TypeScript package directory offers: a tsserver (5.x) or a native LSP (7.x). */
async function inspect(packageDir: string): Promise<{ kind: "tsserver"; lib: string } | { kind: "native"; exe: string } | null> {
  const major = await majorVersion(packageDir);
  if (major === null) return null;
  if (await exists(path.join(packageDir, "lib", "tsserver.js"))) return { kind: "tsserver", lib: path.join(packageDir, "lib") };
  if (major >= 7) {
    const exe = await nativeExecutable(packageDir);
    if (exe !== null) return { kind: "native", exe };
  }
  return null;
}

/** Global TypeScript packages: beside the language server, beside `tsc` on PATH, and the usual npm roots. */
const NPM_GLOBALS = ["/opt/homebrew/lib/node_modules/typescript", "/usr/local/lib/node_modules/typescript"];

async function globalPackages(find: Find, root: string, npmGlobals: readonly string[]): Promise<string[]> {
  const dirs: string[] = [];
  for (const bin of ["typescript-language-server", "tsc"]) {
    const found = await find(root, [bin]);
    if (found === null) continue;
    const real = await realpath(found).catch(() => found);
    // .../lib/node_modules/<pkg>/{bin,lib}/x → .../lib/node_modules/typescript
    dirs.push(path.resolve(path.dirname(real), "..", "..", "typescript"), path.resolve(path.dirname(real), ".."));
  }
  dirs.push(...npmGlobals);
  return [...new Set(dirs)];
}

export async function resolveTypeScriptServer(root: string, find: Find, npmGlobals: readonly string[] = NPM_GLOBALS): Promise<ServerCommand> {
  const languageServer = await find(root, ["typescript-language-server"]);
  const viaTsserver = (lib: string | null, label: string): ServerCommand | null =>
    languageServer === null
      ? null
      : {
          command: languageServer,
          args: ["--stdio"],
          initializationOptions: lib === null ? {} : { tsserver: { fallbackPath: lib } },
          label,
        };
  const native = (exe: string, label: string): ServerCommand => ({ command: exe, args: ["--lsp", "--stdio"], initializationOptions: {}, label });

  // 1. The project's own TypeScript, or the native preview's `tsgo`.
  const local = await inspect(path.join(root, "node_modules", "typescript"));
  if (local?.kind === "tsserver") {
    const server = viaTsserver(null, "typescript-language-server");
    if (server !== null) return server;
  }
  if (local?.kind === "native") return native(local.exe, "TypeScript 7 (project)");
  const tsgo = await find(root, ["tsgo"]);
  if (tsgo !== null && tsgo.startsWith(path.join(root, "node_modules"))) return native(tsgo, "tsgo (project)");

  // 2. A global TypeScript: a 5.x behind typescript-language-server, else a native 7.x.
  const globals = [];
  for (const dir of await globalPackages(find, root, npmGlobals)) {
    const found = await inspect(dir);
    if (found !== null) globals.push(found);
  }
  const tsserver = globals.find((g) => g.kind === "tsserver");
  if (tsserver?.kind === "tsserver") {
    const server = viaTsserver(tsserver.lib, "typescript-language-server (global TypeScript)");
    if (server !== null) return server;
  }
  const globalNative = globals.find((g) => g.kind === "native");
  if (globalNative?.kind === "native") return native(globalNative.exe, "TypeScript 7 (global)");
  if (tsgo !== null) return native(tsgo, "tsgo");

  throw new Error(
    "No TypeScript language server found. Add typescript to the project (npm i -D typescript) and install typescript-language-server, or install TypeScript 7.",
  );
}
