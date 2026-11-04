import { expect, it } from "vitest";
import { cleanupOnSave, DEFAULT_SETTINGS, parseSettings } from "./settings.js";

it("keeps valid stored values and drops invalid or unknown ones", () => {
  const s = parseSettings(JSON.stringify({ autoSave: "afterDelay", fontSize: 99, tabSize: 3, wordWrap: true, minimap: false, bogus: 1 }));
  expect(s.autoSave).toBe("afterDelay");
  expect(s.minimap).toBe(false);
  expect(s.fontSize).toBe(DEFAULT_SETTINGS.fontSize);
  expect(s.tabSize).toBe(DEFAULT_SETTINGS.tabSize);
  expect(s.wordWrap).toBe("off");
  expect(s).not.toHaveProperty("bogus");
  expect(parseSettings("not json")).toEqual(DEFAULT_SETTINGS);
  expect(parseSettings("[1]")).toEqual(DEFAULT_SETTINGS);
});

it("trims trailing whitespace and adds one final newline, keeping CRLF", () => {
  const both = { trimTrailingWhitespace: true, insertFinalNewline: true };
  expect(cleanupOnSave("a  \nb\t\n  c ", both)).toBe("a\nb\n  c\n");
  expect(cleanupOnSave("a \r\nb", both)).toBe("a\r\nb\r\n");
  expect(cleanupOnSave("", both)).toBe("");
  expect(cleanupOnSave("x \n", { trimTrailingWhitespace: false, insertFinalNewline: true })).toBe("x \n");
});
