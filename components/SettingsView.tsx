// Settings: VS Code's most-changed preferences, grouped and searchable. Changes apply
// at once to every open workspace and are remembered in this browser.
import { useState } from "react";
import { CHOICES, DEFAULT_SETTINGS, RANGES, type Settings } from "@/lib/settings";
import { Icon } from "@/components/ui/icon";
import { useSettings } from "./use-settings";

type Row = { key: keyof Settings; label: string; detail: string; labels?: Record<string, string> };

const GROUPS: { title: string; icon: string; rows: Row[] }[] = [
  {
    title: "Files",
    icon: "FileText",
    rows: [
      {
        key: "autoSave",
        label: "Auto save",
        detail: "Save edited files for you: after a pause in typing, or when you click away from the editor.",
        labels: { off: "Off", afterDelay: "After a delay", onFocusChange: "When focus leaves the editor" },
      },
      { key: "autoSaveDelay", label: "Auto save delay (ms)", detail: "How long to wait after the last keystroke, when auto save is \"After a delay\"." },
      { key: "formatOnSave", label: "Format on save", detail: "Run ruff (Python) or prettier (web files) when saving, if the project has them." },
      { key: "trimTrailingWhitespace", label: "Trim trailing whitespace", detail: "Remove spaces at the end of lines when saving. Keeps diffs clean." },
      { key: "insertFinalNewline", label: "Insert final newline", detail: "End every saved file with one newline, as most linters expect." },
    ],
  },
  {
    title: "Editor",
    icon: "Code",
    rows: [
      { key: "fontSize", label: "Font size", detail: "Editor text size in pixels." },
      { key: "fontFamily", label: "Font", detail: "Uses the font if it's installed on this computer.", labels: { default: "Default" } },
      { key: "fontLigatures", label: "Font ligatures", detail: "Join symbols like => and != into one glyph, in fonts that support it." },
      { key: "tabSize", label: "Tab size", detail: "Spaces per indentation level." },
      { key: "insertSpaces", label: "Indent with spaces", detail: "Pressing Tab inserts spaces instead of a tab character." },
      { key: "wordWrap", label: "Word wrap", detail: "Wrap long lines at the edge of the editor.", labels: { off: "Off", on: "On" } },
      { key: "lineNumbers", label: "Line numbers", detail: "Relative numbers count from the cursor line.", labels: { on: "On", relative: "Relative", off: "Off" } },
      { key: "minimap", label: "Minimap", detail: "The code overview on the right edge." },
      { key: "stickyScroll", label: "Sticky scroll", detail: "Pin the enclosing class and function headers at the top while scrolling." },
      { key: "bracketPairColorization", label: "Bracket pair colours", detail: "Colour matching brackets and draw guides between them." },
      { key: "renderWhitespace", label: "Show whitespace", detail: "Draw dots for spaces and arrows for tabs.", labels: { none: "Never", selection: "In selection", all: "Always" } },
      { key: "cursorStyle", label: "Cursor style", detail: "", labels: { line: "Line", block: "Block", underline: "Underline" } },
      { key: "cursorBlinking", label: "Cursor blinking", detail: "", labels: { blink: "Blink", smooth: "Smooth", phase: "Phase", solid: "Solid" } },
      { key: "smoothScrolling", label: "Smooth scrolling", detail: "Animate scrolling in the editor." },
    ],
  },
  {
    title: "Terminal",
    icon: "Terminal",
    rows: [
      { key: "terminalFontSize", label: "Font size", detail: "Terminal text size in pixels." },
      { key: "terminalCursorStyle", label: "Cursor style", detail: "", labels: { block: "Block", bar: "Bar", underline: "Underline" } },
      { key: "terminalCursorBlink", label: "Cursor blinking", detail: "" },
    ],
  },
];

export function SettingsView() {
  const { settings, update, reset } = useSettings();
  const [query, setQuery] = useState("");
  const q = query.trim().toLowerCase();
  const changed = (Object.keys(DEFAULT_SETTINGS) as (keyof Settings)[]).filter((key) => settings[key] !== DEFAULT_SETTINGS[key]).length;

  return (
    <div className="flex h-full min-h-0 flex-col text-[13px]">
      <div className="flex shrink-0 items-center gap-1 px-3 pb-2">
        <div className="flex min-w-0 flex-1 items-center gap-1.5 rounded-md border border-border bg-background px-2">
          <Icon name="Search" className="size-3.5 shrink-0 text-muted-foreground" />
          <input
            value={query}
            placeholder="Search settings"
            aria-label="Search settings"
            className="min-w-0 flex-1 bg-transparent py-1 text-xs outline-none"
            onChange={(event) => setQuery(event.target.value)}
          />
        </div>
        <button
          type="button"
          disabled={changed === 0}
          title="Reset every setting to its default"
          className="rounded-md px-2 py-1 text-xs text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-40"
          onClick={() => window.confirm(`Reset ${changed} changed setting${changed === 1 ? "" : "s"} to the defaults?`) && reset()}
        >
          Reset
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto pb-3">
        {GROUPS.map((group) => {
          const rows = group.rows.filter((row) => q === "" || `${group.title} ${row.label} ${row.detail}`.toLowerCase().includes(q));
          if (rows.length === 0) return null;
          return (
            <section key={group.title} className="pb-2">
              <h3 className="flex items-center gap-1.5 px-3 py-1 text-[11px] font-semibold uppercase text-muted-foreground">
                <Icon name={group.icon} className="size-3.5" />
                {group.title}
              </h3>
              {rows.map((row) => (
                <SettingRow
                  key={row.key}
                  row={row}
                  value={settings[row.key]}
                  modified={settings[row.key] !== DEFAULT_SETTINGS[row.key]}
                  disabled={row.key === "autoSaveDelay" && settings.autoSave !== "afterDelay"}
                  onChange={(value) => update(row.key, value as never)}
                />
              ))}
            </section>
          );
        })}
      </div>
    </div>
  );
}

function SettingRow({
  row,
  value,
  modified,
  disabled,
  onChange,
}: {
  row: Row;
  value: Settings[keyof Settings];
  modified: boolean;
  disabled: boolean;
  onChange(value: Settings[keyof Settings]): void;
}) {
  const id = `kf-setting-${row.key}`;
  const choice = CHOICES.find((c) => c.key === row.key);
  const range = RANGES.find((r) => r.key === row.key);
  const control =
    typeof value === "boolean" ? (
      <button
        id={id}
        type="button"
        role="switch"
        aria-checked={value}
        className={`relative h-4 w-7 shrink-0 rounded-full transition-colors ${value ? "bg-primary" : "bg-muted-foreground/30"}`}
        onClick={() => onChange(!value)}
      >
        <span className={`absolute top-0.5 size-3 rounded-full bg-background shadow transition-[left] ${value ? "left-3.5" : "left-0.5"}`} />
      </button>
    ) : choice ? (
      <select
        id={id}
        value={String(value)}
        className="mt-1 w-full rounded border border-border bg-background px-1 py-0.5 text-xs"
        onChange={(event) => onChange((typeof value === "number" ? Number(event.target.value) : event.target.value) as Settings[keyof Settings])}
      >
        {choice.options.map((option) => (
          <option key={option} value={String(option)}>
            {row.labels?.[String(option)] ?? String(option)}
          </option>
        ))}
      </select>
    ) : range ? (
      <input
        id={id}
        type="number"
        min={range.min}
        max={range.max}
        step={row.key === "autoSaveDelay" ? 100 : 1}
        disabled={disabled}
        defaultValue={value as number}
        key={String(value)}
        className="w-16 shrink-0 rounded border border-border bg-background px-1 py-0.5 text-right text-xs disabled:opacity-40"
        onBlur={(event) => {
          const next = Math.round(Number(event.target.value));
          if (Number.isFinite(next)) onChange(Math.min(range.max, Math.max(range.min, next)) as Settings[keyof Settings]);
        }}
        onKeyDown={(event) => event.key === "Enter" && event.currentTarget.blur()}
      />
    ) : null;

  // Dropdowns go under the description: the side bar is too narrow for both on one line.
  return (
    <div className={`py-1.5 pl-3 pr-3 hover:bg-muted/50 ${modified ? "border-l-2 border-primary pl-2.5" : ""}`}>
      <div className="flex items-start gap-2">
        <label htmlFor={id} className="min-w-0 flex-1">
          <span className="block text-xs font-medium">{row.label}</span>
          {row.detail ? <span className="block text-[11px] leading-snug text-muted-foreground">{row.detail}</span> : null}
        </label>
        {choice ? null : control}
      </div>
      {choice ? control : null}
    </div>
  );
}
