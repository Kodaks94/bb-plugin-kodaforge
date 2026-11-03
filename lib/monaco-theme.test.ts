import { expect, it } from "vitest";
import { toMonacoTheme } from "./monaco-theme.js";

it("converts a VS Code theme document", () => {
  const data = toMonacoTheme({
    name: "t",
    type: "dark",
    fg: "#eeeeee",
    bg: "#111111",
    colors: { "editor.lineHighlightBackground": "#222222", bad: "rgb(1,2,3)" },
    tokenColors: [
      { scope: "comment, string.quoted", settings: { foreground: "#888888", fontStyle: "italic" } },
      { scope: ["keyword"], settings: { foreground: "#ff0000" } },
    ],
  });
  expect(data.base).toBe("vs-dark");
  expect(data.rules).toContainEqual({ token: "comment", foreground: "888888", fontStyle: "italic" });
  expect(data.rules).toContainEqual({ token: "string.quoted", foreground: "888888", fontStyle: "italic" });
  expect(data.rules).toContainEqual({ token: "keyword", foreground: "ff0000" });
  expect(data.colors).toEqual({
    "editor.lineHighlightBackground": "#222222",
    "editor.background": "#111111",
    "editor.foreground": "#eeeeee",
  });
});
