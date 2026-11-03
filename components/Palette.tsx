// ⌘P Quick Open and ⌘⇧P command palette share one list UI.
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { fuzzyMatch } from "@/lib/tree";

export interface PaletteItem {
  id: string;
  label: string;
  detail?: string;
  /** Text the query matches against; defaults to the label. */
  match?: string;
  icon?: ReactNode;
  run(): void;
}

const LIMIT = 200;

export function Palette({
  placeholder,
  items,
  loading,
  onClose,
}: {
  placeholder: string;
  items: readonly PaletteItem[];
  loading?: boolean;
  onClose(): void;
}) {
  const [query, setQuery] = useState("");
  const [index, setIndex] = useState(0);
  const listRef = useRef<HTMLUListElement>(null);

  const matches = useMemo(() => {
    const q = query.trim();
    if (q === "") return items.slice(0, LIMIT);
    const ranked: { item: PaletteItem; score: number }[] = [];
    for (const item of items) {
      const match = fuzzyMatch(item.match ?? item.label, q);
      if (match !== null) ranked.push({ item, score: match.score });
    }
    ranked.sort((a, b) => b.score - a.score);
    return ranked.slice(0, LIMIT).map((entry) => entry.item);
  }, [items, query]);

  useEffect(() => {
    setIndex(0);
  }, [query]);
  useEffect(() => {
    listRef.current?.children[index]?.scrollIntoView({ block: "nearest" });
  }, [index]);

  const choose = (item: PaletteItem | undefined) => {
    if (item === undefined) return;
    onClose();
    item.run();
  };

  return (
    <div className="absolute inset-0 z-50 flex justify-center bg-black/20 pt-12" onMouseDown={onClose}>
      <div
        role="dialog"
        aria-label={placeholder}
        className="flex h-fit max-h-[60%] w-[min(600px,90%)] flex-col overflow-hidden rounded-lg border border-border bg-popover text-popover-foreground shadow-xl"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <input
          autoFocus
          value={query}
          placeholder={placeholder}
          aria-label={placeholder}
          className="border-b border-border bg-transparent px-3 py-2 text-sm outline-none"
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Escape") onClose();
            else if (event.key === "ArrowDown") setIndex((i) => Math.min(i + 1, matches.length - 1));
            else if (event.key === "ArrowUp") setIndex((i) => Math.max(i - 1, 0));
            else if (event.key === "Enter") choose(matches[index]);
            else return;
            event.preventDefault();
            event.stopPropagation();
          }}
        />
        <ul ref={listRef} role="listbox" className="min-h-0 overflow-y-auto py-1 text-sm">
          {matches.map((item, i) => (
            <li
              key={item.id}
              role="option"
              aria-selected={i === index}
              className={`flex cursor-pointer items-baseline gap-2 px-3 py-1 ${i === index ? "bg-accent text-accent-foreground" : ""}`}
              onMouseEnter={() => setIndex(i)}
              onClick={() => choose(item)}
            >
              {item.icon ? <span className="flex self-center">{item.icon}</span> : null}
              <span className="truncate">{item.label}</span>
              {item.detail ? <span className="truncate text-xs text-muted-foreground">{item.detail}</span> : null}
            </li>
          ))}
          {matches.length === 0 ? (
            <li className="px-3 py-2 text-muted-foreground">{loading ? "Loading…" : "No matches"}</li>
          ) : null}
        </ul>
      </div>
    </div>
  );
}

/** A one-line prompt in the palette's place: new file names, renames, commit messages. */
export function InputBox({
  title,
  initial,
  placeholder,
  onSubmit,
  onCancel,
}: {
  title: string;
  initial: string;
  placeholder?: string;
  onSubmit(value: string): void;
  onCancel(): void;
}) {
  const [value, setValue] = useState(initial);
  return (
    <div className="absolute inset-0 z-50 flex justify-center bg-black/20 pt-12" onMouseDown={onCancel}>
      <div
        role="dialog"
        aria-label={title}
        className="h-fit w-[min(600px,90%)] overflow-hidden rounded-lg border border-border bg-popover text-popover-foreground shadow-xl"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="px-3 pt-2 text-xs text-muted-foreground">{title}</div>
        <input
          autoFocus
          value={value}
          placeholder={placeholder}
          aria-label={title}
          className="w-full bg-transparent px-3 py-2 text-sm outline-none"
          onFocus={(event) => {
            // Select the name without its extension, as VS Code does on rename.
            const dot = value.lastIndexOf(".");
            event.target.setSelectionRange(0, dot > 0 ? dot : value.length);
          }}
          onChange={(event) => setValue(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Escape") onCancel();
            else if (event.key === "Enter") onSubmit(value);
            else return;
            event.preventDefault();
            event.stopPropagation();
          }}
        />
      </div>
    </div>
  );
}
