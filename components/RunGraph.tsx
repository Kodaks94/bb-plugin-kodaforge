// One workflow run as a vertical agent graph: start → each phase → its agents → result.
// A running phase's spine flows; a running agent pulses. Clicking an agent opens the
// thread it worked in. Polls while the run is live.
import { useEffect, useState } from "react";
import { useRpc } from "@get-bb/plugin-sdk/app";
import type { rpcContract, Scope } from "../server";
import type { AgentCall, RunHistory } from "@/lib/workflows";
import { Icon } from "@/components/ui/icon";
import { useHues } from "./colors";

const LIVE = new Set(["running", "queued", "pending", "starting"]);
const SHOWN_PER_PHASE = 8;

const GRAPH_CSS = `
@keyframes kf-flow { to { background-position: 0 12px; } }
@keyframes kf-pulse { 0%, 100% { box-shadow: 0 0 0 0 var(--kf-c); } 50% { box-shadow: 0 0 0 4px transparent; } }
.kf-spine-live { background-image: linear-gradient(var(--kf-c) 50%, transparent 50%); background-size: 2px 12px; animation: kf-flow 0.6s linear infinite; }
.kf-dot-live { animation: kf-pulse 1.4s ease-out infinite; }
@media (prefers-reduced-motion: reduce) { .kf-spine-live, .kf-dot-live { animation: none; } }
`;

function duration(from: number | null, to: number | null): string {
  if (from === null) return "";
  const seconds = Math.max(0, Math.round(((to ?? Date.now()) - from) / 1000));
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
  return `${Math.floor(seconds / 3600)}h ${Math.floor((seconds % 3600) / 60)}m`;
}

export function RunGraph({
  scope,
  threadId,
  runId,
  onBack,
  onOpenThread,
}: {
  scope: Scope;
  threadId: string | null;
  runId: string;
  onBack(): void;
  onOpenThread(id: string): void;
}) {
  const rpc = useRpc<typeof rpcContract>();
  const hues = useHues();
  const [history, setHistory] = useState<RunHistory | null>(null);
  const [result, setResult] = useState<unknown>(undefined);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [showResult, setShowResult] = useState(false);
  const [, tick] = useState(0);

  const live = history === null || LIVE.has(history.status);
  useEffect(() => {
    let stopped = false;
    const load = async () => {
      try {
        const { result: next } = await rpc.call("workflows", { scope, threadId, request: { action: "history", runId } });
        if (stopped) return;
        setHistory(next as RunHistory);
        setError(null);
        if (!LIVE.has((next as RunHistory).status)) {
          const { result: status } = await rpc.call("workflows", { scope, threadId, request: { action: "status", runId } });
          if (!stopped) setResult((status as { result?: unknown }).result);
        }
      } catch (cause) {
        if (!stopped) setError((cause as Error).message);
      }
    };
    void load();
    if (!live) return () => void (stopped = true);
    const poll = setInterval(load, 3000);
    const clock = setInterval(() => tick((n) => n + 1), 1000);
    return () => {
      stopped = true;
      clearInterval(poll);
      clearInterval(clock);
    };
  }, [rpc, scope, threadId, runId, live]);

  const tone = (status: string) =>
    status === "succeeded" ? hues.green : status === "failed" ? hues.red : LIVE.has(status) ? hues.blue : status === "cancelled" ? hues.muted : hues.yellow;

  if (history === null) {
    return (
      <div className="flex h-full flex-col text-[13px]">
        <Header onBack={onBack} title="Loading run…" />
        {error ? <p className="px-3 text-xs text-destructive">{error}</p> : <p className="px-3 text-xs text-muted-foreground">Reading the agent graph…</p>}
      </div>
    );
  }

  const counts = { succeeded: 0, running: 0, failed: 0, other: 0 };
  for (const call of history.calls) {
    if (call.status === "succeeded") counts.succeeded++;
    else if (call.status === "failed") counts.failed++;
    else if (LIVE.has(call.status)) counts.running++;
    else counts.other++;
  }
  const total = history.calls.length;
  const groups = [...history.phases.map((phase) => ({ phase, calls: history.calls.filter((c) => c.phase === phase) }))];
  const loose = history.calls.filter((c) => c.phase === null);
  if (loose.length > 0) groups.push({ phase: "Agents", calls: loose });
  const runColor = tone(history.status);

  return (
    <div className="flex h-full min-h-0 flex-col text-[13px]">
      <style>{GRAPH_CSS}</style>
      <Header onBack={onBack} title={history.name} />
      <div className="shrink-0 px-3 pb-2">
        <div className="flex items-center gap-2 text-xs">
          <span className="rounded-full px-1.5 py-px text-[11px] font-medium" style={{ color: runColor, background: `color-mix(in srgb, ${runColor} 14%, transparent)` }}>
            {history.status}
          </span>
          <span className="text-muted-foreground">
            {total} agent{total === 1 ? "" : "s"} · {duration(history.createdAt, history.finishedAt)}
          </span>
        </div>
        {total > 0 ? (
          <div className="mt-2 flex h-1.5 overflow-hidden rounded-full bg-muted" role="img" aria-label={`${counts.succeeded} done, ${counts.running} running, ${counts.failed} failed`}>
            <span style={{ width: `${(counts.succeeded / total) * 100}%`, background: hues.green }} />
            <span style={{ width: `${(counts.running / total) * 100}%`, background: hues.blue }} />
            <span style={{ width: `${(counts.failed / total) * 100}%`, background: hues.red }} />
          </div>
        ) : null}
      </div>

      <ol className="min-h-0 flex-1 overflow-y-auto px-3 pb-4" aria-label="Agent graph">
        <Node color={hues.muted} icon="Play" title="Start" detail={history.createdAt ? new Date(history.createdAt).toLocaleTimeString() : ""} />
        {groups.map(({ phase, calls }, i) => {
          const done = calls.length > 0 && calls.every((c) => !LIVE.has(c.status));
          const failures = calls.filter((c) => c.status === "failed").length;
          // Every agent failed: red. Some did: amber, since the workflow may carry on without them.
          const failed = failures > 0 && failures === calls.length;
          const partial = failures > 0 && !failed;
          const active = calls.some((c) => LIVE.has(c.status)) || (history.phase === phase && LIVE.has(history.status));
          const color = failed ? hues.red : active ? hues.blue : partial ? hues.yellow : done ? hues.green : hues.muted;
          const open = expanded[phase] ?? false;
          const visible = open ? calls : calls.slice(0, SHOWN_PER_PHASE);
          return (
            <li key={phase}>
              <Spine color={active ? hues.blue : calls.length > 0 ? color : hues.muted} live={active} dashed={calls.length === 0 && !active} />
              <Node
                color={color}
                icon={failed ? "X" : active ? "Loader" : partial ? "AlertTriangle" : done ? "Check" : "Circle"}
                title={phase}
                detail={
                  calls.length === 0
                    ? active
                      ? "starting…"
                      : "waiting"
                    : `${calls.length} agent${calls.length === 1 ? "" : "s"}${failures > 0 && !failed ? ` · ${failures} failed` : ""}`
                }
                live={active}
                step={i + 1}
              />
              {calls.length > 0 ? (
                <ul className="relative ml-[11px] border-l pl-3 pt-1" style={{ borderColor: `color-mix(in srgb, ${color} 45%, transparent)` }}>
                  {visible.map((call) => (
                    <AgentCard key={call.index} call={call} color={tone(call.status)} onOpen={onOpenThread} />
                  ))}
                  {calls.length > SHOWN_PER_PHASE ? (
                    <li>
                      <button type="button" className="py-1 text-[11px] text-muted-foreground hover:text-foreground" onClick={() => setExpanded((e) => ({ ...e, [phase]: !open }))}>
                        {open ? "Show fewer" : `Show ${calls.length - SHOWN_PER_PHASE} more`}
                      </button>
                    </li>
                  ) : null}
                </ul>
              ) : null}
            </li>
          );
        })}
        <li>
          <Spine color={runColor} live={live} dashed={live} />
          <Node
            color={live ? hues.muted : runColor}
            icon={history.status === "succeeded" ? "Flag" : history.status === "failed" ? "AlertTriangle" : live ? "Clock" : "Square"}
            title={live ? "Result" : history.status === "succeeded" ? "Finished" : history.status === "failed" ? "Failed" : "Stopped"}
            detail={live ? "when every agent is done" : history.finishedAt ? new Date(history.finishedAt).toLocaleTimeString() : ""}
          />
          {history.error ? <p className="ml-8 mt-1 text-xs text-destructive">{history.error}</p> : null}
          {result !== undefined && result !== null ? (
            <div className="ml-8 mt-1">
              <button type="button" className="text-[11px] text-muted-foreground hover:text-foreground" onClick={() => setShowResult((v) => !v)}>
                {showResult ? "Hide result" : "Show result"}
              </button>
              {showResult ? (
                <pre className="mt-1 max-h-64 overflow-auto whitespace-pre-wrap break-words rounded-md border border-border bg-muted/40 p-2 font-mono text-[11px]">
                  {JSON.stringify(result, null, 2)}
                </pre>
              ) : null}
            </div>
          ) : null}
        </li>
      </ol>
    </div>
  );
}

function Header({ onBack, title }: { onBack(): void; title: string }) {
  return (
    <div className="flex h-9 shrink-0 items-center gap-1 px-1.5">
      <button type="button" aria-label="Back to runs" title="Back to runs" className="flex size-6 items-center justify-center rounded text-muted-foreground hover:bg-muted hover:text-foreground" onClick={onBack}>
        <Icon name="ArrowLeft" className="size-3.5" />
      </button>
      <span className="truncate text-xs font-semibold">{title}</span>
    </div>
  );
}

function Spine({ color, live, dashed }: { color: string; live: boolean; dashed: boolean }) {
  return (
    <div className="ml-[11px] h-4 w-0.5" aria-hidden>
      <div
        className={`h-full w-full ${live ? "kf-spine-live" : ""}`}
        style={
          {
            "--kf-c": color,
            background: live ? undefined : dashed ? `repeating-linear-gradient(${color} 0 3px, transparent 3px 6px)` : color,
            opacity: dashed && !live ? 0.6 : 1,
          } as React.CSSProperties
        }
      />
    </div>
  );
}

function Node({ color, icon, title, detail, live = false, step }: { color: string; icon: string; title: string; detail: string; live?: boolean; step?: number }) {
  return (
    <div className="flex items-center gap-2">
      <span
        className={`flex size-6 shrink-0 items-center justify-center rounded-full border ${live ? "kf-dot-live" : ""}`}
        style={{ "--kf-c": color, color, borderColor: color, background: `color-mix(in srgb, ${color} 14%, var(--background))` } as React.CSSProperties}
      >
        <Icon name={icon} className={`size-3.5 ${live && icon === "Loader" ? "animate-spin motion-reduce:animate-none" : ""}`} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-xs font-semibold">
          {step !== undefined ? <span className="mr-1 font-normal text-muted-foreground">{step}.</span> : null}
          {title}
        </span>
        {detail ? <span className="block truncate text-[11px] text-muted-foreground">{detail}</span> : null}
      </span>
    </div>
  );
}

function AgentCard({ call, color, onOpen }: { call: AgentCall; color: string; onOpen(id: string): void }) {
  const live = LIVE.has(call.status);
  const label = call.label ?? `Agent ${call.index + 1}`;
  return (
    <li className="relative py-0.5">
      {/* the branch from the phase's rail into this card */}
      <span aria-hidden className="absolute -left-3 top-1/2 h-px w-3" style={{ background: `color-mix(in srgb, ${color} 45%, transparent)` }} />
      <button
        type="button"
        disabled={call.childThreadId === null}
        title={call.childThreadId ? `Open ${label}'s thread` : label}
        className="group flex w-full items-center gap-2 rounded-md border border-border bg-background px-2 py-1 text-left transition-colors hover:border-[color:var(--kf-c)] disabled:cursor-default"
        style={{ "--kf-c": color } as React.CSSProperties}
        onClick={() => call.childThreadId && onOpen(call.childThreadId)}
      >
        <span className={`size-2 shrink-0 rounded-full ${live ? "kf-dot-live" : ""}`} style={{ background: color, "--kf-c": color } as React.CSSProperties} />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-xs">{label}</span>
          <span className="block truncate text-[10px] text-muted-foreground">
            {[call.model, call.replayed ? "cached" : null, call.error].filter(Boolean).join(" · ")}
          </span>
        </span>
        <span className="shrink-0 font-mono text-[10px] tabular-nums text-muted-foreground">{duration(call.startedAt, call.finishedAt)}</span>
        {call.childThreadId ? <Icon name="ChevronRight" className="size-3 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100" /> : null}
      </button>
    </li>
  );
}
