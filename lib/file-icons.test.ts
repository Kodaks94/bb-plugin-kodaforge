import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { fileIcon, folderIcon, type IconMap } from "./file-icons.js";

const map = JSON.parse(readFileSync("monaco/file-icons/map.json", "utf8")) as IconMap;

it("picks icons the way VS Code's Material theme does", () => {
  expect(fileIcon(map, "src/app.ts")).toBe("typescript");
  expect(fileIcon(map, "src/types.d.ts")).toBe("typescript-def");
  expect(fileIcon(map, "src/app.spec.ts")).toBe("test-ts");
  expect(fileIcon(map, "package.json")).toBe("nodejs");
  expect(fileIcon(map, "scripts/run.py")).toBe("python");
  expect(fileIcon(map, "README.md")).toBe("readme");
  expect(fileIcon(map, "Dockerfile")).toBe("docker");
  expect(fileIcon(map, "mystery.zzz")).toBe("file");
});

it("picks named folder icons, open and closed", () => {
  expect(folderIcon(map, "src", false)).toBe("folder-src");
  expect(folderIcon(map, "src", true)).toBe("folder-src-open");
  expect(folderIcon(map, "a/components", false)).toBe("folder-components");
  expect(folderIcon(map, "whatever", false)).toBe("folder");
});
