// One semantic palette for the whole IDE, taken from BB's current code theme
// (its terminal ANSI colours), so colour coding follows light and dark themes.
import { useMemo } from "react";
import { experimental_useCodeTheme } from "@get-bb/plugin-sdk/app";
import type { Hue } from "@/lib/file-colors";

const FALLBACK: Record<"dark" | "light", Record<Hue, string>> = {
  dark: { blue: "#6cb6ff", cyan: "#56d4dd", green: "#7ee787", yellow: "#e3b341", orange: "#f0883e", red: "#ff7b72", magenta: "#d2a8ff", muted: "#8b949e" },
  light: { blue: "#0969da", cyan: "#1b7c83", green: "#1a7f37", yellow: "#9a6700", orange: "#bc4c00", red: "#cf222e", magenta: "#8250df", muted: "#6e7781" },
};

export function useHues(): Record<Hue, string> {
  const { theme, mode } = experimental_useCodeTheme();
  return useMemo(() => {
    const fallback = FALLBACK[theme?.type ?? mode];
    const c = theme?.colors ?? {};
    const pick = (key: string, hue: Hue) => {
      const value = c[`terminal.ansi${key}`];
      return value && /^#[0-9a-f]{6}/i.test(value) ? value.slice(0, 7) : fallback[hue];
    };
    return {
      blue: pick("Blue", "blue"),
      cyan: pick("Cyan", "cyan"),
      green: pick("Green", "green"),
      yellow: pick("Yellow", "yellow"),
      // ANSI has no orange: the theme's own warning colour stands in.
      orange: (c["editorWarning.foreground"] ?? "").match(/^#[0-9a-f]{6}/i)?.[0] ?? fallback.orange,
      red: pick("Red", "red"),
      magenta: pick("Magenta", "magenta"),
      muted: fallback.muted,
    };
  }, [theme, mode]);
}
