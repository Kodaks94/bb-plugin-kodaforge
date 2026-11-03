// Starts a language server the first time a Python or TS/JS file opens in this
// workbench, one per language, and stops them all when the workbench closes.
import { useEffect, useRef, useState } from "react";
import { useRpc } from "@get-bb/plugin-sdk/app";
import type { rpcContract, Scope } from "../server";
import type { Monaco } from "./monaco";
import type { Documents } from "./use-documents";
import { serverFor, startLanguageClient, type LspState, type ServerLanguage } from "./lsp";

export function useLanguageServers(
  monaco: Monaco | null,
  docs: Documents,
  scope: Scope,
  root: string | null,
  log: (line: string) => void,
) {
  const rpc = useRpc<typeof rpcContract>();
  const [states, setStates] = useState<Partial<Record<ServerLanguage, LspState>>>({});
  const clients = useRef(new Map<ServerLanguage, Promise<(() => void) | null>>());
  const latestDocs = useRef(docs);
  latestDocs.current = docs;

  const wanted = new Set<ServerLanguage>();
  for (const path of docs.paths()) {
    const language = docs.model(path)?.getLanguageId();
    const server = language === undefined ? null : serverFor(language);
    if (server !== null) wanted.add(server);
  }
  const wantedKey = [...wanted].sort().join(",");

  useEffect(() => {
    if (monaco === null || root === null) return;
    for (const language of wantedKey.split(",").filter(Boolean) as ServerLanguage[]) {
      if (clients.current.has(language)) continue;
      const setState = (state: LspState) => setStates((current) => ({ ...current, [language]: state }));
      clients.current.set(
        language,
        rpc
          .call("lspEndpoint", null)
          .then(({ path, token }) => {
            const url = new URL(path, window.location.origin);
            url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
            url.search = new URLSearchParams({ token, kind: scope.kind, id: scope.id, language }).toString();
            return startLanguageClient(
              language,
              url.toString(),
              {
                monaco,
                root,
                pathOf: (uri) => latestDocs.current.pathOf(uri),
                modelFor: (path) => latestDocs.current.model(path),
                ensureModel: async (path) => ((await latestDocs.current.open(path)) ? latestDocs.current.model(path) : null),
                log,
              },
              setState,
            );
          })
          .catch((error: Error) => {
            setState({ status: "failed", detail: error.message });
            log(`${language} language server: ${error.message}`);
            return null;
          }),
      );
    }
  }, [monaco, root, wantedKey, rpc, scope, log]);

  useEffect(() => {
    const current = clients.current;
    return () => {
      for (const client of current.values()) void client.then((dispose) => dispose?.());
      current.clear();
    };
  }, [scope.kind, scope.id]);

  /** Retry a failed server (e.g. after installing it). */
  const restart = (language: ServerLanguage) => {
    void clients.current.get(language)?.then((dispose) => dispose?.());
    clients.current.delete(language);
    setStates((current) => ({ ...current, [language]: undefined }));
  };

  return { states, restart };
}
