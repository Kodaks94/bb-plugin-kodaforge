import { expect, it } from "vitest";
import { isAppSource, mergeArchitecture } from "./app-architecture.js";
import { buildAppGalaxy, RING } from "./galaxy.js";

// An email-triage app: two pydantic-ai agents, a tool on one of them, its own MCP server with
// a tool, a model, and a skill the agents load.
const TRIAGE = `from pydantic_ai import Agent
from fastmcp import FastMCP

mail = FastMCP("mail-tools")
classifier = Agent("openai:gpt-5", instructions="Label the email")
self.drafter = Agent(model, toolsets=[mail], instructions="load_skill before replying")

@classifier.tool
def lookup_sender(ctx, address: str) -> str:
    return address

@mail.tool
def send_reply(to: str, body: str) -> None:
    ...
`;
const SUMMARY = `import Anthropic from "@anthropic-ai/sdk";
export async function summarise(text: string) {
  return client.messages.create({ model: "claude-haiku-5-5", messages: [] });
}
`;

it("maps agents, their tools, MCP servers, models and skills", () => {
  const arch = mergeArchitecture([
    { path: "app/triage.py", text: TRIAGE },
    { path: "web/summary.ts", text: SUMMARY },
    { path: "skills/tone/SKILL.md", text: "---\nname: polite-tone\n---\nBe kind." },
  ]);
  const names = (kind: string) => arch.nodes.filter((n) => n.kind === kind).map((n) => `${n.name}:${n.detail}`).sort();
  expect(names("agent")).toEqual(["classifier:pydantic-ai", "drafter:pydantic-ai", "summarise:LLM call"]);
  expect(names("tool")).toEqual(["lookup_sender:tool", "send_reply:tool"]);
  expect(names("mcp")).toEqual(["mail-tools:MCP server"]);
  expect(names("model")).toEqual(["claude-haiku-5-5:model", "openai:gpt-5:model"]);
  expect(names("skill")).toEqual(["polite-tone:skill"]);

  const id = (name: string) => arch.nodes.find((n) => n.name === name)!.id;
  const has = (from: string, to: string) => arch.links.some((l) => l.from === id(from) && l.to === id(to));
  expect(has("classifier", "lookup_sender")).toBe(true); // registered on the agent by name
  expect(has("mail-tools", "send_reply")).toBe(true); // registered on the server
  expect(has("drafter", "mail-tools")).toBe(true); // handed the server as a toolset
  expect(has("drafter", "polite-tone")).toBe(true); // its file loads skills
  expect(has("summarise", "claude-haiku-5-5")).toBe(true);
  expect(has("classifier", "send_reply")).toBe(false);
  expect(arch.nodes.find((n) => n.name === "classifier")).toMatchObject({ path: "app/triage.py", line: 5 });
});

it("reads app code, not tests, the coding agents' folders or type stubs", () => {
  expect(isAppSource("app/agent.py")).toBe(true);
  expect(isAppSource("skills/x/SKILL.md")).toBe(true);
  for (const path of ["tests/test_agent.py", "app/test_brain.py", "src/agent.test.ts", ".claude/skills/x/SKILL.md", "node_modules/ai/index.js", "types/x.d.ts"]) {
    expect(isAppSource(path)).toBe(false);
  }
});

it("lays the app out as a solar system that opens code on click", () => {
  const g = buildAppGalaxy(mergeArchitecture([{ path: "app/triage.py", text: TRIAGE }]));
  const by = Object.fromEntries(g.bodies.map((b) => [b.label, b]));
  expect(by.classifier).toMatchObject({ kind: "appAgent", orbit: RING.working, file: { path: "app/triage.py", line: 5 } });
  expect(by.lookup_sender).toMatchObject({ kind: "tool", parent: by.classifier!.id });
  expect(by["mail-tools"]).toMatchObject({ kind: "mcp", orbit: RING.workflows });
  expect(by.send_reply).toMatchObject({ kind: "tool", parent: by["mail-tools"]!.id });
  expect(by["openai:gpt-5"]).toMatchObject({ kind: "model", orbit: RING.mcp });
  expect(g.links).toContainEqual({ from: by.drafter!.id, to: by["mail-tools"]!.id, kind: "workflow" });
});
