// Phase 2: the file tree. A virtual list over the flattened tree, with create,
// rename, move (drag and drop), delete, git colours and reveal-active-file.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { experimental_useCodeTheme, useRpc } from "@get-bb/plugin-sdk/app";
import type { rpcContract, Scope } from "../server";
import { ancestorsOf, basename, buildTree, dirname, visibleRows, type TreeNode } from "@/lib/tree";
import { decorateTree, type Decoration } from "@/lib/git-status";
import { Icon } from "@/components/ui/icon";
import { InputBox } from "./Palette";
import { hueForFile } from "@/lib/file-colors";
import { useHues } from "./colors";

const ROW_HEIGHT = 22;

/** VS Code theme keys for each decoration, with fallbacks for themes that lack them. */
const DECORATION_COLOR: Record<Decoration, [string, string]> = {
  modified: ["gitDecoration.modifiedResourceForeground", "#e2c08d"],
  added: ["gitDecoration.addedResourceForeground", "#81b88b"],
  untracked: ["gitDecoration.untrackedResourceForeground", "#73c991"],
  deleted: ["gitDecoration.deletedResourceForeground", "#c74e39"],
  renamed: ["gitDecoration.renamedResourceForeground", "#73c991"],
  conflict: ["gitDecoration.conflictingResourceForeground", "#e4676b"],
};
const DECORATION_LETTER: Record<Decoration, string> = {
  modified: "M",
  added: "A",
  untracked: "U",
  deleted: "D",
  renamed: "R",
  conflict: "!",
};

type Pending =
  | { kind: "newFile" | "newFolder"; parent: string }
  | { kind: "rename"; path: string };

export function Explorer({
  scope,
  activePath,
  changeTick,
  onOpen,
  onRenamed,
  onDeleted,
  log,
}: {
  scope: Scope;
  activePath: string | null;
  /** Bumped by the workbench whenever the watcher reports a change. */
  changeTick: number;
  onOpen(path: string, toSide?: boolean): void;
  onRenamed(from: string, to: string): void;
  onDeleted(path: string): void;
  log(line: string): void;
}) {
  const rpc = useRpc<typeof rpcContract>();
  const codeTheme = experimental_useCodeTheme();
  const hues = useHues();
  const [includeHidden, setIncludeHidden] = useState(() => localStorage.getItem("ide:dotfiles") !== "0");
  const [entries, setEntries] = useState<{ path: string; kind: "file" | "directory" }[] | null>(null);
  const [truncated, setTruncated] = useState(false);
  const [decorations, setDecorations] = useState<Map<string, Decoration>>(new Map());
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [selected, setSelected] = useState<string | null>(null);
  const [menu, setMenu] = useState<{ x: number; y: number; node: TreeNode | null } | null>(null);
  const [pending, setPending] = useState<Pending | null>(null);
  const [dropTarget, setDropTarget] = useState<string | null>(null);

  const refresh = useCallback(() => {
    rpc.call("tree", { scope, includeHidden }).then(
      (result) => {
        setEntries(result.entries);
        setTruncated(result.truncated);
      },
      (error: Error) => log(`Could not list files: ${error.message}`),
    );
    rpc.call("gitStatus", { scope }).then(
      (status) => setDecorations(decorateTree(status.entries)),
      () => setDecorations(new Map()),
    );
  }, [rpc, scope, includeHidden, log]);

  // Watcher events arrive in bursts (a build, a checkout); refresh once they settle.
  useEffect(() => {
    const timer = setTimeout(refresh, changeTick === 0 ? 0 : 400);
    return () => clearTimeout(timer);
  }, [refresh, changeTick]);

  useEffect(() => localStorage.setItem("ide:dotfiles", includeHidden ? "1" : "0"), [includeHidden]);

  const tree = useMemo(() => buildTree(entries ?? []), [entries]);
  const rows = useMemo(() => visibleRows(tree, expanded), [tree, expanded]);

  const scroller = useRef<HTMLDivElement>(null);
  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scroller.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 12,
  });

  // Reveal the active file: open its folders, select and scroll to it.
  useEffect(() => {
    if (activePath === null || activePath.startsWith("diff:")) return;
    setSelected(activePath);
    setExpanded((current) => {
      const missing = ancestorsOf(activePath).filter((folder) => !current.has(folder));
      return missing.length === 0 ? current : new Set([...current, ...missing]);
    });
  }, [activePath]);
  useEffect(() => {
    if (activePath === null) return;
    const index = rows.findIndex((row) => row.node.path === activePath);
    if (index !== -1) virtualizer.scrollToIndex(index, { align: "auto" });
  }, [activePath, rows, virtualizer]);

  const toggle = (path: string) =>
    setExpanded((current) => {
      const next = new Set(current);
      if (!next.delete(path)) next.add(path);
      return next;
    });

  const parentFor = (node: TreeNode | null) => (node === null ? "" : node.kind === "directory" ? node.path : dirname(node.path));
  const join = (parent: string, name: string) => (parent === "" ? name : `${parent}/${name}`);

  async function act(label: string, work: () => Promise<unknown>) {
    try {
      await work();
      refresh();
    } catch (error) {
      log(`${label} failed: ${(error as Error).message}`);
      window.alert(`${label} failed: ${(error as Error).message}`);
    }
  }

  const submitPending = (value: string) => {
    const name = value.trim();
    const current = pending;
    setPending(null);
    if (current === null || name === "") return;
    if (name.split("/").some((part) => part === ".." || part === ".")) {
      window.alert("Names cannot contain . or .. segments");
      return;
    }
    if (current.kind === "rename") {
      const to = join(dirname(current.path), name);
      if (to === current.path) return;
      void act("Rename", async () => {
        await rpc.call("move", { scope, from: current.path, to });
        onRenamed(current.path, to);
      });
    } else {
      const path = join(current.parent, name);
      void act(current.kind === "newFile" ? "New file" : "New folder", async () => {
        if (current.kind === "newFile") {
          await rpc.call("createFile", { scope, path });
          onOpen(path);
        } else {
          await rpc.call("createFolder", { scope, path });
        }
        setExpanded((set) => new Set([...set, ...ancestorsOf(path), ...(current.kind === "newFolder" ? [path] : [])]));
      });
    }
  };

  const remove = (node: TreeNode) => {
    const what = node.kind === "directory" ? `the folder "${node.path}" and everything in it` : `"${node.path}"`;
    if (!window.confirm(`Delete ${what}? This cannot be undone.`)) return;
    void act("Delete", async () => {
      await rpc.call("remove", { scope, path: node.path });
      onDeleted(node.path);
    });
  };

  const move = (from: string, toFolder: string) => {
    const to = join(toFolder, basename(from));
    if (to === from || toFolder === from || toFolder.startsWith(`${from}/`)) return;
    void act("Move", async () => {
      await rpc.call("move", { scope, from, to });
      onRenamed(from, to);
    });
  };

  const colorOf = (decoration: Decoration | undefined) => {
    if (decoration === undefined) return undefined;
    const [key, fallback] = DECORATION_COLOR[decoration];
    return codeTheme.theme?.colors[key] ?? fallback;
  };

  const onKeyDown = (event: React.KeyboardEvent) => {
    const node = rows.find((row) => row.node.path === selected)?.node;
    if (node === undefined || pending !== null) return;
    if (event.key === "F2") setPending({ kind: "rename", path: node.path });
    else if (event.key === "Delete" || (event.key === "Backspace" && event.metaKey)) remove(node);
    else if (event.key === "Enter") node.kind === "directory" ? toggle(node.path) : onOpen(node.path);
    else if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      const index = rows.findIndex((row) => row.node.path === selected) + (event.key === "ArrowDown" ? 1 : -1);
      const next = rows[Math.max(0, Math.min(rows.length - 1, index))];
      if (next) {
        setSelected(next.node.path);
        virtualizer.scrollToIndex(rows.indexOf(next));
      }
    } else return;
    event.preventDefault();
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex h-7 shrink-0 items-center gap-0.5 px-2">
        <span className="flex-1 truncate text-[11px] font-semibold uppercase text-muted-foreground">Files</span>
        <ToolButton icon="Plus" label="New File" onClick={() => setPending({ kind: "newFile", parent: parentFor(selectedNode()) })} />
        <ToolButton icon="FolderPlus" label="New Folder" onClick={() => setPending({ kind: "newFolder", parent: parentFor(selectedNode()) })} />
        <ToolButton icon="RotateCcw" label="Refresh" onClick={refresh} />
        <ToolButton icon="Minimize2" label="Collapse All" onClick={() => setExpanded(new Set())} />
        <ToolButton
          icon={includeHidden ? "Eye" : "EyeOff"}
          label={includeHidden ? "Hide dotfiles" : "Show dotfiles"}
          pressed={includeHidden}
          onClick={() => setIncludeHidden((value) => !value)}
        />
      </div>
      <div
        ref={scroller}
        role="tree"
        aria-label="Files"
        tabIndex={0}
        className={`relative min-h-0 flex-1 overflow-y-auto outline-none ${dropTarget === "" ? "bg-primary/10" : ""}`}
        onKeyDown={onKeyDown}
        onContextMenu={(event) => {
          if (event.target !== event.currentTarget) return;
          event.preventDefault();
          setMenu({ x: event.clientX, y: event.clientY, node: null });
        }}
        onDragOver={(event) => {
          if (event.target === event.currentTarget) {
            event.preventDefault();
            setDropTarget("");
          }
        }}
        onDrop={(event) => {
          const from = event.dataTransfer.getData("application/x-ide-path");
          setDropTarget(null);
          if (from && event.target === event.currentTarget) move(from, "");
        }}
      >
        {entries === null ? <p className="px-3 py-2 text-xs text-muted-foreground">Loading…</p> : null}
        <div style={{ height: virtualizer.getTotalSize(), position: "relative" }}>
          {virtualizer.getVirtualItems().map((item) => {
            const { node, depth, isExpanded } = rows[item.index]!;
            const decoration = decorations.get(node.path);
            const isDir = node.kind === "directory";
            return (
              <div
                key={node.path}
                role="treeitem"
                aria-expanded={isDir ? isExpanded : undefined}
                aria-selected={selected === node.path}
                draggable
                title={node.path}
                className={`absolute left-0 flex w-full cursor-pointer items-center gap-1 pr-2 text-[13px] ${
                  selected === node.path ? "bg-accent text-accent-foreground" : "hover:bg-muted"
                } ${dropTarget === node.path ? "outline outline-1 outline-primary" : ""}`}
                style={{ top: item.start, height: ROW_HEIGHT, paddingLeft: 8 + depth * 12 }}
                onClick={(event) => {
                  setSelected(node.path);
                  if (isDir) toggle(node.path);
                  else onOpen(node.path, event.altKey || event.metaKey);
                }}
                onContextMenu={(event) => {
                  event.preventDefault();
                  setSelected(node.path);
                  setMenu({ x: event.clientX, y: event.clientY, node });
                }}
                onDragStart={(event) => {
                  event.dataTransfer.setData("application/x-ide-path", node.path);
                  event.dataTransfer.effectAllowed = "move";
                }}
                onDragOver={(event) => {
                  if (!isDir) return;
                  event.preventDefault();
                  event.stopPropagation();
                  setDropTarget(node.path);
                }}
                onDragLeave={() => setDropTarget((current) => (current === node.path ? null : current))}
                onDrop={(event) => {
                  if (!isDir) return;
                  event.preventDefault();
                  event.stopPropagation();
                  setDropTarget(null);
                  const from = event.dataTransfer.getData("application/x-ide-path");
                  if (from) move(from, node.path);
                }}
              >
                {isDir ? (
                  <>
                    <Icon name={isExpanded ? "ChevronDown" : "ChevronRight"} className="size-3.5 shrink-0 text-muted-foreground" />
                    <span className="flex shrink-0" style={{ color: hues.yellow }}>
                      <Icon name="Folder" className="size-3.5" />
                    </span>
                  </>
                ) : (
                  <span className="ml-3.5 flex shrink-0" style={{ color: hues[hueForFile(node.path)] }}>
                    <Icon name="File" className="size-3.5" />
                  </span>
                )}
                <span className="flex-1 truncate" style={{ color: colorOf(decoration) }}>
                  {node.name}
                </span>
                {decoration !== undefined && !isDir ? (
                  <span className="text-[11px]" style={{ color: colorOf(decoration) }}>
                    {DECORATION_LETTER[decoration]}
                  </span>
                ) : null}
              </div>
            );
          })}
        </div>
        {truncated ? (
          <p className="px-3 py-2 text-xs text-muted-foreground">
            Only the first 10,000 entries are shown. Add large folders to the IDE's Excluded directories setting.
          </p>
        ) : null}
      </div>
      {menu !== null ? (
        <ContextMenu
          x={menu.x}
          y={menu.y}
          onClose={() => setMenu(null)}
          items={[
            { label: "New File…", run: () => setPending({ kind: "newFile", parent: parentFor(menu.node) }) },
            { label: "New Folder…", run: () => setPending({ kind: "newFolder", parent: parentFor(menu.node) }) },
            ...(menu.node === null
              ? []
              : [
                  ...(menu.node.kind === "file" ? [{ label: "Open to the Side", run: () => onOpen(menu.node!.path, true) }] : []),
                  { label: "Rename…", run: () => setPending({ kind: "rename", path: menu.node!.path }) },
                  { label: "Delete", run: () => remove(menu.node!) },
                  { label: "Copy Relative Path", run: () => void navigator.clipboard.writeText(menu.node!.path) },
                ]),
          ]}
        />
      ) : null}
      {pending !== null ? (
        <InputBox
          title={
            pending.kind === "rename"
              ? `Rename ${pending.path}`
              : `${pending.kind === "newFile" ? "New file" : "New folder"} in ${pending.parent || "workspace root"}`
          }
          initial={pending.kind === "rename" ? basename(pending.path) : ""}
          placeholder={pending.kind === "newFolder" ? "folder or nested/folders" : "name.ext or folder/name.ext"}
          onSubmit={submitPending}
          onCancel={() => setPending(null)}
        />
      ) : null}
    </div>
  );

  function selectedNode(): TreeNode | null {
    return rows.find((row) => row.node.path === selected)?.node ?? null;
  }
}

function ToolButton({ icon, label, onClick, pressed }: { icon: string; label: string; onClick(): void; pressed?: boolean }) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      aria-pressed={pressed}
      className="flex size-6 items-center justify-center rounded text-muted-foreground hover:bg-muted hover:text-foreground"
      onClick={onClick}
    >
      <Icon name={icon} className="size-3.5" />
    </button>
  );
}

function ContextMenu({
  x,
  y,
  items,
  onClose,
}: {
  x: number;
  y: number;
  items: { label: string; run(): void }[];
  onClose(): void;
}) {
  useEffect(() => {
    const close = () => onClose();
    window.addEventListener("mousedown", close);
    window.addEventListener("blur", close);
    return () => {
      window.removeEventListener("mousedown", close);
      window.removeEventListener("blur", close);
    };
  }, [onClose]);
  return (
    <ul
      role="menu"
      className="fixed z-50 min-w-44 rounded-md border border-border bg-popover py-1 text-[13px] text-popover-foreground shadow-lg"
      style={{ left: x, top: y }}
      onMouseDown={(event) => event.stopPropagation()}
    >
      {items.map((item) => (
        <li key={item.label}>
          <button
            type="button"
            role="menuitem"
            className="w-full px-3 py-1 text-left hover:bg-accent hover:text-accent-foreground"
            onClick={() => {
              onClose();
              item.run();
            }}
          >
            {item.label}
          </button>
        </li>
      ))}
    </ul>
  );
}
