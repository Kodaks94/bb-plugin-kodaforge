// KodaForge frontend: a full IDE page in the sidebar (any workspace) and a
// KodaForge tab beside a thread, pinned to that thread's workspace.
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import {
  definePluginApp,
  useBbNavigate,
  useRpc,
  type ExperimentalThreadTabProps,
  type PluginNavPanelProps,
} from "@get-bb/plugin-sdk/app";
import type { rpcContract, Scope, WorkspaceOption } from "./server";
import { groupWorkspaces } from "@/lib/workspaces";
import { Workbench } from "@/components/Workbench";
import { KodaIcon } from "@/components/KodaIcon";
import { Icon } from "@/components/ui/icon";
import { closeTab, openTab, parseSaved } from "@/lib/open-workspaces";

const PANEL_PATH = "forge";

/** Route `kind/id` ⇄ scope, so a reload or deep link reopens the same workspace. */
function parseScope(subPath: string): Scope | null {
  const [kind, id] = subPath.split("/").map((part) => decodeURIComponent(part));
  return (kind === "project" || kind === "environment" || kind === "thread") && id ? { kind, id } : null;
}

const OPEN_KEY = "kodaforge:open-workspaces";

// Which open workspaces have unsaved edits. Kept outside React state on purpose: a
// state update in IdePage on the first keystroke rebuilt every workbench (and its
// editors), so typing lost focus after one character. Only the tab strip listens.
const dirtyWorkspaces = new Map<string, boolean>();
const dirtyListeners = new Set<() => void>();
let dirtySnapshot: Record<string, boolean> = {};
function setWorkspaceDirty(key: string, value: boolean) {
  if ((dirtyWorkspaces.get(key) ?? false) === value) return;
  dirtyWorkspaces.set(key, value);
  dirtySnapshot = Object.fromEntries(dirtyWorkspaces);
  dirtyListeners.forEach((listener) => listener());
}
function useDirtyWorkspaces(): Record<string, boolean> {
  return useSyncExternalStore(
    (listener) => {
      dirtyListeners.add(listener);
      return () => dirtyListeners.delete(listener);
    },
    () => dirtySnapshot,
  );
}

function IdePage({ subPath }: PluginNavPanelProps) {
  const rpc = useRpc<typeof rpcContract>();
  const navigate = useBbNavigate();
  const [workspaces, setWorkspaces] = useState<WorkspaceOption[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    rpc.call("workspaces", null).then(
      (result) => setWorkspaces(result.workspaces),
      (cause: Error) => setError(cause.message),
    );
  }, [rpc]);

  // After the last tab is closed the page stays empty; without this the first
  // workspace in the list reopened by itself, as if the page had reloaded.
  const [closedAll, setClosedAll] = useState(false);
  const routed = parseScope(subPath);
  useEffect(() => {
    if (routed !== null) setClosedAll(false);
  }, [subPath]);
  const fallback = closedAll ? null : (workspaces?.[0]?.ref ?? null);
  const [closingRoute, setClosingRoute] = useState<{ from: string; next: string | null } | null>(null);
  useEffect(() => {
    setClosingRoute((route) => route && route.from !== subPath ? null : route);
  }, [subPath]);
  const activeScope = closingRoute?.from === subPath
    ? (closingRoute.next ? parseScope(closingRoute.next) : null)
    : routed ?? fallback;
  const active = activeScope === null ? null : `${activeScope.kind}/${activeScope.id}`;

  // Workspaces open as tabs; each stays mounted so its buffers and terminals survive switching.
  const [open, setOpen] = useState<string[]>(() => parseSaved(localStorage.getItem(OPEN_KEY)));
  const previous = useRef<string | null>(null);
  useEffect(() => {
    if (active === null) return;
    setOpen((list) => openTab(list, active, previous.current));
    previous.current = active;
  }, [active]);
  useEffect(() => {
    localStorage.setItem(OPEN_KEY, JSON.stringify(open));
  }, [open]);

  const go = (key: string) => navigate.toPluginPanel(PANEL_PATH, { subPath: key });
  function finishClose(list: string[], next: string | null) {
    for (const key of open) if (!list.includes(key)) setWorkspaceDirty(key, false);
    setOpen(list);
    if (next === active) return;
    setClosedAll(next === null);
    // The host publishes the new route asynchronously. Show the survivor immediately.
    setClosingRoute({ from: subPath, next });
    go(next ?? "");
  }
  const close = (key: string) => {
    if (dirtySnapshot[key] && !window.confirm(`${labelFor(key).title} has unsaved changes. Close it anyway?`)) return;
    const next = closeTab(open, key, active ?? key);
    finishClose(next.list, next.active);
  };
  function closeGroup(keep: string | null) {
    const unsaved = open.filter((key) => key !== keep && dirtySnapshot[key]).length;
    if (unsaved && !window.confirm(`${unsaved} workspace(s) have unsaved changes. Close anyway?`)) return;
    finishClose(keep ? [keep] : [], keep);
  }

  const byKey = useMemo(() => new Map((workspaces ?? []).map((w) => [`${w.ref.kind}/${w.ref.id}`, w])), [workspaces]);
  // A workspace opened by link (a thread, or an environment the picker does not
  // list) has no entry above: ask the server for its project and machine.
  const [resolved, setResolved] = useState<Record<string, { title: string; detail: string; projectId: string | null }>>({});
  useEffect(() => {
    if (workspaces === null) return;
    for (const key of open) {
      const scope = parseScope(key);
      if (scope === null || byKey.has(key) || resolved[key] !== undefined) continue;
      rpc.call("resolve", { scope }).then(
        (found) => setResolved((all) => ({ ...all, [key]: { title: found.label, detail: found.sublabel, projectId: found.projectId } })),
        () => undefined,
      );
    }
  }, [open, workspaces]);
  function labelFor(key: string): { title: string; detail: string; projectId: string | null; kind: string } {
    const option = byKey.get(key);
    const kind = key.split("/")[0]!;
    if (option) return { title: option.label, detail: option.sublabel, projectId: option.projectId, kind: option.worktree ? "worktree" : kind === "thread" ? "thread" : "folder" };
    const found = resolved[key];
    if (found) return { ...found, kind: kind === "thread" ? "thread" : "folder" };
    return { title: kind === "thread" ? "Thread workspace" : kind === "environment" ? "Workspace" : "Project", detail: "", projectId: null, kind };
  }

  const tabs = (
    <WorkspaceTabs
      open={open}
      active={active}
      labelFor={labelFor}
      groups={groupWorkspaces(workspaces ?? [])}
      onSelect={go}
      onClose={close}
      onCloseOthers={closeGroup}
      onCloseAll={() => closeGroup(null)}
    />
  );

  if (error !== null) return <div role="alert" className="p-6 text-sm text-destructive">{error}</div>;
  if (closedAll && (active === null || activeScope === null)) {
    return (
      <div className="h-full min-h-0">
        <div className="flex items-center gap-2 border-b border-border px-2 py-1.5">{tabs}</div>
        <p role="status" className="p-6 text-sm text-muted-foreground">No workspace is open. Use + to open one.</p>
      </div>
    );
  }
  if (active === null || activeScope === null) {
    return (
      <div role="status" className="p-6 text-sm text-muted-foreground">
        {workspaces === null ? "Loading workspaces…" : "No project has a checkout yet."}
      </div>
    );
  }
  const shown = open.includes(active) ? open : [...open, active];
  return (
    <div className="h-full min-h-0">
      {shown.map((key) => (
        <WorkspaceView key={key} workspaceKey={key} active={key === active} header={tabs} />
      ))}
    </div>
  );
}

function WorkspaceView({ workspaceKey, active, header }: {
  workspaceKey: string; active: boolean; header: React.ReactNode;
}) {
  // Workbench reloads Monaco and its buffers whenever the scope identity changes.
  const scope = useMemo(() => parseScope(workspaceKey)!, [workspaceKey]);
  return (
    <div className={active ? "h-full min-h-0" : "hidden"}>
      <Workbench scope={scope} active={active} header={header}
        onDirtyChange={(value) => setWorkspaceDirty(workspaceKey, value)} />
    </div>
  );
}

/** One colour per project, so tabs from the same project read as a group. */
const PROJECT_HUES = ["#f5a04a", "#6cb6ff", "#56d364", "#d2a8ff", "#ff7b72", "#56d4dd", "#e3b341"];
function hueFor(projectId: string | null): string {
  if (projectId === null) return "#8b949e";
  let hash = 0;
  for (const char of projectId) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return PROJECT_HUES[hash % PROJECT_HUES.length]!;
}

function WorkspaceTabs({
  open,
  active,
  labelFor,
  groups,
  onSelect,
  onClose,
  onCloseOthers,
  onCloseAll,
}: {
  open: string[];
  active: string | null;
  labelFor(key: string): { title: string; detail: string; projectId: string | null; kind: string };
  groups: ReturnType<typeof groupWorkspaces<WorkspaceOption>>;
  onSelect(key: string): void;
  onClose(key: string): void;
  onCloseOthers(key: string): void;
  onCloseAll(): void;
}) {
  const dirty = useDirtyWorkspaces();
  const [context, setContext] = useState<{ key: string; x: number; y: number } | null>(null);
  const contextRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!context) return;
    const dismiss = (event: PointerEvent) => {
      if (!contextRef.current?.contains(event.target as Node)) setContext(null);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setContext(null);
    };
    const blur = () => setContext(null);
    window.addEventListener("pointerdown", dismiss, true);
    window.addEventListener("keydown", escape);
    window.addEventListener("blur", blur);
    return () => {
      window.removeEventListener("pointerdown", dismiss, true);
      window.removeEventListener("keydown", escape);
      window.removeEventListener("blur", blur);
    };
  }, [context]);
  const [menu, setMenu] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!menu) return;
    const away = (event: MouseEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) setMenu(false);
    };
    window.addEventListener("mousedown", away);
    return () => window.removeEventListener("mousedown", away);
  }, [menu]);

  return (
    <div className="flex min-w-0 items-center gap-1">
      <div role="tablist" aria-label="Open workspaces" className="flex min-w-0 items-center gap-1 overflow-x-auto">
        {open.map((key) => {
          const label = labelFor(key);
          const selected = key === active;
          return (
            <div
              key={key}
              role="tab"
              aria-selected={selected}
              tabIndex={0}
              title={`${label.title}${label.detail ? ` · ${label.detail}` : ""}`}
              className={`group flex h-7 shrink-0 cursor-pointer items-center gap-1.5 rounded-md border pl-2 pr-1 text-xs ${
                selected ? "border-border bg-background text-foreground shadow-sm" : "border-transparent text-muted-foreground hover:bg-muted hover:text-foreground"
              }`}
              onContextMenu={(event) => {
                event.preventDefault();
                setMenu(false);
                setContext({ key, x: event.clientX, y: event.clientY });
              }}
              onClick={() => onSelect(key)}
              onAuxClick={(event) => event.button === 1 && onClose(key)}
              onKeyDown={(event) => event.target === event.currentTarget && event.key === "Enter" && onSelect(key)}
            >
              <span className="size-2 shrink-0 rounded-sm" style={{ background: hueFor(label.projectId) }} />
              <Icon name={label.kind === "worktree" ? "GitBranch" : label.kind === "thread" ? "MessageSquare" : "Folder"} className="size-3.5 shrink-0" />
              <span className="max-w-40 truncate font-medium">{label.title}</span>
              {label.detail ? <span className="max-w-32 truncate text-muted-foreground">{label.detail}</span> : null}
              <button
                type="button"
                aria-label={`Close ${label.title}${dirty[key] ? " (unsaved changes)" : ""}`}
                className="flex size-5 items-center justify-center rounded hover:bg-muted"
                onClick={(event) => {
                  event.stopPropagation();
                  onClose(key);
                }}
              >
                {dirty[key] ? <span className="size-2 rounded-full bg-foreground group-hover:hidden" /> : null}
                <Icon name="X" className={`size-3 ${dirty[key] ? "hidden group-hover:block" : selected ? "" : "opacity-0 group-hover:opacity-100"}`} />
              </button>
            </div>
          );
        })}
      </div>
      {context && open.includes(context.key) && (
        <div ref={contextRef} role="group" aria-label="Workspace tab actions"
          className="fixed z-50 grid w-36 rounded-md border border-border bg-background p-1 text-xs shadow-md"
          style={{ left: Math.max(0, Math.min(context.x, window.innerWidth - 148)),
                   top: Math.max(0, Math.min(context.y, window.innerHeight - 72)) }}>
          <button type="button" autoFocus disabled={open.length < 2}
            className="rounded px-2 py-1.5 text-left hover:bg-muted disabled:opacity-50"
            onClick={() => { setContext(null); onCloseOthers(context.key); }}>Close others</button>
          <button type="button" className="rounded px-2 py-1.5 text-left hover:bg-muted"
            onClick={() => { setContext(null); onCloseAll(); }}>Close all</button>
        </div>
      )}
      <div className="relative shrink-0" ref={menuRef}>
        <button
          type="button"
          aria-label="Open another workspace"
          title="Open another workspace"
          aria-expanded={menu}
          className="flex size-7 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
          onClick={() => setMenu((value) => !value)}
        >
          <Icon name="Plus" className="size-4" />
        </button>
        {menu ? (
          <div role="menu" className="absolute left-0 top-8 z-50 max-h-96 w-72 overflow-y-auto rounded-lg border border-border bg-popover py-1 text-[13px] text-popover-foreground shadow-[0_12px_32px_rgba(0,0,0,0.28)]">
            {groups.length === 0 ? <p className="px-3 py-2 text-xs text-muted-foreground">No workspaces yet.</p> : null}
            {groups.map((group) => (
              <div key={group.projectId} className="py-1">
                <div className="flex items-center gap-2 px-3 py-1 text-[11px] font-semibold uppercase text-muted-foreground">
                  <span className="size-2 rounded-sm" style={{ background: hueFor(group.projectId) }} />
                  {group.projectName}
                </div>
                {group.options.map((option) => {
                  const key = `${option.ref.kind}/${option.ref.id}`;
                  const isOpen = open.includes(key);
                  return (
                    <button
                      key={key}
                      type="button"
                      role="menuitem"
                      className="flex w-full items-center gap-2 px-3 py-1.5 text-left hover:bg-accent hover:text-accent-foreground"
                      onClick={() => {
                        setMenu(false);
                        onSelect(key);
                      }}
                    >
                      <Icon name={option.worktree ? "GitBranch" : "Folder"} className="size-3.5 shrink-0 text-muted-foreground" />
                      <span className="min-w-0 flex-1 truncate">{option.sublabel}</span>
                      {isOpen ? <Icon name="Check" className="size-3.5 shrink-0 text-muted-foreground" /> : null}
                    </button>
                  );
                })}
              </div>
            ))}
          </div>
        ) : null}
      </div>
    </div>
  );
}

function ThreadIde({ threadId }: ExperimentalThreadTabProps) {
  const scope = useMemo<Scope>(() => ({ kind: "thread", id: threadId }), [threadId]);
  return (
    <div className="h-full min-h-0">
      <Workbench key={threadId} scope={scope} />
    </div>
  );
}

export default definePluginApp((app) => {
  app.experimental_icons.register({ name: "KodaBear", component: KodaIcon });
  app.slots.navPanel({
    id: "forge",
    title: "KodaForge",
    icon: "KodaBear",
    path: PANEL_PATH,
    component: IdePage,
  });
  app.slots.experimental_tab({
    id: "forge",
    title: "KodaForge",
    icon: "KodaBear",
    tooltip: "Open this thread's workspace in KodaForge",
    context: { kind: "thread" },
    availability: "action",
    layout: "flush",
    component: ThreadIde,
  });
});
