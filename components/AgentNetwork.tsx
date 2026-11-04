// The Agent Network, in two modes. Coding: the agents working on this project as a living
// solar system with Koda as the sun. App: the AI architecture the project's own code builds
// (its agents and their tools, MCP servers, models and skills), read from the source.
// Coding mode:
// Working threads orbit close, idle ones further out, sub-agents are their moons, workflow
// runs are ringed planets whose agents circle them, and MCP servers are stations on the
// outer belt. Click a planet to open its thread, a ringed planet to open its run graph.
import { useEffect, useMemo, useRef, useState } from "react";
import { experimental_useSidebarThreads, useRpc } from "@get-bb/plugin-sdk/app";
import type { ResolvedScope, rpcContract, Scope } from "../server";
import type { AgentCall, RunHistory } from "@/lib/workflows";
import { buildAppGalaxy, buildGalaxy, type Body, type GalaxyRun, type GalaxyThread } from "@/lib/galaxy";
import type { Architecture } from "@/lib/app-architecture";
import { runs as spriteRuns, spriteFor } from "@/lib/koda-sprite";
import { Icon } from "@/components/ui/icon";
import { useHues } from "./colors";

type Mcp = { name: string; source: "claude" | "project" | "codex" | "plugin"; transport: string; plugin: string | null };
type Point = { x: number; y: number };
type Mode = "coding" | "app";

const LIVE_RUN = new Set(["running", "queued", "pending", "starting"]);

export function AgentNetwork({
  scope,
  workspace,
  onOpenThread,
  onOpenRun,
  onOpenFile,
}: {
  scope: Scope;
  workspace: ResolvedScope;
  onOpenThread(id: string): void;
  onOpenRun(id: string): void;
  onOpenFile(path: string, line: number): void;
}) {
  const rpc = useRpc<typeof rpcContract>();
  const hues = useHues();
  const { threads } = experimental_useSidebarThreads();
  const [mode, setMode] = useState<Mode>("coding");

  // App mode: the project's own agent architecture, rescanned every 30 s while shown.
  const [arch, setArch] = useState<(Architecture & { truncated: boolean }) | null>(null);
  useEffect(() => {
    if (mode !== "app") return;
    let stopped = false;
    const load = () => void rpc.call("appArchitecture", { scope }).then((a) => !stopped && setArch(a), () => !stopped && setArch({ nodes: [], links: [], truncated: false }));
    load();
    const timer = setInterval(load, 30_000);
    return () => {
      stopped = true;
      clearInterval(timer);
    };
  }, [rpc, scope, mode]);

  // Workflow runs (the latest few, with their agents) and MCP servers, polled.
  const [runs, setRuns] = useState<GalaxyRun[]>([]);
  const [mcps, setMcps] = useState<Mcp[]>([]);
  useEffect(() => {
    let stopped = false;
    void rpc.call("mcpServers", { scope }).then(({ servers }) => !stopped && setMcps(servers), () => undefined);
    const load = async () => {
      try {
        const { result } = await rpc.call("workflows", { scope, threadId: null, request: { action: "list" } });
        const list = (Array.isArray(result) ? result : []) as { id: string; name: string; status: string; originThreadId: string | null }[];
        const shown = [...list.filter((r) => LIVE_RUN.has(r.status)), ...list.filter((r) => !LIVE_RUN.has(r.status))].slice(0, 3);
        const withCalls = await Promise.all(
          shown.map(async (run) => {
            const { result: history } = await rpc
              .call("workflows", { scope, threadId: null, request: { action: "history", runId: run.id } })
              .catch(() => ({ result: null }));
            return { id: run.id, name: run.name, status: run.status, originThreadId: run.originThreadId, calls: ((history as RunHistory | null)?.calls ?? []) as AgentCall[] };
          }),
        );
        if (!stopped) setRuns(withCalls);
      } catch {
        // workflows plugin off or no thread: the galaxy just has no workflow planets
      }
    };
    void load();
    const timer = setInterval(load, 5000);
    return () => {
      stopped = true;
      clearInterval(timer);
    };
  }, [rpc, scope]);

  const mine: GalaxyThread[] = useMemo(
    () =>
      threads
        .filter((t) => t.projectId === workspace.projectId && !t.isHidden)
        .map((t) => ({
          id: t.id,
          title: t.displayTitle,
          parentId: t.parentThreadId,
          provider: t.providerId,
          state:
            t.status === "error" || t.runtimeStatus === "error"
              ? "error"
              : t.hasPendingInteraction
                ? "waiting"
                : t.status === "active" || t.runtimeStatus === "active" || Object.values(t.activity).some((n) => n > 0)
                  ? "working"
                  : "idle",
          activity: t.activity.backgroundAgents + t.activity.workflows,
        })),
    [threads, workspace.projectId],
  );

  const galaxy = useMemo(
    () => (mode === "app" ? buildAppGalaxy(arch ?? { nodes: [], links: [] }) : buildGalaxy(mine, runs, mcps)),
    [mode, arch, mine, runs, mcps],
  );
  const working = mine.filter((t) => t.state === "working").length;
  const count = (kind: string) => arch?.nodes.filter((n) => n.kind === kind).length ?? 0;

  // Canvas, camera and interaction.
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [hover, setHover] = useState<{ body: Body; at: Point } | null>(null);
  const [paused, setPaused] = useState(() => window.matchMedia("(prefers-reduced-motion: reduce)").matches);
  const [labels, setLabels] = useState(true);
  const camera = useRef({ zoom: 1, x: 0, y: 0 });
  const positions = useRef(new Map<string, Point & { r: number }>());
  const latest = useRef({ galaxy, paused, labels, hues, mode, hoverId: null as string | null });
  latest.current = { galaxy, paused, labels, hues, mode, hoverId: hover?.body.id ?? null };

  useEffect(() => {
    const canvas = canvasRef.current!;
    const ctx = canvas.getContext("2d")!;
    const stars = Array.from({ length: 260 }, (_, i) => ({ x: rand(i * 3), y: rand(i * 3 + 1), z: 0.3 + rand(i * 3 + 2) * 0.7, p: rand(i * 7) * 6.28 }));
    const sun = spriteImage("working");
    const sleepySun = spriteImage("sleepy");
    let frame = 0;
    let clock = 0;
    let last = performance.now();
    const draw = (now: number) => {
      frame = requestAnimationFrame(draw);
      const width = canvas.clientWidth;
      const height = canvas.clientHeight;
      if (width === 0 || height === 0 || document.hidden) return;
      const dpr = window.devicePixelRatio || 1;
      if (canvas.width !== Math.round(width * dpr)) {
        canvas.width = Math.round(width * dpr);
        canvas.height = Math.round(height * dpr);
      }
      const { galaxy: g, paused: still, labels: showLabels, hues: h, mode: view, hoverId } = latest.current;
      if (!still) clock += Math.min(now - last, 50) / 1000;
      last = now;
      const cam = camera.current;
      // The MCP belt (plus its labels) fits between the header and the legend.
      const usable = Math.min(width - 40, height - 150);
      const scale = (Math.max(usable, 160) / 2 / 330) * cam.zoom;
      const cx = width / 2 + cam.x;
      const cy = 76 + (height - 76 - 56) / 2 + cam.y;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, width, height);

      // Stars, with a little parallax when panning.
      for (const star of stars) {
        const twinkle = 0.45 + 0.55 * Math.abs(Math.sin(clock * 0.8 * star.z + star.p));
        ctx.globalAlpha = 0.25 + 0.55 * twinkle * star.z;
        ctx.fillStyle = "#dfe7ff";
        const sx = (((star.x * width + cam.x * star.z * 0.4) % width) + width) % width;
        const sy = (((star.y * height + cam.y * star.z * 0.4) % height) + height) % height;
        ctx.fillRect(sx, sy, star.z * 1.6, star.z * 1.6);
      }
      ctx.globalAlpha = 1;

      // Orbits.
      ctx.lineWidth = 1;
      for (const ring of g.rings) {
        ctx.beginPath();
        ctx.setLineDash(ring.dashed ? [3, 6] : []);
        ctx.strokeStyle = `rgba(200,215,255,${ring.dashed ? 0.12 : 0.07})`;
        ctx.arc(cx, cy, ring.radius * scale, 0, Math.PI * 2);
        ctx.stroke();
      }
      ctx.setLineDash([]);

      // Positions: roots orbit the sun, children orbit their parent.
      const pos = positions.current;
      pos.clear();
      for (const body of g.bodies) {
        const center = body.parent ? pos.get(body.parent) : { x: cx, y: cy, r: 0 };
        if (!center) continue;
        const angle = body.phase + clock * body.speed;
        const radius = body.parent ? body.orbit * Math.max(scale, 0.7) : body.orbit * scale;
        pos.set(body.id, { x: center.x + Math.cos(angle) * radius, y: center.y + Math.sin(angle) * radius, r: body.size * Math.max(scale, 0.6) });
      }

      // Links: a workflow to the thread that started it; MCP reach on hover.
      for (const link of g.links) {
        const a = pos.get(link.from);
        const b = pos.get(link.to);
        if (!a || !b) continue;
        const lit = hoverId !== null && (link.from === hoverId || link.to === hoverId);
        if (link.kind === "mcp" && !lit) continue;
        ctx.beginPath();
        ctx.setLineDash(link.kind === "mcp" ? [2, 4] : [6, 5]);
        ctx.strokeStyle = link.kind === "mcp" ? hexA(h.cyan, lit ? 0.55 : 0.15) : hexA(h.green, lit ? 0.7 : 0.25);
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(b.x, b.y);
        ctx.stroke();
      }
      ctx.setLineDash([]);

      // Energy from the sun to every working agent.
      for (const body of g.bodies) {
        if (!body.working || body.parent) continue;
        const p = pos.get(body.id)!;
        const color = colorOf(body, h);
        const beam = ctx.createLinearGradient(cx, cy, p.x, p.y);
        beam.addColorStop(0, hexA("#ffb347", 0.35));
        beam.addColorStop(1, hexA(color, 0.05));
        ctx.strokeStyle = beam;
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(cx, cy);
        ctx.lineTo(p.x, p.y);
        ctx.stroke();
        for (let i = 0; i < 3; i++) {
          const t = (clock * 0.45 + i / 3 + body.phase) % 1;
          ctx.fillStyle = hexA("#ffd48a", 0.9 * (1 - t));
          ctx.beginPath();
          ctx.arc(cx + (p.x - cx) * t, cy + (p.y - cy) * t, 1.8, 0, Math.PI * 2);
          ctx.fill();
        }
      }
      ctx.lineWidth = 1;

      // The sun: Koda, with a breathing corona that brightens when agents work.
      const busy = view === "app" || g.bodies.some((b) => b.working);
      const pulse = 1 + 0.06 * Math.sin(clock * (busy ? 2.4 : 0.9));
      const sunR = 46 * scale * pulse;
      const corona = ctx.createRadialGradient(cx, cy, sunR * 0.2, cx, cy, sunR * 2.6);
      corona.addColorStop(0, "rgba(255,196,110,0.95)");
      corona.addColorStop(0.35, "rgba(245,160,74,0.45)");
      corona.addColorStop(1, "rgba(245,120,40,0)");
      ctx.fillStyle = corona;
      ctx.beginPath();
      ctx.arc(cx, cy, sunR * 2.6, 0, Math.PI * 2);
      ctx.fill();
      const bear = busy ? sun : sleepySun;
      const bearSize = sunR * 1.25;
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(bear, cx - bearSize / 2, cy - bearSize / 2, bearSize, bearSize);

      // Bodies, outermost first so moons draw over their planets.
      for (const body of [...g.bodies].sort((a, b) => Number(Boolean(a.parent)) - Number(Boolean(b.parent)))) {
        const p = pos.get(body.id);
        if (!p) continue;
        const color = colorOf(body, h);
        const hovered = body.id === hoverId;
        if (body.kind === "mcp" || body.kind === "skill") {
          ctx.save();
          ctx.translate(p.x, p.y);
          ctx.rotate(Math.PI / 4 + clock * 0.3);
          ctx.fillStyle = hexA(color, hovered ? 1 : 0.85);
          ctx.shadowColor = color;
          ctx.shadowBlur = hovered ? 14 : 6;
          ctx.fillRect(-p.r, -p.r, p.r * 2, p.r * 2);
          ctx.restore();
        } else {
          if (body.working || body.state === "waiting" || body.state === "error") {
            const halo = body.state === "error" ? h.red : body.state === "waiting" ? h.yellow : color;
            ctx.beginPath();
            ctx.strokeStyle = hexA(halo, 0.35 + 0.35 * Math.abs(Math.sin(clock * 3 + body.phase)));
            ctx.lineWidth = 2;
            ctx.arc(p.x, p.y, p.r + 4 + 2 * Math.sin(clock * 3 + body.phase), 0, Math.PI * 2);
            ctx.stroke();
            ctx.lineWidth = 1;
          }
          // Lit from the sun's side.
          const dx = cx - p.x;
          const dy = cy - p.y;
          const d = Math.hypot(dx, dy) || 1;
          const sphere = ctx.createRadialGradient(p.x + (dx / d) * p.r * 0.45, p.y + (dy / d) * p.r * 0.45, p.r * 0.1, p.x, p.y, p.r);
          sphere.addColorStop(0, lighten(color));
          sphere.addColorStop(0.6, color);
          sphere.addColorStop(1, hexA(color, body.state === "idle" ? 0.35 : 0.7));
          ctx.globalAlpha = body.state === "idle" && !hovered ? 0.6 : 1;
          ctx.shadowColor = color;
          ctx.shadowBlur = hovered ? 18 : body.working ? 12 : 0;
          ctx.fillStyle = sphere;
          ctx.beginPath();
          ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
          ctx.fill();
          ctx.shadowBlur = 0;
          ctx.globalAlpha = 1;
          if (body.kind === "run" || body.kind === "model") {
            ctx.strokeStyle = hexA(color, 0.75);
            ctx.lineWidth = 1.5;
            ctx.beginPath();
            ctx.ellipse(p.x, p.y, p.r * 1.9, p.r * 0.6, -0.4, 0, Math.PI * 2);
            ctx.stroke();
            ctx.lineWidth = 1;
          }
        }
        const showLabel =
          hovered || (showLabels && (body.kind === "run" || body.kind === "mcp" || body.kind === "appAgent" || body.kind === "model" || (body.kind === "thread" && (body.working || scale > 0.9))));
        if (showLabel) {
          ctx.font = `${hovered ? 600 : 500} 11px ui-sans-serif, system-ui, sans-serif`;
          ctx.textAlign = "center";
          ctx.fillStyle = hovered ? "#ffffff" : "rgba(225,232,255,0.78)";
          ctx.fillText(truncate(body.label, hovered ? 40 : 22), p.x, p.y + p.r + 14);
        }
      }
    };
    frame = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(frame);
  }, []);

  const hitTest = (x: number, y: number): Body | null => {
    let best: Body | null = null;
    let bestD = Infinity;
    for (const body of latest.current.galaxy.bodies) {
      const p = positions.current.get(body.id);
      if (!p) continue;
      const d = Math.hypot(p.x - x, p.y - y);
      if (d < Math.max(p.r + 5, 9) && d < bestD) {
        best = body;
        bestD = d;
      }
    }
    return best;
  };
  const drag = useRef<{ x: number; y: number; moved: boolean } | null>(null);
  const local = (event: React.PointerEvent | React.WheelEvent) => {
    const box = canvasRef.current!.getBoundingClientRect();
    return { x: event.clientX - box.left, y: event.clientY - box.top };
  };

  const open = (body: Body) => {
    setHover(null);
    if (body.file) onOpenFile(body.file.path, body.file.line);
    else if (body.kind === "run") onOpenRun(body.ref);
    else if (body.kind === "agent" && body.thread) onOpenThread(body.thread);
    else if (body.kind === "thread" || body.kind === "child") onOpenThread(body.ref);
  };

  return (
    <div
      className="relative h-full w-full overflow-hidden select-none"
      style={{
        background:
          "radial-gradient(ellipse at 50% 45%, #1b1633 0%, #0e1022 45%, #070812 100%), radial-gradient(circle at 20% 80%, rgba(110,80,200,0.18), transparent 50%)",
      }}
    >
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0"
        style={{ background: "radial-gradient(circle at 78% 22%, rgba(80,160,255,0.12), transparent 40%), radial-gradient(circle at 18% 75%, rgba(200,90,220,0.12), transparent 45%)" }}
      />
      <canvas
        ref={canvasRef}
        className="absolute inset-0 h-full w-full"
        role="img"
        aria-label={
          mode === "app"
            ? `App architecture: ${count("agent")} agents, ${count("tool")} tools, ${count("mcp")} MCP servers, ${count("model")} models, ${count("skill")} skills`
            : `Agent network: ${working} working, ${mine.length - working} idle, ${runs.length} workflow runs, ${mcps.length} MCP servers`
        }
        style={{ cursor: hover ? "pointer" : drag.current ? "grabbing" : "grab" }}
        onPointerDown={(event) => {
          event.currentTarget.setPointerCapture(event.pointerId);
          drag.current = { x: event.clientX, y: event.clientY, moved: false };
        }}
        onPointerMove={(event) => {
          if (drag.current && event.buttons === 1) {
            const dx = event.clientX - drag.current.x;
            const dy = event.clientY - drag.current.y;
            if (Math.abs(dx) + Math.abs(dy) > 2) drag.current.moved = true;
            camera.current.x += dx;
            camera.current.y += dy;
            drag.current.x = event.clientX;
            drag.current.y = event.clientY;
            return;
          }
          const at = local(event);
          const body = hitTest(at.x, at.y);
          setHover((current) => (body === null ? null : current !== null && current.body.id === body.id && Math.abs(current.at.x - at.x) < 2 ? current : { body, at }));
        }}
        onPointerUp={(event) => {
          const wasDrag = drag.current?.moved;
          drag.current = null;
          if (wasDrag) return;
          const at = local(event);
          const body = hitTest(at.x, at.y);
          if (body) open(body);
        }}
        onPointerLeave={() => setHover(null)}
        onDoubleClick={() => (camera.current = { zoom: 1, x: 0, y: 0 })}
        onWheel={(event) => {
          const cam = camera.current;
          const next = Math.min(3, Math.max(0.45, cam.zoom * Math.exp(-event.deltaY * 0.0015)));
          // Zoom around the pointer.
          const at = local(event);
          const box = canvasRef.current!.getBoundingClientRect();
          const ox = at.x - box.width / 2 - cam.x;
          const oy = at.y - (76 + (box.height - 132) / 2) - cam.y;
          cam.x -= ox * (next / cam.zoom - 1);
          cam.y -= oy * (next / cam.zoom - 1);
          cam.zoom = next;
        }}
      />

      <header className="pointer-events-none absolute inset-x-0 top-0 flex flex-wrap items-start gap-3 p-4">
        <div>
          <h2 className="text-sm font-semibold tracking-wide text-white">Agent Network</h2>
          <p className="text-[11px] text-white/55">
            {workspace.label} · {mode === "app" ? "what this project's code builds" : "who is working on this project"}
          </p>
        </div>
        <div className="pointer-events-auto flex rounded-md border border-white/10 bg-white/5 p-0.5 text-[11px] backdrop-blur" role="tablist" aria-label="Agent Network mode">
          {(["coding", "app"] as const).map((m) => (
            <button
              key={m}
              type="button"
              role="tab"
              aria-selected={mode === m}
              title={m === "app" ? "The agents, tools, MCP servers, models and skills this project's code defines" : "The agents, workflows and MCP servers working on this project"}
              className={`rounded px-2 py-0.5 ${mode === m ? "bg-white/15 font-semibold text-white" : "text-white/60 hover:text-white"}`}
              onClick={() => {
                setHover(null);
                setMode(m);
              }}
            >
              {m === "app" ? "App" : "Coding"}
            </button>
          ))}
        </div>
        {mode === "app" ? (
          <div className="flex flex-wrap gap-1.5">
            <Stat color={hues.orange} label="agents" value={count("agent")} />
            <Stat color={hues.yellow} label="tools" value={count("tool")} />
            <Stat color={hues.cyan} label="MCP servers" value={count("mcp")} />
            <Stat color={hues.blue} label="models" value={count("model")} />
            <Stat color={hues.green} label="skills" value={count("skill")} />
          </div>
        ) : (
          <div className="flex flex-wrap gap-1.5">
            <Stat color={hues.blue} label="working" value={working} />
            <Stat color="#9aa5c4" label="idle" value={mine.length - working} />
            <Stat color={hues.green} label="workflows" value={runs.length} />
            <Stat color={hues.cyan} label="MCP servers" value={mcps.length} />
          </div>
        )}
        <span className="flex-1" />
        <div className="pointer-events-auto flex gap-1">
          <Toggle icon={paused ? "Play" : "Pause"} label={paused ? "Resume motion" : "Pause motion"} onClick={() => setPaused((v) => !v)} />
          <Toggle icon="Info" label={labels ? "Hide labels" : "Show labels"} onClick={() => setLabels((v) => !v)} />
          <Toggle icon="Maximize2" label="Recentre (double-click)" onClick={() => (camera.current = { zoom: 1, x: 0, y: 0 })} />
        </div>
      </header>

      {mode === "app" ? (
        <footer className="pointer-events-none absolute bottom-0 left-0 flex flex-wrap gap-x-4 gap-y-1 p-4 text-[11px] text-white/60">
          <Legend shape="dot" color={hues.orange} label="Agent" />
          <Legend shape="dot" color={hues.magenta} label="Direct LLM call" />
          <Legend shape="dot" color={hues.yellow} label="Tool (moon)" />
          <Legend shape="diamond" color={hues.cyan} label="MCP server" />
          <Legend shape="ring" color={hues.blue} label="Model" />
          <Legend shape="diamond" color={hues.green} label="Skill" />
          <span>Read from the source, not run · click anything to open its code</span>
        </footer>
      ) : (
        <footer className="pointer-events-none absolute bottom-0 left-0 flex flex-wrap gap-x-4 gap-y-1 p-4 text-[11px] text-white/60">
          <Legend shape="dot" color={hues.orange} label="Claude Code agent" />
          <Legend shape="dot" color={hues.green} label="Codex agent" />
          <Legend shape="dot" color={hues.magenta} label="Other agent" />
          <Legend shape="ring" color={hues.green} label="Workflow run" />
          <Legend shape="diamond" color={hues.cyan} label="MCP server" />
          <span>Inner orbit: working · outer: idle · moons: sub-agents</span>
        </footer>
      )}

      {mode === "app" && arch !== null && arch.nodes.length === 0 ? (
        <p className="pointer-events-none absolute inset-x-0 bottom-20 text-center text-xs text-white/60">
          No agents, MCP servers or model calls found in this project's code.
        </p>
      ) : null}
      {mode === "app" && arch?.truncated ? (
        <p className="pointer-events-none absolute inset-x-0 bottom-14 text-center text-[11px] text-white/45">Large project: the first 3000 source files were scanned.</p>
      ) : null}
      {mode === "coding" && mine.length === 0 && runs.length === 0 ? (
        <p className="pointer-events-none absolute inset-x-0 bottom-20 text-center text-xs text-white/60">
          No agents in this project yet. Start a chat and it will appear here as a planet.
        </p>
      ) : null}

      {hover ? (
        <div
          role="tooltip"
          className="pointer-events-none absolute z-10 max-w-64 rounded-lg border border-white/15 bg-[#0d0f1f]/90 px-3 py-2 text-xs text-white shadow-[0_8px_30px_rgba(0,0,0,0.5)] backdrop-blur"
          style={{ left: Math.min(hover.at.x + 14, (canvasRef.current?.clientWidth ?? 0) - 260), top: hover.at.y + 14 }}
        >
          <div className="font-semibold">{hover.body.label}</div>
          <div className="mt-0.5 text-white/65">{hover.body.detail}</div>
          {hover.body.kind !== "mcp" || hover.body.file ? <div className="mt-1 text-[10px] text-white/45">{hover.body.file ? "Click to open the code" : "Click to open"}</div> : null}
        </div>
      ) : null}
    </div>
  );
}

function Stat({ color, label, value }: { color: string; label: string; value: number }) {
  return (
    <span className="flex items-center gap-1.5 rounded-full border border-white/10 bg-white/5 px-2 py-0.5 text-[11px] text-white/80 backdrop-blur">
      <span className="size-1.5 rounded-full" style={{ background: color, boxShadow: `0 0 6px ${color}` }} />
      <span className="font-semibold tabular-nums text-white">{value}</span>
      {label}
    </span>
  );
}

function Toggle({ icon, label, onClick }: { icon: string; label: string; onClick(): void }) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      className="flex size-7 items-center justify-center rounded-md border border-white/10 bg-white/5 text-white/70 backdrop-blur hover:bg-white/10 hover:text-white"
      onClick={onClick}
    >
      <Icon name={icon} className="size-3.5" />
    </button>
  );
}

function Legend({ shape, color, label }: { shape: "dot" | "ring" | "diamond"; color: string; label: string }) {
  return (
    <span className="flex items-center gap-1.5">
      {shape === "dot" ? <span className="size-2 rounded-full" style={{ background: color }} /> : null}
      {shape === "ring" ? <span className="h-1.5 w-3 rounded-[50%] border" style={{ borderColor: color }} /> : null}
      {shape === "diamond" ? <span className="size-1.5 rotate-45" style={{ background: color }} /> : null}
      {label}
    </span>
  );
}

function colorOf(body: Body, h: ReturnType<typeof useHues>): string {
  if (body.kind === "appAgent") return body.provider === "LLM call" ? h.magenta : h.orange;
  if (body.kind === "tool") return h.yellow;
  if (body.kind === "model") return h.blue;
  if (body.kind === "skill") return h.green;
  if (body.kind === "mcp") return body.source === "codex" ? h.green : body.source === "plugin" ? h.magenta : h.cyan;
  if (body.kind === "agent") return body.state === "error" ? h.red : body.working ? h.blue : body.state === "idle" ? h.green : h.yellow;
  if (body.kind === "run") return body.state === "error" ? h.red : body.working ? h.blue : h.green;
  if (body.state === "error") return h.red;
  return body.provider === "claude-code" ? h.orange : body.provider === "codex" ? h.green : h.magenta;
}

function spriteImage(mood: "working" | "sleepy"): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = 16;
  canvas.height = 16;
  const ctx = canvas.getContext("2d")!;
  for (const run of spriteRuns(spriteFor(mood, { sunglasses: true }))) {
    ctx.fillStyle = run.color;
    ctx.fillRect(run.x, run.y, run.w, 1);
  }
  return canvas;
}

/** Deterministic 0..1 noise, so the starfield doesn't jump between renders. */
function rand(seed: number): number {
  const x = Math.sin(seed * 12.9898 + 78.233) * 43758.5453;
  return x - Math.floor(x);
}

function hexA(hex: string, alpha: number): string {
  const n = Number.parseInt(hex.slice(1, 7), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${alpha.toFixed(3)})`;
}

function lighten(hex: string): string {
  const n = Number.parseInt(hex.slice(1, 7), 16);
  const mix = (c: number) => Math.round(c + (255 - c) * 0.55);
  return `rgb(${mix((n >> 16) & 255)},${mix((n >> 8) & 255)},${mix(n & 255)})`;
}

function truncate(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}
