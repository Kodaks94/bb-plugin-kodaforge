// Run and Debug: start a Python file under debugpy, step through it, and inspect
// variables, the call stack and breakpoints. The Debug Console is below.
import { useEffect, useRef, useState } from "react";
import { Icon } from "@/components/ui/icon";
import { useHues } from "./colors";
import { FileIcon } from "./FileIcon";
import type { Debugger, Variable } from "./debugger";

export function DebugToolbar({ debug }: { debug: Debugger }) {
  const hues = useHues();
  if (!debug.active) return null;
  const paused = debug.status === "stopped";
  const buttons: { icon: string; label: string; hue: string; run(): void; disabled?: boolean }[] = [
    paused
      ? { icon: "Play", label: "Continue (F5)", hue: hues.green, run: () => void debug.step("continue") }
      : { icon: "Pause", label: "Pause (F6)", hue: hues.yellow, run: () => void debug.step("pause") },
    { icon: "ArrowRight", label: "Step Over (F10)", hue: hues.blue, run: () => void debug.step("next"), disabled: !paused },
    { icon: "ArrowDown", label: "Step Into (F11)", hue: hues.blue, run: () => void debug.step("stepIn"), disabled: !paused },
    { icon: "ArrowUp", label: "Step Out (⇧F11)", hue: hues.blue, run: () => void debug.step("stepOut"), disabled: !paused },
    { icon: "RotateCcw", label: "Restart (⇧⌘F5)", hue: hues.green, run: () => void debug.restart() },
    { icon: "Square", label: "Stop (⇧F5)", hue: hues.red, run: () => void debug.stop() },
  ];
  return (
    <div role="toolbar" aria-label="Debug" className="flex items-center gap-0.5 rounded-md border border-border bg-background px-1 py-0.5 shadow-[0_2px_10px_rgba(0,0,0,0.12)]">
      {buttons.map((button) => (
        <button
          key={button.label}
          type="button"
          title={button.label}
          aria-label={button.label}
          disabled={button.disabled}
          className="flex size-6 items-center justify-center rounded hover:bg-muted disabled:opacity-30"
          onClick={button.run}
        >
          <span className="flex" style={{ color: button.hue }}>
            <Icon name={button.icon} className="size-3.5" />
          </span>
        </button>
      ))}
    </div>
  );
}

export function DebugView({
  debug,
  activePath,
  onOpenAt,
  onStart,
}: {
  debug: Debugger;
  activePath: string | null;
  onOpenAt(path: string, line: number, column: number): void;
  /** Saves the file and opens the Debug Console before launching. */
  onStart?(path: string, args: string): void;
}) {
  const hues = useHues();
  const [target, setTarget] = useState(activePath?.endsWith(".py") ? activePath : (debug.program?.path ?? ""));
  const [args, setArgs] = useState(debug.program?.args ?? "");
  useEffect(() => {
    if (!debug.active && activePath?.endsWith(".py")) setTarget(activePath);
  }, [activePath, debug.active]);

  const breakpoints = Object.entries(debug.breakpoints).flatMap(([path, lines]) => lines.map((line) => ({ path, line })));
  const where = debug.frames[0];

  return (
    <div className="flex h-full min-h-0 flex-col text-[13px]">
      {debug.active ? (
        <div className="shrink-0 space-y-1.5 px-3 pb-2">
          <DebugToolbar debug={debug} />
          <p className="text-xs" role="status">
            {debug.status === "stopped" && where ? (
              <span style={{ color: debug.stopped?.reason === "exception" ? hues.red : hues.yellow }}>
                Paused ({debug.stopped?.reason}) at {where.path?.split("/").pop() ?? where.name}:{where.line}
              </span>
            ) : (
              <span style={{ color: hues.green }}>{debug.status === "starting" ? "Starting debugpy…" : `Running ${debug.program?.path}`}</span>
            )}
          </p>
        </div>
      ) : (
        <div className="shrink-0 space-y-1.5 px-3 pb-3">
          <label className="block text-xs text-muted-foreground" htmlFor="kf-debug-target">
            Python file
          </label>
          <input
            id="kf-debug-target"
            value={target}
            placeholder="path/to/script.py"
            className="w-full rounded border border-border bg-background px-2 py-1 text-xs outline-none focus:border-primary"
            onChange={(event) => setTarget(event.target.value)}
          />
          <label className="block text-xs text-muted-foreground" htmlFor="kf-debug-args">
            Arguments
          </label>
          <input
            id="kf-debug-args"
            value={args}
            placeholder="optional"
            className="w-full rounded border border-border bg-background px-2 py-1 text-xs outline-none focus:border-primary"
            onChange={(event) => setArgs(event.target.value)}
          />
          <button
            type="button"
            disabled={!/\.py$/.test(target.trim())}
            className="flex w-full items-center justify-center gap-1.5 rounded-md px-2 py-1.5 text-xs font-medium disabled:opacity-40"
            style={{ background: hues.green, color: "var(--background)" }}
            onClick={() => (onStart ? onStart(target.trim(), args) : void debug.start(target.trim(), args))}
          >
            <Icon name="Play" className="size-3.5" />
            Start Debugging (F5)
          </button>
          <p className="text-[11px] text-muted-foreground">
            Uses debugpy from the project's .venv or PATH. JS/TS debugging needs vscode-js-debug, which is not bundled yet.
          </p>
        </div>
      )}
      <div className="min-h-0 flex-1 overflow-y-auto pb-2">
        <Section title="Variables">
          {debug.scopes.length === 0 ? (
            <Empty>{debug.status === "stopped" ? "No variables here." : "Pause on a breakpoint to see variables."}</Empty>
          ) : (
            debug.scopes.map((scope) => (
              <VariableTree key={scope.variablesReference} debug={debug} name={scope.name} reference={scope.variablesReference} depth={0} startOpen={!scope.expensive} />
            ))
          )}
        </Section>
        <Section title="Call Stack">
          {debug.frames.length === 0 ? (
            <Empty>{debug.active ? "Running…" : "Not debugging."}</Empty>
          ) : (
            debug.frames.map((frame) => (
              <button
                key={frame.id}
                type="button"
                className={`flex w-full items-center gap-2 px-3 py-0.5 text-left hover:bg-muted ${frame.id === debug.frame?.id ? "bg-accent text-accent-foreground" : ""}`}
                onClick={() => {
                  void debug.selectFrame(frame.id);
                  if (frame.path) onOpenAt(frame.path, frame.line, frame.column);
                }}
              >
                <span className="min-w-0 flex-1 truncate font-mono text-xs">{frame.name}</span>
                <span className="shrink-0 text-[11px] text-muted-foreground">
                  {frame.path ? `${frame.path.split("/").pop()}:${frame.line}` : "library code"}
                </span>
              </button>
            ))
          )}
        </Section>
        <Section
          title="Breakpoints"
          action={breakpoints.length > 0 ? { label: "Remove all breakpoints", icon: "Trash2", run: debug.clearBreakpoints } : undefined}
        >
          {breakpoints.length === 0 ? (
            <Empty>Click left of a line number (or press F9) to add one.</Empty>
          ) : (
            breakpoints.map(({ path, line }) => (
              <div key={`${path}:${line}`} className="group flex items-center gap-2 px-3 py-0.5 hover:bg-muted">
                <span className="size-2.5 shrink-0 rounded-full" style={{ background: hues.red }} />
                <button type="button" className="flex min-w-0 flex-1 items-center gap-1.5 text-left" onClick={() => onOpenAt(path, line, 1)}>
                  <FileIcon path={path} className="size-3.5" />
                  <span className="truncate">{path.split("/").pop()}</span>
                  <span className="text-[11px] text-muted-foreground">{line}</span>
                </button>
                <button
                  type="button"
                  aria-label={`Remove breakpoint ${path}:${line}`}
                  className="opacity-0 focus:opacity-100 group-hover:opacity-100"
                  onClick={() => debug.toggleBreakpoint(path, line)}
                >
                  <Icon name="X" className="size-3" />
                </button>
              </div>
            ))
          )}
        </Section>
      </div>
    </div>
  );
}

function VariableTree({ debug, name, reference, depth, startOpen, value, type }: { debug: Debugger; name: string; reference: number; depth: number; startOpen?: boolean; value?: string; type?: string }) {
  const hues = useHues();
  const [open, setOpen] = useState(startOpen ?? false);
  const children: Variable[] | undefined = debug.variables[reference];
  useEffect(() => {
    if (open && reference > 0 && children === undefined) void debug.loadVariables(reference);
  }, [open, reference, children, debug]);
  const expandable = reference > 0;
  return (
    <div>
      <button
        type="button"
        aria-expanded={expandable ? open : undefined}
        className="flex w-full items-center gap-1 py-0.5 pr-3 text-left font-mono text-xs hover:bg-muted"
        style={{ paddingLeft: 12 + depth * 12 }}
        onClick={() => expandable && setOpen((value) => !value)}
      >
        <span className="w-3.5 shrink-0 text-muted-foreground">{expandable ? <Icon name={open ? "ChevronDown" : "ChevronRight"} className="size-3.5" /> : null}</span>
        <span style={{ color: depth === 0 && value === undefined ? undefined : hues.magenta }} className={depth === 0 && value === undefined ? "font-sans font-semibold" : ""}>
          {name}
        </span>
        {value !== undefined ? (
          <>
            <span className="text-muted-foreground">=</span>
            <span className="truncate" style={{ color: valueHue(value, type, hues) }} title={type ? `${type}: ${value}` : value}>
              {value}
            </span>
          </>
        ) : null}
      </button>
      {open && children
        ? children.map((child) => (
            <VariableTree key={`${child.name}:${child.variablesReference}`} debug={debug} name={child.name} reference={child.variablesReference} depth={depth + 1} value={child.value} type={child.type} />
          ))
        : null}
    </div>
  );
}

function valueHue(value: string, type: string | undefined, hues: ReturnType<typeof useHues>): string | undefined {
  if (type === "str" || /^['"]/.test(value)) return hues.orange;
  if (type === "int" || type === "float" || /^-?\d/.test(value)) return hues.green;
  if (value === "True" || value === "False" || value === "None") return hues.blue;
  return undefined;
}

function Section({ title, action, children }: { title: string; action?: { label: string; icon: string; run(): void }; children: React.ReactNode }) {
  return (
    <section className="pb-2">
      <div className="flex items-center px-3 py-1 text-[11px] font-semibold uppercase text-muted-foreground">
        <span className="flex-1">{title}</span>
        {action ? (
          <button type="button" title={action.label} aria-label={action.label} className="rounded p-0.5 hover:bg-muted hover:text-foreground" onClick={action.run}>
            <Icon name={action.icon} className="size-3.5" />
          </button>
        ) : null}
      </div>
      {children}
    </section>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return <p className="px-3 py-0.5 text-xs text-muted-foreground">{children}</p>;
}

export function DebugConsole({ debug }: { debug: Debugger }) {
  const hues = useHues();
  const [input, setInput] = useState("");
  const [history, setHistory] = useState<string[]>([]);
  const [cursor, setCursor] = useState(-1);
  const end = useRef<HTMLDivElement>(null);
  // Block body on purpose: Chromium's scrollIntoView now returns a Promise, and an
  // effect must return nothing or a cleanup function.
  useEffect(() => {
    end.current?.scrollIntoView({ block: "end" });
  }, [debug.consoleLines.length]);
  const color = (category: string) =>
    category === "stderr" || category === "error" ? hues.red : category === "console" ? hues.muted : category === "input" ? hues.blue : category === "result" ? hues.green : undefined;
  return (
    <div className="flex h-full flex-col font-mono text-xs">
      <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-1">
        {debug.consoleLines.map((line, i) => (
          <div key={i} className="whitespace-pre-wrap break-words" style={{ color: color(line.category) }}>
            {line.text}
          </div>
        ))}
        <div ref={end} />
      </div>
      <div className="flex shrink-0 items-center gap-1 border-t border-border px-3 py-1">
        <span style={{ color: hues.blue }} className="flex">
          <Icon name="ChevronRight" className="size-3.5" />
        </span>
        <input
          value={input}
          aria-label="Evaluate expression"
          placeholder={debug.status === "stopped" ? "Evaluate in the selected frame" : "Pause the program to evaluate expressions"}
          className="min-w-0 flex-1 bg-transparent outline-none"
          onChange={(event) => setInput(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && input.trim() !== "") {
              void debug.evaluate(input);
              setHistory((h) => [input, ...h].slice(0, 50));
              setCursor(-1);
              setInput("");
            } else if (event.key === "ArrowUp" && history.length > 0) {
              const next = Math.min(cursor + 1, history.length - 1);
              setCursor(next);
              setInput(history[next]!);
            } else if (event.key === "ArrowDown") {
              const next = cursor - 1;
              setCursor(next);
              setInput(next < 0 ? "" : history[next]!);
            } else return;
            event.preventDefault();
          }}
        />
        <button type="button" title="Clear console" aria-label="Clear console" className="text-muted-foreground hover:text-foreground" onClick={debug.clearConsole}>
          <Icon name="Trash2" className="size-3.5" />
        </button>
      </div>
    </div>
  );
}
