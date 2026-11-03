/**
 * Search-everything query modes, VS Code's prefixes: plain text searches files,
 * symbols, text and commands at once; ">" commands, "#" symbols, "%" text in
 * files, ":12" or ":12:5" goes to a line in the open file.
 */
export type Mode = "all" | "commands" | "symbols" | "text" | "line";

export function parseQuery(raw: string): { mode: Mode; text: string; line?: number; column?: number } {
  const first = raw[0];
  const rest = raw.slice(1).trim();
  if (first === ">") return { mode: "commands", text: rest };
  if (first === "#") return { mode: "symbols", text: rest };
  if (first === "%") return { mode: "text", text: rest };
  if (first === ":") {
    const match = /^(\d+)(?::(\d+))?$/.exec(rest);
    return { mode: "line", text: rest, ...(match ? { line: Number(match[1]), column: Number(match[2] ?? 1) } : {}) };
  }
  return { mode: "all", text: raw.trim() };
}

const SYMBOL_KINDS = [
  "", "file", "module", "namespace", "package", "class", "method", "property", "field", "constructor",
  "enum", "interface", "function", "variable", "constant", "string", "number", "boolean", "array",
  "object", "key", "null", "enum member", "struct", "event", "operator", "type parameter",
];
export const symbolKindName = (kind: number) => SYMBOL_KINDS[kind] ?? "symbol";
