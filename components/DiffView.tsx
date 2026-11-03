// Phase 6: side-by-side diff in Monaco. Unstaged changes compare the index with
// the live, editable buffer; staged changes compare HEAD with the index.
import { useEffect, useRef, useState } from "react";
import { useRpc } from "@get-bb/plugin-sdk/app";
import type * as MonacoApi from "monaco-editor/esm/vs/editor/editor.api.js";
import type { rpcContract, Scope } from "../server";
import { diffSides, type DiffSide } from "@/lib/diff-key";
import type { Documents } from "./use-documents";
import type { Monaco } from "./monaco";

export function DiffView({ monaco, docs, scope, path, side }: { monaco: Monaco; docs: Documents; scope: Scope; path: string; side: DiffSide }) {
  const rpc = useRpc<typeof rpcContract>();
  const host = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const editor = monaco.editor.createDiffEditor(host.current!, {
      automaticLayout: true,
      renderSideBySide: true,
      readOnly: side === "staged",
      originalEditable: false,
      fontSize: 13,
      fixedOverflowWidgets: true,
    });
    const owned: MonacoApi.editor.ITextModel[] = [];
    let cancelled = false;
    const temp = (content: string) => {
      // Same language as the real file, so both sides are highlighted alike.
      const uri = monaco.Uri.from({ scheme: "ide-diff", path: `/${owned.length}/${path}` });
      const model = monaco.editor.createModel(content, undefined, uri);
      owned.push(model);
      return model;
    };
    (async () => {
      const sides = diffSides(side);
      const original = await rpc.call("scmShow", { scope, path, at: sides.original });
      let modified: MonacoApi.editor.ITextModel | null;
      if (sides.modified === "disk") {
        // A deleted file has nothing on disk: compare against an empty buffer.
        modified = (await docs.open(path).catch(() => false)) ? docs.model(path) : temp("");
      } else {
        modified = temp((await rpc.call("scmShow", { scope, path, at: "index" })).content ?? "");
      }
      if (cancelled || modified === null) return;
      editor.setModel({ original: temp(original.content ?? ""), modified });
    })().catch((cause: Error) => !cancelled && setError(cause.message));
    return () => {
      cancelled = true;
      editor.dispose();
      owned.forEach((model) => model.dispose());
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [monaco, path, side, scope.kind, scope.id]);

  return (
    <div className="flex h-full flex-col">
      <div className="shrink-0 border-b border-border px-3 py-1 text-xs text-muted-foreground">
        {path} · {side === "working" ? "Index ↔ Working Tree (editable)" : "HEAD ↔ Index"}
        {error ? <span className="ml-2 text-destructive">{error}</span> : null}
      </div>
      <div ref={host} className="min-h-0 flex-1" />
    </div>
  );
}
