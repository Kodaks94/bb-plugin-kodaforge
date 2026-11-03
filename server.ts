// bb-plugin-ide server entry: workspace resolution, guarded file I/O, the Monaco
// asset URL, and relaying the host's file watcher to the app over realtime.
//
// Workspace resolution follows bb-plugin-files-editor (MIT, abdoutelb).
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineRpcContract, type BbPluginApi } from "@get-bb/plugin-sdk";
import { z } from "zod";
import { hostContract, hostSignals, searchOptionsSchema, searchQuerySchema, searchResultSchema } from "./contract.js";
import { applyReplacements } from "./lib/replace.js";
import { createBridge } from "./lib/lsp-bridge.js";
import { createWorkspaceFiles, type Target } from "./lib/workspace-files.js";

export const CHANGED_CHANNEL = "ide/changed";
const LIST_LIMIT = 10_000; // BB's listPaths maximum
const PREVIEW_TTL_MS = 60 * 60_000;
const DEFAULT_EXCLUDED = ".git\n.claude/worktrees\nnode_modules\n.venv\nvenv\n__pycache__\n.next\n.turbo\ndist\nbuild\n.cache";

const scopeSchema = z
  .object({ kind: z.enum(["thread", "environment", "project"]), id: z.string().min(1).max(200) })
  .strict();
export type Scope = z.infer<typeof scopeSchema>;

const resolvedSchema = z.object({
  root: z.string(),
  hostId: z.string(),
  label: z.string(),
  sublabel: z.string(),
  projectId: z.string(),
  environmentId: z.string().nullable(),
});
export type ResolvedScope = z.infer<typeof resolvedSchema>;

const workspaceSchema = z.object({
  ref: scopeSchema,
  label: z.string(),
  sublabel: z.string(),
  projectId: z.string(),
  kind: z.enum(["project", "environment"]),
  /** A git worktree (branch icon) rather than a plain folder. */
  worktree: z.boolean().optional(),
});
export type WorkspaceOption = z.infer<typeof workspaceSchema>;

const relPath = z.string().min(1).max(4096);

export const rpcContract = defineRpcContract({
  workspaces: {
    input: z.null(),
    output: z.object({ workspaces: z.array(workspaceSchema) }),
  },
  resolve: {
    input: z.object({ scope: scopeSchema }).strict(),
    output: resolvedSchema,
  },
  listFiles: {
    input: z.object({ scope: scopeSchema, includeHidden: z.boolean() }).strict(),
    output: z.object({ paths: z.array(z.string()), truncated: z.boolean() }),
  },
  read: {
    input: z.object({ scope: scopeSchema, path: relPath }).strict(),
    output: z.discriminatedUnion("kind", [
      z.object({
        kind: z.literal("text"),
        content: z.string(),
        sha256: z.string(),
        sizeBytes: z.number(),
        readOnly: z.boolean(),
      }),
      z.object({ kind: z.literal("binary"), sizeBytes: z.number(), sha256: z.string() }),
    ]),
  },
  write: {
    input: z
      .object({
        scope: scopeSchema,
        path: relPath,
        content: z.string(),
        expectedSha256: z.string().nullable(),
      })
      .strict(),
    output: z.discriminatedUnion("outcome", [
      z.object({ outcome: z.literal("written"), sha256: z.string(), sizeBytes: z.number() }),
      z.object({ outcome: z.literal("conflict"), currentSha256: z.string().nullable() }),
    ]),
  },
  tree: {
    input: z.object({ scope: scopeSchema, includeHidden: z.boolean() }).strict(),
    output: z.object({
      entries: z.array(z.object({ path: z.string(), kind: z.enum(["file", "directory"]) })),
      truncated: z.boolean(),
    }),
  },
  createFile: {
    input: z.object({ scope: scopeSchema, path: relPath }).strict(),
    output: z.object({ created: z.boolean() }),
  },
  createFolder: {
    input: z.object({ scope: scopeSchema, path: relPath }).strict(),
    output: z.object({ created: z.boolean() }),
  },
  move: {
    input: z.object({ scope: scopeSchema, from: relPath, to: relPath }).strict(),
    output: z.object({ moved: z.boolean() }),
  },
  remove: {
    input: z.object({ scope: scopeSchema, path: relPath }).strict(),
    output: z.object({ removed: z.boolean() }),
  },
  gitStatus: {
    input: z.object({ scope: scopeSchema }).strict(),
    output: hostContract.gitStatus.output,
  },
  search: {
    input: z.object({ scope: scopeSchema, options: searchOptionsSchema }).strict(),
    output: searchResultSchema,
  },
  /** Write the replacements the user kept in the preview; each file must be unchanged since. */
  replaceApply: {
    input: z
      .object({
        scope: scopeSchema,
        query: searchQuerySchema,
        replacement: z.string().max(10_000),
        files: z
          .array(z.object({ path: relPath, sha256: z.string(), offsets: z.array(z.number().int().nonnegative()).max(5000) }))
          .max(2000),
      })
      .strict(),
    output: z.object({
      results: z.array(
        z.object({
          path: z.string(),
          outcome: z.enum(["replaced", "stale", "failed"]),
          count: z.number(),
          message: z.string().optional(),
        }),
      ),
    }),
  },
  /** Where the app opens the language-server WebSocket, and the plugin token it needs. */
  lspEndpoint: {
    input: z.null(),
    output: z.object({ path: z.string(), dapPath: z.string(), token: z.string() }),
  },
  format: {
    input: z.object({ scope: scopeSchema, path: relPath, content: z.string().max(4 * 1024 * 1024) }).strict(),
    output: z.discriminatedUnion("status", [
      z.object({ status: z.literal("formatted"), content: z.string(), tool: z.string() }),
      z.object({ status: z.literal("unsupported") }),
      z.object({ status: z.literal("unavailable"), reason: z.string() }),
      z.object({ status: z.literal("failed"), reason: z.string() }),
      z.object({ status: z.literal("disabled") }),
    ]),
  },
  scmShow: {
    input: z.object({ scope: scopeSchema, path: relPath, at: z.enum(["HEAD", "index"]) }).strict(),
    output: z.object({ content: z.string().nullable() }),
  },
  scmStage: {
    input: z.object({ scope: scopeSchema, paths: z.array(relPath).min(1).max(5000) }).strict(),
    output: z.object({ ok: z.boolean() }),
  },
  scmUnstage: {
    input: z.object({ scope: scopeSchema, paths: z.array(relPath).min(1).max(5000) }).strict(),
    output: z.object({ ok: z.boolean() }),
  },
  scmCommit: {
    input: z.object({ scope: scopeSchema, message: z.string().max(100_000), all: z.boolean() }).strict(),
    output: z.object({ summary: z.string() }),
  },
  scmBranches: {
    input: z.object({ scope: scopeSchema }).strict(),
    output: z.object({ current: z.string().nullable(), local: z.array(z.string()), remote: z.array(z.string()) }),
  },
  scmSwitch: {
    input: z.object({ scope: scopeSchema, name: z.string().min(1).max(250), create: z.boolean() }).strict(),
    output: z.object({ ok: z.boolean() }),
  },
  scmDiscard: {
    input: z.object({ scope: scopeSchema, tracked: z.array(relPath).max(5000), untracked: z.array(relPath).max(5000) }).strict(),
    output: z.object({ ok: z.boolean() }),
  },
  scmStash: {
    input: z
      .object({
        scope: scopeSchema,
        action: z.enum(["push", "list", "apply", "pop", "drop"]),
        message: z.string().max(1000).optional(),
        ref: z.string().max(40).optional(),
      })
      .strict(),
    output: z.object({ stashes: z.array(z.object({ ref: z.string(), message: z.string() })) }),
  },
  workflows: {
    input: z
      .object({
        scope: scopeSchema,
        /** The thread a started run reports to (the chat panel's thread). */
        threadId: z.string().max(200).nullable(),
        request: z.discriminatedUnion("action", [
          z.object({ action: z.literal("list") }),
          z.object({ action: z.literal("status"), runId: z.string().max(100) }),
          z.object({ action: z.literal("run"), name: z.string().max(64), args: z.string().max(100_000).optional() }),
        ]),
      })
      .strict(),
    output: z.object({ result: z.unknown() }),
  },
  /** Python environments for this workspace, and the one in use (saved per workspace). */
  pythonEnvs: {
    input: z.object({ scope: scopeSchema }).strict(),
    output: z.object({ envs: hostContract.pythonEnvs.output.shape.envs, selected: z.string().nullable() }),
  },
  pythonSelect: {
    input: z.object({ scope: scopeSchema, python: z.string().max(4096).nullable() }).strict(),
    output: z.object({ selected: z.string().nullable() }),
  },
  monacoAssets: {
    input: z.null(),
    output: z.object({ baseUrl: z.string(), expiresAtMs: z.number() }),
  },
  watch: {
    input: z.object({ scope: scopeSchema }).strict(),
    output: z.object({ root: z.string() }),
  },
});

export default async function plugin(bb: BbPluginApi) {
  const settings = bb.settings.define({
    excludedDirectories: {
      type: "string",
      label: "Excluded directories",
      description: "One name per line. Hidden from Quick Open, the explorer and search.",
      default: DEFAULT_EXCLUDED,
    },
    formatOnSave: {
      type: "boolean",
      label: "Format on save",
      description: "Run ruff (Python) or prettier (TS/JS) from the project or PATH before saving.",
      default: true,
    },
  });

  async function excluded(): Promise<string[]> {
    const { excludedDirectories } = await settings.get();
    return String(excludedDirectories)
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line !== "" && !line.includes(".."));
  }

  const host = bb.hosts.experimental_client({
    contract: hostContract,
    experimental_signals: hostSignals,
  });
  host.experimental_onSignal("changed", ({ payload }) => {
    bb.log.debug(`changed ${payload.root}: ${payload.paths.length} path(s)${payload.rescan ? ", rescan" : ""}`);
    bb.realtime.publish(CHANGED_CHANNEL, payload);
  });

  const files = createWorkspaceFiles(bb.sdk.files, async (target, relativePath) =>
    host.call("checkPath", { root: target.root, path: relativePath }, { hostId: target.hostId }),
  );

  /** `projects.get` 404s on the personal project; the list includes it. */
  async function project(projectId: string) {
    try {
      return await bb.sdk.projects.get({ projectId });
    } catch {
      const projects = await bb.sdk.projects.list({ includePersonal: true });
      return projects.find((entry) => entry.id === projectId) ?? null;
    }
  }

  async function resolveScope(scope: Scope): Promise<ResolvedScope> {
    let environmentId: string | null = null;
    let projectId: string | null = null;
    if (scope.kind === "thread") {
      const thread = await bb.sdk.threads.get({ threadId: scope.id });
      environmentId = thread.environmentId;
      projectId = thread.projectId;
    } else if (scope.kind === "environment") {
      environmentId = scope.id;
    } else {
      projectId = scope.id;
    }

    if (environmentId !== null) {
      const environment = await bb.sdk.environments.get({ environmentId });
      if (environment.path !== null) {
        const owner = await project(environment.projectId);
        return {
          root: environment.path,
          hostId: environment.hostId,
          label: owner?.name ?? "Workspace",
          sublabel: environment.branchName ?? environment.name ?? "workspace",
          projectId: environment.projectId,
          environmentId,
        };
      }
      projectId ??= environment.projectId;
    }
    if (projectId === null) throw new Error("This thread has no workspace yet.");

    const found = await project(projectId);
    if (found === null) throw new Error("That project no longer exists.");
    const source = found.sources.find((entry) => entry.isDefault) ?? found.sources[0];
    if (source === undefined) throw new Error(`${found.name} has no checkout on any machine yet.`);
    return {
      root: source.path,
      hostId: source.hostId,
      label: found.name,
      sublabel: "project checkout",
      projectId,
      environmentId: null,
    };
  }

  const target = async (scope: Scope): Promise<Target> => resolveScope(scope);

  let preview: { baseUrl: string; expiresAtMs: number } | null = null;
  function monacoDir(): string {
    const here = path.dirname(fileURLToPath(import.meta.url));
    const found = [path.join(here, "monaco"), path.join(here, "..", "monaco")].find((dir) =>
      existsSync(path.join(dir, "editor.js")),
    );
    if (found === undefined) throw new Error("Monaco bundle missing: run `npm run build:monaco`");
    return found;
  }

  // Language servers and debug adapters: browser WebSocket <-> this bridge <-> host
  // session (see lib/lsp-bridge.ts). Routes require the plugin token; BB serves them
  // on its own listener.
  function bridgeRoute(
    route: string,
    kindSchema: z.ZodType<string>,
    start: (resolved: ResolvedScope, kind: string) => Promise<{ sessionId: string; generation: number; command: string }>,
  ) {
    bb.http.experimental_websocket(
      route,
      ({ url }) => {
        const parsed = z
          .object({ kind: scopeSchema.shape.kind, id: z.string().min(1).max(200), language: kindSchema })
          .safeParse(Object.fromEntries(url.searchParams));
        let bridge: ReturnType<typeof createBridge> | null = null;
        return {
          onOpen(socket) {
            if (!parsed.success) return socket.close(1008, "bad request");
            const { kind, id, language } = parsed.data;
            const opened = resolveScope({ kind, id });
            bridge = createBridge(
              socket,
              {
                start: async () => {
                  const resolved = await opened;
                  const started = await start(resolved, language);
                  bb.log.info(`${route.slice(1)} ${language} started (${started.command}) for ${resolved.root}`);
                  return started;
                },
                send: async (sessionId, generation, messages) => {
                  await host.call("lspSend", { sessionId, generation, messages }, { hostId: (await opened).hostId });
                },
                receive: async (sessionId, generation, after) =>
                  host.call("lspReceive", { sessionId, generation, after, waitMs: 20_000 }, { hostId: (await opened).hostId }),
              },
              (line) => bb.log.info(line),
            );
          },
          onMessage(_socket, data) {
            bridge?.onMessage(typeof data === "string" ? data : Buffer.from(data).toString("utf8"));
          },
          onClose() {
            bridge?.close();
          },
        };
      },
      { auth: "token" },
    );
  }

  bridgeRoute("/lsp", z.enum(["python", "typescript"]), (resolved, language) =>
    host.call("lspStart", { root: resolved.root, language: language as "python" | "typescript" }, { hostId: resolved.hostId }),
  );
  bridgeRoute("/dap", z.enum(["python"]), (resolved) => host.call("dapStart", { root: resolved.root, adapter: "python" }, { hostId: resolved.hostId }));

  bb.rpc.register(rpcContract, {
    async workspaces() {
      const projects = await bb.sdk.projects.list({ include: "threads", includePersonal: true });
      const workspaces: WorkspaceOption[] = [];
      for (const entry of projects) {
        if (entry.sources.length > 0) {
          workspaces.push({
            ref: { kind: "project", id: entry.id },
            label: entry.name,
            sublabel: entry.kind === "personal" ? "personal files" : "project checkout",
            projectId: entry.id,
            kind: "project",
          });
        }
        const seen = new Set<string>();
        // "Other" environments are either the project checkout itself (skip: already listed)
        // or a folder of their own, like a personal thread workspace (list it).
        const others: { environmentId: string; title: string | null }[] = [];
        for (const thread of "threads" in entry ? entry.threads : []) {
          const environmentId = thread.environmentId;
          if (environmentId === null || thread.archivedAt !== null || thread.deletedAt !== null) continue;
          // Several threads can share a workspace: name it after the first one with a title.
          const known = others.find((other) => other.environmentId === environmentId);
          if (known && !known.title?.trim()) known.title = thread.title;
          if (seen.has(environmentId)) continue;
          seen.add(environmentId);
          if (thread.environmentWorkspaceDisplayKind === "other") {
            others.push({ environmentId, title: thread.title });
            continue;
          }
          workspaces.push({
            ref: { kind: "environment", id: environmentId },
            label: entry.name,
            sublabel: thread.environmentBranchName ?? thread.environmentName ?? "worktree",
            projectId: entry.id,
            kind: "environment",
            worktree: true,
          });
        }
        const checkouts = new Set(entry.sources.map((source) => source.path));
        const resolved = await Promise.all(
          others.map(({ environmentId }) => bb.sdk.environments.get({ environmentId }).catch(() => null)),
        );
        resolved.forEach((environment, i) => {
          if (environment === null || environment.path === null || checkouts.has(environment.path)) return;
          const title = others[i]!.title?.trim();
          workspaces.push({
            ref: { kind: "environment", id: others[i]!.environmentId },
            label: entry.name,
            sublabel:
              environment.branchName ??
              (title ? (title.length > 40 ? `${title.slice(0, 39)}…` : title) : null) ??
              environment.name ??
              "workspace",
            projectId: entry.id,
            kind: "environment",
            worktree: environment.branchName !== null,
          });
        });
      }
      return { workspaces };
    },

    resolve: ({ scope }) => resolveScope(scope),

    async listFiles({ scope, includeHidden }) {
      const resolved = await target(scope);
      const result = await bb.sdk.files.listPaths({
        hostId: resolved.hostId,
        path: resolved.root,
        includeFiles: true,
        includeDirectories: false,
        includeHidden,
        excludeNames: await excluded(),
        limit: LIST_LIMIT,
      });
      return {
        paths: result.paths.map((entry) => entry.path.replace(/\\/g, "/")),
        truncated: result.truncated,
      };
    },

    async tree({ scope, includeHidden }) {
      const resolved = await target(scope);
      const result = await bb.sdk.files.listPaths({
        hostId: resolved.hostId,
        path: resolved.root,
        includeFiles: true,
        includeDirectories: true,
        includeHidden,
        excludeNames: await excluded(),
        limit: LIST_LIMIT,
      });
      return {
        entries: result.paths.map((entry) => ({ path: entry.path.replace(/\\/g, "/"), kind: entry.kind })),
        truncated: result.truncated,
      };
    },

    async createFile({ scope, path: relativePath }) {
      const result = await files.write(await target(scope), relativePath, "", null);
      if (result.outcome === "conflict") throw new Error(`${relativePath} already exists`);
      return { created: true };
    },

    async createFolder({ scope, path: relativePath }) {
      await files.mkdir(await target(scope), relativePath);
      return { created: true };
    },

    async move({ scope, from, to }) {
      await files.move(await target(scope), from, to);
      bb.log.info(`moved ${from} -> ${to}`);
      return { moved: true };
    },

    async remove({ scope, path: relativePath }) {
      await files.remove(await target(scope), relativePath);
      bb.log.info(`removed ${relativePath}`);
      return { removed: true };
    },

    async gitStatus({ scope }) {
      const resolved = await target(scope);
      return host.call("gitStatus", { root: resolved.root }, { hostId: resolved.hostId });
    },

    async read({ scope, path: relativePath }) {
      return files.read(await target(scope), relativePath);
    },

    async write({ scope, path: relativePath, content, expectedSha256 }) {
      const resolved = await target(scope);
      const result = await files.write(resolved, relativePath, content, expectedSha256);
      if (result.outcome === "written") {
        bb.log.info(`saved ${relativePath} in ${resolved.root}`);
      }
      return result;
    },

    async search({ scope, options }) {
      const resolved = await target(scope);
      return host.call(
        "search",
        { root: resolved.root, options, excludedNames: await excluded() },
        { hostId: resolved.hostId },
      );
    },

    async replaceApply({ scope, query, replacement, files: selected }) {
      const resolved = await target(scope);
      const results = [];
      for (const file of selected) {
        try {
          const current = await files.read(resolved, file.path);
          if (current.kind !== "text" || current.readOnly || current.sha256 !== file.sha256) {
            results.push({ path: file.path, outcome: "stale" as const, count: 0, message: "Changed since the preview; search again" });
            continue;
          }
          const next = applyReplacements(current.content, query, replacement, new Set(file.offsets));
          if (next.count === 0) {
            results.push({ path: file.path, outcome: "stale" as const, count: 0, message: "No selected match is left" });
            continue;
          }
          const written = await files.write(resolved, file.path, next.text, current.sha256);
          results.push(
            written.outcome === "written"
              ? { path: file.path, outcome: "replaced" as const, count: next.count }
              : { path: file.path, outcome: "stale" as const, count: 0, message: "Changed while replacing" },
          );
        } catch (error) {
          results.push({ path: file.path, outcome: "failed" as const, count: 0, message: (error as Error).message });
        }
      }
      bb.log.info(`replace: ${results.filter((r) => r.outcome === "replaced").length}/${selected.length} files`);
      return { results };
    },

    async lspEndpoint() {
      const { token } = await bb.sdk.plugins.token({ pluginId: bb.pluginId });
      const base = `/api/v1/plugins/${encodeURIComponent(bb.pluginId)}/http`;
      return { path: `${base}/lsp`, dapPath: `${base}/dap`, token };
    },

    async format({ scope, path: relativePath, content }) {
      if (!(await settings.get()).formatOnSave) return { status: "disabled" as const };
      const resolved = await target(scope);
      return host.call("format", { root: resolved.root, path: relativePath, content }, { hostId: resolved.hostId });
    },

    async scmShow({ scope, path: relativePath, at }) {
      const resolved = await target(scope);
      return host.call("gitShow", { root: resolved.root, path: relativePath, at }, { hostId: resolved.hostId });
    },
    async scmStage({ scope, paths }) {
      const resolved = await target(scope);
      return host.call("gitStage", { root: resolved.root, paths }, { hostId: resolved.hostId });
    },
    async scmUnstage({ scope, paths }) {
      const resolved = await target(scope);
      return host.call("gitUnstage", { root: resolved.root, paths }, { hostId: resolved.hostId });
    },
    async scmCommit({ scope, message, all }) {
      const resolved = await target(scope);
      const result = await host.call("gitCommit", { root: resolved.root, message, all }, { hostId: resolved.hostId });
      bb.log.info(`commit in ${resolved.root}: ${result.summary}`);
      return result;
    },
    async scmBranches({ scope }) {
      const resolved = await target(scope);
      return host.call("gitBranches", { root: resolved.root }, { hostId: resolved.hostId });
    },
    async scmSwitch({ scope, name, create }) {
      const resolved = await target(scope);
      const result = await host.call("gitSwitch", { root: resolved.root, name, create }, { hostId: resolved.hostId });
      bb.log.info(`switched ${resolved.root} to ${name}`);
      return result;
    },

    async scmDiscard({ scope, tracked, untracked }) {
      const resolved = await target(scope);
      bb.log.info(`discard in ${resolved.root}: ${tracked.length} tracked, ${untracked.length} untracked`);
      return host.call("gitDiscard", { root: resolved.root, tracked, untracked }, { hostId: resolved.hostId });
    },
    async scmStash({ scope, action, message, ref }) {
      const resolved = await target(scope);
      return host.call("gitStash", { root: resolved.root, action, message, ref }, { hostId: resolved.hostId });
    },

    async workflows({ scope, threadId, request }) {
      const resolved = await resolveScope(scope);
      const thread = threadId ?? (scope.kind === "thread" ? scope.id : null);
      if (request.action === "run") bb.log.info(`workflow ${request.name} started from the IDE for ${thread}`);
      return host.call(
        "workflows",
        { root: resolved.root, context: { projectId: resolved.projectId, environmentId: resolved.environmentId, threadId: thread }, request },
        { hostId: resolved.hostId },
      );
    },

    async pythonEnvs({ scope }) {
      const resolved = await target(scope);
      const { envs } = await host.call("pythonEnvs", { root: resolved.root }, { hostId: resolved.hostId });
      const saved = await bb.storage.kv.get<string>(`python:${resolved.hostId}:${resolved.root}`);
      // A saved choice that no longer exists falls back to the default: the workspace's own env.
      const selected = envs.find((env) => env.python === saved)?.python ?? envs.find((env) => env.local || env.kind === "poetry")?.python ?? null;
      return { envs, selected };
    },

    async pythonSelect({ scope, python }) {
      const resolved = await target(scope);
      const key = `python:${resolved.hostId}:${resolved.root}`;
      if (python === null) {
        await bb.storage.kv.delete(key);
        return { selected: null };
      }
      // Only an interpreter the host just found: the browser never names a program to run.
      const { envs } = await host.call("pythonEnvs", { root: resolved.root }, { hostId: resolved.hostId });
      if (!envs.some((env) => env.python === python)) throw new Error("That interpreter was not found in this workspace's environments");
      await bb.storage.kv.set(key, python);
      return { selected: python };
    },

    async monacoAssets() {
      if (preview === null || preview.expiresAtMs - Date.now() < 5 * 60_000) {
        preview = await bb.sdk.files.createPreview({ rootPath: monacoDir(), ttlMs: PREVIEW_TTL_MS });
      }
      return preview;
    },

    async watch({ scope }) {
      const resolved = await target(scope);
      await host.call(
        "watch",
        { root: resolved.root, ignored: await excluded() },
        { hostId: resolved.hostId },
      );
      return { root: resolved.root };
    },
  });
}
