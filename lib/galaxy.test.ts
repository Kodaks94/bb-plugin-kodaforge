import { expect, it } from "vitest";
import { buildGalaxy, RING, type GalaxyThread } from "./galaxy.js";

const thread = (id: string, state: GalaxyThread["state"], parentId: string | null = null, provider = "claude-code"): GalaxyThread => ({
  id,
  title: `Thread ${id}`,
  parentId,
  provider,
  state,
  activity: 0,
});

it("puts working agents on the inner orbit, idle ones outside, and sub-agents as moons after their parent", () => {
  const g = buildGalaxy([thread("a", "working"), thread("b", "idle"), thread("c", "working", "a"), thread("d", "idle", "c"), thread("x", "idle", "gone")], [], []);
  const by = Object.fromEntries(g.bodies.map((b) => [b.ref, b]));
  expect(by.a).toMatchObject({ kind: "thread", orbit: RING.working, working: true });
  expect(by.b).toMatchObject({ kind: "thread", orbit: RING.idle });
  expect(by.c).toMatchObject({ kind: "child", parent: "t:a" });
  expect(by.d).toMatchObject({ kind: "child", parent: "t:c" });
  // A thread whose parent isn't in this project is a planet, not a lost moon.
  expect(by.x).toMatchObject({ kind: "thread", orbit: RING.idle });
  // Parents come before children, so positions can be computed in one pass.
  const order = g.bodies.map((b) => b.id);
  expect(order.indexOf("t:a")).toBeLessThan(order.indexOf("t:c"));
  expect(order.indexOf("t:c")).toBeLessThan(order.indexOf("t:d"));
  expect(by.a!.detail).toBe("Claude Code · working · 1 sub-agent");
  expect(g.rings.map((r) => r.radius)).toEqual([RING.working, RING.idle]);
});

it("draws workflow runs as planets with agent moons, linked to the thread that started them", () => {
  const call = (index: number, status: string) => ({
    index, label: `agent ${index}`, phase: "Review", status, model: "m", provider: "p", childThreadId: `thr_${index}`,
    startedAt: 0, finishedAt: null, error: null, replayed: false,
  });
  const g = buildGalaxy([thread("a", "idle")], [{ id: "wfr_1", name: "review", status: "running", originThreadId: "a", calls: [call(0, "running"), call(1, "failed")] }], []);
  const run = g.bodies.find((b) => b.kind === "run")!;
  expect(run).toMatchObject({ ref: "wfr_1", working: true, orbit: RING.workflows });
  const moons = g.bodies.filter((b) => b.parent === run.id);
  expect(moons.map((m) => [m.thread, m.state])).toEqual([["thr_0", "working"], ["thr_1", "error"]]);
  expect(g.links).toContainEqual({ from: "r:wfr_1", to: "t:a", kind: "workflow" });
});

it("links each agent only to the MCP servers its provider loads", () => {
  const g = buildGalaxy(
    [thread("c", "idle", null, "claude-code"), thread("x", "idle", null, "codex")],
    [],
    [
      { name: "notes", source: "claude", transport: "http", plugin: null },
      { name: "repl", source: "codex", transport: "stdio", plugin: null },
      { name: "db", source: "project", transport: "stdio", plugin: null },
    ],
  );
  const reach = (t: string) => g.links.filter((l) => l.from === `t:${t}` && l.kind === "mcp").map((l) => l.to.split(":").pop());
  expect(reach("c")).toEqual(["notes", "db"]);
  expect(reach("x")).toEqual(["repl", "db"]);
  expect(g.rings.at(-1)).toEqual({ radius: RING.mcp, dashed: true });
});
