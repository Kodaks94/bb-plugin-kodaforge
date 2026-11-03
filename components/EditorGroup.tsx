// One editor group: its tab strip, a Monaco editor, and the conflict banner.
import { useEffect, useRef } from "react";
import type * as MonacoApi from "monaco-editor/esm/vs/editor/editor.api.js";
import type { EditorAction, Group } from "@/lib/editor-state";
import { Icon } from "@/components/ui/icon";
import type { Documents } from "./use-documents";
import type { Monaco } from "./monaco";
import { DiffView } from "./DiffView";
import { parseDiffKey } from "@/lib/diff-key";
import { hueForFile } from "@/lib/file-colors";
import { useHues } from "./colors";
import type { Scope } from "../server";

type Editor = MonacoApi.editor.IStandaloneCodeEditor;

export function EditorGroup({
  monaco,
  docs,
  scope,
  group,
  index,
  focused,
  minimap,
  dispatch,
  onEditor,
  onCursor,
  requestClose,
  welcome,
}: {
  monaco: Monaco;
  docs: Documents;
  scope: Scope;
  group: Group;
  index: number;
  focused: boolean;
  minimap: boolean;
  dispatch(action: EditorAction): void;
  onEditor(index: number, editor: Editor | null): void;
  onCursor(position: { line: number; column: number } | null): void;
  requestClose(path: string, group: number): void;
  /** Shown in an empty group: KodaForge's welcome. */
  welcome?: React.ReactNode;
}) {
  const hues = useHues();
  const host = useRef<HTMLDivElement>(null);
  const editor = useRef<Editor | null>(null);
  const latest = useRef({ index, dispatch, onCursor, focused });
  latest.current = { index, dispatch, onCursor, focused };

  useEffect(() => {
    const instance = monaco.editor.create(host.current!, {
      model: null,
      automaticLayout: true,
      fontSize: 13,
      minimap: { enabled: minimap },
      scrollBeyondLastLine: false,
      renderWhitespace: "selection",
      fixedOverflowWidgets: true,
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

  useEffect(() => {
    editor.current?.updateOptions({ minimap: { enabled: minimap } });
  }, [minimap]);

  const active = group.active;
  const diff = active === null ? null : parseDiffKey(active);
  const model = active === null || diff !== null ? null : docs.model(active);
  const meta = active === null ? null : docs.meta(active);
  useEffect(() => {
    const instance = editor.current;
    if (instance === null) return;
    if (instance.getModel() !== model) instance.setModel(model);
    instance.updateOptions({ readOnly: meta?.readOnly ?? false });
    if (focused && model !== null) instance.focus();
  }, [model, meta?.readOnly, focused]);

  return (
    <div className="flex h-full min-w-0 flex-col" onMouseDown={() => !focused && dispatch({ type: "focus", group: index })}>
      <div
        role="tablist"
        aria-label={`Editor group ${index + 1}`}
        className="flex h-9 shrink-0 overflow-x-auto border-b border-border bg-muted/40"
      >
        {group.tabs.map((path) => {
          const selected = path === active;
          const dirty = docs.isDirty(path);
          const tabDiff = parseDiffKey(path);
          const name = tabDiff === null ? path.split("/").pop() : `${tabDiff.path.split("/").pop()} (${tabDiff.side === "staged" ? "Index" : "Working Tree"})`;
          return (
            <div
              key={path}
              role="tab"
              aria-selected={selected}
              title={path}
              tabIndex={0}
              className={`group flex shrink-0 cursor-pointer items-center gap-1.5 border-r border-border px-3 text-xs ${
                selected ? "bg-background text-foreground" : "text-muted-foreground hover:bg-background/60"
              } ${selected && focused ? "shadow-[inset_0_1px_0_var(--primary)]" : ""}`}
              onClick={() => dispatch({ type: "activate", path, group: index })}
              onAuxClick={(event) => event.button === 1 && requestClose(path, index)}
              onKeyDown={(event) => event.key === "Enter" && dispatch({ type: "activate", path, group: index })}
            >
              <span className="flex" style={{ color: hues[hueForFile(tabDiff?.path ?? path)] }}>
                <Icon name={tabDiff ? "GitBranch" : "File"} className="size-3.5" />
              </span>
              <span className={docs.meta(path)?.conflict ? "text-destructive" : ""}>{name}</span>
              <button
                type="button"
                aria-label={dirty ? `${name} has unsaved changes; close` : `Close ${name}`}
                className="flex size-4 items-center justify-center rounded hover:bg-muted"
                onClick={(event) => {
                  event.stopPropagation();
                  requestClose(path, index);
                }}
              >
                {dirty ? (
                  <span className="size-2 rounded-full bg-foreground group-hover:hidden" />
                ) : null}
                <Icon name="X" className={`size-3 ${dirty ? "hidden group-hover:block" : selected ? "" : "opacity-0 group-hover:opacity-100"}`} />
              </button>
            </div>
          );
        })}
      </div>
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
      <div className="relative min-h-0 flex-1">
        <div ref={host} className={`absolute inset-0 ${diff === null ? "" : "invisible"}`} />
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
