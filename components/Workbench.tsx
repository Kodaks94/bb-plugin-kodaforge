// The VS Code-style shell: activity bar, side bar, editor groups, bottom panel
// and status bar, for one workspace.
import { useCallback, useEffect, useMemo, useReducer, useRef, useState, type ReactNode } from "react";
import { Group as PanelGroup, Panel, Separator } from "react-resizable-panels";
import {
  experimental_useCodeTheme,
  experimental_useRpcKeyedQuery,
  useRealtime,
  useRpc,
} from "@get-bb/plugin-sdk/app";
import type * as MonacoApi from "monaco-editor/esm/vs/editor/editor.api.js";
import { z } from "zod";
import type { PluginRpcContract } from "@get-bb/plugin-sdk";
import type { ResolvedScope, rpcContract, Scope } from "../server";
import { editorReducer, initialEditorState, openPaths } from "@/lib/editor-state";
import { Icon } from "@/components/ui/icon";
import { applyTheme, loadMonaco, type Monaco } from "./monaco";
import { useDocuments } from "./use-documents";
import { EditorGroup } from "./EditorGroup";
import { InputBox, Palette, type PaletteItem } from "./Palette";
import { Explorer } from "./Explorer";
import { SearchView } from "./SearchView";
import { useLanguageServers } from "./use-language-servers";
import { notifySaved } from "./lsp";
import { TerminalPanel, type TerminalApi } from "./TerminalPanel";
import { SourceControlView } from "./SourceControlView";
import { diffKey } from "@/lib/diff-key";
import { moodFor } from "@/lib/koda-sprite";
import { useHues } from "./colors";
import { Koda, MOOD_LINES } from "./Koda";
import { KodaIcon } from "./KodaIcon";
import { SidePanel, type SideTab } from "./SidePanel";
import { FileIcon, FileIconProvider } from "./FileIcon";
import { useDebugger } from "./debugger";
import { DebugConsole, DebugToolbar, DebugView } from "./DebugView";
import { TasksView } from "./TasksView";
import { SearchEverywhere, type TextHit } from "./SearchEverywhere";
import { taskArgv, type Task } from "@/lib/tasks";
import type { Hue } from "@/lib/file-colors";
import { remapPath } from "@/lib/editor-state";

type Editor = MonacoApi.editor.IStandaloneCodeEditor;
type View = "explorer" | "search" | "scm" | "debug" | "tasks" | "problems";
type PanelTab = "terminal" | "debug" | "problems" | "output";

// A plain object, not defineRpcContract(): the app bundle may only import the SDK's /app entry at runtime.
const gitContract = {
  status: {
    input: z.object({ keys: z.array(z.string()) }),
    output: z.record(
      z.string(),
      z.object({
        outcome: z.string(),
        workspace: z.object({ branch: z.object({ currentBranch: z.string().nullable() }) }).optional(),
      }),
    ),
  },
} satisfies PluginRpcContract;

const VIEWS: { id: View; icon: string; label: string; keys: string; hue: Hue }[] = [
  { id: "explorer", icon: "FileText", label: "Explorer", keys: "⌘⇧E", hue: "blue" },
  { id: "search", icon: "Search", label: "Search", keys: "⌘⇧F", hue: "yellow" },
  { id: "scm", icon: "GitBranch", label: "Source Control", keys: "⌘⇧G", hue: "orange" },
  { id: "debug", icon: "Bug", label: "Run and Debug", keys: "⌘⇧D", hue: "red" },
  { id: "tasks", icon: "Play", label: "Tasks (Makefile, npm scripts)", keys: "", hue: "green" },
  { id: "problems", icon: "AlertTriangle", label: "Problems", keys: "", hue: "red" },
];

/** Browser surfaces the design has to own too: scrollbars and selection, from BB's theme variables. */
const CHROME_CSS = `
.kf-root ::selection { background: color-mix(in srgb, var(--primary) 30%, transparent); }
.kf-root * { scrollbar-width: thin; scrollbar-color: color-mix(in srgb, var(--muted-foreground) 35%, transparent) transparent; }
.kf-root *::-webkit-scrollbar { width: 10px; height: 10px; }
.kf-root *::-webkit-scrollbar-thumb { background: color-mix(in srgb, var(--muted-foreground) 30%, transparent); border-radius: 8px; border: 2px solid transparent; background-clip: content-box; }
.kf-root *::-webkit-scrollbar-thumb:hover { background-color: color-mix(in srgb, var(--muted-foreground) 55%, transparent); }
.kf-root *::-webkit-scrollbar-track { background: transparent; }
.kf-root .kf-bp::before { content: ""; display: block; width: 9px; height: 9px; margin: 5px 0 0 5px; border-radius: 50%; background: var(--kf-red); }
.kf-root .kf-stop-glyph::before { content: ""; display: block; width: 10px; height: 12px; margin: 4px 0 0 4px; background: var(--kf-yellow); clip-path: polygon(0 0, 100% 50%, 0 100%); }
.kf-root .kf-stop-line { background: color-mix(in srgb, var(--kf-yellow) 22%, transparent); }
.kf-root button:focus-visible, .kf-root [role="treeitem"]:focus-visible, .kf-root [role="tab"]:focus-visible { outline: 1.5px solid var(--primary); outline-offset: -1.5px; }
`;

/** The workbench the user touched last; it owns shortcuts that land on the bare page body. */
let lastActiveWorkbench: symbol | null = null;

const isMac = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.userAgent);

export function Workbench({
  scope,
  header,
  active = true,
  onDirtyChange,
}: {
  scope: Scope;
  header?: ReactNode;
  /** False while another workspace tab is showing: stays alive (buffers, terminals) but takes no keys. */
  active?: boolean;
  /** Reports whether any open file has unsaved changes, for the workspace tab's dot. */
  onDirtyChange?(dirty: boolean): void;
}) {
  const rpc = useRpc<typeof rpcContract>();
  const [resolved, setResolved] = useState<ResolvedScope | null>(null);
  const [monaco, setMonaco] = useState<Monaco | null>(null);
  const [assetsUrl, setAssetsUrl] = useState<string | null>(null);
  const [fatal, setFatal] = useState<string | null>(null);
  const [output, setOutput] = useState<string[]>([]);
  // Koda celebrates the good news in the log: saves, commits, replacements.
  const [celebrating, setCelebrating] = useState(0);
  const log = useCallback((line: string) => {
    setOutput((lines) => [...lines.slice(-499), `[${new Date().toLocaleTimeString()}] ${line}`]);
    if (/^(Saved|Committed|Replaced|Started workflow)/.test(line)) setCelebrating(Date.now());
  }, []);

  useEffect(() => {
    let cancelled = false;
    setResolved(null);
    setFatal(null);
    Promise.all([rpc.call("resolve", { scope }), rpc.call("monacoAssets", null).then((a) => {
        setAssetsUrl(a.baseUrl);
        return loadMonaco(a.baseUrl);
      })]).then(
      ([info, api]) => {
        if (cancelled) return;
        setResolved(info);
        setMonaco(() => api);
      },
      (error: Error) => !cancelled && setFatal(error.message),
    );
    return () => {
      cancelled = true;
    };
  }, [rpc, scope]);

  // Keep the host's file watcher alive while this workbench is open.
  useEffect(() => {
    if (resolved === null) return;
    const renew = () => rpc.call("watch", { scope }).catch((error: Error) => log(`File watching unavailable: ${error.message}`));
    void renew();
    const timer = setInterval(renew, 60_000);
    return () => clearInterval(timer);
  }, [rpc, scope, resolved, log]);

  const codeTheme = experimental_useCodeTheme();
  useEffect(() => {
    if (monaco === null) return;
    monaco.editor.setTheme(applyTheme(monaco, codeTheme.theme, codeTheme.mode));
  }, [monaco, codeTheme.theme, codeTheme.mode]);

  const docs = useDocuments(monaco, scope, resolved?.root ?? null, log);

  // Layout survives leaving KodaForge: views, panel, and open tabs, per workspace.
  const layoutKey = `kodaforge:layout:${scope.kind}:${scope.id}`;
  const savedLayout = useRef<{
    view?: View | null;
    panel?: PanelTab | null;
    panelMax?: boolean;
    minimap?: boolean;
    groups?: { tabs: string[]; active: string | null }[];
    focused?: number;
  }>(
    (() => {
      try {
        return JSON.parse(localStorage.getItem(layoutKey) ?? "{}");
      } catch {
        return {};
      }
    })(),
  ).current;
  const [state, dispatch] = useReducer(editorReducer, initialEditorState);
  // Python environments: the selected one drives pyright, the debugger, new terminals and tasks.
  type PyEnvs = { envs: { python: string; kind: string; name: string; version: string; local: boolean; activate: string | null }[]; selected: string | null };
  const [pyEnvs, setPyEnvs] = useState<PyEnvs | null>(null);
  const loadPythonEnvs = useCallback(
    () => rpc.call("pythonEnvs", { scope }).then(setPyEnvs, () => setPyEnvs({ envs: [], selected: null })),
    [rpc, scope],
  );
  useEffect(() => {
    if (resolved !== null) void loadPythonEnvs();
  }, [resolved, loadPythonEnvs]);
  const pyEnv = pyEnvs?.envs.find((env) => env.python === pyEnvs.selected) ?? null;

  const lsp = useLanguageServers(monaco, docs, scope, resolved?.root ?? null, log, pyEnv?.python ?? null);
  const debug = useDebugger(scope, resolved?.root ?? null, log, pyEnv?.python ?? null);

  /** ⌘S: format with ruff/prettier when available, then the hash-guarded save. */
  const save = useCallback(
    async (path: string) => {
      const model = docs.model(path);
      const meta = docs.meta(path);
      if (model === null || meta === null || meta.readOnly) return;
      try {
        const before = model.getValue();
        const formatted = await rpc.call("format", { scope, path, content: before });
        if (formatted.status === "formatted" && formatted.content !== before && model.getValue() === before) {
          model.pushEditOperations([], [{ range: model.getFullModelRange(), text: formatted.content }], () => null);
        } else if (formatted.status === "failed") {
          log(`Format skipped for ${path}: ${formatted.reason}`);
        } else if (formatted.status === "unavailable") {
          log(`Format skipped: ${formatted.reason}`);
        }
      } catch (error) {
        log(`Format skipped for ${path}: ${(error as Error).message}`);
      }
      await docs.save(path);
      notifySaved(path);
    },
    [docs, rpc, scope, log],
  );
  const [view, setView] = useState<View | null>(savedLayout.view === undefined ? "explorer" : savedLayout.view);
  const [panel, setPanel] = useState<PanelTab | null>(savedLayout.panel ?? null);
  const [minimap, setMinimap] = useState(savedLayout.minimap ?? true);
  const [panelMax, setPanelMax] = useState(savedLayout.panelMax ?? false);
  const terminalRef = useRef<TerminalApi | null>(null);
  /** Open the terminal panel and hand back its API once it has mounted. */
  const terminalApi = useCallback(async (): Promise<TerminalApi | null> => {
    setPanel("terminal");
    for (let frame = 0; frame < 60 && terminalRef.current === null; frame++) {
      await new Promise((resolve) => requestAnimationFrame(resolve));
    }
    return terminalRef.current;
  }, []);
  const [palette, setPalette] = useState<"files" | "commands" | "branches" | "python" | null>(null);
  const [scmBranch, setScmBranch] = useState<string | null>(null);
  const [branchList, setBranchList] = useState<{ current: string | null; local: string[]; remote: string[] } | null>(null);
  const [newBranch, setNewBranch] = useState(false);
  const [cursor, setCursor] = useState<{ line: number; column: number } | null>(null);
  const editors = useRef(new Map<number, Editor>());
  const onEditor = useCallback((index: number, editor: Editor | null) => {
    if (editor === null) editors.current.delete(index);
    else editors.current.set(index, editor);
  }, []);

  // Dispose a model once no group shows its tab.
  const open = openPaths(state);
  const trackedPaths = useRef(new Set<string>());
  useEffect(() => {
    for (const path of trackedPaths.current) {
      if (!open.includes(path)) {
        trackedPaths.current.delete(path);
        docs.close(path);
      }
    }
  });

  const openFile = useCallback(
    async (path: string, toSide = false) => {
      try {
        if (await docs.open(path)) {
          trackedPaths.current.add(path);
          dispatch({ type: "open", path, toSide });
        }
      } catch (error) {
        log(`Could not open ${path}: ${(error as Error).message}`);
      }
    },
    [docs, log],
  );

  // Open a file and select a range in it (search results, problems, LSP locations).
  const focusedRef = useRef(state.focused);
  focusedRef.current = state.focused;
  const openAt = useCallback(
    async (path: string, line: number, column: number, length = 0) => {
      await openFile(path);
      // Wait (a few frames at most) for the group's editor to switch to the model.
      const target = docs.model(path);
      for (let frame = 0; frame < 20; frame++) {
        const editor = editors.current.get(focusedRef.current);
        if (editor !== undefined && target !== null && editor.getModel() === target) {
          const range = { startLineNumber: line, startColumn: column, endLineNumber: line, endColumn: column + length };
          editor.setSelection(range);
          editor.revealRangeInCenterIfOutsideViewport(range);
          editor.focus();
          return;
        }
        await new Promise((resolve) => requestAnimationFrame(resolve));
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [openFile, docs.model],
  );

  // Go to Definition / peek into another file: Monaco asks us to open it in a tab.
  const pathOfRef = useRef(docs.pathOf);
  pathOfRef.current = docs.pathOf;
  useEffect(() => {
    if (monaco === null) return;
    const opener = monaco.editor.registerEditorOpener({
      openCodeEditor(_source, resource, selectionOrPosition) {
        const path = pathOfRef.current(resource);
        if (path === null) return false;
        const at =
          selectionOrPosition === undefined
            ? { line: 1, column: 1 }
            : "startLineNumber" in selectionOrPosition
              ? { line: selectionOrPosition.startLineNumber, column: selectionOrPosition.startColumn }
              : { line: selectionOrPosition.lineNumber, column: selectionOrPosition.column };
        void openAt(path, at.line, at.column);
        return true;
      },
    });
    return () => opener.dispose();
  }, [monaco, openAt]);

  const onRenamed = useCallback(
    (from: string, to: string) => {
      docs.rename(from, to);
      for (const path of [...trackedPaths.current]) {
        const next = remapPath(path, from, to);
        if (next === null) continue;
        trackedPaths.current.delete(path);
        trackedPaths.current.add(next);
      }
      dispatch({ type: "rename", from, to });
      markFilesStale();
      log(`Renamed ${from} → ${to}`);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [docs.rename, log],
  );
  const onDeleted = useCallback(
    (deleted: string) => {
      // Clean tabs of deleted files close; dirty ones stay so the edits can be saved elsewhere.
      for (const path of docs.paths()) {
        if (remapPath(path, deleted, deleted) !== null && !docs.isDirty(path)) dispatch({ type: "closeEverywhere", path });
      }
      markFilesStale();
      log(`Deleted ${deleted}`);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [docs.paths, docs.isDirty, log],
  );

  // Reopen the saved tabs once the editor is ready; files that are gone are skipped.
  const restored = useRef(false);
  useEffect(() => {
    if (restored.current || monaco === null || resolved === null) return;
    restored.current = true;
    const groups = savedLayout.groups ?? [];
    void (async () => {
      const kept = [];
      for (const group of groups) {
        const tabs: string[] = [];
        for (const path of group.tabs) {
          if (path.startsWith("diff:")) tabs.push(path);
          else if (await docs.open(path).catch(() => false)) tabs.push(path);
        }
        kept.push({ tabs, active: group.active });
      }
      // Track the reopened files only now, together with the tabs that show them,
      // so the unused-model cleanup never sees one without the other.
      for (const group of kept) for (const path of group.tabs) if (!path.startsWith("diff:")) trackedPaths.current.add(path);
      dispatch({ type: "restore", groups: kept, focused: savedLayout.focused ?? 0 });
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [monaco, resolved]);

  useEffect(() => {
    if (!restored.current) return;
    localStorage.setItem(
      layoutKey,
      JSON.stringify({
        view,
        panel,
        panelMax,
        minimap,
        groups: state.groups.map((group) => ({ tabs: group.tabs, active: group.active })),
        focused: state.focused,
      }),
    );
  }, [layoutKey, view, panel, panelMax, minimap, state]);

  const focusedGroup = state.groups[state.focused];
  const activePath = focusedGroup?.active ?? null;
  const activeModel = activePath === null ? null : docs.model(activePath);

  const requestClose = useCallback(
    (path: string, group: number) => {
      const elsewhere = state.groups.some((g, i) => i !== group && g.tabs.includes(path));
      if (!elsewhere && docs.isDirty(path) && !window.confirm(`Discard unsaved changes to ${path}?`)) return;
      dispatch({ type: "close", path, group });
    },
    [state.groups, docs],
  );

  // Problems: every marker Monaco holds for this workbench's models.
  const [markers, setMarkers] = useState<MonacoApi.editor.IMarker[]>([]);
  useEffect(() => {
    if (monaco === null) return;
    const read = () =>
      setMarkers(
        monaco.editor.getModelMarkers({}).filter((marker) => open.some((path) => docs.model(path)?.uri.toString() === marker.resource.toString())),
      );
    read();
    const subscription = monaco.editor.onDidChangeMarkers(read);
    return () => subscription.dispose();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [monaco, open.join("\n")]);
  const errors = markers.filter((m) => m.severity === 8).length;
  const warnings = markers.filter((m) => m.severity === 4).length;

  // Quick Open's file list, refetched when opened after a create/delete.
  const [fileList, setFileList] = useState<{ paths: string[]; truncated: boolean } | null>(null);
  const filesStale = useRef(true);
  useEffect(() => {
    if (palette !== "files" || !filesStale.current) return;
    filesStale.current = false;
    rpc.call("listFiles", { scope, includeHidden: true }).then(setFileList, (error: Error) => {
      filesStale.current = true;
      log(`Could not list files: ${error.message}`);
    });
  }, [palette, rpc, scope, log]);
  const [changeTick, setChangeTick] = useState(0);
  const markFilesStale = useCallback(() => {
    filesStale.current = true;
    setChangeTick((tick) => tick + 1);
  }, []);
  useRealtimeChanges(resolved?.root ?? null, markFilesStale);

  const runTask = async (task: Task) => {
    const api = await terminalApi();
    const envBin = pyEnv ? pyEnv.python.slice(0, pyEnv.python.lastIndexOf("/")) : null;
    log(`Running ${task.kind === "make" ? "make" : "npm run"} ${task.name}${pyEnv ? ` with ${pyEnv.name}` : ""}`);
    await api?.run(taskArgv(task, envBin), `${task.kind === "make" ? "make" : "npm"} ${task.name}`);
    markFilesStale();
  };

  const searchText = (query: string): Promise<TextHit[]> =>
    rpc
      .call("search", { scope, options: { query: { query, regex: false, matchCase: false, wholeWord: false }, include: "", exclude: "" } })
      .then((result) => result.files.flatMap((file) => file.matches.map((m) => ({ path: file.path, line: m.line, column: m.column, length: m.length, preview: m.preview }))));

  const pythonItems: PaletteItem[] =
    pyEnvs === null
      ? []
      : [
          ...pyEnvs.envs.map((env) => ({
            id: env.python,
            label: `${env.python === pyEnvs.selected ? "● " : ""}${env.name}`,
            detail: `Python ${env.version} · ${env.kind}${env.local ? " · in this workspace" : ""}`,
            match: `${env.name} ${env.version} ${env.kind}`,
            run: () =>
              void rpc.call("pythonSelect", { scope, python: env.python }).then(
                ({ selected }) => {
                  setPyEnvs({ ...pyEnvs, selected });
                  log(`Python: using ${env.name} (${env.version})`);
                },
                (error: Error) => log(`Python: ${error.message}`),
              ),
          })),
          {
            id: "+venv",
            label: "+ Create a .venv in this workspace",
            detail: "python3 -m venv .venv, in a terminal",
            run: () =>
              void terminalApi()
                .then((api) => api?.run(["python3", "-m", "venv", ".venv"], "python -m venv .venv"))
                .then(() => loadPythonEnvs()),
          },
          { id: "rescan", label: "Rescan environments", run: () => void loadPythonEnvs() },
        ];

  const commands = useMemo<PaletteItem[]>(() => {
    const own: PaletteItem[] = [
      { id: "save", label: "File: Save", run: () => activePath && void save(activePath) },
      { id: "saveNoFormat", label: "File: Save without Formatting", run: () => activePath && void docs.save(activePath).then(() => notifySaved(activePath)) },
      {
        id: "saveAll",
        label: "File: Save All",
        run: () => open.filter((p) => docs.isDirty(p)).forEach((p) => void save(p)),
      },
      { id: "revert", label: "File: Revert File", run: () => activePath && void docs.reload(activePath) },
      { id: "quickOpen", label: "Search Everything (Files, Symbols, Text)…", run: () => setPalette("files") },
      { id: "python", label: "Python: Select Interpreter", run: () => setPalette("python") },
      { id: "tasks", label: "Tasks: Show Tasks", run: () => setView("tasks") },
      { id: "search", label: "Search: Find in Files", run: () => setView("search") },
      { id: "scm", label: "View: Show Source Control", run: () => setView("scm") },
      { id: "branch", label: "Git: Switch Branch…", run: () => setPalette("branches") },
      { id: "debugStart", label: "Debug: Start Debugging", run: () => (setView("debug"), activePath?.endsWith(".py") && void startDebugging(activePath)) },
      { id: "debugStop", label: "Debug: Stop", run: () => void debug.stop() },
      { id: "debugBp", label: "Debug: Toggle Breakpoint", run: () => {
        const line = editors.current.get(state.focused)?.getPosition()?.lineNumber;
        if (activePath && line) debug.toggleBreakpoint(activePath, line);
      } },
      { id: "debugConsole", label: "View: Show Debug Console", run: () => setPanel("debug") },
      { id: "chat", label: "Chat: Open Chat", run: () => openSide("chat") },
      { id: "newChat", label: "Chat: New Chat", run: () => (setChatThreadId(null), openSide("chat")) },
      { id: "threads", label: "Chat: Show Threads", run: () => openSide("threads") },
      { id: "workflows", label: "Workflows: Show Workflows", run: () => openSide("workflows") },
      { id: "close", label: "View: Close Editor", run: () => activePath && requestClose(activePath, state.focused) },
      { id: "split", label: "View: Split Editor Right", run: () => dispatch({ type: "split" }) },
      { id: "sidebar", label: "View: Toggle Side Bar", run: () => setView((v) => (v === null ? "explorer" : null)) },
      { id: "panel", label: "View: Toggle Panel", run: () => setPanel((p) => (p === null ? "output" : null)) },
      { id: "minimap", label: "View: Toggle Minimap", run: () => setMinimap((m) => !m) },
      { id: "output", label: "View: Show Output", run: () => setPanel("output") },
      { id: "terminal", label: "View: Toggle Terminal", run: () => setPanel((p) => (p === "terminal" ? null : "terminal")) },
      { id: "terminalNew", label: "Terminal: Create New Terminal", run: () => void terminalApi().then((api) => api?.newTerminal()) },
      { id: "terminalSplit", label: "Terminal: Split Terminal", run: () => void terminalApi().then((api) => api?.split()) },
      { id: "terminalClear", label: "Terminal: Clear", run: () => terminalRef.current?.clear() },
      { id: "panelMax", label: "View: Toggle Maximized Panel", run: () => setPanelMax((value) => !value) },
      { id: "problems", label: "View: Show Problems", run: () => setPanel("problems") },
    ];
    const editor = editors.current.get(state.focused);
    const editorActions: PaletteItem[] = (editor?.getSupportedActions() ?? [])
      .filter((action) => action.label !== "")
      .map((action) => ({
        id: `editor:${action.id}`,
        label: action.label,
        run: () => {
          editor!.focus();
          void action.run();
        },
      }));
    return [...own, ...editorActions];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [palette, activePath, docs, state.focused, requestClose, save]);

  // Shortcuts are scoped to this workbench, so it takes focus when it opens.
  const rootRef = useRef<HTMLDivElement>(null);
  const identity = useRef(Symbol("workbench")).current;
  // When focus falls back to <body> (a clicked button disappeared), keys would
  // reach BB instead; route them here if this workbench was used last.
  const keyHandler = useRef<(event: React.KeyboardEvent) => void>(() => undefined);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (lastActiveWorkbench !== identity || !rootRef.current?.isConnected) return;
      if (event.target !== document.body && event.target !== document.documentElement) return;
      keyHandler.current(event as unknown as React.KeyboardEvent);
    };
    window.addEventListener("keydown", onKey, true);
    return () => {
      window.removeEventListener("keydown", onKey, true);
      if (lastActiveWorkbench === identity) lastActiveWorkbench = null;
    };
  }, [identity]);
  const ready = resolved !== null && monaco !== null;
  useEffect(() => {
    if (ready && active) {
      rootRef.current?.focus();
      lastActiveWorkbench = identity;
    } else if (!active && lastActiveWorkbench === identity) {
      lastActiveWorkbench = null;
    }
  }, [ready, active, identity]);

  const onKeyDownCapture = (event: React.KeyboardEvent) => {
    // Debugging keys, as in VS Code.
    if (/^F(5|6|9|10|11)$/.test(event.key) && !event.altKey && !event.ctrlKey) {
      const k = event.key;
      if (k === "F5" && event.shiftKey && event.metaKey) void debug.restart();
      else if (k === "F5" && event.shiftKey) void debug.stop();
      else if (k === "F5" && debug.status === "stopped") void debug.step("continue");
      else if (k === "F5" && !debug.active) {
        setView("debug");
        if (activePath?.endsWith(".py")) void startDebugging(activePath);
      } else if (k === "F6" && debug.status === "running") void debug.step("pause");
      else if (k === "F9" && activePath !== null && !activePath.startsWith("diff:")) {
        const line = editors.current.get(state.focused)?.getPosition()?.lineNumber;
        if (line) debug.toggleBreakpoint(activePath, line);
      } else if (k === "F10" && debug.status === "stopped") void debug.step("next");
      else if (k === "F11" && debug.status === "stopped") void debug.step(event.shiftKey ? "stepOut" : "stepIn");
      else return;
      event.preventDefault();
      event.stopPropagation();
      return;
    }
    if (event.ctrlKey && !event.metaKey && (event.key === "`" || event.key === "~")) {
      if (event.shiftKey) void terminalApi().then((api) => api?.newTerminal());
      else setPanel((p) => (p === "terminal" ? null : "terminal"));
      event.preventDefault();
      event.stopPropagation();
      return;
    }
    const mod = isMac ? event.metaKey : event.ctrlKey;
    if (mod && event.altKey && event.code === "KeyB") {
      setSideOpen((value) => !value);
      event.preventDefault();
      event.stopPropagation();
      return;
    }
    if (!mod || event.altKey) return;
    const key = event.key.toLowerCase();
    let handled = true;
    if (key === "p" && event.shiftKey) setPalette("commands");
    else if (key === "f" && event.shiftKey) setView("search");
    else if (key === "g" && event.shiftKey) setView("scm");
    else if (key === "e" && event.shiftKey) setView("explorer");
    else if (key === "d" && event.shiftKey) setView("debug");
    else if (key === "p") setPalette("files");
    else if (key === "s" && !event.shiftKey) activePath && void save(activePath);
    else if (key === "\\") {
      // ⌘\ splits whatever has focus: the terminal or the editor.
      if ((event.target as HTMLElement).closest?.(".xterm")) terminalRef.current?.split();
      else dispatch({ type: "split" });
    }
    else if (key === "b" && !event.shiftKey) setView((v) => (v === null ? "explorer" : null));
    else if (key === "j" && !event.shiftKey) setPanel((p) => (p === null ? "output" : null));
    else handled = false;
    if (handled) {
      event.preventDefault();
      event.stopPropagation();
    }
  };

  keyHandler.current = onKeyDownCapture;

  const git = experimental_useRpcKeyedQuery({
    pluginId: "bb--git",
    contract: gitContract,
    method: "status",
    keys: resolved?.environmentId ? [resolved.environmentId] : [],
  });
  const branch = (resolved?.environmentId ? git.data?.[resolved.environmentId]?.workspace?.branch.currentBranch : null) ?? scmBranch;

  // Branch picker: fetched when opened.
  useEffect(() => {
    if (palette !== "branches") return;
    setBranchList(null);
    rpc.call("scmBranches", { scope }).then(setBranchList, (error: Error) => log(`Could not list branches: ${error.message}`));
  }, [palette, rpc, scope, log]);
  const switchTo = (name: string, create: boolean) =>
    rpc.call("scmSwitch", { scope, name, create }).then(
      () => {
        log(`Switched to ${name}`);
        setScmBranch(name);
        markFilesStale();
      },
      (error: Error) => {
        log(`Switch failed: ${error.message}`);
        window.alert(`Could not switch to ${name}: ${error.message}`);
      },
    );
  const branchItems: PaletteItem[] =
    branchList === null
      ? []
      : [
          { id: "+new", label: "+ Create new branch…", run: () => setNewBranch(true) },
          ...branchList.local.map((name) => ({
            id: `l:${name}`,
            label: name,
            detail: name === branchList.current ? "current" : "",
            run: () => name !== branchList.current && void switchTo(name, false),
          })),
          ...branchList.remote.map((name) => ({ id: `r:${name}`, label: name, detail: "remote", run: () => void switchTo(name, false) })),
        ];

  const hues = useHues();

  // The right-hand side panel: chat, threads, workflows.
  const sideKey = `kodaforge:side:${scope.kind}:${scope.id}`;
  const [sideOpen, setSideOpen] = useState(() => localStorage.getItem(`${sideKey}:open`) === "1");
  const [sideTab, setSideTab] = useState<SideTab>("chat");
  const [chatThreadId, setChatThreadIdState] = useState<string | null>(
    () => (scope.kind === "thread" ? scope.id : localStorage.getItem(`${sideKey}:thread`)),
  );
  const setChatThreadId = useCallback(
    (id: string | null) => {
      setChatThreadIdState(id);
      if (id === null) localStorage.removeItem(`${sideKey}:thread`);
      else localStorage.setItem(`${sideKey}:thread`, id);
    },
    [sideKey],
  );
  useEffect(() => {
    localStorage.setItem(`${sideKey}:open`, sideOpen ? "1" : "0");
  }, [sideKey, sideOpen]);
  const openSide = (tab: SideTab) => {
    setSideTab(tab);
    setSideOpen(true);
  };

  // Named workflows the side panel can run: .bb/workflows/<name>.js.
  const [workflowFiles, setWorkflowFiles] = useState<string[]>([]);
  useEffect(() => {
    if (!sideOpen) return;
    rpc.call("listFiles", { scope, includeHidden: true }).then(
      ({ paths }) =>
        setWorkflowFiles(
          paths
            .map((path) => /^\.bb\/workflows\/([a-z0-9][a-z0-9-]{0,63})\.js$/.exec(path)?.[1])
            .filter((name): name is string => name !== undefined),
        ),
      () => setWorkflowFiles([]),
    );
  }, [rpc, scope, sideOpen, changeTick]);

  // Koda's mood.
  const [lastActivity, setLastActivity] = useState(Date.now());
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 15_000);
    return () => clearInterval(timer);
  }, []);
  useEffect(() => {
    if (celebrating === 0) return;
    const timer = setTimeout(() => setNow(Date.now()), 1700);
    return () => clearTimeout(timer);
  }, [celebrating]);
  // Debugging: save the file first, open the Debug Console, then launch.
  async function startDebugging(path: string, args = "") {
    if (docs.isDirty(path)) await save(path);
    setPanel("debug");
    await debug.start(path, args);
  }

  // Breakpoint dots and the paused line, drawn into every open model.
  const decorations = useRef(new Map<string, string[]>());
  const stoppedAt = debug.status === "stopped" ? (debug.frame ?? debug.frames[0] ?? null) : null;
  useEffect(() => {
    if (monaco === null) return;
    for (const path of docs.paths()) {
      const model = docs.model(path);
      if (model === null) continue;
      const lines = debug.breakpoints[path] ?? [];
      const next = [
        ...lines.map((line) => ({
          range: new monaco.Range(line, 1, line, 1),
          options: { glyphMarginClassName: "kf-bp", glyphMarginHoverMessage: { value: "Breakpoint (click or F9 to remove)" }, stickiness: 1 },
        })),
        ...(stoppedAt?.path === path
          ? [
              {
                range: new monaco.Range(stoppedAt.line, 1, stoppedAt.line, 1),
                options: { isWholeLine: true, className: "kf-stop-line", glyphMarginClassName: "kf-stop-glyph" },
              },
            ]
          : []),
      ];
      decorations.current.set(path, model.deltaDecorations(decorations.current.get(path) ?? [], next));
    }
  });
  // When the program pauses, bring its line on screen.
  useEffect(() => {
    if (stoppedAt?.path) void openAt(stoppedAt.path, stoppedAt.line, 1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stoppedAt?.path, stoppedAt?.line, stoppedAt?.id]);

  const mood = moodFor({
    conflict: open.some((path) => docs.meta(path)?.conflict) || debug.stopped?.reason === "exception",
    errors,
    busy:
      Object.values(lsp.states).some((s) => s?.status === "starting") ||
      open.some((path) => docs.meta(path)?.saving) ||
      debug.status === "running" ||
      debug.status === "starting",
    celebrating: celebrating > 0 && Date.now() - celebrating < 1600,
    idleMs: now - lastActivity,
  });

  // Tell the workspace tab whether this workspace has unsaved edits.
  const anyDirty = open.some((path) => docs.isDirty(path));
  const onDirtyRef = useRef(onDirtyChange);
  onDirtyRef.current = onDirtyChange;
  useEffect(() => {
    onDirtyRef.current?.(anyDirty);
  }, [anyDirty]);

  if (fatal !== null) {
    return <div className="p-6 text-sm text-destructive" role="alert">{fatal}</div>;
  }
  if (resolved === null || monaco === null) {
    return <div className="p-6 text-sm text-muted-foreground" role="status">Loading the editor…</div>;
  }

  return (
    <FileIconProvider baseUrl={assetsUrl}>
    <div
      ref={rootRef}
      tabIndex={-1}
      className="kf-root relative flex h-full min-h-0 flex-col bg-background text-foreground outline-none"
      style={{ "--kf-red": hues.red, "--kf-yellow": hues.yellow } as React.CSSProperties}
      onKeyDownCapture={(event) => {
        setLastActivity(Date.now());
        lastActiveWorkbench = identity;
        onKeyDownCapture(event);
      }}
      onPointerDown={() => {
        setLastActivity(Date.now());
        lastActiveWorkbench = identity;
      }}
    >
      <style>{CHROME_CSS}</style>
      <header className="flex h-9 shrink-0 items-center gap-2 border-b border-border bg-muted/30 pl-3 pr-1.5">
        <span className="flex items-center gap-1.5 text-[13px] font-semibold tracking-tight">
          <span style={{ color: hues.orange }} className="flex">
            <KodaIcon className="size-4" />
          </span>
          KodaForge
        </span>
        <span className="h-4 w-px bg-border" />
        <div className="flex min-w-0 flex-1 items-center gap-2 text-xs text-muted-foreground">
          {header ?? (
            <span className="truncate" title={resolved.root}>
              {resolved.label} · {resolved.sublabel}
            </span>
          )}
        </div>
        <DebugToolbar debug={debug} />
        <LayoutButton icon="PanelLeft" label="Toggle Side Bar (⌘B)" active={view !== null} onClick={() => setView((v) => (v === null ? "explorer" : null))} />
        <LayoutButton icon="Terminal" label="Toggle Panel (⌘J)" active={panel !== null} onClick={() => setPanel((p) => (p === null ? "terminal" : null))} />
        <LayoutButton icon="MessageSquare" label="Toggle Chat (⌘⌥B)" active={sideOpen} onClick={() => setSideOpen((value) => !value)} />
      </header>
      <div className="flex min-h-0 flex-1">
        <nav aria-label="Views" className="flex w-11 shrink-0 flex-col items-center gap-1 border-r border-border bg-muted/30 py-2">
          {VIEWS.map((entry) => (
            <button
              key={entry.id}
              type="button"
              title={entry.keys ? `${entry.label} (${entry.keys})` : entry.label}
              aria-label={entry.label}
              aria-pressed={view === entry.id}
              className={`relative flex size-9 items-center justify-center rounded-md ${
                view === entry.id ? "text-foreground" : "text-muted-foreground hover:text-foreground"
              }`}
              onClick={() => setView((v) => (v === entry.id ? null : entry.id))}
            >
              {view === entry.id ? <span className="absolute inset-y-1.5 left-0 w-0.5 rounded" style={{ background: hues[entry.hue] }} /> : null}
              <span className="flex" style={{ color: view === entry.id ? hues[entry.hue] : undefined }}>
                <Icon name={entry.icon} className="size-5" />
              </span>
              {entry.id === "problems" && errors + warnings > 0 ? (
                <span className="absolute right-0.5 top-0.5 rounded-full px-1 text-[10px] font-semibold leading-4" style={{ background: errors > 0 ? hues.red : hues.yellow, color: "var(--background)" }}>
                  {errors + warnings}
                </span>
              ) : null}
            </button>
          ))}
          <span className="flex-1" />
          {(
            [
              ["chat", "MessageSquare", "Chat", hues.blue],
              ["threads", "ListTodo", "Threads", hues.magenta],
              ["workflows", "Workflow", "Workflows", hues.green],
            ] as const
          ).map(([tab, icon, label, hue]) => (
            <button
              key={tab}
              type="button"
              title={label}
              aria-label={label}
              aria-pressed={sideOpen && sideTab === tab}
              className="flex size-9 items-center justify-center rounded-md text-muted-foreground hover:text-foreground"
              onClick={() => (sideOpen && sideTab === tab ? setSideOpen(false) : openSide(tab))}
            >
              <span className="flex" style={{ color: sideOpen && sideTab === tab ? hue : undefined }}>
                <Icon name={icon} className="size-5" />
              </span>
            </button>
          ))}
          <KodaButton mood={mood} />
        </nav>
        <PanelGroup orientation="horizontal" className="min-w-0 flex-1">
          {view !== null ? (
            <>
              <Panel id="sidebar" defaultSize="22" minSize={160} className="flex min-w-0 flex-col border-r border-border">
                <SideBar
                  explorer={
                    <Explorer
                      scope={scope}
                      activePath={activePath}
                      changeTick={changeTick}
                      onOpen={(path, toSide) => void openFile(path, toSide)}
                      onRenamed={onRenamed}
                      onDeleted={onDeleted}
                      log={log}
                    />
                  }
                  tasksView={
                    <TasksView
                      scope={scope}
                      changeTick={changeTick}
                      envName={pyEnv ? `${pyEnv.name} (Python ${pyEnv.version})` : null}
                      onRun={(task) => void runTask(task)}
                      onOpenAt={(path, line) => void openAt(path, line, 1)}
                    />
                  }
                  debugView={
                    <DebugView
                      debug={debug}
                      activePath={activePath}
                      onOpenAt={(path, line, column) => void openAt(path, line, column)}
                      onStart={(path, args) => void startDebugging(path, args)}
                    />
                  }
                  search={<SearchView scope={scope} onOpenAt={(path, line, column, length) => void openAt(path, line, column, length)} log={log} />}
                  scm={
                    <SourceControlView
                      scope={scope}
                      changeTick={changeTick}
                      onOpenDiff={(path, side) => dispatch({ type: "open", path: diffKey(path, side) })}
                      onOpenFile={(path) => void openFile(path)}
                      onChanged={markFilesStale}
                      onBranch={setScmBranch}
                      onPickBranch={() => setPalette("branches")}
                      runInTerminal={async (argv, title) => {
                        const api = await terminalApi();
                        const code = (await api?.run(argv, title)) ?? null;
                        markFilesStale();
                        return code;
                      }}
                      log={log}
                    />
                  }
                  view={view}
                  root={resolved}
                  openEditors={open}
                  isDirty={docs.isDirty}
                  onOpen={(path) => void openFile(path)}
                  markers={markers}
                  onReveal={(marker) => revealMarker(marker)}
                />
              </Panel>
              <Separator className="w-1 bg-transparent hover:bg-primary/40" />
            </>
          ) : null}
          <Panel id="main" minSize={240} className="min-w-0">
            <PanelGroup orientation="vertical">
              <Panel id="editors" minSize={120} className={panel !== null && panelMax ? "hidden" : ""}>
                <PanelGroup orientation="horizontal">
                  {state.groups.map((group, index) => (
                    <GroupSlot key={group.id} index={index}>
                      <EditorGroup
                        monaco={monaco}
                        docs={docs}
                        scope={scope}
                        group={group}
                        index={index}
                        focused={index === state.focused}
                        minimap={minimap}
                        dispatch={dispatch}
                        onEditor={onEditor}
                        onCursor={setCursor}
                        requestClose={requestClose}
                        onGutterClick={(path, line) => debug.toggleBreakpoint(path, line)}
                        welcome={index === 0 ? <Welcome mood={mood} onChat={() => openSide("chat")} /> : undefined}
                      />
                    </GroupSlot>
                  ))}
                </PanelGroup>
              </Panel>
              {panel !== null ? (
                <>
                  {panelMax ? null : <Separator className="h-1 bg-transparent hover:bg-primary/40" />}
                  <Panel id="panel" defaultSize="30" minSize={80} className="border-t border-border">
                    <BottomPanel
                      tab={panel}
                      setTab={setPanel}
                      output={output}
                      markers={markers}
                      onReveal={(m) => revealMarker(m)}
                      debugConsole={<DebugConsole debug={debug} />}
                      terminal={
                        <TerminalPanel
                          ref={terminalRef}
                          activate={pyEnv?.activate ?? null}
                          workspace={resolved}
                          visible={panel === "terminal"}
                          maximized={panelMax}
                          onToggleMaximize={() => setPanelMax((value) => !value)}
                          log={log}
                        />
                      }
                    />
                  </Panel>
                </>
              ) : null}
            </PanelGroup>
          </Panel>
          {sideOpen ? (
            <>
              <Separator className="w-1 bg-transparent hover:bg-primary/40" />
              <Panel id="side" defaultSize="28" minSize={280} className="flex min-w-0 flex-col border-l border-border">
                <SidePanel
                  scope={scope}
                  workspace={resolved}
                  tab={sideTab}
                  setTab={setSideTab}
                  chatThreadId={chatThreadId}
                  setChatThreadId={setChatThreadId}
                  workflowFiles={workflowFiles}
                  onClose={() => setSideOpen(false)}
                  log={log}
                />
              </Panel>
            </>
          ) : null}
        </PanelGroup>
      </div>
      <footer className="flex h-6 shrink-0 items-center gap-4 border-t border-border bg-muted/30 px-3 text-xs text-muted-foreground">
        <span title={resolved.root} className="truncate">
          {resolved.label} · {resolved.sublabel}
        </span>
        {branch ? (
          <button type="button" title="Switch branch" className="flex items-center gap-1 hover:text-foreground" onClick={() => setPalette("branches")}>
            <span className="flex" style={{ color: hues.orange }}>
              <Icon name="GitBranch" className="size-3" />
            </span>
            {branch}
          </button>
        ) : null}
        <button
          type="button"
          title="Toggle Terminal (⌃`)"
          className={`flex items-center gap-1 hover:text-foreground ${panel === "terminal" ? "text-foreground" : ""}`}
          onClick={() => setPanel((p) => (p === "terminal" ? null : "terminal"))}
        >
          <span className="flex" style={{ color: hues.green }}>
            <Icon name="Terminal" className="size-3" />
          </span>
          Terminal
        </button>
        <button type="button" className="flex items-center gap-2 hover:text-foreground" onClick={() => setPanel("problems")}>
          <span className="flex items-center gap-0.5" style={{ color: errors > 0 ? hues.red : undefined }}><Icon name="CircleX" className="size-3" />{errors}</span>
          <span className="flex items-center gap-0.5" style={{ color: warnings > 0 ? hues.yellow : undefined }}><Icon name="AlertTriangle" className="size-3" />{warnings}</span>
        </button>
        <span className="flex-1" />
        {pyEnvs !== null && (pyEnv !== null || pyEnvs.envs.some((env) => env.local) || activePath?.endsWith(".py")) ? (
          <button
            type="button"
            title={pyEnv ? `${pyEnv.python}\nClick to change the Python interpreter` : "Select a Python interpreter"}
            className="flex items-center gap-1 hover:text-foreground"
            onClick={() => setPalette("python")}
          >
            <FileIcon path="python.py" className="size-3" />
            {pyEnv ? `${pyEnv.version} · ${pyEnv.kind === "pyenv" ? "pyenv" : pyEnv.name.replace(/^(conda|poetry|system): /, "")}` : "Select Python"}
          </button>
        ) : null}
        {Object.entries(lsp.states).map(([language, state]) =>
          state === undefined ? null : (
            <button
              key={language}
              type="button"
              title={state.detail ?? state.status}
              className="flex items-center gap-1 hover:text-foreground"
              onClick={() => (state.status === "failed" || state.status === "stopped") && lsp.restart(language as "python" | "typescript")}
            >
              <span
                className="size-1.5 rounded-full"
                style={{ background: state.status === "ready" ? hues.green : state.status === "starting" ? hues.yellow : state.status === "failed" ? hues.red : hues.muted }}
              />
              {language === "python" ? "Python" : "TS/JS"}
              {state.status === "ready" ? "" : ` · ${state.status}`}
            </button>
          ),
        )}
        {activeModel !== null && cursor !== null ? <span>Ln {cursor.line}, Col {cursor.column}</span> : null}
        {activeModel !== null ? <span>{activeModel.getLanguageId()}</span> : null}
        {activePath !== null && docs.meta(activePath)?.readOnly ? <span>Read-only</span> : null}
      </footer>
      {palette === "files" ? (
        <SearchEverywhere
          files={fileList?.paths ?? null}
          commands={commands}
          symbols={lsp.symbols}
          symbolsReady={Object.values(lsp.states).some((state) => state?.status === "ready")}
          searchText={searchText}
          onOpenFile={(path) => void openFile(path)}
          onOpenAt={(path, line, column, length) => void openAt(path, line, column, length)}
          onGotoLine={(line, column) => activePath !== null && !activePath.startsWith("diff:") && void openAt(activePath, line, column)}
          onClose={() => setPalette(null)}
        />
      ) : null}
      {palette === "python" ? (
        <Palette placeholder="Select the Python interpreter for this workspace" items={pythonItems} loading={pyEnvs === null} onClose={() => setPalette(null)} />
      ) : null}
      {palette === "branches" ? (
        <Palette placeholder="Select a branch to switch to" items={branchItems} loading={branchList === null} onClose={() => setPalette(null)} />
      ) : null}
      {newBranch ? (
        <InputBox
          title="New branch name (created from the current HEAD and switched to)"
          initial=""
          onCancel={() => setNewBranch(false)}
          onSubmit={(value) => {
            setNewBranch(false);
            if (value.trim() !== "") void switchTo(value.trim(), true);
          }}
        />
      ) : null}
      {palette === "commands" ? <Palette placeholder="Type a command" items={commands} onClose={() => setPalette(null)} /> : null}
    </div>
    </FileIconProvider>
  );

  function revealMarker(marker: MonacoApi.editor.IMarker) {
    const path = open.find((p) => docs.model(p)?.uri.toString() === marker.resource.toString());
    if (path === undefined) return;
    dispatch({ type: "open", path });
    const editor = editors.current.get(state.focused);
    editor?.revealLineInCenter(marker.startLineNumber);
    editor?.setPosition({ lineNumber: marker.startLineNumber, column: marker.startColumn });
    editor?.focus();
  }
}

function GroupSlot({ index, children }: { index: number; children: ReactNode }) {
  return (
    <>
      {index > 0 ? <Separator className="w-1 bg-border hover:bg-primary/40" /> : null}
      <Panel id={`group-${index}`} minSize={160} className="min-w-0">
        {children}
      </Panel>
    </>
  );
}

function useRealtimeChanges(root: string | null, onChange: () => void) {
  // Any create/delete under the root invalidates Quick Open's cached list.
  useRealtime("ide/changed", (payload) => {
    const event = payload as { root: string };
    if (root !== null && event.root === root) onChange();
  });
}

function SideBar({
  tasksView,
  debugView,
  explorer,
  search,
  scm,
  view,
  root,
  openEditors,
  isDirty,
  onOpen,
  markers,
  onReveal,
}: {
  tasksView: ReactNode;
  debugView: ReactNode;
  explorer: ReactNode;
  search: ReactNode;
  scm: ReactNode;
  view: View;
  root: ResolvedScope;
  openEditors: string[];
  isDirty(path: string): boolean;
  onOpen(path: string): void;
  markers: MonacoApi.editor.IMarker[];
  onReveal(marker: MonacoApi.editor.IMarker): void;
}) {
  const title = VIEWS.find((entry) => entry.id === view)!.label;
  return (
    <>
      <div className="flex h-9 shrink-0 items-center px-3 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{title}</div>
      <div className={`min-h-0 flex-1 text-sm ${view === "problems" ? "overflow-y-auto" : ""}`}>
        {view === "explorer" ? (
          <div className="flex h-full flex-col">
            <div className="px-3 pb-1 text-[11px] font-semibold uppercase text-muted-foreground">Open editors</div>
            <ul className="max-h-[25%] shrink-0 overflow-y-auto pb-1">
              {openEditors.map((path) => (
                <li key={path}>
                  <button type="button" title={path} className="flex w-full items-center gap-1 truncate px-3 py-0.5 text-left hover:bg-muted" onClick={() => onOpen(path)}>
                    <FileIcon path={path} className="size-3.5" />
                    <span className="truncate">{path.split("/").pop()}</span>
                    {isDirty(path) ? <span className="size-1.5 shrink-0 rounded-full bg-foreground" /> : null}
                    <span className="truncate text-xs text-muted-foreground">{path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : ""}</span>
                  </button>
                </li>
              ))}
            </ul>
            {explorer}
          </div>
        ) : view === "search" ? (
          search
        ) : view === "tasks" ? (
          tasksView
        ) : view === "debug" ? (
          debugView
        ) : view === "scm" ? (
          scm
        ) : view === "problems" ? (
          <ProblemList markers={markers} onReveal={onReveal} />
        ) : null}
      </div>
    </>
  );
}

function ProblemList({ markers, onReveal }: { markers: MonacoApi.editor.IMarker[]; onReveal(marker: MonacoApi.editor.IMarker): void }) {
  if (markers.length === 0) return <p className="px-3 py-2 text-xs text-muted-foreground">No problems in open files.</p>;
  return (
    <ul className="text-xs">
      {markers.map((marker, i) => (
        <li key={i}>
          <button type="button" className="flex w-full gap-2 px-3 py-0.5 text-left hover:bg-muted" onClick={() => onReveal(marker)}>
            <Icon name={marker.severity === 8 ? "CircleX" : marker.severity === 4 ? "AlertTriangle" : "Info"} className={`size-3.5 shrink-0 ${marker.severity === 8 ? "text-destructive" : ""}`} />
            <span className="truncate">{marker.message}</span>
            <span className="shrink-0 text-muted-foreground">
              {marker.resource.path.split("/").pop()} [{marker.startLineNumber}, {marker.startColumn}]
            </span>
          </button>
        </li>
      ))}
    </ul>
  );
}

function BottomPanel({
  debugConsole,
  terminal,
  tab,
  setTab,
  output,
  markers,
  onReveal,
}: {
  debugConsole: ReactNode;
  terminal: ReactNode;
  tab: PanelTab;
  setTab(tab: PanelTab | null): void;
  output: string[];
  markers: MonacoApi.editor.IMarker[];
  onReveal(marker: MonacoApi.editor.IMarker): void;
}) {
  const end = useRef<HTMLDivElement>(null);
  // Block body on purpose: Chromium's scrollIntoView now returns a Promise, and an
  // effect must return nothing or a cleanup function.
  useEffect(() => {
    end.current?.scrollIntoView({ block: "end" });
  }, [output.length, tab]);
  return (
    <div className="flex h-full flex-col">
      <div role="tablist" aria-label="Panel" className="flex h-8 shrink-0 items-center gap-4 px-3 text-[11px] uppercase">
        {(["terminal", "debug", "problems", "output"] as const).map((id) => (
          <button
            key={id}
            role="tab"
            type="button"
            aria-selected={tab === id}
            className={tab === id ? "border-b border-foreground text-foreground" : "text-muted-foreground hover:text-foreground"}
            onClick={() => setTab(id)}
          >
            {id === "debug" ? "debug console" : id}
          </button>
        ))}
        <span className="flex-1" />
        <button type="button" aria-label="Close panel" className="text-muted-foreground hover:text-foreground" onClick={() => setTab(null)}>
          <Icon name="X" className="size-3.5" />
        </button>
      </div>
      <div className={`min-h-0 flex-1 ${tab === "terminal" ? "" : "hidden"}`}>{terminal}</div>
      <div className={`min-h-0 flex-1 ${tab === "debug" ? "" : "hidden"}`}>{debugConsole}</div>
      <div className={`min-h-0 flex-1 overflow-y-auto px-3 pb-2 font-mono text-xs ${tab === "terminal" || tab === "debug" ? "hidden" : ""}`}>
        {tab === "output" ? (
          <>
            {output.map((line, i) => (
              <div key={i}>{line}</div>
            ))}
            <div ref={end} />
          </>
        ) : tab === "problems" ? (
          <ProblemList markers={markers} onReveal={onReveal} />
        ) : null}
      </div>
    </div>
  );
}

function LayoutButton({ icon, label, active, onClick }: { icon: string; label: string; active: boolean; onClick(): void }) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      aria-pressed={active}
      className={`flex size-7 items-center justify-center rounded-md hover:bg-muted ${active ? "text-foreground" : "text-muted-foreground"}`}
      onClick={onClick}
    >
      <Icon name={icon} className="size-4" />
    </button>
  );
}

const TIPS = [
  "⌘P opens any file.",
  "⌘⇧P runs any command.",
  "⌘\\ splits the editor, or the terminal when it has focus.",
  "⌃` toggles the terminal; ⌃⇧` opens another.",
  "⌘⌥B opens the chat beside your code.",
  "F12 jumps to a definition; F2 renames everywhere.",
];

/** Koda in the activity bar: his mood, and a tip when you click him. */
function KodaButton({ mood }: { mood: Parameters<typeof Koda>[0]["mood"] }) {
  const [tip, setTip] = useState<number | null>(null);
  useEffect(() => {
    if (tip === null) return;
    const timer = setTimeout(() => setTip(null), 4000);
    return () => clearTimeout(timer);
  }, [tip]);
  return (
    <div className="relative mt-1">
      <button
        type="button"
        aria-label={`${MOOD_LINES[mood]} Click for a tip.`}
        title={MOOD_LINES[mood]}
        className="flex size-9 items-center justify-center rounded-md hover:bg-muted"
        onClick={() => setTip((current) => ((current ?? -1) + 1) % TIPS.length)}
      >
        <Koda mood={mood} size={24} />
      </button>
      {tip !== null ? (
        <div role="status" className="absolute bottom-1 left-11 z-40 w-56 rounded-lg border border-border bg-popover px-3 py-2 text-xs text-popover-foreground shadow-[0_6px_24px_rgba(0,0,0,0.18)]">
          <span className="font-semibold">Koda says:</span> {TIPS[tip]}
        </div>
      ) : null}
    </div>
  );
}

const SHORTCUTS: [string, string][] = [
  ["Open a file", "⌘P"],
  ["Run a command", "⌘⇧P"],
  ["Find in files", "⌘⇧F"],
  ["Toggle terminal", "⌃`"],
  ["Chat with an agent", "⌘⌥B"],
  ["Split editor", "⌘\\"],
];

function Welcome({ mood, onChat }: { mood: Parameters<typeof Koda>[0]["mood"]; onChat(): void }) {
  const hues = useHues();
  return (
    <div className="flex min-h-full items-center justify-center p-8">
      <div className="flex w-full max-w-sm flex-col items-center text-center">
        <Koda mood={mood} size={88} />
        <h1 className="mt-4 text-xl font-semibold tracking-tight">KodaForge</h1>
        <p className="mt-1 text-sm text-muted-foreground">{MOOD_LINES[mood]}</p>
        <dl className="mt-6 w-full divide-y divide-border rounded-lg border border-border text-[13px]">
          {SHORTCUTS.map(([label, keys]) => (
            <div key={label} className="flex items-center justify-between px-3 py-1.5">
              <dt className="text-muted-foreground">{label}</dt>
              <dd>
                <kbd className="rounded border border-border bg-muted/50 px-1.5 py-px font-sans text-xs">{keys}</kbd>
              </dd>
            </div>
          ))}
        </dl>
        <button
          type="button"
          className="mt-4 flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium hover:opacity-90"
          style={{ background: hues.blue, color: "var(--background)" }}
          onClick={onChat}
        >
          <Icon name="MessageSquare" className="size-4" />
          Chat with an agent about this code
        </button>
      </div>
    </div>
  );
}
