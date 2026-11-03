// ⌘P: one box for everything. Files and commands match instantly; symbols (from
// the language servers) and text in files arrive a moment later. Prefixes narrow it:
// ">" commands, "#" symbols, "%" text, ":12" a line in the open file.
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { fuzzyMatch } from "@/lib/tree";
import { parseQuery, symbolKindName } from "@/lib/everything";
import { Icon } from "@/components/ui/icon";
import { FileIcon } from "./FileIcon";
import type { PaletteItem } from "./Palette";
import type { WorkspaceSymbol } from "./lsp";

export interface TextHit {
  path: string;
  line: number;
  column: number;
  length: number;
  preview: string;
}

interface Row {
  id: string;
  section: string;
  icon: ReactNode;
  label: string;
  detail?: string;
  run(): void;
}

const FILES = 40;
const COMMANDS = 8;
const ASYNC = 25;

function fuzzy<T>(items: readonly T[], text: string, key: (item: T) => string, limit: number): T[] {
  if (text === "") return items.slice(0, limit);
  const scored: { item: T; score: number }[] = [];
  for (const item of items) {
    const match = fuzzyMatch(key(item), text);
    if (match !== null) scored.push({ item, score: match.score });
  }
  return scored.sort((a, b) => b.score - a.score).slice(0, limit).map((s) => s.item);
}

export function SearchEverywhere({
  files,
  commands,
  symbols,
  symbolsReady,
  searchText,
  onOpenFile,
  onOpenAt,
  onGotoLine,
  onClose,
}: {
  files: string[] | null;
  commands: PaletteItem[];
  symbols(query: string): Promise<WorkspaceSymbol[]>;
  /** False until a language server runs; servers start when a file of their language opens. */
  symbolsReady: boolean;
  searchText(query: string): Promise<TextHit[]>;
  onOpenFile(path: string): void;
  onOpenAt(path: string, line: number, column: number, length: number): void;
  onGotoLine(line: number, column: number): void;
  onClose(): void;
}) {
  const [raw, setRaw] = useState("");
  const [index, setIndex] = useState(0);
  const [found, setFound] = useState<{ symbols: WorkspaceSymbol[]; text: TextHit[]; busy: boolean }>({ symbols: [], text: [], busy: false });
  const listRef = useRef<HTMLUListElement>(null);
  const query = parseQuery(raw);

  // Symbols and text are slower: debounce, and drop answers to queries no longer typed.
  const sequence = useRef(0);
  useEffect(() => {
    const id = ++sequence.current;
    const wantSymbols = (query.mode === "all" || query.mode === "symbols") && query.text.length >= 2;
    const wantText = (query.mode === "all" || query.mode === "text") && query.text.length >= 3;
    if (!wantSymbols && !wantText) {
      setFound({ symbols: [], text: [], busy: false });
      return;
    }
    setFound((current) => ({ ...current, busy: true }));
    const timer = setTimeout(() => {
      void Promise.all([
        wantSymbols ? symbols(query.text).catch(() => []) : Promise.resolve([]),
        wantText ? searchText(query.text).catch(() => []) : Promise.resolve([]),
      ]).then(([s, t]) => {
        if (id === sequence.current) setFound({ symbols: s.slice(0, ASYNC), text: t.slice(0, ASYNC), busy: false });
      });
    }, 220);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [raw]);

  const rows = useMemo<Row[]>(() => {
    const out: Row[] = [];
    if (query.mode === "line") {
      if (query.line !== undefined) {
        out.push({
          id: "line",
          section: "Go to line",
          icon: <Icon name="ArrowRight" className="size-3.5" />,
          label: `Line ${query.line}${query.column && query.column > 1 ? `, column ${query.column}` : ""}`,
          detail: "in the active file",
          run: () => onGotoLine(query.line!, query.column ?? 1),
        });
      }
      return out;
    }
    if (query.mode === "all") {
      for (const path of fuzzy(files ?? [], query.text, (p) => p, FILES)) {
        const slash = path.lastIndexOf("/");
        out.push({ id: `f:${path}`, section: "Files", icon: <FileIcon path={path} className="size-4" />, label: path.slice(slash + 1), detail: slash === -1 ? "" : path.slice(0, slash), run: () => onOpenFile(path) });
      }
    }
    if (query.mode === "all" || query.mode === "symbols") {
      for (const s of found.symbols) {
        out.push({
          id: `s:${s.path}:${s.line}:${s.name}`,
          section: "Symbols",
          icon: <Icon name="Code" className="size-3.5 text-muted-foreground" />,
          label: s.name,
          detail: `${symbolKindName(s.kind)}${s.container ? ` in ${s.container}` : ""} · ${s.path}:${s.line}`,
          run: () => onOpenAt(s.path, s.line, s.column, s.name.length),
        });
      }
    }
    if (query.mode === "all" || query.mode === "text") {
      for (const hit of found.text) {
        out.push({
          id: `t:${hit.path}:${hit.line}:${hit.column}`,
          section: "Text in files",
          icon: <FileIcon path={hit.path} className="size-4" />,
          label: hit.preview.trim(),
          detail: `${hit.path}:${hit.line}`,
          run: () => onOpenAt(hit.path, hit.line, hit.column, hit.length),
        });
      }
    }
    if (query.mode === "all" || query.mode === "commands") {
      for (const command of fuzzy(commands, query.text, (c) => c.label, query.mode === "commands" ? 200 : query.text ? COMMANDS : 0)) {
        out.push({ id: `c:${command.id}`, section: "Commands", icon: <Icon name="ChevronRight" className="size-3.5 text-muted-foreground" />, label: command.label, run: command.run });
      }
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [raw, files, commands, found]);

  useEffect(() => {
    setIndex(0);
  }, [raw]);
  useEffect(() => {
    listRef.current?.querySelector(`[data-index="${index}"]`)?.scrollIntoView({ block: "nearest" });
  }, [index]);

  const choose = (row: Row | undefined) => {
    if (row === undefined) return;
    onClose();
    row.run();
  };

  const empty =
    query.mode === "line"
      ? "Type a line number, like :42 or :42:7"
      : files === null
        ? "Loading…"
        : found.busy
          ? "Searching…"
          : query.mode === "symbols" && !symbolsReady
            ? "Symbols come from the language servers. Open a Python or TypeScript file to start one."
            : "Nothing found";

  return (
    <div className="absolute inset-0 z-50 flex justify-center bg-black/20 pt-12" onMouseDown={onClose}>
      <div
        role="dialog"
        aria-label="Search everything"
        className="flex h-fit max-h-[70%] w-[min(720px,92%)] flex-col overflow-hidden rounded-lg border border-border bg-popover text-popover-foreground shadow-xl"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="flex items-center gap-2 border-b border-border px-3">
          <Icon name="Search" className="size-4 shrink-0 text-muted-foreground" />
          <input
            autoFocus
            value={raw}
            placeholder="Search files, symbols, text and commands"
            aria-label="Search everything"
            className="min-w-0 flex-1 bg-transparent py-2.5 text-sm outline-none"
            onChange={(event) => setRaw(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Escape") onClose();
              else if (event.key === "ArrowDown") setIndex((i) => Math.min(i + 1, rows.length - 1));
              else if (event.key === "ArrowUp") setIndex((i) => Math.max(i - 1, 0));
              else if (event.key === "Enter") choose(rows[index]);
              else return;
              event.preventDefault();
              event.stopPropagation();
            }}
          />
          {found.busy ? <span className="text-[11px] text-muted-foreground">searching…</span> : null}
        </div>
        {raw === "" ? (
          <div className="flex flex-wrap gap-x-4 gap-y-1 border-b border-border px-3 py-1.5 text-[11px] text-muted-foreground">
            {[
              [">", "commands"],
              ["#", "symbols"],
              ["%", "text in files"],
              [":", "go to line"],
            ].map(([key, label]) => (
              <button key={key} type="button" className="hover:text-foreground" onClick={() => setRaw(key!)}>
                <kbd className="mr-1 rounded border border-border px-1 font-mono">{key}</kbd>
                {label}
              </button>
            ))}
          </div>
        ) : null}
        <ul ref={listRef} role="listbox" aria-label="Results" className="min-h-0 overflow-y-auto py-1 text-sm">
          {rows.map((row, i) => (
            <li key={row.id} role="presentation">
              {i === 0 || rows[i - 1]!.section !== row.section ? (
                <div className="px-3 pb-0.5 pt-2 text-[11px] font-semibold uppercase text-muted-foreground">{row.section}</div>
              ) : null}
              <div
                role="option"
                aria-selected={i === index}
                data-index={i}
                className={`flex cursor-pointer items-center gap-2 px-3 py-1 ${i === index ? "bg-accent text-accent-foreground" : ""}`}
                onMouseEnter={() => setIndex(i)}
                onClick={() => choose(row)}
              >
                <span className="flex w-4 shrink-0 justify-center">{row.icon}</span>
                <span className={`truncate ${row.section === "Text in files" ? "font-mono text-xs" : ""}`}>{row.label}</span>
                {row.detail ? <span className="ml-auto max-w-[50%] shrink-0 truncate pl-2 text-xs text-muted-foreground">{row.detail}</span> : null}
              </div>
            </li>
          ))}
          {rows.length === 0 ? <li className="px-3 py-2 text-muted-foreground">{empty}</li> : null}
        </ul>
      </div>
    </div>
  );
}
