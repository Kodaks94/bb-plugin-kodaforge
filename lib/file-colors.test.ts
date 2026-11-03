import { expect, it } from "vitest";
import { hueForFile } from "./file-colors.js";

it("colour-codes by name first, then extension", () => {
  expect(hueForFile("src/app.tsx")).toBe("blue");
  expect(hueForFile("scripts/run.py")).toBe("cyan");
  expect(hueForFile("package.json")).toBe("green");
  expect(hueForFile("data.json")).toBe("yellow");
  expect(hueForFile(".env.local")).toBe("yellow");
  expect(hueForFile("Dockerfile")).toBe("cyan");
  expect(hueForFile("NOTES")).toBe("muted");
  expect(hueForFile(".hidden")).toBe("muted");
});
