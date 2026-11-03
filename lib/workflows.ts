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
  | { action: "run"; name: string; args?: string };

export function workflowArgv(request: WorkflowAction): string[] {
  switch (request.action) {
    case "list":
      return ["workflows", "list", "--limit", "30", "--json"];
    case "status":
      if (!/^wfr?_[A-Za-z0-9-]{4,80}$/.test(request.runId)) throw new Error("Not a workflow run id");
      return ["workflows", "status", request.runId, "--json"];
    case "run": {
      if (!/^[a-z0-9][a-z0-9-]{0,63}$/.test(request.name)) throw new Error("Workflow names are lowercase kebab-case");
      if (request.args !== undefined) JSON.parse(request.args);
      return ["workflows", "run", "--name", request.name, ...(request.args === undefined ? [] : ["--args", request.args]), "--json"];
    }
  }
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
