import { expect, it } from "vitest";
import { parseQuery, symbolKindName } from "./everything.js";

it("parses VS Code-style prefixes", () => {
  expect(parseQuery("  greet ")).toEqual({ mode: "all", text: "greet" });
  expect(parseQuery("> split")).toEqual({ mode: "commands", text: "split" });
  expect(parseQuery("#Bear")).toEqual({ mode: "symbols", text: "Bear" });
  expect(parseQuery("%TODO later")).toEqual({ mode: "text", text: "TODO later" });
  expect(parseQuery(":42")).toEqual({ mode: "line", text: "42", line: 42, column: 1 });
  expect(parseQuery(":42:7")).toEqual({ mode: "line", text: "42:7", line: 42, column: 7 });
  expect(parseQuery(":abc")).toEqual({ mode: "line", text: "abc" });
  expect(symbolKindName(5)).toBe("class");
  expect(symbolKindName(99)).toBe("symbol");
});
