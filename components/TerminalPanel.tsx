// Terminals: xterm.js in the browser, BB's persistent terminals behind it.
// Tabs on the right, each holding up to four terminals split side by side.
// Terminals start in the workspace root, survive closing the IDE, and are found
// again (by their "IDE" title) with their layout when it reopens.
import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from "react";
import { Group as PanelGroup, Panel, Separator } from "react-resizable-panels";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import "@xterm/xterm/css/xterm.css";
import { experimental_useCodeTheme, useSdk } from "@get-bb/plugin-sdk/app";
import type { ResolvedScope } from "../server";
import { Icon } from "@/components/ui/icon";
import { useHues } from "./colors";
import { decodeBase64, encodeBase64, nextPollDelay, TITLE_PREFIX } from "@/lib/terminal-io";
import {
  addTerminal,
  emptyLayout,
  focusTerminal,
  MAX_SPLITS,
  removeTerminal,
  restoreLayout,
  visibleGroup,
  type TerminalLayout,
} from "@/lib/terminal-groups";

interface Session {
  id: string;
  title: string;
  /** Command terminals (git push…) stay open after they exit so the output can be read. */
  command: boolean;
}

export interface TerminalApi {
  newTerminal(): void;
  split(): void;
  /** Run a program (no shell) in a new terminal tab; resolves when it exits. */
  run(argv: string[], title: string): Promise<number | null>;
  clear(): void;
}

export const TerminalPanel = forwardRef<
  TerminalApi,
  { workspace: ResolvedScope; visible: boolean; maximized: boolean; onToggleMaximize(): void; log(line: string): void }
>(function TerminalPanel({ workspace, visible, maximized, onToggleMaximize, log }, ref) {
  const sdk = useSdk();
  const [sessions, setSessions] = useState<Session[] | null>(null);
  const [layout, setLayout] = useState<TerminalLayout>(emptyLayout);
  const exitWaiters = useRef(new Map<string, (code: number | null) => void>());
  const storageKey = `kodaforge:terminals:${workspace.hostId}:${workspace.root}`;
  const hues = useHues();
  // Each tab gets its own colour, so split panes and the list read as one group.
  const tabHues = [hues.green, hues.blue, hues.magenta, hues.cyan, hues.yellow, hues.orange];

  const scope = workspace.environmentId
    ? ({ kind: "environment", environmentId: workspace.environmentId } as const)
    : ({ kind: "host_path", hostId: workspace.hostId, cwd: workspace.root } as const);

  useEffect(() => {
    let cancelled = false;
    sdk.terminals.list({ scope }).then(
      ({ sessions: all }) => {
        if (cancelled) return;
        const ours = all
          .filter((s) => s.title.startsWith(TITLE_PREFIX) && (s.status === "running" || s.status === "starting"))
          .map((s) => ({ id: s.id, title: s.title, command: !/^Koda \d+$/.test(s.title) }));
        let saved: TerminalLayout | null = null;
        try {
          saved = JSON.parse(localStorage.getItem(storageKey) ?? "null");
        } catch {
          saved = null;
        }
        setSessions(ours);
        setLayout(restoreLayout(saved, ours.map((s) => s.id)));
      },
      (error: Error) => {
        setSessions([]);
        log(`Could not list terminals: ${error.message}`);
      },
    );
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sdk, storageKey]);

  useEffect(() => {
    if (sessions !== null) localStorage.setItem(storageKey, JSON.stringify(layout));
  }, [layout, sessions, storageKey]);

  const create = useCallback(
    async (split: boolean, start?: { argv: string[]; title: string }) => {
      const used = new Set(sessions?.map((s) => s.title));
      let n = 1;
      while (used.has(`${TITLE_PREFIX}${n}`)) n++;
      try {
        const session = await sdk.terminals.create({
          cols: 100,
          rows: 24,
          title: start ? `${TITLE_PREFIX}${start.title}` : `${TITLE_PREFIX}${n}`,
          scope: workspace.environmentId
            ? { kind: "environment", environmentId: workspace.environmentId }
            : { kind: "host_path", hostId: workspace.hostId, cwd: workspace.root },
          ...(start ? { start: { mode: "argv" as const, argv: start.argv } } : {}),
        });
        setSessions((current) => [...(current ?? []), { id: session.id, title: session.title, command: start !== undefined }]);
        setLayout((current) => addTerminal(current, session.id, split));
        return session.id;
      } catch (error) {
        log(`Could not start a terminal: ${(error as Error).message}`);
        return null;
      }
    },
    [sdk, sessions, workspace, log],
  );

  const kill = useCallback(
    async (id: string) => {
      setSessions((current) => (current ?? []).filter((s) => s.id !== id));
      setLayout((current) => removeTerminal(current, id));
      forgetTerminal(id);
      await sdk.terminals.close({ terminalId: id, mode: "force" }).catch(() => undefined);
    },
    [sdk],
  );

  useImperativeHandle(
    ref,
    () => ({
      newTerminal: () => void create(false),
      split: () => void create(true),
      clear: () => {
        if (layout.focused) liveTerminal(layout.focused)?.clear();
      },
      run: async (argv, title) => {
        const id = await create(false, { argv, title });
        if (id === null) return null;
        return new Promise<number | null>((resolve) => exitWaiters.current.set(id, resolve));
      },
    }),
    [create, layout.focused],
  );

  // Opening the panel with no terminal starts one, as VS Code does.
  useEffect(() => {
    if (visible && sessions !== null && sessions.length === 0) void create(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, sessions]);

  const shown = visibleGroup(layout);
  const titleOf = (id: string) => {
    const title = sessions?.find((s) => s.id === id)?.title ?? "";
    return /^Koda \d+$/.test(title) ? `Terminal ${title.slice(TITLE_PREFIX.length)}` : title.slice(TITLE_PREFIX.length);
  };

  return (
    <div className="flex h-full min-h-0">
      <div className="relative min-w-0 flex-1">
        {/* Every terminal stays mounted (and polled slowly) so switching tabs keeps its state. */}
        {sessions?.map((session) =>
          shown.includes(session.id) ? null : (
            <XtermView
              key={session.id}
              hidden
              terminalId={session.id}
              onFocus={() => undefined}
              onExit={(code) => onExited(session, code)}
            />
          ),
        )}
        <PanelGroup orientation="horizontal" className="absolute inset-0" key={shown.join(",")}>
          {shown.map((id, index) => {
            const session = sessions?.find((s) => s.id === id);
            if (session === undefined) return null;
            return (
              <SplitPane key={id} index={index}>
                <div className={`relative h-full ${shown.length > 1 && layout.focused === id ? "shadow-[inset_0_1px_0_var(--primary)]" : ""}`}>
                  <XtermView
                    terminalId={id}
                    hidden={!visible}
                    focus={visible && layout.focused === id}
                    onFocus={() => setLayout((current) => focusTerminal(current, id))}
                    onExit={(code) => onExited(session, code)}
                  />
                </div>
              </SplitPane>
            );
          })}
        </PanelGroup>
      </div>
      <div className="flex w-40 shrink-0 flex-col border-l border-border text-xs">
        <div className="flex h-7 shrink-0 items-center gap-0.5 px-1" role="toolbar" aria-label="Terminal actions">
          <ToolButton icon="Plus" label="New Terminal (⌃⇧`)" onClick={() => void create(false)} />
          <ToolButton
            icon="PanelLeft"
            label={shown.length >= MAX_SPLITS ? "Split Terminal (at most 4 per tab)" : "Split Terminal (⌘\\ in a terminal)"}
            disabled={shown.length >= MAX_SPLITS || layout.focused === null}
            onClick={() => void create(true)}
          />
          <ToolButton icon="Edit" label="Clear Terminal (⌘K)" disabled={layout.focused === null} onClick={() => layout.focused && liveTerminal(layout.focused)?.clear()} />
          <ToolButton icon="Trash2" label="Kill Terminal" disabled={layout.focused === null} onClick={() => layout.focused && void kill(layout.focused)} />
          <span className="flex-1" />
          <ToolButton icon={maximized ? "Minimize2" : "Maximize2"} label={maximized ? "Restore Panel Size" : "Maximize Panel"} onClick={onToggleMaximize} />
        </div>
        <ul aria-label="Terminals" className="min-h-0 flex-1 overflow-y-auto pb-1">
          {layout.groups.map((group, groupIndex) =>
            group.map((id, index) => (
              <li
                key={id}
                className={`group flex items-center gap-1 px-2 py-0.5 ${id === layout.focused ? "bg-accent text-accent-foreground" : "hover:bg-muted"}`}
              >
                <button
                  type="button"
                  className="flex min-w-0 flex-1 items-center gap-1 text-left"
                  onClick={() => setLayout((current) => focusTerminal(current, id))}
                >
                  {group.length > 1 ? (
                    // A drawn bracket joins the panes of one split tab.
                    <span
                      aria-hidden="true"
                      className="h-5 w-1.5 shrink-0 border-l"
                      style={{
                        borderColor: tabHues[groupIndex % tabHues.length],
                        borderTopWidth: index === 0 ? 1 : 0,
                        borderBottomWidth: index === group.length - 1 ? 1 : 0,
                        marginTop: index === 0 ? 8 : 0,
                        marginBottom: index === group.length - 1 ? 8 : 0,
                      }}
                    />
                  ) : null}
                  <span className="flex shrink-0" style={{ color: tabHues[groupIndex % tabHues.length] }}>
                    <Icon name="Terminal" className="size-3.5" />
                  </span>
                  <span className="truncate">{titleOf(id)}</span>
                </button>
                <button type="button" aria-label={`Kill ${titleOf(id)}`} className="opacity-0 focus:opacity-100 group-hover:opacity-100" onClick={() => void kill(id)}>
                  <Icon name="Trash2" className="size-3" />
                </button>
              </li>
            )),
          )}
        </ul>
      </div>
    </div>
  );

  function onExited(session: Session, code: number | null) {
    exitWaiters.current.get(session.id)?.(code);
    exitWaiters.current.delete(session.id);
    // A shell that exited (`exit`) closes like in VS Code; a command keeps its output on screen.
    if (!session.command) {
      setSessions((current) => (current ?? []).filter((s) => s.id !== session.id));
      setLayout((current) => removeTerminal(current, session.id));
      forgetTerminal(session.id);
    }
  }
});

function SplitPane({ index, children }: { index: number; children: React.ReactNode }) {
  return (
    <>
      {index > 0 ? <Separator className="w-1 bg-border hover:bg-primary/40" /> : null}
      <Panel minSize={120} className="min-w-0">
        {children}
      </Panel>
    </>
  );
}

function ToolButton({ icon, label, onClick, disabled }: { icon: string; label: string; onClick(): void; disabled?: boolean }) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      disabled={disabled}
      className="flex size-6 items-center justify-center rounded text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-30"
      onClick={onClick}
    >
      <Icon name={icon} className="size-3.5" />
    </button>
  );
}

/**
 * Live terminals outlive the panel: leaving KodaForge detaches the xterm element
 * and keeps polling (slowly) in the background; coming back reattaches the very
 * same terminal, so the screen, scrollback and full-screen apps stay intact.
 */
interface LiveTerminal {
  terminal: Terminal;
  fit: FitAddon;
  holder: HTMLDivElement;
  visible: boolean;
  exited: { code: number | null } | null;
  onExit: ((code: number | null) => void) | null;
  onFocus: (() => void) | null;
  dispose(): void;
}

const live = new Map<string, LiveTerminal>();

/** Drop terminals that are gone (killed elsewhere, or exited and dismissed). */
export function forgetTerminal(id: string): void {
  live.get(id)?.dispose();
  live.delete(id);
}

export function liveTerminal(id: string): Terminal | null {
  return live.get(id)?.terminal ?? null;
}

function attachTerminal(sdk: ReturnType<typeof useSdk>, terminalId: string): LiveTerminal {
  const existing = live.get(terminalId);
  if (existing !== undefined) return existing;

  const holder = document.createElement("div");
  holder.style.cssText = "position:absolute;inset:0;padding:4px 8px 0 8px";
  const terminal = new Terminal({
    fontSize: 12,
    fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
    cursorBlink: true,
    scrollback: 10000,
  });
  const fit = new FitAddon();
  terminal.loadAddon(fit);
  terminal.open(holder);
  // ⌘K clears, as in VS Code; everything else goes to the shell.
  terminal.attachCustomKeyEventHandler((event) => {
    if (event.type === "keydown" && event.metaKey && event.key.toLowerCase() === "k") {
      terminal.clear();
      return false;
    }
    return true;
  });
  const entry: LiveTerminal = {
    terminal,
    fit,
    holder,
    visible: false,
    exited: null,
    onExit: null,
    onFocus: null,
    dispose: () => undefined,
  };
  const focusIn = () => entry.onFocus?.();
  holder.addEventListener("focusin", focusIn);
  const input = terminal.onData((data) => {
    void sdk.terminals.input({ terminalId, dataBase64: encodeBase64(data) }).catch(() => undefined);
  });
  const resize = terminal.onResize(({ cols, rows }) => {
    void sdk.terminals.resize({ terminalId, cols, rows }).catch(() => undefined);
  });

  // BB has no push for terminal output: poll by sequence number, fast while text
  // flows, slow when idle, hidden, or while KodaForge is not on screen.
  let stopped = false;
  let nextSeq: number | undefined;
  let delay = 50;
  const poll = async () => {
    while (!stopped) {
      let hadData = false;
      try {
        const out = await sdk.terminals.output(
          nextSeq === undefined ? { terminalId, tailBytes: 512 * 1024 } : { terminalId, sinceSeq: nextSeq },
        );
        for (const chunk of out.chunks) terminal.write(decodeBase64(chunk.dataBase64));
        hadData = out.chunks.length > 0;
        nextSeq = out.nextSeq;
        if (out.status === "exited" || out.status === "disconnected") {
          terminal.write(`\r\n\x1b[2m[${out.status}${out.exitCode === null ? "" : ` with code ${out.exitCode}`}]\x1b[0m\r\n`);
          entry.exited = { code: out.exitCode };
          entry.onExit?.(out.exitCode);
          return;
        }
      } catch {
        // transient; retry with backoff
      }
      delay = nextPollDelay(delay, hadData, entry.visible);
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  };
  void poll();

  entry.dispose = () => {
    stopped = true;
    holder.removeEventListener("focusin", focusIn);
    input.dispose();
    resize.dispose();
    terminal.dispose();
    holder.remove();
  };
  live.set(terminalId, entry);
  return entry;
}

function XtermView({
  terminalId,
  hidden,
  focus,
  onFocus,
  onExit,
}: {
  terminalId: string;
  hidden: boolean;
  focus?: boolean;
  onFocus(): void;
  onExit(code: number | null): void;
}) {
  const sdk = useSdk();
  const host = useRef<HTMLDivElement>(null);
  const entryRef = useRef<LiveTerminal | null>(null);
  const codeTheme = experimental_useCodeTheme();

  useEffect(() => {
    const entry = attachTerminal(sdk, terminalId);
    entryRef.current = entry;
    host.current!.append(entry.holder);
    entry.onFocus = onFocus;
    entry.onExit = onExit;
    // It may have exited while KodaForge was closed.
    if (entry.exited !== null) onExit(entry.exited.code);
    const observer = new ResizeObserver(() => {
      if (entry.visible && host.current?.offsetParent) entry.fit.fit();
    });
    observer.observe(host.current!);
    return () => {
      observer.disconnect();
      entry.visible = false;
      entry.onFocus = null;
      entry.onExit = null;
      // Detach, never dispose: the terminal lives on for the next visit.
      entry.holder.remove();
      entryRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sdk, terminalId]);

  useEffect(() => {
    const entry = entryRef.current;
    if (entry === null) return;
    entry.onFocus = onFocus;
    entry.onExit = onExit;
  });

  useEffect(() => {
    const entry = entryRef.current;
    if (entry === null) return;
    entry.visible = !hidden;
    if (hidden) return;
    requestAnimationFrame(() => {
      entry.fit.fit();
      if (focus) entry.terminal.focus();
    });
  }, [hidden, focus]);

  useEffect(() => {
    const entry = entryRef.current;
    if (entry === null) return;
    const colors = codeTheme.theme?.colors ?? {};
    const pick = (key: string) => colors[`terminal.${key}`];
    entry.terminal.options.theme = {
      background: colors["terminal.background"] ?? codeTheme.theme?.bg,
      foreground: colors["terminal.foreground"] ?? codeTheme.theme?.fg,
      cursor: colors["terminalCursor.foreground"],
      selectionBackground: colors["terminal.selectionBackground"],
      black: pick("ansiBlack"),
      red: pick("ansiRed"),
      green: pick("ansiGreen"),
      yellow: pick("ansiYellow"),
      blue: pick("ansiBlue"),
      magenta: pick("ansiMagenta"),
      cyan: pick("ansiCyan"),
      white: pick("ansiWhite"),
      brightBlack: pick("ansiBrightBlack"),
      brightRed: pick("ansiBrightRed"),
      brightGreen: pick("ansiBrightGreen"),
      brightYellow: pick("ansiBrightYellow"),
      brightBlue: pick("ansiBrightBlue"),
      brightMagenta: pick("ansiBrightMagenta"),
      brightCyan: pick("ansiBrightCyan"),
      brightWhite: pick("ansiBrightWhite"),
    };
  }, [codeTheme.theme]);

  return <div ref={host} className={`absolute inset-0 ${hidden ? "invisible" : ""}`} />;
}
