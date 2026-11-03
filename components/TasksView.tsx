// Tasks: Makefile targets and package.json scripts in the workspace, one click to run.
import { useCallback, useEffect, useState } from "react";
import { useRpc } from "@get-bb/plugin-sdk/app";
import type { rpcContract, Scope } from "../server";
import { parseMakefile, parsePackageScripts, taskFiles, type Task } from "@/lib/tasks";
import { Icon } from "@/components/ui/icon";
import { FileIcon } from "./FileIcon";
import { useHues } from "./colors";

export function TasksView({
  scope,
  changeTick,
  envName,
  onRun,
  onOpenAt,
}: {
  scope: Scope;
  changeTick: number;
  /** The Python environment tasks run with, shown so it's never a surprise. */
  envName: string | null;
  onRun(task: Task): void;
  onOpenAt(path: string, line: number): void;
}) {
  const rpc = useRpc<typeof rpcContract>();
  const hues = useHues();
  const [tasks, setTasks] = useState<Task[] | null>(null);

  const load = useCallback(async () => {
    try {
      const { paths } = await rpc.call("listFiles", { scope, includeHidden: false });
      const found: Task[] = [];
      for (const file of taskFiles(paths)) {
        const read = await rpc.call("read", { scope, path: file }).catch(() => null);
        if (read?.kind !== "text") continue;
        found.push(...(file.endsWith("package.json") ? parsePackageScripts(file, read.content) : parseMakefile(file, read.content)));
      }
      setTasks(found);
    } catch {
      setTasks([]);
    }
  }, [rpc, scope]);

  useEffect(() => {
    const timer = setTimeout(() => void load(), changeTick === 0 ? 0 : 600);
    return () => clearTimeout(timer);
  }, [load, changeTick]);

  const files = [...new Set((tasks ?? []).map((t) => t.file))];
  return (
    <div className="flex h-full min-h-0 flex-col text-[13px]">
      <div className="flex h-7 shrink-0 items-center gap-1 px-3 text-[11px] text-muted-foreground">
        <span className="flex-1 truncate">{envName ? `Runs with ${envName}` : "Runs in the workspace root"}</span>
        <button type="button" title="Refresh" aria-label="Refresh tasks" className="rounded p-0.5 hover:bg-muted hover:text-foreground" onClick={() => void load()}>
          <Icon name="RotateCcw" className="size-3.5" />
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto pb-2">
        {tasks === null ? <p className="px-3 py-1 text-xs text-muted-foreground">Looking for Makefiles and package.json…</p> : null}
        {tasks?.length === 0 ? (
          <p className="px-3 py-1 text-xs text-muted-foreground">No Makefile targets or package.json scripts in this workspace.</p>
        ) : null}
        {files.map((file) => (
          <section key={file} className="pb-1">
            <button
              type="button"
              className="flex w-full items-center gap-1.5 px-3 py-1 text-left text-[11px] font-semibold uppercase text-muted-foreground hover:text-foreground"
              onClick={() => onOpenAt(file, 1)}
            >
              <FileIcon path={file} className="size-3.5" />
              <span className="truncate normal-case">{file}</span>
            </button>
            {tasks!
              .filter((task) => task.file === file)
              .map((task) => (
                <div key={`${file}:${task.name}`} className="group flex items-center gap-1 py-0.5 pl-4 pr-2 hover:bg-muted">
                  <button
                    type="button"
                    title={`Run ${task.kind === "make" ? `make ${task.name}` : `npm run ${task.name}`}`}
                    aria-label={`Run ${task.name}`}
                    className="flex size-5 shrink-0 items-center justify-center rounded hover:bg-background"
                    onClick={() => onRun(task)}
                  >
                    <span className="flex" style={{ color: hues.green }}>
                      <Icon name="Play" className="size-3.5" />
                    </span>
                  </button>
                  <button type="button" className="flex min-w-0 flex-1 items-baseline gap-2 text-left" onClick={() => onOpenAt(task.file, task.line)}>
                    <span className="shrink-0 font-mono text-xs">{task.name}</span>
                    <span className="truncate text-xs text-muted-foreground">{task.detail}</span>
                  </button>
                </div>
              ))}
          </section>
        ))}
      </div>
    </div>
  );
}
