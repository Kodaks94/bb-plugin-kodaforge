// Loads the Monaco bundle the server publishes (see scripts/build-monaco.mjs)
// on first use, so the app bundle stays small until an editor opens.
import type * as MonacoApi from "monaco-editor/esm/vs/editor/editor.api.js";
import { toMonacoTheme, type CodeTheme } from "@/lib/monaco-theme";

export type Monaco = typeof MonacoApi;

let loading: Promise<Monaco> | null = null;

export function loadMonaco(baseUrl: string): Promise<Monaco> {
  loading ??= (async () => {
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = `${baseUrl}/editor.css`;
    document.head.append(link);
    (globalThis as { MonacoEnvironment?: unknown }).MonacoEnvironment = {
      getWorker: () => new Worker(new URL(`${baseUrl}/editor.worker.js`, window.location.origin), { type: "module" }),
    };
    const module = (await import(/* @vite-ignore */ `${baseUrl}/editor.js`)) as { monaco?: Monaco };
    if (module.monaco === undefined) throw new Error("The Monaco bundle did not expose its API");
    return module.monaco;
  })();
  loading.catch(() => {
    loading = null;
  });
  return loading;
}

/** Defines (or redefines) BB's current code theme and returns its Monaco name. */
export function applyTheme(monaco: Monaco, theme: CodeTheme | null, mode: "dark" | "light"): string {
  if (theme === null) return mode === "dark" ? "vs-dark" : "vs";
  const name = `bb-${theme.name.replace(/[^a-zA-Z0-9-]/g, "-")}`;
  monaco.editor.defineTheme(name, toMonacoTheme(theme));
  return name;
}
