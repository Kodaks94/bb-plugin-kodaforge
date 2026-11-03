/**
 * Turns BB's code theme (a VS Code theme document from
 * experimental_useCodeTheme) into Monaco's theme data. Monaco's Monarch tokens
 * are named like TextMate's top-level scopes (`comment`, `string`, `keyword`…),
 * so mapping each rule's scopes through as-is colours the common tokens.
 */

interface TokenRule {
  scope?: string | readonly string[];
  settings: { foreground?: string; background?: string; fontStyle?: string };
}

export interface CodeTheme {
  name: string;
  type: "dark" | "light";
  fg: string;
  bg: string;
  colors: Readonly<Record<string, string>>;
  tokenColors: readonly TokenRule[];
}

export interface MonacoThemeData {
  base: "vs" | "vs-dark";
  inherit: boolean;
  rules: { token: string; foreground?: string; background?: string; fontStyle?: string }[];
  colors: Record<string, string>;
}

const hex = (color: string | undefined) =>
  color !== undefined && /^#[0-9a-fA-F]{3,8}$/.test(color) ? color.slice(1) : undefined;

export function toMonacoTheme(theme: CodeTheme): MonacoThemeData {
  const rules: MonacoThemeData["rules"] = [];
  for (const rule of theme.tokenColors) {
    const scopes = rule.scope === undefined ? [""] : typeof rule.scope === "string" ? rule.scope.split(",") : rule.scope;
    for (const scope of scopes) {
      const entry = {
        token: scope.trim(),
        foreground: hex(rule.settings.foreground),
        background: hex(rule.settings.background),
        fontStyle: rule.settings.fontStyle,
      };
      rules.push(Object.fromEntries(Object.entries(entry).filter(([, v]) => v !== undefined)) as typeof entry);
    }
  }
  // Monaco throws on colours it cannot parse, so keep only hex values.
  const colors: Record<string, string> = {};
  for (const [key, value] of Object.entries(theme.colors)) {
    if (hex(value) !== undefined) colors[key] = value;
  }
  colors["editor.background"] ??= theme.bg;
  colors["editor.foreground"] ??= theme.fg;
  return { base: theme.type === "dark" ? "vs-dark" : "vs", inherit: true, rules, colors };
}
