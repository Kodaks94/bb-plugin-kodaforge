// Runs on the machine that holds the workspace (BB's daemon starts it on demand).
// Phase 1: the symlink guard and a debounced file watcher per workspace root.
import { experimental_defineHostEntry } from "@get-bb/plugin-sdk/host";
import { hostContract, hostSignals } from "./contract.js";
import { checkRealPath } from "./lib/realpath-guard.js";
import { toRelativeChange } from "./lib/watch.js";
import { run } from "./lib/run.js";
import { parsePorcelain, withinPrefix } from "./lib/git-status.js";
import { listCandidates, MAX_SEARCH_FILE_BYTES, searchWorkspace } from "./lib/search-files.js";
import { LspHost } from "./lib/lsp-host.js";
import { formatFile } from "./lib/format.js";
import { resolveWithinRoot } from "./lib/paths.js";
import * as gitOps from "./lib/git-ops.js";
import { runWorkflowCommand } from "./lib/workflows.js";
import { discoverMcpServers } from "./lib/mcp-servers.js";
import { isAppSource, mergeArchitecture } from "./lib/app-architecture.js";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { resolvePythonDebugger } from "./lib/debug-adapter.js";
import { findBinary } from "./lib/lsp-host.js";
import { discoverPythonEnvs } from "./lib/python-envs.js";

const lsp = new LspHost();

/** The app renews its lease every minute; a watch nobody renews stops. */
const LEASE_MS = 3 * 60_000;

const watches = new Map<string, { dispose(): Promise<void>; renewedAt: number }>();
let sweeper: ReturnType<typeof setInterval> | null = null;

async function disposeAll() {
  lsp.disposeAll();
  if (sweeper !== null) clearInterval(sweeper);
  sweeper = null;
  const all = [...watches.values()];
  watches.clear();
  await Promise.allSettled(all.map((entry) => entry.dispose()));
}

export default experimental_defineHostEntry({
  contract: hostContract,
  experimental_signals: hostSignals,
  handlers: {
    checkPath: ({ root, path }) => checkRealPath(root, path),

    search: ({ root, options, excludedNames }, context) =>
      searchWorkspace(root, { ...options, excludedNames, maxMatches: 5000, timeLimitMs: 15_000, signal: context.signal }),

    lspStart: ({ root, language }) => lsp.start(root, language),
    dapStart: async ({ root }) => {
      const adapter = await resolvePythonDebugger(root, findBinary);
      return { ...lsp.startProcess(`dap:python:${root}`, root, adapter), python: adapter.python };
    },
    lspSend: ({ sessionId, generation, messages }) => {
      lsp.send(sessionId, generation, messages);
      return { ok: true };
    },
    lspReceive: ({ sessionId, generation, after, waitMs }, context) =>
      lsp.receive(sessionId, generation, after, waitMs, context.signal),

    format: ({ root, path, content }) => {
      resolveWithinRoot(root, path);
      return formatFile(root, path, content);
    },

    gitShow: async ({ root, path, at }) => ({ content: await gitOps.showFile(root, path, at) }),
    gitStage: async ({ root, paths }) => (await gitOps.stage(root, paths), { ok: true }),
    gitUnstage: async ({ root, paths }) => (await gitOps.unstage(root, paths), { ok: true }),
    gitCommit: ({ root, message, all }) => gitOps.commit(root, message, all),
    gitBranches: ({ root }) => gitOps.branches(root),
    gitSwitch: async ({ root, name, create }) => (await gitOps.switchBranch(root, name, create), { ok: true }),

    gitDiscard: async ({ root, tracked, untracked }) => (await gitOps.discard(root, tracked, untracked), { ok: true }),
    gitStash: async ({ root, action, message, ref }) => ({ stashes: await gitOps.stash(root, action, { message, ref }) }),

    workflows: async ({ root, context, request }) => ({ result: await runWorkflowCommand(root, context, request) }),

    pythonEnvs: async ({ root }) => ({ envs: await discoverPythonEnvs(root) }),
    mcpServers: async ({ root }) => ({ servers: await discoverMcpServers(root) }),

    appArchitecture: async ({ root, excludedNames }) => {
      // shortcut: reads up to 3000 source files per scan; a huge monorepo shows a partial map (truncated).
      const candidates = (await listCandidates(root, excludedNames)).filter(isAppSource);
      const files: { path: string; text: string }[] = [];
      for (const file of candidates.slice(0, 3000)) {
        const full = path.join(root, file);
        const info = await stat(full).catch(() => null);
        if (info === null || !info.isFile() || info.size > MAX_SEARCH_FILE_BYTES) continue;
        files.push({ path: file, text: await readFile(full, "utf8").catch(() => "") });
      }
      return { ...mergeArchitecture(files), truncated: candidates.length > 3000 };
    },

    gitStatus: async ({ root }, context) => {
      const result = await run("git", ["status", "--porcelain=v1", "-z", "-b", "--untracked-files=all"], {
        cwd: root,
        signal: context.signal,
      }).catch(() => null);
      if (result === null || result.code !== 0) return { isRepo: false, branch: null, entries: [] };
      // Porcelain paths are repo-relative; the workspace may be a subfolder of the repo.
      const prefix = (await run("git", ["rev-parse", "--show-prefix"], { cwd: root })).stdout.trim();
      return { isRepo: true, ...withinPrefix(parsePorcelain(result.stdout), prefix) };
    },

    watch: async ({ root, ignored }, context) => {
      const existing = watches.get(root);
      if (existing !== undefined) {
        existing.renewedAt = Date.now();
        return { watching: true };
      }
      const subscription = await context.experimental_watch(
        { rootPath: root, ignoredPaths: [".git", ...ignored], debounceMs: 150, maxWaitMs: 1000 },
        async (event) => {
          if (event.kind === "watch-error") return;
          const paths =
            event.kind === "changed"
              ? event.changes.map((change) => toRelativeChange(root, change.path)).filter((p) => p !== null)
              : [];
          await context.experimental_emitSignal("changed", {
            root,
            paths,
            rescan: event.kind === "rescan-required",
          });
        },
      );
      watches.set(root, { dispose: () => subscription.dispose(), renewedAt: Date.now() });
      sweeper ??= setInterval(() => {
        const now = Date.now();
        for (const [key, entry] of watches) {
          if (now - entry.renewedAt < LEASE_MS) continue;
          watches.delete(key);
          void entry.dispose();
        }
      }, 30_000);
      context.lifecycle.signal.addEventListener("abort", () => void disposeAll(), { once: true });
      return { watching: true };
    },
  },
  dispose: disposeAll,
});
