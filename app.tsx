// KodaForge frontend: a full IDE page in the sidebar (any workspace) and a
// KodaForge tab beside a thread, pinned to that thread's workspace.
import { useEffect, useMemo, useState } from "react";
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

const PANEL_PATH = "forge";

/** Route `kind/id` ⇄ scope, so a reload or deep link reopens the same workspace. */
function parseScope(subPath: string): Scope | null {
  const [kind, id] = subPath.split("/").map((part) => decodeURIComponent(part));
  return (kind === "project" || kind === "environment" || kind === "thread") && id ? { kind, id } : null;
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

  const routed = parseScope(subPath);
  const scope = routed ?? workspaces?.[0]?.ref ?? null;
  const groups = useMemo(() => groupWorkspaces(workspaces ?? []), [workspaces]);
  const key = scope === null ? "" : `${scope.kind}/${scope.id}`;

  const picker = (
    <>
      <label htmlFor="kodaforge-workspace" className="sr-only">
        Workspace
      </label>
      <select
        id="kodaforge-workspace"
        className="min-w-0 max-w-sm rounded-md border border-border bg-background px-1.5 py-0.5 text-xs text-foreground"
        value={key}
        onChange={(event) => navigate.toPluginPanel(PANEL_PATH, { subPath: event.target.value })}
      >
        {routed !== null && !workspaces?.some((w) => `${w.ref.kind}/${w.ref.id}` === key) ? (
          <option value={key}>{scope?.kind === "thread" ? "This thread's workspace" : key}</option>
        ) : null}
        {groups.map((group) => (
          <optgroup key={group.projectId} label={group.projectName}>
            {group.options.map((option) => (
              <option key={`${option.ref.kind}/${option.ref.id}`} value={`${option.ref.kind}/${option.ref.id}`}>
                {option.label} · {option.sublabel}
              </option>
            ))}
          </optgroup>
        ))}
      </select>
    </>
  );

  if (error !== null) return <div role="alert" className="p-6 text-sm text-destructive">{error}</div>;
  if (scope === null) {
    return (
      <div role="status" className="p-6 text-sm text-muted-foreground">
        {workspaces === null ? "Loading workspaces…" : "No project has a checkout yet."}
      </div>
    );
  }
  return (
    <div className="h-full min-h-0">
      <Workbench key={key} scope={scope} header={picker} />
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
