// Shared between server.ts and host.ts. The host entry runs on the machine that
// holds the workspace; the server calls it through BB's host RPC.
import {
  defineRpcContract,
  type ExperimentalHostSignals,
} from "@get-bb/plugin-sdk";
import { z } from "zod";

const rootInput = z.object({ root: z.string().min(1) }).strict();

export const searchQuerySchema = z
  .object({
    query: z.string().min(1).max(1000),
    regex: z.boolean(),
    matchCase: z.boolean(),
    wholeWord: z.boolean(),
  })
  .strict();

export const searchOptionsSchema = z
  .object({
    query: searchQuerySchema,
    replacement: z.string().max(10_000).optional(),
    include: z.string().max(1000),
    exclude: z.string().max(1000),
  })
  .strict();

const textMatchSchema = z.object({
  offset: z.number(),
  length: z.number(),
  line: z.number(),
  column: z.number(),
  preview: z.string(),
  previewStart: z.number(),
  replacement: z.string().optional(),
});

export const searchResultSchema = z.object({
  files: z.array(z.object({ path: z.string(), sha256: z.string(), matches: z.array(textMatchSchema) })),
  matchCount: z.number(),
  searchedFiles: z.number(),
  truncated: z.boolean(),
});

export const hostContract = defineRpcContract({
  /** Realpath check: rejects a path whose symlinks lead outside the root. */
  checkPath: {
    experimental_retryable: true,
    input: rootInput.extend({ path: z.string() }).strict(),
    output: z.discriminatedUnion("ok", [
      z.object({ ok: z.literal(true) }),
      z.object({ ok: z.literal(false), reason: z.string() }),
    ]),
  },
  /** Start watching `root`, or keep an existing watch alive for another lease. */
  watch: {
    experimental_retryable: true,
    input: rootInput.extend({ ignored: z.array(z.string()).max(200) }).strict(),
    output: z.object({ watching: z.boolean() }),
  },
  search: {
    input: rootInput.extend({ options: searchOptionsSchema, excludedNames: z.array(z.string()).max(200) }).strict(),
    output: searchResultSchema,
  },
  lspStart: {
    input: rootInput.extend({ language: z.enum(["python", "typescript"]) }).strict(),
    output: z.object({ sessionId: z.string(), generation: z.number(), command: z.string() }),
  },
  /** Start a debug adapter (DAP) session; it is then driven with lspSend/lspReceive. */
  dapStart: {
    input: rootInput.extend({ adapter: z.enum(["python"]) }).strict(),
    output: z.object({ sessionId: z.string(), generation: z.number(), command: z.string(), python: z.string() }),
  },
  lspSend: {
    input: z.object({ sessionId: z.string(), generation: z.number(), messages: z.array(z.string().max(20_000_000)).max(1000) }).strict(),
    output: z.object({ ok: z.boolean() }),
  },
  lspReceive: {
    input: z.object({ sessionId: z.string(), generation: z.number(), after: z.number(), waitMs: z.number().max(30_000) }).strict(),
    output: z.object({ messages: z.array(z.object({ seq: z.number(), data: z.string() })), closed: z.string().nullable() }),
  },
  format: {
    input: rootInput.extend({ path: z.string(), content: z.string() }).strict(),
    output: z.discriminatedUnion("status", [
      z.object({ status: z.literal("formatted"), content: z.string(), tool: z.string() }),
      z.object({ status: z.literal("unsupported") }),
      z.object({ status: z.literal("unavailable"), reason: z.string() }),
      z.object({ status: z.literal("failed"), reason: z.string() }),
    ]),
  },
  gitShow: {
    experimental_retryable: true,
    input: rootInput.extend({ path: z.string(), at: z.enum(["HEAD", "index"]) }).strict(),
    output: z.object({ content: z.string().nullable() }),
  },
  gitStage: {
    input: rootInput.extend({ paths: z.array(z.string()).min(1).max(5000) }).strict(),
    output: z.object({ ok: z.boolean() }),
  },
  gitUnstage: {
    input: rootInput.extend({ paths: z.array(z.string()).min(1).max(5000) }).strict(),
    output: z.object({ ok: z.boolean() }),
  },
  gitCommit: {
    input: rootInput.extend({ message: z.string().max(100_000), all: z.boolean() }).strict(),
    output: z.object({ summary: z.string() }),
  },
  gitBranches: {
    experimental_retryable: true,
    input: rootInput,
    output: z.object({ current: z.string().nullable(), local: z.array(z.string()), remote: z.array(z.string()) }),
  },
  gitSwitch: {
    input: rootInput.extend({ name: z.string().min(1).max(250), create: z.boolean() }).strict(),
    output: z.object({ ok: z.boolean() }),
  },
  gitDiscard: {
    input: rootInput.extend({ tracked: z.array(z.string()).max(5000), untracked: z.array(z.string()).max(5000) }).strict(),
    output: z.object({ ok: z.boolean() }),
  },
  gitStash: {
    input: rootInput
      .extend({
        action: z.enum(["push", "list", "apply", "pop", "drop"]),
        message: z.string().max(1000).optional(),
        ref: z.string().max(40).optional(),
      })
      .strict(),
    output: z.object({ stashes: z.array(z.object({ ref: z.string(), message: z.string() })) }),
  },
  workflows: {
    input: rootInput
      .extend({
        context: z.object({ projectId: z.string(), environmentId: z.string().nullable(), threadId: z.string().nullable() }).strict(),
        request: z.discriminatedUnion("action", [
          z.object({ action: z.literal("list") }),
          z.object({ action: z.literal("status"), runId: z.string().max(100) }),
          z.object({ action: z.literal("history"), runId: z.string().max(100) }),
          z.object({ action: z.literal("run"), name: z.string().max(64), args: z.string().max(100_000).optional() }),
        ]),
      })
      .strict(),
    output: z.object({ result: z.unknown() }),
  },
  pythonEnvs: {
    experimental_retryable: true,
    input: rootInput,
    output: z.object({
      envs: z.array(
        z.object({
          python: z.string(),
          kind: z.enum(["venv", "uv", "conda", "pyenv", "poetry", "system"]),
          name: z.string(),
          version: z.string(),
          local: z.boolean(),
          activate: z.string().nullable(),
        }),
      ),
    }),
  },
  gitStatus: {
    experimental_retryable: true,
    input: rootInput,
    output: z.object({
      isRepo: z.boolean(),
      branch: z.string().nullable(),
      upstream: z.string().nullable().optional(),
      ahead: z.number().optional(),
      behind: z.number().optional(),
      entries: z.array(
        z.object({ path: z.string(), index: z.string(), worktree: z.string(), origPath: z.string().optional() }),
      ),
    }),
  },
});

export const hostSignals = {
  changed: {
    payload: z.object({
      root: z.string(),
      /** Root-relative, forward slashes. Empty with `rescan` = reread everything. */
      paths: z.array(z.string()),
      rescan: z.boolean(),
    }),
  },
} satisfies ExperimentalHostSignals;
