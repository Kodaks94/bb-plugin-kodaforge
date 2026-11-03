// Phase 3: search across files, and replace with a preview of every change.
import { useEffect, useMemo, useRef, useState } from "react";
import { useRpc } from "@get-bb/plugin-sdk/app";
import type { rpcContract, Scope } from "../server";
import { Icon } from "@/components/ui/icon";
import { hueForFile } from "@/lib/file-colors";
import { useHues } from "./colors";

type SearchResult = { files: { path: string; sha256: string; matches: Match[] }[]; matchCount: number; searchedFiles: number; truncated: boolean };
type Match = { offset: number; length: number; line: number; column: number; preview: string; previewStart: number; replacement?: string };

const key = (path: string, offset: number) => `${path}\u0000${offset}`;

export function SearchView({
  scope,
  onOpenAt,
  log,
}: {
  scope: Scope;
  onOpenAt(path: string, line: number, column: number, length: number): void;
  log(line: string): void;
}) {
  const rpc = useRpc<typeof rpcContract>();
  const hues = useHues();
  const [query, setQuery] = useState("");
  const [replacement, setReplacement] = useState("");
  const [replacing, setReplacing] = useState(false);
  const [regex, setRegex] = useState(false);
  const [matchCase, setMatchCase] = useState(false);
  const [wholeWord, setWholeWord] = useState(false);
  const [include, setInclude] = useState("");
  const [exclude, setExclude] = useState("");
  const [showFilters, setShowFilters] = useState(false);
  const [result, setResult] = useState<SearchResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [excluded, setExcluded] = useState<Set<string>>(new Set());
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [rerun, setRerun] = useState(0);
  const sequence = useRef(0);

  const queryObject = useMemo(() => ({ query, regex, matchCase, wholeWord }), [query, regex, matchCase, wholeWord]);

  useEffect(() => {
    if (query === "") {
      setResult(null);
      setError(null);
      return;
    }
    const id = ++sequence.current;
    const timer = setTimeout(() => {
      setBusy(true);
      rpc
        .call("search", {
          scope,
          options: { query: queryObject, include, exclude, ...(replacing ? { replacement } : {}) },
        })
        .then(
          (next) => {
            if (id !== sequence.current) return;
            setResult(next);
            setError(null);
            setExcluded(new Set());
          },
          (cause: Error) => id === sequence.current && setError(cause.message.replace(/^.*?: /, "")),
        )
        .finally(() => id === sequence.current && setBusy(false));
    }, 300);
    return () => clearTimeout(timer);
  }, [rpc, scope, queryObject, include, exclude, replacing, replacement, rerun]);

  const selected = useMemo(() => {
    if (result === null) return [];
    return result.files
      .map((file) => ({ ...file, offsets: file.matches.filter((m) => !excluded.has(key(file.path, m.offset))).map((m) => m.offset) }))
      .filter((file) => file.offsets.length > 0);
  }, [result, excluded]);
  const selectedCount = selected.reduce((sum, file) => sum + file.offsets.length, 0);

  const toggleMatch = (path: string, offset: number) =>
    setExcluded((current) => {
      const next = new Set(current);
      const k = key(path, offset);
      if (!next.delete(k)) next.add(k);
      return next;
    });
  const toggleFile = (file: { path: string; matches: Match[] }, include: boolean) =>
    setExcluded((current) => {
      const next = new Set(current);
      for (const match of file.matches) {
        if (include) next.delete(key(file.path, match.offset));
        else next.add(key(file.path, match.offset));
      }
      return next;
    });

  async function replaceAll() {
    if (selectedCount === 0) return;
    const files = selected.length;
    if (!window.confirm(`Replace ${selectedCount} occurrence${selectedCount === 1 ? "" : "s"} in ${files} file${files === 1 ? "" : "s"} with "${replacement}"?`)) return;
    setBusy(true);
    try {
      const { results } = await rpc.call("replaceApply", {
        scope,
        query: queryObject,
        replacement,
        files: selected.map(({ path, sha256, offsets }) => ({ path, sha256, offsets })),
      });
      const done = results.filter((r) => r.outcome === "replaced");
      log(`Replaced ${done.reduce((n, r) => n + r.count, 0)} occurrences in ${done.length} files`);
      for (const r of results) if (r.outcome !== "replaced") log(`Skipped ${r.path}: ${r.message ?? r.outcome}`);
      if (done.length < results.length) window.alert(`${results.length - done.length} file(s) were skipped; see Output.`);
    } catch (cause) {
      log(`Replace failed: ${(cause as Error).message}`);
    } finally {
      setBusy(false);
      setRerun((n) => n + 1);
    }
  }

  return (
    <div className="flex h-full min-h-0 flex-col text-[13px]">
      <div className="flex shrink-0 flex-col gap-1.5 px-2 pb-2">
        <div className="flex items-start gap-1">
          <button
            type="button"
            aria-label={replacing ? "Hide replace" : "Show replace"}
            aria-expanded={replacing}
            className="mt-1 flex size-5 items-center justify-center rounded text-muted-foreground hover:bg-muted"
            onClick={() => setReplacing((value) => !value)}
          >
            <Icon name={replacing ? "ChevronDown" : "ChevronRight"} className="size-3.5" />
          </button>
          <div className="flex min-w-0 flex-1 flex-col gap-1">
            <div className="flex items-center rounded border border-border bg-background focus-within:border-primary">
              <input
                autoFocus
                value={query}
                aria-label="Search"
                placeholder="Search"
                className="min-w-0 flex-1 bg-transparent px-2 py-1 outline-none"
                onChange={(event) => setQuery(event.target.value)}
              />
              <Toggle label="Match Case" text="Aa" value={matchCase} onChange={setMatchCase} />
              <Toggle label="Match Whole Word" text="ab" underline value={wholeWord} onChange={setWholeWord} />
              <Toggle label="Use Regular Expression" text=".*" value={regex} onChange={setRegex} />
            </div>
            {replacing ? (
              <div className="flex items-center gap-1">
                <input
                  value={replacement}
                  aria-label="Replace"
                  placeholder={regex ? "Replace ($1, $<name> allowed)" : "Replace"}
                  className="min-w-0 flex-1 rounded border border-border bg-background px-2 py-1 outline-none focus:border-primary"
                  onChange={(event) => setReplacement(event.target.value)}
                />
                <button
                  type="button"
                  title={`Replace ${selectedCount} selected`}
                  aria-label="Replace All"
                  disabled={busy || selectedCount === 0}
                  className="rounded border border-border px-2 py-1 text-xs hover:bg-muted disabled:opacity-40"
                  onClick={() => void replaceAll()}
                >
                  Replace All
                </button>
              </div>
            ) : null}
          </div>
        </div>
        <button
          type="button"
          className="self-end text-[11px] text-muted-foreground hover:text-foreground"
          onClick={() => setShowFilters((value) => !value)}
        >
          {showFilters ? "Hide" : "Show"} file filters
        </button>
        {showFilters ? (
          <>
            <input
              value={include}
              aria-label="Files to include"
              placeholder="files to include (e.g. src/**, *.ts)"
              className="rounded border border-border bg-background px-2 py-1 text-xs outline-none focus:border-primary"
              onChange={(event) => setInclude(event.target.value)}
            />
            <input
              value={exclude}
              aria-label="Files to exclude"
              placeholder="files to exclude"
              className="rounded border border-border bg-background px-2 py-1 text-xs outline-none focus:border-primary"
              onChange={(event) => setExclude(event.target.value)}
            />
          </>
        ) : null}
        <div className="text-[11px] text-muted-foreground" role="status">
          {error !== null ? (
            <span className="text-destructive">{error}</span>
          ) : busy ? (
            "Searching…"
          ) : result === null ? null : (
            <>
              {result.matchCount} result{result.matchCount === 1 ? "" : "s"} in {result.files.length} file
              {result.files.length === 1 ? "" : "s"}
              {result.truncated ? " (stopped early: refine the search)" : ""}
              {replacing && result.matchCount > 0 ? ` · ${selectedCount} selected to replace` : ""}
            </>
          )}
        </div>
      </div>
      <ul className="min-h-0 flex-1 overflow-y-auto pb-2" aria-label="Search results">
        {result?.files.map((file) => {
          const isCollapsed = collapsed.has(file.path);
          const kept = file.matches.filter((m) => !excluded.has(key(file.path, m.offset))).length;
          const slash = file.path.lastIndexOf("/");
          return (
            <li key={file.path}>
              <div className="flex items-center gap-1 px-2 py-0.5 hover:bg-muted">
                <button
                  type="button"
                  aria-label={isCollapsed ? `Expand ${file.path}` : `Collapse ${file.path}`}
                  className="flex size-4 items-center justify-center"
                  onClick={() =>
                    setCollapsed((current) => {
                      const next = new Set(current);
                      if (!next.delete(file.path)) next.add(file.path);
                      return next;
                    })
                  }
                >
                  <Icon name={isCollapsed ? "ChevronRight" : "ChevronDown"} className="size-3.5" />
                </button>
                {replacing ? (
                  <input
                    type="checkbox"
                    aria-label={`Replace in ${file.path}`}
                    checked={kept > 0}
                    ref={(element) => {
                      if (element) element.indeterminate = kept > 0 && kept < file.matches.length;
                    }}
                    onChange={(event) => toggleFile(file, event.target.checked)}
                  />
                ) : null}
                <span className="flex shrink-0" style={{ color: hues[hueForFile(file.path)] }}>
                  <Icon name="File" className="size-3.5" />
                </span>
                <span className="truncate" title={file.path}>
                  {file.path.slice(slash + 1)}
                </span>
                <span className="truncate text-xs text-muted-foreground">{slash === -1 ? "" : file.path.slice(0, slash)}</span>
                <span className="ml-auto rounded-full bg-muted px-1.5 text-[11px]">{file.matches.length}</span>
              </div>
              {isCollapsed ? null : (
                <ul>
                  {file.matches.map((match) => {
                    const on = !excluded.has(key(file.path, match.offset));
                    const before = match.preview.slice(0, match.previewStart).trimStart();
                    const hit = match.preview.slice(match.previewStart, match.previewStart + match.length);
                    const after = match.preview.slice(match.previewStart + match.length);
                    return (
                      <li key={match.offset} className="flex items-center gap-1 py-0.5 pl-7 pr-2 hover:bg-muted">
                        {replacing ? (
                          <input
                            type="checkbox"
                            aria-label={`Replace line ${match.line}`}
                            checked={on}
                            onChange={() => toggleMatch(file.path, match.offset)}
                          />
                        ) : null}
                        <button
                          type="button"
                          title={`Line ${match.line}, column ${match.column}`}
                          className="min-w-0 flex-1 truncate text-left font-mono text-xs"
                          onClick={() => onOpenAt(file.path, match.line, match.column, match.length)}
                        >
                          <span className="text-muted-foreground">{before}</span>
                          {replacing && match.replacement !== undefined ? (
                            <>
                              <span className="bg-destructive/20 line-through">{hit}</span>
                              <span className={on ? "bg-primary/25" : "opacity-50"}>{match.replacement}</span>
                            </>
                          ) : (
                            <span className="rounded-sm bg-primary/25">{hit}</span>
                          )}
                          <span className="text-muted-foreground">{after}</span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function Toggle({
  label,
  text,
  value,
  onChange,
  underline,
}: {
  label: string;
  text: string;
  value: boolean;
  onChange(value: boolean): void;
  underline?: boolean;
}) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      aria-pressed={value}
      className={`mx-0.5 rounded px-1 font-mono text-[11px] ${value ? "bg-primary/25 text-foreground" : "text-muted-foreground hover:bg-muted"} ${underline ? "underline" : ""}`}
      onClick={() => onChange(!value)}
    >
      {text}
    </button>
  );
}
