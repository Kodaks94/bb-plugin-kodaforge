import { describe, expect, it } from "vitest";
import { previewKind, viewerPage } from "./preview.js";

describe("previewKind", () => {
  it("knows files by extension, in any case, folder and script", () => {
    expect(previewKind("assets/logo.PNG")).toBe("image");
    expect(previewKind("Отчёты/Итоги за май.xlsx")).toBe("sheet");
    expect(previewKind("a.b/report.final.docx")).toBe("document");
    expect(previewKind("deck.pptx")).toBe("slides");
    expect(previewKind("manual.pdf")).toBe("pdf");
    expect(previewKind("clip.mp4")).toBe("video");
    expect(previewKind("voice.m4a")).toBe("audio");
  });
  it("leaves text and unknown files to the editor", () => {
    for (const path of ["a.ts", "README.md", "logo.svg", "data.csv", "Makefile", ".png", "png", "x.docx/notes"]) {
      expect(previewKind(path)).toBeNull();
    }
  });
});

describe("viewerPage", () => {
  const page = viewerPage('const end = "</script><img>";', "n1", { background: "#fff}</style><script>" });
  it("lets only the viewer script run and nothing load from the network", () => {
    expect(page).toContain("default-src 'none'; script-src 'nonce-n1';");
    expect(page).not.toContain("connect-src");
    expect(page).not.toMatch(/script-src[^;]*unsafe/);
  });
  it("keeps the script and the colours from closing their own element", () => {
    expect(page.match(/<\/script>/g)).toHaveLength(1);
    expect(page.match(/<\/style>/g)).toHaveLength(1);
  });
});
