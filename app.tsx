// KodaForge frontend: a full IDE page in the sidebar (any workspace) and a
// KodaForge tab beside a thread, pinned to that thread's workspace.
import { useEffect, useMemo, useRef, useState } from "react";
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

  const routed = parseScope(subPath);
  const fallback = workspaces?.[0]?.ref ?? null;
  const activeScope = routed ?? fallback;
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
  const [dirty, setDirty] = useState<Record<string, boolean>>({});

  const go = (key: string) => navigate.toPluginPanel(PANEL_PATH, { subPath: key });
  const close = (key: string) => {
    if (dirty[key] && !window.confirm(`${labelFor(key).title} has unsaved changes. Close it anyway?`)) return;
    const next = closeTab(open, key, active ?? key);
    setOpen(next.list);
    if (key === active) go(next.active ?? "");
  };

  const byKey = useMemo(() => new Map((workspaces ?? []).map((w) => [`${w.ref.kind}/${w.ref.id}`, w])), [workspaces]);
  function labelFor(key: string): { title: string; detail: string; projectId: string | null; kind: string } {
    const option = byKey.get(key);
    const kind = key.split("/")[0]!;
    if (option) return { title: option.label, detail: option.sublabel, projectId: option.projectId, kind: option.worktree ? "worktree" : kind === "thread" ? "thread" : "folder" };
    return { title: kind === "thread" ? "Thread workspace" : kind === "environment" ? "Workspace" : "Project", detail: "", projectId: null, kind };
  }

  const tabs = (
    <WorkspaceTabs
      open={open}
      active={active}
      dirty={dirty}
      labelFor={labelFor}
      groups={groupWorkspaces(workspaces ?? [])}
      onSelect={go}
      onClose={close}
    />
  );

  if (error !== null) return <div role="alert" className="p-6 text-sm text-destructive">{error}</div>;
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
      {shown.map((key) => {
        const scope = parseScope(key)!;
        return (
          <div key={key} className={key === active ? "h-full min-h-0" : "hidden"}>
            <Workbench
              scope={scope}
              header={tabs}
              active={key === active}
              onDirtyChange={(value) => setDirty((current) => (current[key] === value ? current : { ...current, [key]: value }))}
            />
          </div>
        );
      })}
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
  dirty,
  labelFor,
  groups,
  onSelect,
  onClose,
}: {
  open: string[];
  active: string | null;
  dirty: Record<string, boolean>;
  labelFor(key: string): { title: string; detail: string; projectId: string | null; kind: string };
  groups: ReturnType<typeof groupWorkspaces<WorkspaceOption>>;
  onSelect(key: string): void;
  onClose(key: string): void;
}) {
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
              onClick={() => onSelect(key)}
              onAuxClick={(event) => event.button === 1 && onClose(key)}
              onKeyDown={(event) => event.key === "Enter" && onSelect(key)}
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
