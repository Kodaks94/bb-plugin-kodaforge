// The Agent Network's layout, kept pure so it can be tested: who orbits what, how far,
// how fast, and which links to draw. Distances are in world units; the view scales them
// so the MCP belt fits the screen.
import type { AgentCall } from "./workflows";

export type AgentState = "working" | "idle" | "waiting" | "error";

export interface GalaxyThread {
  id: string;
  title: string;
  parentId: string | null;
  provider: string;
  state: AgentState;
  /** Background agents and workflows the thread is running. */
  activity: number;
}

export interface GalaxyRun {
  id: string;
  name: string;
  status: string;
  originThreadId: string | null;
  calls: AgentCall[];
}

export interface GalaxyMcp {
  name: string;
  source: "claude" | "project" | "codex" | "plugin";
  transport: string;
  plugin: string | null;
}

export interface Body {
  id: string;
  kind: "thread" | "child" | "run" | "agent" | "mcp";
  /** The thread id, run id or MCP name this body stands for. */
  ref: string;
  /** For a workflow agent: the thread it worked in. */
  thread?: string;
  label: string;
  detail: string;
  /** Orbits this body instead of the sun. */
  parent?: string;
  orbit: number;
  /** Radians per second; negative orbits the other way. */
  speed: number;
  phase: number;
  size: number;
  working: boolean;
  state: AgentState;
  provider?: string;
  source?: GalaxyMcp["source"];
}

export interface Galaxy {
  bodies: Body[];
  rings: { radius: number; dashed: boolean }[];
  links: { from: string; to: string; kind: "workflow" | "mcp" }[];
}

export const RING = { working: 120, idle: 190, workflows: 250, mcp: 305 };
const MAX_AGENT_MOONS = 12;
const LIVE = new Set(["running", "queued", "pending", "starting"]);

const PROVIDER_NAMES: Record<string, string> = { "claude-code": "Claude Code", codex: "Codex", pi: "Pi" };
const SOURCE_NAMES: Record<GalaxyMcp["source"], string> = { claude: "Claude (global)", project: "This project", codex: "Codex", plugin: "Claude plugin" };

/** Which MCP config sources an agent of this provider loads. */
function reaches(provider: string, source: GalaxyMcp["source"]): boolean {
  if (provider === "codex") return source === "codex" || source === "project";
  if (provider === "claude-code") return source !== "codex";
  return false;
}

function hash(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619);
  return (h >>> 0) / 4294967296;
}

/** Evenly around the ring, nudged by the id so the layout feels natural but stays stable. */
function spread(index: number, count: number, id: string): number {
  return (index / Math.max(count, 1)) * Math.PI * 2 + (hash(id) - 0.5) * (Math.PI / Math.max(count, 3));
}

export function buildGalaxy(threads: GalaxyThread[], runs: GalaxyRun[], mcps: GalaxyMcp[]): Galaxy {
  const bodies: Body[] = [];
  const links: Galaxy["links"] = [];
  const ids = new Set(threads.map((t) => t.id));
  const roots = threads.filter((t) => t.parentId === null || !ids.has(t.parentId));
  const children = (id: string) => threads.filter((t) => t.parentId === id);

  const working = roots.filter((t) => t.state !== "idle");
  const idle = roots.filter((t) => t.state === "idle");
  const addThread = (t: GalaxyThread, orbit: number, phase: number, speed: number, parent?: string) => {
    const kids = children(t.id);
    bodies.push({
      id: `t:${t.id}`,
      kind: parent ? "child" : "thread",
      ref: t.id,
      label: t.title,
      detail: [PROVIDER_NAMES[t.provider] ?? t.provider, t.state === "waiting" ? "waiting for you" : t.state, kids.length ? `${kids.length} sub-agent${kids.length === 1 ? "" : "s"}` : ""]
        .filter(Boolean)
        .join(" · "),
      parent,
      orbit,
      speed,
      phase,
      size: parent ? 4 : (t.state === "idle" ? 7 : 9) + Math.min(t.activity, 4),
      working: t.state === "working",
      state: t.state,
      provider: t.provider,
    });
    // Sub-agents: moons, nested as deep as they go.
    kids.forEach((kid, i) => addThread(kid, 20 + i * 7, spread(i, kids.length, kid.id), 1.1 - i * 0.08, `t:${t.id}`));
  };
  working.forEach((t, i) => addThread(t, RING.working, spread(i, working.length, t.id), 0.16));
  idle.forEach((t, i) => addThread(t, RING.idle, spread(i, idle.length, t.id), 0.06));

  runs.forEach((run, i) => {
    const live = LIVE.has(run.status);
    const failed = run.status === "failed";
    const id = `r:${run.id}`;
    bodies.push({
      id,
      kind: "run",
      ref: run.id,
      label: run.name,
      detail: `Workflow · ${run.status} · ${run.calls.length} agent${run.calls.length === 1 ? "" : "s"}`,
      orbit: RING.workflows,
      speed: 0.045,
      phase: spread(i, runs.length, run.id) + Math.PI / 5,
      size: 10,
      working: live,
      state: failed ? "error" : live ? "working" : "idle",
    });
    if (run.originThreadId && ids.has(run.originThreadId)) links.push({ from: id, to: `t:${run.originThreadId}`, kind: "workflow" });
    const shown = run.calls.slice(0, MAX_AGENT_MOONS);
    shown.forEach((call, j) => {
      const callLive = LIVE.has(call.status);
      bodies.push({
        id: `a:${run.id}:${call.index}`,
        kind: "agent",
        ref: `${run.id}:${call.index}`,
        thread: call.childThreadId ?? undefined,
        label: call.label ?? `Agent ${call.index + 1}`,
        detail: [call.phase, call.model, call.status].filter(Boolean).join(" · "),
        parent: id,
        orbit: 18 + (j % 3) * 6,
        speed: 1.4 - (j % 3) * 0.3,
        phase: spread(j, shown.length, `${run.id}${j}`),
        size: 3,
        working: callLive,
        state: call.status === "failed" ? "error" : callLive ? "working" : call.status === "succeeded" ? "idle" : "waiting",
      });
    });
  });

  mcps.forEach((mcp, i) => {
    const id = `m:${mcp.source}:${mcp.plugin ?? ""}:${mcp.name}`;
    bodies.push({
      id,
      kind: "mcp",
      ref: mcp.name,
      label: mcp.name,
      detail: `MCP server · ${SOURCE_NAMES[mcp.source]}${mcp.plugin ? ` (${mcp.plugin})` : ""} · ${mcp.transport}`,
      orbit: RING.mcp,
      speed: -0.02,
      phase: spread(i, mcps.length, id),
      size: 4,
      working: false,
      state: "idle",
      source: mcp.source,
    });
    for (const t of roots) if (reaches(t.provider, mcp.source)) links.push({ from: `t:${t.id}`, to: id, kind: "mcp" });
  });

  const rings: Galaxy["rings"] = [];
  if (working.length) rings.push({ radius: RING.working, dashed: false });
  if (idle.length) rings.push({ radius: RING.idle, dashed: false });
  if (runs.length) rings.push({ radius: RING.workflows, dashed: false });
  if (mcps.length) rings.push({ radius: RING.mcp, dashed: true });
  return { bodies, rings, links };
}
