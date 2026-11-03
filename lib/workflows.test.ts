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
