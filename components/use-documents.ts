// Open files as Monaco models, keep them in step with the disk, and save them
// through the server's hash guard.
import { useCallback, useEffect, useRef, useState } from "react";
import { useRealtime, useRpc } from "@get-bb/plugin-sdk/app";
import type * as MonacoApi from "monaco-editor/esm/vs/editor/editor.api.js";
import type { rpcContract, Scope } from "../server";
import { onDiskChange, remapPath } from "@/lib/editor-state";
import type { Monaco } from "./monaco";

type Model = MonacoApi.editor.ITextModel;

export interface DocMeta {
  sha256: string;
  readOnly: boolean;
  savedVersion: number;
  /** Set when a save hit the hash guard or the disk moved under a dirty tab. */
  conflict: { diskSha256: string | null } | null;
  saving: boolean;
}

let instanceCounter = 0;

export function useDocuments(monaco: Monaco | null, scope: Scope, root: string | null, log: (line: string) => void) {
  const rpc = useRpc<typeof rpcContract>();
  const instance = useRef(`w${++instanceCounter}`).current;
  const models = useRef(new Map<string, Model>());
  const meta = useRef(new Map<string, DocMeta>());
  const [version, setVersion] = useState(0);
  const bump = useCallback(() => setVersion((v) => v + 1), []);

  const uriFor = useCallback(
    (path: string) => monaco!.Uri.from({ scheme: "file", authority: instance, path: `/${path}` }),
    [monaco, instance],
  );

  // Dispose this workbench's models when it unmounts or switches workspace.
  useEffect(() => {
    const current = models.current;
    return () => {
      for (const model of current.values()) model.dispose();
      current.clear();
      meta.current.clear();
    };
  }, [scope.kind, scope.id]);

  const isDirty = useCallback((path: string) => {
    const model = models.current.get(path);
    const info = meta.current.get(path);
    return model !== undefined && info !== undefined && model.getAlternativeVersionId() !== info.savedVersion;
  }, []);

  /** Replace the buffer with disk content, keeping undo history. */
  const replaceContent = useCallback((model: Model, content: string) => {
    if (model.getValue() === content) return;
    model.pushEditOperations([], [{ range: model.getFullModelRange(), text: content }], () => null);
  }, []);

  const open = useCallback(
    async (path: string): Promise<boolean> => {
      if (monaco === null) return false;
      if (models.current.has(path)) return true;
      const file = await rpc.call("read", { scope, path });
      if (file.kind === "binary") {
        log(`${path} is not a text file (${file.sizeBytes} bytes); not opened`);
        return false;
      }
      if (models.current.has(path)) return true;
      const model = monaco.editor.createModel(file.content, undefined, uriFor(path));
      models.current.set(path, model);
      meta.current.set(path, {
        sha256: file.sha256,
        readOnly: file.readOnly,
        savedVersion: model.getAlternativeVersionId(),
        conflict: null,
        saving: false,
      });
      model.onDidChangeContent(bump);
      if (file.readOnly) log(`${path} is over 2 MB and opened read-only`);
      bump();
      return true;
    },
    [monaco, rpc, scope, uriFor, bump, log],
  );

  const close = useCallback(
    (path: string) => {
      models.current.get(path)?.dispose();
      models.current.delete(path);
      meta.current.delete(path);
      bump();
    },
    [bump],
  );

  const write = useCallback(
    async (path: string, expectedSha256: string | null) => {
      const model = models.current.get(path);
      const info = meta.current.get(path);
      if (model === undefined || info === undefined || info.readOnly || info.saving) return;
      const content = model.getValue();
      const versionAtSave = model.getAlternativeVersionId();
      info.saving = true;
      bump();
      try {
        const result = await rpc.call("write", { scope, path, content, expectedSha256 });
        if (result.outcome === "written") {
          Object.assign(info, { sha256: result.sha256, savedVersion: versionAtSave, conflict: null });
          log(`Saved ${path}`);
        } else {
          info.conflict = { diskSha256: result.currentSha256 };
          log(`${path} changed on disk since it was opened; save stopped`);
        }
      } catch (error) {
        log(`Save failed for ${path}: ${(error as Error).message}`);
      } finally {
        info.saving = false;
        bump();
      }
    },
    [rpc, scope, bump, log],
  );

  const save = useCallback((path: string) => write(path, meta.current.get(path)?.sha256 ?? null), [write]);

  /** Overwrite after a conflict: still compare-and-swap, against the disk's current hash. */
  const overwrite = useCallback(
    (path: string) => write(path, meta.current.get(path)?.conflict?.diskSha256 ?? null),
    [write],
  );

  const reload = useCallback(
    async (path: string) => {
      const model = models.current.get(path);
      const info = meta.current.get(path);
      if (model === undefined || info === undefined) return;
      const file = await rpc.call("read", { scope, path });
      if (file.kind !== "text") return;
      replaceContent(model, file.content);
      Object.assign(info, {
        sha256: file.sha256,
        readOnly: file.readOnly,
        savedVersion: model.getAlternativeVersionId(),
        conflict: null,
      });
      bump();
    },
    [rpc, scope, replaceContent, bump],
  );

  /** The watcher saw these paths change: follow the disk in clean tabs, flag dirty ones. */
  const syncFromDisk = useCallback(
    async (paths: readonly string[]) => {
      for (const path of paths) {
        const model = models.current.get(path);
        const info = meta.current.get(path);
        if (model === undefined || info === undefined || info.saving) continue;
        let disk: { sha256: string; content: string } | null = null;
        try {
          const file = await rpc.call("read", { scope, path });
          disk = file.kind === "text" ? file : { sha256: file.sha256, content: "" };
        } catch {
          disk = null; // deleted or unreadable
        }
        const decision = onDiskChange({ dirty: isDirty(path), sha256: info.sha256 }, disk?.sha256 ?? null);
        if (decision === "reload" && disk !== null) {
          replaceContent(model, disk.content);
          Object.assign(info, { sha256: disk.sha256, savedVersion: model.getAlternativeVersionId() });
          log(`Reloaded ${path} (changed on disk)`);
        } else if (decision === "conflict" || decision === "deleted") {
          info.conflict = { diskSha256: disk?.sha256 ?? null };
          log(decision === "deleted" ? `${path} was deleted on disk` : `${path} changed on disk while you were editing it`);
        }
      }
      bump();
    },
    [rpc, scope, isDirty, replaceContent, bump, log],
  );

  /** A file or folder was renamed in the explorer: carry open buffers (and unsaved edits) along. */
  const rename = useCallback(
    (from: string, to: string) => {
      if (monaco === null) return;
      for (const [path, model] of [...models.current]) {
        const next = remapPath(path, from, to);
        const info = meta.current.get(path);
        if (next === null || info === undefined) continue;
        const dirty = isDirty(path);
        const moved = monaco.editor.createModel(model.getValue(), undefined, uriFor(next));
        moved.onDidChangeContent(bump);
        models.current.set(next, moved);
        meta.current.set(next, { ...info, savedVersion: dirty ? -1 : moved.getAlternativeVersionId() });
        models.current.delete(path);
        meta.current.delete(path);
        model.dispose();
      }
      bump();
    },
    [monaco, isDirty, uriFor, bump],
  );

  useRealtime("ide/changed", (payload) => {
    const event = payload as { root: string; paths: string[]; rescan: boolean };
    if (root === null || event.root !== root) return;
    const open = [...models.current.keys()];
    void syncFromDisk(event.rescan ? open : event.paths.filter((path) => models.current.has(path)));
  });

  return {
    version,
    model: (path: string) => models.current.get(path) ?? null,
    meta: (path: string) => meta.current.get(path) ?? null,
    isDirty,
    open,
    close,
    save,
    overwrite,
    reload,
    rename,
    syncFromDisk,
    paths: () => [...models.current.keys()],
    /** The workspace-relative path of a model URI that belongs to this workbench. */
    pathOf: (uri: { scheme: string; authority: string; path: string }) =>
      uri.scheme === "file" && uri.authority === instance ? uri.path.slice(1) : null,
  };
}

export type Documents = ReturnType<typeof useDocuments>;
