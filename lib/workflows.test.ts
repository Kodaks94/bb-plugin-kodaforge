import { expect, it } from "vitest";
import { workflowArgv } from "./workflows.js";

it("builds only the allowed workflow commands, validating every value", () => {
  expect(workflowArgv({ action: "list" })).toEqual(["workflows", "list", "--limit", "30", "--json"]);
  expect(workflowArgv({ action: "status", runId: "wfr_c9f60fd4-5bed" })).toEqual(["workflows", "status", "wfr_c9f60fd4-5bed", "--json"]);
  expect(workflowArgv({ action: "run", name: "nightly-review", args: '{"a":1}' })).toEqual([
    "workflows", "run", "--name", "nightly-review", "--args", '{"a":1}', "--json",
  ]);
  expect(() => workflowArgv({ action: "status", runId: "--all" })).toThrow();
  expect(() => workflowArgv({ action: "run", name: "--script=x" })).toThrow(/kebab/);
  expect(() => workflowArgv({ action: "run", name: "ok", args: "{not json" })).toThrow();
});

it("reads history pages into phases and agent calls, without prompts or results", async () => {
  const { parseHistory, metaPhases } = await import("./workflows.js");
  expect(workflowArgv({ action: "history", runId: "wfr_abcd-1", cursor: 3 })).toEqual(["workflows", "history", "wfr_abcd-1", "--cursor", "3", "--limit", "100", "--json"]);
  expect(() => workflowArgv({ action: "history", runId: "../x" })).toThrow();
  expect(metaPhases('export const meta = { name: "x", phases: [{ title: "Review" }, { title: \'Verify\', detail: "y" }] }')).toEqual(["Review", "Verify"]);

  const run = { type: "run", name: "review-pr", status: "running", phase: "Review", source: 'export const meta = { phases: [{ title: "Review" }, { title: "Verify" }] }', createdAt: 1, finishedAt: null };
  const call = (i: number, phase: string, status: string, extra = {}) => ({
    type: "call", callIndex: i, label: `agent ${i}`, phase, status, resolvedModel: "m", resolvedProvider: "p",
    childThreadId: `thr_${i}`, startedAt: 10, finishedAt: null, error: null, source: "live", prompt: "SECRET PROMPT", result: { big: true }, ...extra,
  });
  const page = { type: "page", hasMore: true, nextCursor: 3 };
  const h = parseHistory([run, call(0, "Review", "succeeded"), call(1, "Review", "failed", { error: "boom" }), call(2, "Fix", "running", { source: "cache" }), page].map((r) => JSON.stringify(r)).join("\n"));
  expect(h.phases).toEqual(["Review", "Verify", "Fix"]);
  expect(h.calls.map((c) => [c.index, c.phase, c.status, c.error, c.replayed])).toEqual([
    [0, "Review", "succeeded", null, false],
    [1, "Review", "failed", "boom", false],
    [2, "Fix", "running", null, true],
  ]);
  expect(h.nextCursor).toBe(3);
  expect(JSON.stringify(h)).not.toContain("SECRET");
});
