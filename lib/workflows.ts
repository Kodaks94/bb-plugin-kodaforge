// The BB workflows plugin has no RPC, so the IDE drives its CLI on the host:
// list recent runs, read one run's status, and start a named workflow
// (.bb/workflows/<name>.js). Nothing else of the CLI is reachable from here.
import { findBinary } from "./lsp-host.js";
import { run } from "./run.js";

export interface WorkflowContext {
  projectId: string;
  environmentId: string | null;
  /** The thread a started run reports back to. Required for `run`. */
  threadId: string | null;
}

export type WorkflowAction =
  | { action: "list" }
  | { action: "status"; runId: string }
  | { action: "history"; runId: string; cursor?: number }
  | { action: "run"; name: string; args?: string };

export function workflowArgv(request: WorkflowAction): string[] {
  switch (request.action) {
    case "list":
      return ["workflows", "list", "--limit", "30", "--json"];
    case "status":
    case "history": {
      if (!/^wfr?_[A-Za-z0-9-]{4,80}$/.test(request.runId)) throw new Error("Not a workflow run id");
      if (request.action === "status") return ["workflows", "status", request.runId, "--json"];
      return ["workflows", "history", request.runId, "--cursor", String(request.cursor ?? 0), "--limit", "100", "--json"];
    }
    case "run": {
      if (!/^[a-z0-9][a-z0-9-]{0,63}$/.test(request.name)) throw new Error("Workflow names are lowercase kebab-case");
      if (request.args !== undefined) JSON.parse(request.args);
      return ["workflows", "run", "--name", request.name, ...(request.args === undefined ? [] : ["--args", request.args]), "--json"];
    }
  }
}

/** One agent call, as the run graph draws it. Prompts and results stay on the host. */
export interface AgentCall {
  index: number;
  label: string | null;
  phase: string | null;
  status: string;
  model: string | null;
  provider: string | null;
  childThreadId: string | null;
  startedAt: number | null;
  finishedAt: number | null;
  error: string | null;
  replayed: boolean;
}

export interface RunHistory {
  name: string;
  status: string;
  phase: string | null;
  error: string | null;
  createdAt: number | null;
  finishedAt: number | null;
  /** Phase titles in meta order, then any phase only a call names. */
  phases: string[];
  calls: AgentCall[];
  nextCursor: number | null;
}

const str = (value: unknown) => (typeof value === "string" ? value : null);
const num = (value: unknown) => (typeof value === "number" ? value : null);

/** Phase titles from the workflow source's literal `meta.phases`. */
export function metaPhases(source: string): string[] {
  const block = /phases\s*:\s*\[([\s\S]*?)\]/.exec(source)?.[1] ?? "";
  return [...block.matchAll(/title\s*:\s*(["'`])((?:(?!\1).)+)\1/g)].map((m) => m[2]!);
}

/** `bb workflows history` JSONL → the run and its calls. */
export function parseHistory(jsonl: string): RunHistory {
  const history: RunHistory = { name: "", status: "unknown", phase: null, error: null, createdAt: null, finishedAt: null, phases: [], calls: [], nextCursor: null };
  for (const line of jsonl.split("\n")) {
    if (!line.trim()) continue;
    const record = JSON.parse(line) as Record<string, unknown>;
    if (record.type === "run") {
      Object.assign(history, {
        name: str(record.name) ?? "",
        status: str(record.status) ?? "unknown",
        phase: str(record.phase),
        error: str(record.error),
        createdAt: num(record.createdAt),
        finishedAt: num(record.finishedAt),
        phases: metaPhases(str(record.source) ?? ""),
      });
    } else if (record.type === "call") {
      history.calls.push({
        index: num(record.callIndex) ?? history.calls.length,
        label: str(record.label),
        phase: str(record.phase),
        status: str(record.status) ?? "unknown",
        model: str(record.resolvedModel),
        provider: str(record.resolvedProvider),
        childThreadId: str(record.childThreadId),
        startedAt: num(record.startedAt),
        finishedAt: num(record.finishedAt),
        error: str(record.error),
        replayed: record.source !== undefined && record.source !== "live",
      });
    } else if (record.type === "page") {
      history.nextCursor = record.hasMore === true ? num(record.nextCursor) : null;
    }
  }
  for (const call of history.calls) if (call.phase !== null && !history.phases.includes(call.phase)) history.phases.push(call.phase);
  return history;
}

export async function runWorkflowCommand(root: string, context: WorkflowContext, request: WorkflowAction): Promise<unknown> {
  if (request.action === "run" && context.threadId === null) {
    throw new Error("Pick a thread in the Chat panel first: a workflow reports back to a thread");
  }
  const cli = process.env.BB_CLI ?? (await findBinary(root, ["bb"]));
  if (cli === null) throw new Error("The bb CLI was not found on this machine");
  const env: Record<string, string> = { BB_PROJECT_ID: context.projectId };
  if (context.environmentId) env.BB_ENVIRONMENT_ID = context.environmentId;
  if (context.threadId) env.BB_THREAD_ID = context.threadId;
  if (request.action === "history") {
    // Page until done; maxAgentCalls tops out at 1000, so at most 10 pages.
    let merged: RunHistory | null = null;
    let cursor = request.cursor ?? 0;
    for (let page = 0; page < 10; page++) {
      const out = await run(cli, workflowArgv({ ...request, cursor }), { cwd: root, env, timeoutMs: 20_000 });
      if (out.code !== 0) throw new Error(out.stderr.trim() || `bb workflows exited with ${out.code}`);
      const part = parseHistory(out.stdout);
      if (merged === null) merged = part;
      else merged = { ...(merged as RunHistory), calls: [...(merged as RunHistory).calls, ...part.calls], nextCursor: part.nextCursor };
      if (part.nextCursor === null) break;
      cursor = part.nextCursor;
    }
    return merged;
  }
  const result = await run(cli, workflowArgv(request), { cwd: root, env, timeoutMs: 20_000 });
  let parsed: unknown;
  try {
    parsed = JSON.parse(result.stdout);
  } catch {
    throw new Error(result.stderr.trim() || `bb workflows exited with ${result.code}`);
  }
  if (parsed && typeof parsed === "object" && "ok" in parsed && (parsed as { ok: boolean }).ok === false) {
    throw new Error((parsed as { error?: { message?: string } }).error?.message ?? "bb workflows failed");
  }
  return parsed;
}
