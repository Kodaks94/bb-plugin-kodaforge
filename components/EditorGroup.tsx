// One editor group: its tab strip, a Monaco editor, and the conflict banner.
import { useEffect, useRef, useState } from "react";
import type * as MonacoApi from "monaco-editor/esm/vs/editor/editor.api.js";
import { AGENTS_TAB, isVirtualTab, MAX_GROUPS, type EditorAction, type Group } from "@/lib/editor-state";
import { KodaIcon } from "./KodaIcon";
import { Icon } from "@/components/ui/icon";
import type { Documents } from "./use-documents";
import type { Monaco } from "./monaco";
import { DiffView } from "./DiffView";
import { parseDiffKey } from "@/lib/diff-key";
import { FileIcon } from "./FileIcon";
import { useHues } from "./colors";
import type { Scope } from "../server";

type Editor = MonacoApi.editor.IStandaloneCodeEditor;

type Zone = "left" | "center" | "right";
/** Drag payloads: a tab ({path, group}) and an Explorer row (a file path). */
const TAB_MIME = "application/x-kodaforge-tab";
const FILE_MIME = "application/x-ide-path";

type MenuItem = { label: string; keys?: string; disabled?: boolean; run(): void } | null;

function TabMenu({ x, y, items, onClose }: { x: number; y: number; items: MenuItem[]; onClose(): void }) {
  return (
    <div
      role="menu"
      className="fixed z-50 min-w-52 rounded-md border border-border bg-popover py-1 text-xs text-popover-foreground shadow-[0_8px_28px_rgba(0,0,0,0.3)]"
      style={{ left: Math.min(x, window.innerWidth - 220), top: Math.min(y, window.innerHeight - 280) }}
      onMouseDown={(event) => event.stopPropagation()}
    >
      {items.map((item, i) =>
        item === null ? (
          <div key={i} role="separator" className="my-1 h-px bg-border" />
        ) : (
          <button
            key={item.label}
            type="button"
            role="menuitem"
            disabled={item.disabled}
            className="flex w-full items-center gap-4 px-3 py-1 text-left hover:bg-accent hover:text-accent-foreground disabled:opacity-40 disabled:hover:bg-transparent"
            onClick={() => {
              onClose();
              item.run();
            }}
          >
            <span className="flex-1">{item.label}</span>
            {item.keys ? <span className="text-muted-foreground">{item.keys}</span> : null}
          </button>
        ),
      )}
    </div>
  );
}

export function EditorGroup({
  monaco,
  docs,
  scope,
  group,
  index,
  focused,
  options,
  dispatch,
  onEditor,
  onCursor,
  requestClose,
  onGutterClick,
  welcome,
  groupCount,
  renderView,
  onDropFile,
}: {
  monaco: Monaco;
  docs: Documents;
  scope: Scope;
  group: Group;
  index: number;
  focused: boolean;
  /** Editor options from Settings (font, wrap, minimap…). */
  options: MonacoApi.editor.IEditorOptions;
  dispatch(action: EditorAction): void;
  onEditor(index: number, editor: Editor | null): void;
  onCursor(position: { line: number; column: number } | null): void;
  requestClose(path: string, group: number): void;
  /** A click in the glyph margin: toggles a breakpoint. */
  onGutterClick?(path: string, line: number): void;
  /** Shown in an empty group: KodaForge's welcome. */
  welcome?: React.ReactNode;
  /** How many groups exist, to know whether another split fits. */
  groupCount: number;
  /** Content for view tabs (view:…), such as the Agent Network. */
  renderView?(key: string): React.ReactNode;
  /** A file dragged in from the Explorer: open it in this group, or beside it. */
  onDropFile?(path: string, where: "here" | "side"): void;
}) {
  const hues = useHues();
  const host = useRef<HTMLDivElement>(null);
  const editor = useRef<Editor | null>(null);
  const latest = useRef({ index, dispatch, onCursor, focused, onGutterClick, active: group.active });
  latest.current = { index, dispatch, onCursor, focused, onGutterClick, active: group.active };

  useEffect(() => {
    const instance = monaco.editor.create(host.current!, {
      model: null,
      automaticLayout: true,
      ...options,
      scrollBeyondLastLine: false,
      fixedOverflowWidgets: true,
      glyphMargin: true,
    });
    editor.current = instance;
    const report = () => {
      const position = instance.getPosition();
      latest.current.onCursor(position === null ? null : { line: position.lineNumber, column: position.column });
    };
    const subscriptions = [
      instance.onDidFocusEditorText(() => {
        latest.current.dispatch({ type: "focus", group: latest.current.index });
        report();
      }),
      instance.onDidChangeCursorPosition(() => {
        if (latest.current.focused) report();
      }),
      instance.onMouseDown((event) => {
        const { active, onGutterClick } = latest.current;
        const line = event.target.position?.lineNumber;
        if (event.target.type === monaco.editor.MouseTargetType.GUTTER_GLYPH_MARGIN && line && active && !isVirtualTab(active)) {
          onGutterClick?.(active, line);
        }
      }),
    ];
    onEditor(index, instance);
    return () => {
      subscriptions.forEach((s) => s.dispose());
      onEditor(index, null);
      instance.dispose();
      editor.current = null;
    };
    // The editor lives as long as the group; index changes are handled through `latest`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [monaco]);

  useEffect(() => {
    onEditor(index, editor.current);
  }, [index, onEditor]);

  const optionsKey = JSON.stringify(options);
  useEffect(() => {
    editor.current?.updateOptions(options);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [optionsKey]);

  const active = group.active;
  const diff = active === null ? null : parseDiffKey(active);
  const model = active === null || diff !== null || isVirtualTab(active) ? null : docs.model(active);
  const view = active !== null && active.startsWith("view:") ? (renderView?.(active) ?? null) : null;
  const meta = active === null ? null : docs.meta(active);
  useEffect(() => {
    const instance = editor.current;
    if (instance === null) return;
    if (instance.getModel() !== model) instance.setModel(model);
    instance.updateOptions({ readOnly: meta?.readOnly ?? false });
    if (focused && model !== null) instance.focus();
  }, [model, meta?.readOnly, focused]);

  const tabName = (path: string) => {
    if (path === AGENTS_TAB) return "Agent Network";
    const tabDiff = parseDiffKey(path);
    return tabDiff === null ? path.split("/").pop()! : `${tabDiff.path.split("/").pop()} (${tabDiff.side === "staged" ? "Index" : "Working Tree"})`;
  };
  const unsaved = group.tabs.filter((path) => docs.isDirty(path));

  // Drag and drop. Tabs carry {path, group}; Explorer rows carry a file path.
  const [dropAt, setDropAt] = useState<number | null>(null);
  const [zone, setZone] = useState<Zone | null>(null);
  const dragKind = (event: React.DragEvent) =>
    event.dataTransfer.types.includes(TAB_MIME) ? "tab" : event.dataTransfer.types.includes(FILE_MIME) ? "file" : null;
  // Computed from the event itself, not from hover state, which can lag a fast drop.
  const zoneAt = (event: React.DragEvent): Zone => {
    const box = event.currentTarget.getBoundingClientRect();
    const x = (event.clientX - box.left) / box.width;
    if (groupCount >= MAX_GROUPS) return "center";
    return x < 0.25 ? "left" : x > 0.75 ? "right" : "center";
  };
  const slotAt = (event: React.DragEvent, tabIndex: number) => {
    const box = event.currentTarget.getBoundingClientRect();
    return event.clientX < box.left + box.width / 2 ? tabIndex : tabIndex + 1;
  };
  const dropTab = (event: React.DragEvent, target: { index?: number; zone?: Zone }) => {
    event.preventDefault();
    setDropAt(null);
    setZone(null);
    const copy = event.altKey;
    const tab = event.dataTransfer.getData(TAB_MIME);
    if (tab) {
      const { path, group: from } = JSON.parse(tab) as { path: string; group: number };
      if (target.zone === "left" || target.zone === "right") {
        dispatch({ type: "moveToNewGroup", path, from, at: target.zone === "left" ? index : index + 1, copy });
      } else {
        dispatch({ type: "move", path, from, to: index, index: target.index, copy });
      }
      return;
    }
    const file = event.dataTransfer.getData(FILE_MIME);
    if (file) onDropFile?.(file, target.zone === "left" || target.zone === "right" ? "side" : "here");
  };

  const [menu, setMenu] = useState<{ path: string; x: number; y: number } | null>(null);
  useEffect(() => {
    if (menu === null) return;
    const away = () => setMenu(null);
    window.addEventListener("mousedown", away);
    window.addEventListener("blur", away);
    return () => {
      window.removeEventListener("mousedown", away);
      window.removeEventListener("blur", away);
    };
  }, [menu]);

  return (
    <div className="flex h-full min-w-0 flex-col" onMouseDown={() => !focused && dispatch({ type: "focus", group: index })}>
      <div
        role="tablist"
        aria-label={`Editor group ${index + 1}`}
        className="flex h-9 shrink-0 overflow-x-auto border-b border-border bg-muted/40"
        onDragOver={(event) => {
          if (dragKind(event) === null) return;
          event.preventDefault();
          event.dataTransfer.dropEffect = event.altKey ? "copy" : "move";
          if (event.target === event.currentTarget) setDropAt(group.tabs.length);
        }}
        onDragLeave={(event) => !event.currentTarget.contains(event.relatedTarget as Node | null) && setDropAt(null)}
        onDrop={(event) => dropTab(event, { index: dropAt ?? group.tabs.length })}
      >
        {group.tabs.map((path, tabIndex) => {
          const selected = path === active;
          const dirty = docs.isDirty(path);
          const tabDiff = parseDiffKey(path);
          const pinned = group.pinned.includes(path);
          const name = tabName(path);
          return (
            <div
              key={path}
              role="tab"
              aria-selected={selected}
              title={pinned ? `${path} (pinned)` : path}
              tabIndex={0}
              draggable
              className={`group relative flex shrink-0 cursor-pointer items-center gap-1.5 border-r border-border text-xs ${pinned ? "pl-2 pr-1.5" : "px-3"} ${
                selected ? "bg-background text-foreground" : "text-muted-foreground hover:bg-background/60"
              } ${selected && focused ? "shadow-[inset_0_1px_0_var(--primary)]" : ""}`}
              onClick={() => dispatch({ type: "activate", path, group: index })}
              onAuxClick={(event) => event.button === 1 && requestClose(path, index)}
              onKeyDown={(event) => event.key === "Enter" && dispatch({ type: "activate", path, group: index })}
              onContextMenu={(event) => {
                event.preventDefault();
                dispatch({ type: "activate", path, group: index });
                setMenu({ path, x: event.clientX, y: event.clientY });
              }}
              onDragStart={(event) => {
                event.dataTransfer.setData(TAB_MIME, JSON.stringify({ path, group: index }));
                event.dataTransfer.effectAllowed = "copyMove";
              }}
              onDragEnd={() => {
                setDropAt(null);
                setZone(null);
              }}
              onDragOver={(event) => {
                if (dragKind(event) === null) return;
                event.preventDefault();
                event.stopPropagation();
                setDropAt(slotAt(event, tabIndex));
              }}
              onDrop={(event) => {
                event.stopPropagation();
                dropTab(event, { index: slotAt(event, tabIndex) });
              }}
            >
              {dropAt === tabIndex ? <span aria-hidden className="absolute inset-y-1 -left-px w-0.5 rounded bg-primary" /> : null}
              {dropAt === tabIndex + 1 && tabIndex === group.tabs.length - 1 ? <span aria-hidden className="absolute inset-y-1 -right-px w-0.5 rounded bg-primary" /> : null}
              {path === AGENTS_TAB ? (
                <KodaIcon className="size-3.5" />
              ) : tabDiff ? (
                <span className="flex" style={{ color: hues.orange }}>
                  <Icon name="GitBranch" className="size-3.5" />
                </span>
              ) : (
                <FileIcon path={path} className="size-3.5" />
              )}
              <span className={docs.meta(path)?.conflict ? "text-destructive" : ""}>{name}</span>
              {pinned && !dirty ? (
                <button
                  type="button"
                  aria-label={`Unpin ${name}`}
                  title="Unpin"
                  className="flex size-4 items-center justify-center rounded text-muted-foreground hover:bg-muted"
                  onClick={(event) => {
                    event.stopPropagation();
                    dispatch({ type: "togglePin", path, group: index });
                  }}
                >
                  <Icon name="Pin" className="size-3" />
                </button>
              ) : (
                <button
                  type="button"
                  aria-label={dirty ? `${name} has unsaved changes; close` : `Close ${name}`}
                  className="flex size-4 items-center justify-center rounded hover:bg-muted"
                  onClick={(event) => {
                    event.stopPropagation();
                    requestClose(path, index);
                  }}
                >
                  {dirty ? <span className="size-2 rounded-full bg-foreground group-hover:hidden" /> : null}
                  <Icon name="X" className={`size-3 ${dirty ? "hidden group-hover:block" : selected ? "" : "opacity-0 group-hover:opacity-100"}`} />
                </button>
              )}
            </div>
          );
        })}
        <span className="min-w-6 flex-1" aria-hidden />
      </div>
      {menu !== null ? (
        <TabMenu
          x={menu.x}
          y={menu.y}
          items={[
            { label: "Close", keys: "⌘W", run: () => requestClose(menu.path, index) },
            { label: "Close Others", keys: "⌥⌘T", run: () => dispatch({ type: "closeOthers", path: menu.path, group: index, keep: unsaved }) },
            { label: "Close to the Right", run: () => dispatch({ type: "closeRight", path: menu.path, group: index, keep: unsaved }) },
            { label: "Close All", run: () => dispatch({ type: "closeAll", group: index, keep: unsaved }) },
            null,
            { label: group.pinned.includes(menu.path) ? "Unpin" : "Pin", run: () => dispatch({ type: "togglePin", path: menu.path, group: index }) },
            { label: "Split Right", keys: "⌘\\", disabled: groupCount >= MAX_GROUPS, run: () => dispatch({ type: "moveToNewGroup", path: menu.path, from: index, at: index + 1, copy: true }) },
            { label: "Move to Next Group", keys: "⌃⌘→", run: () => dispatch({ type: "moveActive", delta: 1 }) },
            { label: "Move to Previous Group", keys: "⌃⌘←", disabled: index === 0, run: () => dispatch({ type: "moveActive", delta: -1 }) },
            null,
            { label: "Copy Path", disabled: isVirtualTab(menu.path), run: () => void navigator.clipboard?.writeText(menu.path) },
          ]}
          onClose={() => setMenu(null)}
        />
      ) : null}
      {active !== null && diff === null && meta?.conflict ? (
        <div role="alert" className="flex shrink-0 items-center gap-2 border-b border-border bg-destructive/10 px-3 py-1.5 text-xs">
          <Icon name="AlertTriangle" className="size-3.5 text-destructive" />
          <span className="flex-1">
            {meta.conflict.diskSha256 === null
              ? "This file was deleted on disk."
              : "This file changed on disk (an agent may have edited it) since you opened it."}
          </span>
          <button type="button" className="rounded border border-border px-2 py-0.5 hover:bg-muted" onClick={() => void docs.reload(active).then(() => editor.current?.focus())}>
            Reload
          </button>
          <button type="button" className="rounded border border-border px-2 py-0.5 hover:bg-muted" onClick={() => void docs.overwrite(active).then(() => editor.current?.focus())}>
            Overwrite
          </button>
        </div>
      ) : null}
      {meta?.readOnly ? (
        <div className="shrink-0 border-b border-border px-3 py-1 text-xs text-muted-foreground">Read-only: file is larger than 2 MB.</div>
      ) : null}
      <div
        className="relative min-h-0 flex-1"
        onDragOver={(event) => {
          if (dragKind(event) === null) return;
          event.preventDefault();
          event.dataTransfer.dropEffect = event.altKey ? "copy" : "move";
          // Edges split, as in VS Code; no edge zones once the groups are full.
          setZone(zoneAt(event));
        }}
        onDragLeave={(event) => !event.currentTarget.contains(event.relatedTarget as Node | null) && setZone(null)}
        onDrop={(event) => dropTab(event, { zone: zoneAt(event) })}
      >
        <div ref={host} className={`absolute inset-0 ${diff === null && view === null ? "" : "invisible"}`} />
        {view !== null ? <div className="absolute inset-0 bg-background">{view}</div> : null}
        {zone !== null ? (
          <div
            aria-hidden
            className={`pointer-events-none absolute inset-y-0 z-20 rounded-sm border-2 border-primary/60 bg-primary/15 transition-[left,right] duration-100 ${
              zone === "left" ? "left-0 right-1/2" : zone === "right" ? "left-1/2 right-0" : "left-0 right-0"
            }`}
          />
        ) : null}
        {diff !== null ? (
          <div className="absolute inset-0 bg-background">
            <DiffView key={active!} monaco={monaco} docs={docs} scope={scope} path={diff.path} side={diff.side} />
          </div>
        ) : null}
        {active === null ? <div className="absolute inset-0 overflow-auto bg-background">{welcome}</div> : null}
      </div>
    </div>
  );
}
