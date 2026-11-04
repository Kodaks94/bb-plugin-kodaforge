// KodaForge settings: VS Code's most-changed preferences, stored once per browser
// and shared by every open workspace. Unknown or mistyped stored values fall back to
// the default, so an old or hand-edited entry can never break the editor.

export const SETTINGS_KEY = "kodaforge:settings";

export const DEFAULT_SETTINGS = {
  // Files
  autoSave: "off" as "off" | "afterDelay" | "onFocusChange",
  autoSaveDelay: 1000,
  formatOnSave: true,
  trimTrailingWhitespace: false,
  insertFinalNewline: false,
  // Editor
  fontSize: 13,
  fontFamily: "default" as "default" | "JetBrains Mono" | "Fira Code" | "SF Mono" | "Menlo",
  fontLigatures: false,
  tabSize: 4 as 2 | 4 | 8,
  insertSpaces: true,
  wordWrap: "off" as "off" | "on",
  lineNumbers: "on" as "on" | "relative" | "off",
  minimap: true,
  renderWhitespace: "selection" as "none" | "selection" | "all",
  cursorStyle: "line" as "line" | "block" | "underline",
  cursorBlinking: "blink" as "blink" | "smooth" | "phase" | "solid",
  smoothScrolling: true,
  stickyScroll: true,
  bracketPairColorization: true,
  // Terminal
  terminalFontSize: 12,
  terminalCursorStyle: "block" as "block" | "bar" | "underline",
  terminalCursorBlink: true,
};

export type Settings = typeof DEFAULT_SETTINGS;

type Choice = { key: keyof Settings; options: readonly (string | number)[] };
type Range = { key: keyof Settings; min: number; max: number };

/** Allowed values for the settings that aren't free booleans. */
export const CHOICES: Choice[] = [
  { key: "autoSave", options: ["off", "afterDelay", "onFocusChange"] },
  { key: "fontFamily", options: ["default", "JetBrains Mono", "Fira Code", "SF Mono", "Menlo"] },
  { key: "tabSize", options: [2, 4, 8] },
  { key: "wordWrap", options: ["off", "on"] },
  { key: "lineNumbers", options: ["on", "relative", "off"] },
  { key: "renderWhitespace", options: ["none", "selection", "all"] },
  { key: "cursorStyle", options: ["line", "block", "underline"] },
  { key: "cursorBlinking", options: ["blink", "smooth", "phase", "solid"] },
  { key: "terminalCursorStyle", options: ["block", "bar", "underline"] },
];
export const RANGES: Range[] = [
  { key: "autoSaveDelay", min: 200, max: 10_000 },
  { key: "fontSize", min: 9, max: 28 },
  { key: "terminalFontSize", min: 9, max: 24 },
];

/** Stored JSON → full settings; anything missing or invalid takes its default. */
export function parseSettings(raw: string | null): Settings {
  let stored: Record<string, unknown> = {};
  try {
    const parsed: unknown = JSON.parse(raw ?? "{}");
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) stored = parsed as Record<string, unknown>;
  } catch {
    // corrupt entry: defaults
  }
  const out: Record<string, unknown> = { ...DEFAULT_SETTINGS };
  for (const key of Object.keys(DEFAULT_SETTINGS) as (keyof Settings)[]) {
    const value = stored[key];
    if (typeof value !== typeof DEFAULT_SETTINGS[key]) continue;
    const choice = CHOICES.find((c) => c.key === key);
    const range = RANGES.find((r) => r.key === key);
    if (choice && !choice.options.includes(value as string | number)) continue;
    if (range && (!Number.isFinite(value) || (value as number) < range.min || (value as number) > range.max)) continue;
    out[key] = value;
  }
  return out as Settings;
}

/** The on-save whitespace fixes: trailing spaces off each line, exactly one final newline. */
export function cleanupOnSave(text: string, options: { trimTrailingWhitespace: boolean; insertFinalNewline: boolean }): string {
  let out = text;
  const eol = text.includes("\r\n") ? "\r\n" : "\n";
  if (options.trimTrailingWhitespace) out = out.split(eol).map((line) => line.replace(/[ \t]+$/, "")).join(eol);
  if (options.insertFinalNewline && out.length > 0 && !out.endsWith(eol)) out += eol;
  return out;
}

const FONT_STACKS: Record<Settings["fontFamily"], string | undefined> = {
  default: undefined,
  "JetBrains Mono": "'JetBrains Mono', ui-monospace, Menlo, monospace",
  "Fira Code": "'Fira Code', ui-monospace, Menlo, monospace",
  "SF Mono": "'SF Mono', ui-monospace, Menlo, monospace",
  Menlo: "Menlo, ui-monospace, monospace",
};

/** Monaco editor options for these settings. */
export function editorOptions(s: Settings) {
  return {
    fontSize: s.fontSize,
    ...(FONT_STACKS[s.fontFamily] ? { fontFamily: FONT_STACKS[s.fontFamily] } : {}),
    fontLigatures: s.fontLigatures,
    wordWrap: s.wordWrap,
    lineNumbers: s.lineNumbers,
    minimap: { enabled: s.minimap },
    renderWhitespace: s.renderWhitespace,
    cursorStyle: s.cursorStyle,
    cursorBlinking: s.cursorBlinking,
    smoothScrolling: s.smoothScrolling,
    stickyScroll: { enabled: s.stickyScroll },
    bracketPairColorization: { enabled: s.bracketPairColorization },
    guides: { bracketPairs: s.bracketPairColorization },
  } as const;
}
