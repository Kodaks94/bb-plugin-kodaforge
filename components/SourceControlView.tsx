// Phase 6: Source Control. Staged and unstaged changes from `git status`, stage
// and unstage, commit, and a side-by-side diff for each file.
import { useCallback, useEffect, useState } from "react";
import { experimental_useCodeTheme, useRpc } from "@get-bb/plugin-sdk/app";
import type { rpcContract, Scope } from "../server";
import { decorationOf, type GitEntry } from "@/lib/git-status";
import type { DiffSide } from "@/lib/diff-key";
import { Icon } from "@/components/ui/icon";
import { InputBox } from "./Palette";
import { FileIcon } from "./FileIcon";

const COLOR_KEY: Record<string, [string, string]> = {
  modified: ["gitDecoration.modifiedResourceForeground", "#e2c08d"],
  added: ["gitDecoration.addedResourceForeground", "#81b88b"],
  untracked: ["gitDecoration.untrackedResourceForeground", "#73c991"],
  deleted: ["gitDecoration.deletedResourceForeground", "#c74e39"],
  renamed: ["gitDecoration.renamedResourceForeground", "#73c991"],
  conflict: ["gitDecoration.conflictingResourceForeground", "#e4676b"],
};

export function SourceControlView({
  scope,
  changeTick,
  onOpenDiff,
  onOpenFile,
  onChanged,
  onBranch,
  onPickBranch,
  runInTerminal,
  log,
}: {
  scope: Scope;
  changeTick: number;
  onOpenDiff(path: string, side: DiffSide): void;
  onOpenFile(path: string): void;
  /** Git state changed without touching files (stage, commit): refresh decorations. */
  onChanged(): void;
  onBranch(branch: string | null): void;
  onPickBranch(): void;
  /** Remote operations run in a visible terminal: progress, credential prompts, and no time limit. */
  runInTerminal(argv: string[], title: string): Promise<number | null>;
  log(line: string): void;
}) {
  const rpc = useRpc<typeof rpcContract>();
  const codeTheme = experimental_useCodeTheme();
  const [status, setStatus] = useState<{
    isRepo: boolean;
    branch: string | null;
    upstream?: string | null;
    ahead?: number;
    behind?: number;
    entries: GitEntry[];
  } | null>(null);
  const [menu, setMenu] = useState(false);
  const [stashes, setStashes] = useState<{ ref: string; message: string }[] | null>(null);
  const [askStashMessage, setAskStashMessage] = useState(false);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(() => {
    rpc.call("gitStatus", { scope }).then(
      (next) => {
        setStatus(next);
        onBranch(next.branch);
      },
      (error: Error) => log(`git status failed: ${error.message}`),
    );
  }, [rpc, scope, onBranch, log]);

  useEffect(() => {
    const timer = setTimeout(refresh, changeTick === 0 ? 0 : 300);
    return () => clearTimeout(timer);
  }, [refresh, changeTick]);

  async function act(label: string, work: () => Promise<unknown>) {
    setBusy(true);
    try {
      await work();
    } catch (error) {
      log(`${label} failed: ${(error as Error).message}`);
      window.alert(`${label} failed: ${(error as Error).message}`);
    } finally {
      setBusy(false);
      refresh();
      onChanged();
    }
  }

  if (status === null) return <p className="px-3 py-2 text-xs text-muted-foreground">Loading…</p>;
  if (!status.isRepo) return <p className="px-3 py-2 text-xs text-muted-foreground">This workspace is not a git repository.</p>;

  const staged = status.entries.filter((e) => e.index !== " " && e.index !== "?");
  const changes = status.entries.filter((e) => e.worktree !== " ");
  const color = (entry: GitEntry) => {
    const [key, fallback] = COLOR_KEY[decorationOf(entry)]!;
    return codeTheme.theme?.colors[key] ?? fallback;
  };

  const doCommit = () =>
    act("Commit", async () => {
      if (staged.length === 0) {
        if (changes.length === 0) throw new Error("There is nothing to commit");
        if (!window.confirm("There are no staged changes. Stage all changes and commit them?")) return;
        await rpc.call("scmStage", { scope, paths: changes.map((e) => e.path) });
      }
      const { summary } = await rpc.call("scmCommit", { scope, message, all: false });
      setMessage("");
      log(`Committed: ${summary}`);
    });

  const discardEntries = (entries: GitEntry[]) => {
    const untracked = entries.filter((e) => e.worktree === "?").map((e) => e.path);
    const tracked = entries.filter((e) => e.worktree !== "?").map((e) => e.path);
    const what =
      entries.length === 1
        ? untracked.length === 1
          ? `Delete the untracked file "${entries[0]!.path}"?`
          : `Discard your changes to "${entries[0]!.path}"?`
        : `Discard changes in ${tracked.length} file(s) and delete ${untracked.length} untracked file(s)?`;
    if (!window.confirm(`${what} This cannot be undone.`)) return;
    void act("Discard", () => rpc.call("scmDiscard", { scope, tracked, untracked }));
  };

  const remote = async (argv: string[], title: string) => {
    setMenu(false);
    const code = await runInTerminal(argv, title);
    log(`${title} ${code === 0 ? "finished" : `exited with code ${code ?? "?"}`}`);
    refresh();
    onChanged();
  };

  const stashAction = (action: "push" | "apply" | "pop" | "drop", ref?: string, message?: string) => {
    setMenu(false);
    if (action === "drop" && !window.confirm(`Drop ${ref ?? "the latest stash"}? This cannot be undone.`)) return;
    void act(`Stash ${action}`, async () => {
      const result = await rpc.call("scmStash", { scope, action, ref, ...(message ? { message } : {}) });
      setStashes(result.stashes);
      log(`Stash ${action} done; ${result.stashes.length} stash(es) left`);
    });
  };

  const row = (entry: GitEntry, side: DiffSide) => {
    const letter = side === "staged" ? entry.index : entry.worktree === "?" ? "U" : entry.worktree;
    const slash = entry.path.lastIndexOf("/");
    const deleted = (side === "staged" ? entry.index : entry.worktree) === "D";
    return (
      <li key={`${side}:${entry.path}`} className="group flex items-center gap-1 px-3 py-0.5 hover:bg-muted">
        <button
          type="button"
          title={entry.origPath ? `${entry.origPath} → ${entry.path}` : entry.path}
          className={`flex min-w-0 flex-1 items-center gap-1.5 text-left ${deleted ? "line-through" : ""}`}
          onClick={() => (entry.worktree === "?" && side === "working" ? onOpenFile(entry.path) : onOpenDiff(entry.path, side))}
        >
          <FileIcon path={entry.path} className="size-3.5" />
          <span className="truncate" style={{ color: color(entry) }}>
            {entry.path.slice(slash + 1)}
          </span>
          <span className="truncate text-xs text-muted-foreground">{slash === -1 ? "" : entry.path.slice(0, slash)}</span>
        </button>
        {!deleted ? <RowButton icon="File" label={`Open ${entry.path}`} onClick={() => onOpenFile(entry.path)} /> : null}
        {side === "working" ? <RowButton icon="RotateCcw" label={entry.worktree === "?" ? `Delete ${entry.path}` : `Discard changes to ${entry.path}`} onClick={() => discardEntries([entry])} /> : null}
        {side === "staged" ? (
          <RowButton icon="Minus" label={`Unstage ${entry.path}`} onClick={() => void act("Unstage", () => rpc.call("scmUnstage", { scope, paths: [entry.path] }))} />
        ) : (
          <RowButton icon="Plus" label={`Stage ${entry.path}`} onClick={() => void act("Stage", () => rpc.call("scmStage", { scope, paths: [entry.path] }))} />
        )}
        <span className="w-3 text-center text-[11px]" style={{ color: color(entry) }}>
          {letter}
        </span>
      </li>
    );
  };

  return (
    <div className="flex h-full min-h-0 flex-col text-[13px]">
      <div className="flex shrink-0 items-center gap-1 px-2 pb-1">
        <button
          type="button"
          title="Switch branch"
          className="flex min-w-0 items-center gap-1 rounded px-1 py-0.5 text-xs hover:bg-muted"
          onClick={onPickBranch}
        >
          <Icon name="GitBranch" className="size-3.5 shrink-0" />
          <span className="truncate">{status.branch ?? "detached HEAD"}</span>
        </button>
        <span className="flex-1" />
        {status.upstream ? (
          <button
            type="button"
            title={`Sync with ${status.upstream}: pull, then push`}
            className="rounded px-1 py-0.5 text-[11px] text-muted-foreground hover:bg-muted hover:text-foreground"
            onClick={() => void remote(["sh", "-c", "git pull --ff-only && git push"], "git sync")}
          >
            <span className="flex items-center gap-1">
              <Icon name="ArrowDown" className="size-3" />
              {status.behind ?? 0}
              <Icon name="ArrowUp" className="size-3" />
              {status.ahead ?? 0}
            </span>
          </button>
        ) : null}
        <RowButton icon="RotateCcw" label="Refresh" onClick={refresh} always />
        <div className="relative">
          <RowButton
            icon="MoreHorizontal"
            label="More actions"
            always
            onClick={() => {
              setMenu((open) => !open);
              rpc.call("scmStash", { scope, action: "list" }).then((r) => setStashes(r.stashes), () => setStashes([]));
            }}
          />
          {menu ? (
            <ul role="menu" className="absolute right-0 top-6 z-50 w-56 rounded-md border border-border bg-popover py-1 text-[13px] text-popover-foreground shadow-lg">
              <MenuItem label="Pull" onClick={() => void remote(["git", "pull", "--ff-only"], "git pull")} />
              <MenuItem
                label={status.upstream ? "Push" : "Publish Branch (push -u origin)"}
                onClick={() => void remote(status.upstream ? ["git", "push"] : ["git", "push", "-u", "origin", status.branch ?? "HEAD"], "git push")}
              />
              <MenuItem label="Fetch" onClick={() => void remote(["git", "fetch", "--prune"], "git fetch")} />
              <li className="my-1 border-t border-border" />
              <MenuItem label="Stash (include untracked)…" onClick={() => (setMenu(false), setAskStashMessage(true))} />
              {stashes === null ? (
                <li className="px-3 py-1 text-xs text-muted-foreground">Loading stashes…</li>
              ) : stashes.length === 0 ? (
                <li className="px-3 py-1 text-xs text-muted-foreground">No stashes</li>
              ) : (
                stashes.map((entry) => (
                  <li key={entry.ref} className="px-3 py-1">
                    <div className="truncate text-xs" title={entry.message}>
                      {entry.ref}: {entry.message}
                    </div>
                    <div className="flex gap-2 text-xs">
                      <button type="button" className="text-primary hover:underline" onClick={() => stashAction("pop", entry.ref)}>Pop</button>
                      <button type="button" className="text-primary hover:underline" onClick={() => stashAction("apply", entry.ref)}>Apply</button>
                      <button type="button" className="text-destructive hover:underline" onClick={() => stashAction("drop", entry.ref)}>Drop</button>
                    </div>
                  </li>
                ))
              )}
              <li className="my-1 border-t border-border" />
              <MenuItem label="Discard All Changes…" onClick={() => (setMenu(false), changes.length > 0 && discardEntries(changes))} />
            </ul>
          ) : null}
        </div>
      </div>
      <div className="flex shrink-0 flex-col gap-1 px-2 pb-2">
        <textarea
          value={message}
          rows={3}
          aria-label="Commit message"
          placeholder={`Message (⌘Enter to commit on "${status.branch ?? "HEAD"}")`}
          className="resize-y rounded border border-border bg-background px-2 py-1 text-xs outline-none focus:border-primary"
          onChange={(event) => setMessage(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
              event.preventDefault();
              void doCommit();
            }
          }}
        />
        <button
          type="button"
          disabled={busy || message.trim() === "" || (staged.length === 0 && changes.length === 0)}
          className="flex items-center justify-center gap-1 rounded bg-primary px-2 py-1 text-xs text-primary-foreground hover:opacity-90 disabled:opacity-40"
          onClick={() => void doCommit()}
        >
          <Icon name="Check" className="size-3.5" />
          Commit{staged.length === 0 && changes.length > 0 ? " All" : ""}
        </button>
      </div>
      {askStashMessage ? (
        <InputBox
          title="Stash message (optional)"
          initial=""
          onCancel={() => setAskStashMessage(false)}
          onSubmit={(value) => {
            setAskStashMessage(false);
            stashAction("push", undefined, value.trim() || undefined);
          }}
        />
      ) : null}
      <div className="min-h-0 flex-1 overflow-y-auto pb-2">
        {staged.length > 0 ? (
          <Section
            title="Staged Changes"
            count={staged.length}
            action={{ icon: "Minus", label: "Unstage All", run: () => void act("Unstage", () => rpc.call("scmUnstage", { scope, paths: staged.map((e) => e.path) })) }}
          >
            {staged.map((entry) => row(entry, "staged"))}
          </Section>
        ) : null}
        <Section
          title="Changes"
          count={changes.length}
          action={
            changes.length === 0
              ? undefined
              : { icon: "Plus", label: "Stage All", run: () => void act("Stage", () => rpc.call("scmStage", { scope, paths: changes.map((e) => e.path) })) }
          }
          secondary={changes.length === 0 ? undefined : { icon: "RotateCcw", label: "Discard All Changes", run: () => discardEntries(changes) }}
        >
          {changes.length === 0 ? <li className="px-3 py-1 text-xs text-muted-foreground">No changes.</li> : changes.map((entry) => row(entry, "working"))}
        </Section>
      </div>
    </div>
  );
}

function MenuItem({ label, onClick }: { label: string; onClick(): void }) {
  return (
    <li>
      <button type="button" role="menuitem" className="w-full px-3 py-1 text-left hover:bg-accent hover:text-accent-foreground" onClick={onClick}>
        {label}
      </button>
    </li>
  );
}

function Section({
  title,
  count,
  action,
  secondary,
  children,
}: {
  title: string;
  count: number;
  action?: { icon: string; label: string; run(): void };
  secondary?: { icon: string; label: string; run(): void };
  children: React.ReactNode;
}) {
  return (
    <section className="pb-1">
      <div className="group flex items-center px-3 py-0.5 text-[11px] font-semibold uppercase text-muted-foreground">
        <span className="flex-1">{title}</span>
        {secondary ? <RowButton icon={secondary.icon} label={secondary.label} onClick={secondary.run} /> : null}
        {action ? <RowButton icon={action.icon} label={action.label} onClick={action.run} /> : null}
        <span className="ml-1 rounded-full bg-muted px-1.5 font-normal">{count}</span>
      </div>
      <ul>{children}</ul>
    </section>
  );
}

function RowButton({ icon, label, onClick, always }: { icon: string; label: string; onClick(): void; always?: boolean }) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      className={`flex size-5 shrink-0 items-center justify-center rounded text-muted-foreground hover:bg-muted hover:text-foreground ${
        always ? "" : "opacity-0 focus:opacity-100 group-hover:opacity-100"
      }`}
      onClick={onClick}
    >
      <Icon name={icon} className="size-3.5" />
    </button>
  );
}
