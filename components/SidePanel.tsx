// The secondary side bar (VS Code's right-hand panel): chat with an agent on this
// workspace, the project's threads, and its workflow runs. Chat and the composer
// are BB's own components; nothing about threads is proxied through the plugin.
import { useEffect, useMemo, useState } from "react";
import {
  ThreadChat,
  ThreadTitle,
  experimental_NewThreadComposer as NewThreadComposer,
  experimental_ThreadStatusGlyph as ThreadStatusGlyph,
  experimental_useSidebarThreads,
  useRpc,
  useSdk,
} from "@get-bb/plugin-sdk/app";
import type { ResolvedScope, rpcContract, Scope } from "../server";
import { Icon } from "@/components/ui/icon";
import { useHues } from "./colors";
import { RunGraph } from "./RunGraph";

export type SideTab = "chat" | "threads" | "workflows";

interface Run {
  id: string;
  name: string;
  status: string;
  phase: string | null;
  error: string | null;
  createdAt: number;
  finishedAt: number | null;
}

export function SidePanel({
  scope,
  workspace,
  tab,
  setTab,
  chatThreadId,
  setChatThreadId,
  workflowFiles,
  openRun,
  setOpenRun,
  onClose,
  log,
}: {
  scope: Scope;
  workspace: ResolvedScope;
  tab: SideTab;
  setTab(tab: SideTab): void;
  chatThreadId: string | null;
  setChatThreadId(id: string | null): void;
  /** Named workflows found under .bb/workflows/. */
  workflowFiles: string[];
  /** The run whose agent graph is open; owned by the workbench so the Agent Network can open one. */
  openRun: string | null;
  setOpenRun(id: string | null): void;
  onClose(): void;
  log(line: string): void;
}) {
  const hues = useHues();
  const tabs: { id: SideTab; label: string; icon: string; hue: string }[] = [
    { id: "chat", label: "Chat", icon: "MessageSquare", hue: hues.blue },
    { id: "threads", label: "Threads", icon: "ListTodo", hue: hues.magenta },
    { id: "workflows", label: "Workflows", icon: "Workflow", hue: hues.green },
  ];
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div role="tablist" aria-label="Side panel" className="flex h-9 shrink-0 items-center gap-0.5 border-b border-border px-1.5">
        {tabs.map((entry) => (
          <button
            key={entry.id}
            role="tab"
            type="button"
            aria-selected={tab === entry.id}
            className={`flex items-center gap-1.5 rounded-md px-2 py-1 text-xs transition-colors ${
              tab === entry.id ? "bg-muted text-foreground" : "text-muted-foreground hover:text-foreground"
            }`}
            onClick={() => setTab(entry.id)}
          >
            <span style={{ color: tab === entry.id ? entry.hue : undefined }} className="flex">
              <Icon name={entry.icon} className="size-3.5" />
            </span>
            {entry.label}
          </button>
        ))}
        <span className="flex-1" />
        <button type="button" aria-label="Close side panel" title="Close (⌘⌥B)" className="flex size-6 items-center justify-center rounded text-muted-foreground hover:bg-muted hover:text-foreground" onClick={onClose}>
          <Icon name="X" className="size-3.5" />
        </button>
      </div>
      <div className="min-h-0 flex-1">
        {tab === "chat" ? (
          <ChatTab workspace={workspace} threadId={chatThreadId} setThreadId={setChatThreadId} openThreads={() => setTab("threads")} log={log} />
        ) : tab === "threads" ? (
          <ThreadsTab
            workspace={workspace}
            current={chatThreadId}
            onPick={(id) => {
              setChatThreadId(id);
              setTab("chat");
            }}
            onNew={() => {
              setChatThreadId(null);
              setTab("chat");
            }}
          />
        ) : (
          <WorkflowsTab
            scope={scope}
            threadId={chatThreadId}
            files={workflowFiles}
            log={log}
            open={openRun}
            setOpen={setOpenRun}
            onOpenThread={(id) => {
              setChatThreadId(id);
              setTab("chat");
            }}
          />
        )}
      </div>
    </div>
  );
}

function ChatTab({
  workspace,
  threadId,
  setThreadId,
  openThreads,
  log,
}: {
  workspace: ResolvedScope;
  threadId: string | null;
  setThreadId(id: string | null): void;
  openThreads(): void;
  log(line: string): void;
}) {
  const sdk = useSdk();
  if (threadId === null) {
    return (
      <div className="flex h-full min-h-0 flex-col">
        <div className="shrink-0 px-3 pb-2 pt-3">
          <h2 className="text-sm font-semibold">New chat</h2>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {workspace.environmentId ? "The agent works in this workspace, on the same files as the editor." : "Starts a thread in this project."}
          </p>
        </div>
        <div className="min-h-0 flex-1 px-2 pb-2">
          <NewThreadComposer
            defaultProjectId={workspace.projectId}
            {...(workspace.environmentId ? { defaultEnvironment: { type: "reuse" as const, environmentId: workspace.environmentId } } : {})}
            placeholder="Ask an agent about this code…"
            draftKey={`kodaforge:${workspace.projectId}:${workspace.environmentId ?? "project"}`}
            onSubmit={async (request) => {
              try {
                const thread = await sdk.threads.spawn(request);
                setThreadId(thread.id);
                log(`Started a chat thread (${thread.id})`);
              } catch (error) {
                log(`Could not start a thread: ${(error as Error).message}`);
                throw error;
              }
            }}
          />
        </div>
      </div>
    );
  }
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex h-8 shrink-0 items-center gap-1 border-b border-border px-2 text-xs">
        <span className="min-w-0 flex-1 truncate font-medium">
          <ThreadTitle threadId={threadId} />
        </span>
        <IconButton icon="ListTodo" label="All threads" onClick={openThreads} />
        <IconButton icon="MessageSquarePlus" label="New chat" onClick={() => setThreadId(null)} />
      </div>
      <div className="min-h-0 flex-1">
        <ThreadChat key={threadId} threadId={threadId} variant="compact" layout="contained" />
      </div>
    </div>
  );
}

function ThreadsTab({
  workspace,
  current,
  onPick,
  onNew,
}: {
  workspace: ResolvedScope;
  current: string | null;
  onPick(id: string): void;
  onNew(): void;
}) {
  const hues = useHues();
  const { threads, status } = experimental_useSidebarThreads();
  const mine = useMemo(() => {
    const inProject = threads.filter((thread) => thread.projectId === workspace.projectId && !thread.isHidden);
    // Threads on this exact workspace first, as they share the editor's files.
    return [...inProject].sort((a, b) => Number(b.environment?.id === workspace.environmentId) - Number(a.environment?.id === workspace.environmentId));
  }, [threads, workspace.projectId, workspace.environmentId]);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex h-8 shrink-0 items-center px-3 text-xs text-muted-foreground">
        <span className="flex-1">{status === "loading" ? "Loading threads…" : `${mine.length} thread${mine.length === 1 ? "" : "s"} in ${workspace.label}`}</span>
        <IconButton icon="MessageSquarePlus" label="New chat" onClick={onNew} />
      </div>
      <ul className="min-h-0 flex-1 overflow-y-auto pb-2 text-[13px]" aria-label="Threads">
        {mine.map((thread) => {
          const here = thread.environment?.id != null && thread.environment.id === workspace.environmentId;
          return (
            <li key={thread.id}>
              <button
                type="button"
                className={`flex w-full items-center gap-2 px-3 py-1.5 text-left hover:bg-muted ${thread.id === current ? "bg-accent text-accent-foreground" : ""}`}
                onClick={() => onPick(thread.id)}
              >
                <span className="flex size-4 shrink-0 items-center justify-center">
                  <ThreadStatusGlyph indicator={thread.indicator} />
                </span>
                <span className="min-w-0 flex-1">
                  <span className={`block truncate ${thread.isUnread ? "font-semibold" : ""}`}>{thread.displayTitle}</span>
                  <span className="block truncate text-[11px] text-muted-foreground">
                    {thread.environment?.branchName ?? thread.environment?.name ?? (here ? "same files as the editor" : "no workspace")}
                  </span>
                </span>
                {here ? (
                  <span className="shrink-0 rounded px-1.5 py-px text-[10px] font-medium" style={{ color: hues.green, background: `${hues.green}1f` }}>
                    this workspace
                  </span>
                ) : null}
              </button>
            </li>
          );
        })}
        {status === "ready" && mine.length === 0 ? <li className="px-3 py-2 text-xs text-muted-foreground">No threads in this project yet. Start a chat.</li> : null}
      </ul>
    </div>
  );
}

function WorkflowsTab({
  scope,
  threadId,
  files,
  log,
  open,
  setOpen,
  onOpenThread,
}: {
  scope: Scope;
  threadId: string | null;
  files: string[];
  log(line: string): void;
  open: string | null;
  setOpen(id: string | null): void;
  onOpenThread(id: string): void;
}) {
  const rpc = useRpc<typeof rpcContract>();
  const hues = useHues();
  const [runs, setRuns] = useState<Run[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const origin = threadId ?? (scope.kind === "thread" ? scope.id : null);

  useEffect(() => {
    let stopped = false;
    const load = () =>
      rpc.call("workflows", { scope, threadId: origin, request: { action: "list" } }).then(
        ({ result }) => {
          if (stopped) return;
          setRuns(Array.isArray(result) ? (result as Run[]) : []);
          setError(null);
        },
        (cause: Error) => !stopped && setError(cause.message),
      );
    void load();
    const timer = setInterval(load, 4000);
    return () => {
      stopped = true;
      clearInterval(timer);
    };
  }, [rpc, scope, origin]);

  const statusHue = (status: string) =>
    status === "succeeded" ? hues.green : status === "failed" ? hues.red : status === "running" ? hues.blue : status === "cancelled" ? hues.muted : hues.yellow;

  const start = (name: string) => {
    if (origin === null) return;
    if (!window.confirm(`Run the "${name}" workflow? It reports back to the chat thread, and its agents count against your usage.`)) return;
    rpc.call("workflows", { scope, threadId: origin, request: { action: "run", name } }).then(
      () => log(`Started workflow ${name}`),
      (cause: Error) => {
        log(`Workflow ${name} did not start: ${cause.message}`);
        window.alert(cause.message);
      },
    );
  };

  if (open !== null) {
    return <RunGraph scope={scope} threadId={origin} runId={open} onBack={() => setOpen(null)} onOpenThread={onOpenThread} />;
  }

  return (
    <div className="flex h-full min-h-0 flex-col text-[13px]">
      <section className="shrink-0 border-b border-border px-3 py-2">
        <h2 className="text-xs font-semibold">Run a workflow</h2>
        {files.length === 0 ? (
          <p className="mt-1 text-xs text-muted-foreground">
            Save a workflow as <code className="font-mono">.bb/workflows/&lt;name&gt;.js</code> in this workspace to run it from here.
          </p>
        ) : (
          <div className="mt-1.5 flex flex-wrap gap-1">
            {files.map((name) => (
              <button
                key={name}
                type="button"
                disabled={origin === null}
                title={origin === null ? "Pick a chat thread first: runs report back to a thread" : `Run ${name}`}
                className="flex items-center gap-1 rounded-md border border-border px-2 py-0.5 text-xs hover:bg-muted disabled:opacity-40"
                onClick={() => start(name)}
              >
                <span style={{ color: hues.green }} className="flex">
                  <Icon name="Play" className="size-3" />
                </span>
                {name}
              </button>
            ))}
          </div>
        )}
      </section>
      <div className="flex h-8 shrink-0 items-center px-3 text-xs text-muted-foreground">Recent runs</div>
      <ul className="min-h-0 flex-1 overflow-y-auto pb-2" aria-label="Workflow runs">
        {error ? <li className="px-3 py-1 text-xs text-destructive">{error}</li> : null}
        {runs?.length === 0 ? <li className="px-3 py-1 text-xs text-muted-foreground">No workflow runs in this project yet.</li> : null}
        {runs?.map((run) => (
          <li key={run.id}>
            <button
              type="button"
              title="Show the agent graph"
              className="group flex w-full items-center gap-2 px-3 py-1.5 text-left hover:bg-muted"
              onClick={() => setOpen(run.id)}
            >
              <span className="size-2 shrink-0 rounded-full" style={{ background: statusHue(run.status) }} />
              <span className="min-w-0 flex-1">
                <span className="block truncate">{run.name}</span>
                <span className="block truncate text-[11px] text-muted-foreground">
                  <span style={{ color: statusHue(run.status) }}>{run.status}</span>
                  {run.phase ? ` · ${run.phase}` : ""} · {relativeTime(run.createdAt)}
                </span>
              </span>
              <Icon name="ChevronRight" className="size-3.5 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100" />
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

function IconButton({ icon, label, onClick }: { icon: string; label: string; onClick(): void }) {
  return (
    <button type="button" title={label} aria-label={label} className="flex size-6 items-center justify-center rounded text-muted-foreground hover:bg-muted hover:text-foreground" onClick={onClick}>
      <Icon name={icon} className="size-3.5" />
    </button>
  );
}

function relativeTime(ms: number): string {
  const seconds = Math.round((Date.now() - ms) / 1000);
  if (seconds < 60) return "just now";
  if (seconds < 3600) return `${Math.round(seconds / 60)} min ago`;
  if (seconds < 86_400) return `${Math.round(seconds / 3600)} h ago`;
  return new Date(ms).toLocaleDateString();
}
