import { describe, expect, it, vi } from "vitest";
import { absolutePath, addedItems, EXPLORER_MENU_EVENT, type ExplorerMenuDetail } from "./explorer-menu.js";

describe("absolutePath", () => {
  it("joins in the host's flavour and keeps names as they are", () => {
    expect(absolutePath("/work/repo", "Отчёты за май/a b.docx")).toBe("/work/repo/Отчёты за май/a b.docx");
    expect(absolutePath("/work/repo/", "")).toBe("/work/repo");
    expect(absolutePath("/", "etc")).toBe("/etc");
    expect(absolutePath("/work", "odd\\name")).toBe("/work/odd\\name");
    expect(absolutePath("C:\\work", "a/b")).toBe("C:\\work\\a\\b");
    expect(absolutePath("C:/", "a")).toBe("C:/a");
    expect(absolutePath("\\\\nas\\share", "a")).toBe("\\\\nas\\share\\a");
  });
});

describe("addedItems", () => {
  const entry = { hostId: "host_1", path: "/work/repo/docs", kind: "directory" as const };
  it("offers the entry to listeners and takes the items they push", () => {
    const target = new EventTarget();
    const run = vi.fn();
    target.addEventListener(EXPLORER_MENU_EVENT, (event) => {
      const detail = (event as CustomEvent<ExplorerMenuDetail>).detail;
      expect(detail).toMatchObject({ version: 1, ...entry });
      detail.items.push({ label: "Open in Finder", run });
    });
    const items = addedItems(target, entry, vi.fn());
    expect(items.map((item) => item.label)).toEqual(["Open in Finder"]);
    items[0]!.run();
    expect(run).toHaveBeenCalledOnce();
  });
  it("ignores anything that is not an item and keeps the menu short", () => {
    const target = new EventTarget();
    target.addEventListener(EXPLORER_MENU_EVENT, (event) => {
      const items = (event as CustomEvent).detail.items as unknown[];
      items.push(null, "x", { label: "no run" }, { run: () => undefined });
      for (let i = 0; i < 20; i++) items.push({ label: `item ${i}`, run: () => undefined });
    });
    expect(addedItems(target, entry, vi.fn())).toHaveLength(8);
    expect(addedItems(new EventTarget(), entry, vi.fn())).toEqual([]);
  });
  it("survives a listener that throws and an item that fails, at once or later", async () => {
    const target = new EventTarget();
    target.addEventListener(EXPLORER_MENU_EVENT, (event) => {
      const items = (event as CustomEvent<ExplorerMenuDetail>).detail.items;
      items.push({ label: "now", run: () => { throw new Error("a"); } }, { label: "later", run: () => Promise.reject(new Error("b")) });
    });
    const onError = vi.fn();
    for (const item of addedItems(target, entry, onError)) item.run();
    await Promise.resolve().then(() => undefined).then(() => undefined);
    await vi.waitFor(() => expect(onError.mock.calls.map(([label]) => label)).toEqual(["now", "later"]));
  });
});
