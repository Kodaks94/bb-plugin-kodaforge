/** The theme hues the IDE colour-codes with (resolved from the code theme's ANSI colours). */
export type Hue = "blue" | "cyan" | "green" | "yellow" | "orange" | "red" | "magenta" | "muted";

const BY_EXTENSION: Record<string, Hue> = {
  ts: "blue", tsx: "blue", mts: "blue", cts: "blue", "d.ts": "blue",
  js: "yellow", jsx: "yellow", mjs: "yellow", cjs: "yellow",
  py: "cyan", pyi: "cyan", ipynb: "orange",
  json: "yellow", jsonc: "yellow", json5: "yellow",
  md: "blue", mdx: "blue", txt: "muted", rst: "muted",
  css: "magenta", scss: "magenta", sass: "magenta", less: "magenta",
  html: "orange", htm: "orange", vue: "green", svelte: "orange", astro: "orange",
  go: "cyan", rs: "orange", java: "red", kt: "magenta", swift: "orange", rb: "red", php: "magenta",
  c: "blue", h: "blue", cpp: "blue", hpp: "blue", cs: "green",
  sh: "green", bash: "green", zsh: "green", fish: "green", ps1: "blue",
  yml: "red", yaml: "red", toml: "orange", ini: "muted", env: "yellow",
  sql: "orange", graphql: "magenta", gql: "magenta", prisma: "cyan",
  png: "magenta", jpg: "magenta", jpeg: "magenta", gif: "magenta", svg: "orange", webp: "magenta", ico: "magenta",
  lock: "muted", log: "muted",
};

const BY_NAME: Record<string, Hue> = {
  dockerfile: "cyan",
  makefile: "orange",
  "package.json": "green",
  "tsconfig.json": "blue",
  ".gitignore": "muted",
  ".env": "yellow",
  "readme.md": "cyan",
  license: "muted",
};

export function hueForFile(path: string): Hue {
  const name = path.slice(path.lastIndexOf("/") + 1).toLowerCase();
  if (BY_NAME[name]) return BY_NAME[name]!;
  if (name.startsWith(".env")) return "yellow";
  if (name.endsWith(".d.ts")) return "blue";
  const dot = name.lastIndexOf(".");
  return dot <= 0 ? "muted" : (BY_EXTENSION[name.slice(dot + 1)] ?? "muted");
}
