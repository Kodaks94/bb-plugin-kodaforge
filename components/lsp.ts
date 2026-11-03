// Phase 4: a small LSP client for Monaco. JSON-RPC over the plugin's WebSocket,
// full-text document sync, and the providers the IDE needs. Types come from
// vscode-languageserver-protocol (type-only, nothing is bundled from it).
import type * as P from "vscode-languageserver-protocol";
import type * as MonacoApi from "monaco-editor/esm/vs/editor/editor.api.js";
import type { Monaco } from "./monaco";

type Model = MonacoApi.editor.ITextModel;

export type ServerLanguage = "python" | "typescript";

/** Monaco language ids each server handles. */
export const MONACO_IDS: Record<ServerLanguage, string[]> = {
  python: ["python"],
  typescript: ["typescript", "javascript"],
};

export function serverFor(monacoLanguageId: string): ServerLanguage | null {
  if (monacoLanguageId === "python") return "python";
  if (monacoLanguageId === "typescript" || monacoLanguageId === "javascript") return "typescript";
  return null;
}

export function lspLanguageId(path: string, monacoId: string): string {
  if (/\.tsx$/i.test(path)) return "typescriptreact";
  if (/\.jsx$/i.test(path)) return "javascriptreact";
  return monacoId;
}

/** file:// URI for a workspace-relative path, and back. */
export function toFileUri(root: string, path: string): string {
  const absolute = `${root.replace(/\/+$/, "")}/${path}`;
  return `file://${absolute.split("/").map(encodeURIComponent).join("/")}`;
}

export function fromFileUri(root: string, uri: string): string | null {
  if (!uri.startsWith("file://")) return null;
  const absolute = decodeURIComponent(uri.slice("file://".length));
  const base = root.replace(/\/+$/, "");
  return absolute.startsWith(`${base}/`) ? absolute.slice(base.length + 1) : null;
}

class Connection {
  private nextId = 1;
  private pending = new Map<number, { resolve(value: unknown): void; reject(error: Error): void }>();
  private notifications = new Map<string, (params: any) => void>();
  onRequest: (method: string, params: any) => Promise<unknown> = async () => null;
  onClose: (reason: string) => void = () => undefined;

  constructor(private readonly socket: WebSocket) {
    socket.addEventListener("message", (event) => this.receive(String(event.data)));
    socket.addEventListener("close", (event) => {
      for (const { reject } of this.pending.values()) reject(new Error("language server disconnected"));
      this.pending.clear();
      this.onClose(event.reason || `closed (${event.code})`);
    });
  }

  static open(url: string): Promise<Connection> {
    return new Promise((resolve, reject) => {
      const socket = new WebSocket(url);
      socket.addEventListener("open", () => resolve(new Connection(socket)), { once: true });
      socket.addEventListener("error", () => reject(new Error("could not connect to the language server bridge")), { once: true });
    });
  }

  request<T>(method: string, params: unknown, timeoutMs = 30_000): Promise<T> {
    const id = this.nextId++;
    this.socket.send(JSON.stringify({ jsonrpc: "2.0", id, method, params }));
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`${method} timed out`));
      }, timeoutMs);
      this.pending.set(id, {
        resolve: (value) => {
          clearTimeout(timer);
          resolve(value as T);
        },
        reject: (error) => {
          clearTimeout(timer);
          reject(error);
        },
      });
    });
  }

  notify(method: string, params: unknown) {
    if (this.socket.readyState === WebSocket.OPEN) this.socket.send(JSON.stringify({ jsonrpc: "2.0", method, params }));
  }

  on(method: string, handler: (params: any) => void) {
    this.notifications.set(method, handler);
  }

  close() {
    this.socket.close();
  }

  private receive(data: string) {
    let message: any;
    try {
      message = JSON.parse(data);
    } catch {
      return;
    }
    if (message.id !== undefined && message.method === undefined) {
      const waiter = this.pending.get(message.id);
      this.pending.delete(message.id);
      if (message.error) waiter?.reject(new Error(message.error.message));
      else waiter?.resolve(message.result);
    } else if (message.id !== undefined) {
      this.onRequest(message.method, message.params).then(
        (result) => this.socket.send(JSON.stringify({ jsonrpc: "2.0", id: message.id, result: result ?? null })),
        (error: Error) =>
          this.socket.send(JSON.stringify({ jsonrpc: "2.0", id: message.id, error: { code: -32601, message: error.message } })),
      );
    } else {
      this.notifications.get(message.method)?.(message.params);
    }
  }
}

export interface LspContext {
  monaco: Monaco;
  root: string;
  /** Which models belong to this workbench, and their workspace-relative paths. */
  pathOf(uri: MonacoApi.Uri): string | null;
  modelFor(path: string): Model | null;
  /** Open a file as a model (no tab), for definitions and rename edits in other files. */
  ensureModel(path: string): Promise<Model | null>;
  /** Settings the server asks for through workspace/configuration (e.g. python.pythonPath). */
  settings(): Record<string, unknown>;
  log(line: string): void;
}

export interface WorkspaceSymbol {
  name: string;
  kind: number;
  container: string;
  path: string;
  line: number;
  column: number;
}

export interface LanguageClient {
  dispose(): void;
  /** workspace/symbol, limited to files inside the workspace. */
  workspaceSymbols(query: string): Promise<WorkspaceSymbol[]>;
}

/** Look up "a.b.c" in nested settings; null when absent (what servers expect). */
export function settingAt(settings: Record<string, unknown>, section: string | undefined): unknown {
  if (!section) return settings;
  let value: unknown = settings;
  for (const key of section.split(".")) {
    if (value === null || typeof value !== "object" || !(key in value)) return null;
    value = (value as Record<string, unknown>)[key];
  }
  return value;
}

export type LspState = { status: "starting" | "ready" | "stopped" | "failed"; detail?: string };

/** Start one language server and wire it into Monaco. */
export async function startLanguageClient(
  language: ServerLanguage,
  url: string,
  context: LspContext,
  onState: (state: LspState) => void,
): Promise<LanguageClient> {
  const { monaco, root } = context;
  const disposables: MonacoApi.IDisposable[] = [];
  const versions = new Map<string, number>();
  const pendingChanges = new Map<string, ReturnType<typeof setTimeout>>();
  let disposed = false;

  onState({ status: "starting" });
  const connection = await Connection.open(url);
  connection.onClose = (reason) => {
    if (disposed) return;
    for (const model of monaco.editor.getModels()) if (context.pathOf(model.uri) !== null) monaco.editor.setModelMarkers(model, "lsp", []);
    onState({ status: reason.startsWith("taken over") ? "stopped" : "failed", detail: reason });
    context.log(`${language} language server: ${reason}`);
  };
  connection.onRequest = async (method, params) => {
    if (method === "workspace/configuration") {
      return (params as P.ConfigurationParams).items.map((item) => settingAt(context.settings(), item.section));
    }
    if (method === "workspace/workspaceFolders") return [{ uri: toFileUri(root, "").replace(/\/$/, ""), name: "workspace" }];
    if (method === "workspace/applyEdit") {
      await applyWorkspaceEdit((params as P.ApplyWorkspaceEditParams).edit);
      return { applied: true };
    }
    if (method === "workspace/diagnostic/refresh") {
      for (const model of monaco.editor.getModels()) if (versions.has(model.uri.toString())) schedulePull(model);
      return null;
    }
    if (method === "client/registerCapability" || method === "window/workDoneProgress/create") return null;
    throw new Error(`unsupported request ${method}`);
  };

  const rootUri = toFileUri(root, "").replace(/\/$/, "");
  const initialized = await connection.request<P.InitializeResult>(
    "initialize",
    {
      processId: null,
      rootUri,
      rootPath: root,
      workspaceFolders: [{ uri: rootUri, name: root.split("/").pop() ?? "workspace" }],
      capabilities: {
        textDocument: {
          synchronization: { didSave: true, dynamicRegistration: false },
          completion: {
            completionItem: { snippetSupport: true, documentationFormat: ["markdown", "plaintext"], insertReplaceSupport: false },
            contextSupport: true,
          },
          hover: { contentFormat: ["markdown", "plaintext"] },
          definition: { linkSupport: true },
          references: {},
          rename: { prepareSupport: true },
          formatting: {},
          publishDiagnostics: { relatedInformation: false },
          diagnostic: { dynamicRegistration: false, relatedDocumentSupport: false },
        },
        workspace: {
          configuration: true,
          workspaceFolders: true,
          applyEdit: true,
          workspaceEdit: { documentChanges: true },
          diagnostics: { refreshSupport: true },
        },
      },
      initializationOptions: {},
    },
    60_000,
  );
  connection.notify("initialized", {});
  const capabilities = initialized.capabilities;
  onState({ status: "ready", detail: initialized.serverInfo?.name });

  // --- Document sync (full text) -------------------------------------------------
  const ours = (model: Model) => context.pathOf(model.uri) !== null && MONACO_IDS[language].includes(model.getLanguageId());
  const uriOf = (model: Model) => toFileUri(root, context.pathOf(model.uri)!);

  const open = (model: Model) => {
    if (!ours(model) || versions.has(model.uri.toString())) return;
    versions.set(model.uri.toString(), 1);
    connection.notify("textDocument/didOpen", {
      textDocument: { uri: uriOf(model), languageId: lspLanguageId(context.pathOf(model.uri)!, model.getLanguageId()), version: 1, text: model.getValue() },
    });
    disposables.push(model.onDidChangeContent(() => scheduleChange(model)));
    schedulePull(model);
  };
  const flush = (model: Model) => {
    const key = model.uri.toString();
    const timer = pendingChanges.get(key);
    if (timer === undefined) return;
    clearTimeout(timer);
    pendingChanges.delete(key);
    const version = (versions.get(key) ?? 1) + 1;
    versions.set(key, version);
    connection.notify("textDocument/didChange", { textDocument: { uri: uriOf(model), version }, contentChanges: [{ text: model.getValue() }] });
  };
  const scheduleChange = (model: Model) => {
    if (model.isDisposed() || !versions.has(model.uri.toString())) return;
    const key = model.uri.toString();
    clearTimeout(pendingChanges.get(key));
    pendingChanges.set(key, setTimeout(() => flush(model), 150));
    schedulePull(model);
  };
  const close = (model: Model) => {
    const key = model.uri.toString();
    if (!versions.delete(key)) return;
    clearTimeout(pendingChanges.get(key));
    pendingChanges.delete(key);
    connection.notify("textDocument/didClose", { textDocument: { uri: uriOf(model) } });
  };

  // --- Diagnostics ---------------------------------------------------------------
  const SEVERITY: Record<number, MonacoApi.MarkerSeverity> = {
    1: monaco.MarkerSeverity.Error,
    2: monaco.MarkerSeverity.Warning,
    3: monaco.MarkerSeverity.Info,
    4: monaco.MarkerSeverity.Hint,
  };
  const setMarkers = (model: Model, diagnostics: P.Diagnostic[]) =>
    monaco.editor.setModelMarkers(
      model,
      "lsp",
      diagnostics.map((d) => ({
        ...toRange(d.range),
        message: typeof d.message === "string" ? d.message : d.message.value,
        severity: SEVERITY[d.severity ?? 1] ?? monaco.MarkerSeverity.Error,
        source: d.source,
        code: d.code === undefined ? undefined : String(d.code),
      })),
    );
  connection.on("textDocument/publishDiagnostics", (params: P.PublishDiagnosticsParams) => {
    const path = fromFileUri(root, params.uri);
    const model = path === null ? null : context.modelFor(path);
    if (model !== null) setMarkers(model, params.diagnostics);
  });

  // Pull diagnostics (LSP 3.17), used by servers such as TypeScript 7 instead of publishing.
  const pullTimers = new Map<string, ReturnType<typeof setTimeout>>();
  const schedulePull = (model: Model) => {
    if (!capabilities.diagnosticProvider) return;
    const key = model.uri.toString();
    clearTimeout(pullTimers.get(key));
    pullTimers.set(
      key,
      setTimeout(async () => {
        pullTimers.delete(key);
        if (model.isDisposed() || !versions.has(key)) return;
        flush(model);
        try {
          const report = await connection.request<P.DocumentDiagnosticReport>("textDocument/diagnostic", { textDocument: { uri: uriOf(model) } });
          if (report.kind === "full" && !model.isDisposed()) setMarkers(model, report.items);
        } catch {
          // the next edit pulls again
        }
      }, 400),
    );
  };
  // Start syncing documents only now that every helper above exists.
  monaco.editor.getModels().forEach(open);
  disposables.push(monaco.editor.onDidCreateModel(open));
  disposables.push(monaco.editor.onWillDisposeModel(close));
  disposables.push(monaco.editor.onDidChangeModelLanguage(({ model }) => (ours(model) ? open(model) : close(model))));

  connection.on("window/logMessage", () => undefined);
  connection.on("window/showMessage", (params: P.ShowMessageParams) => context.log(`${language}: ${params.message}`));

  // --- Conversions ---------------------------------------------------------------
  function toRange(range: P.Range): MonacoApi.IRange {
    return {
      startLineNumber: range.start.line + 1,
      startColumn: range.start.character + 1,
      endLineNumber: range.end.line + 1,
      endColumn: range.end.character + 1,
    };
  }
  const toPosition = (position: MonacoApi.Position): P.Position => ({ line: position.lineNumber - 1, character: position.column - 1 });
  const docParams = (model: Model, position: MonacoApi.Position) => {
    flush(model);
    return { textDocument: { uri: uriOf(model) }, position: toPosition(position) };
  };
  const markdown = (content: P.MarkupContent | P.MarkedString): MonacoApi.IMarkdownString =>
    typeof content === "string"
      ? { value: content }
      : "kind" in content
        ? { value: content.value }
        : { value: `\`\`\`${content.language}\n${content.value}\n\`\`\`` };

  async function toLocations(result: P.Location | P.Location[] | P.LocationLink[] | null): Promise<MonacoApi.languages.Location[]> {
    if (result === null) return [];
    const list = Array.isArray(result) ? result : [result];
    const locations: MonacoApi.languages.Location[] = [];
    for (const item of list) {
      const uri = "targetUri" in item ? item.targetUri : item.uri;
      const range = "targetUri" in item ? (item.targetSelectionRange ?? item.targetRange) : item.range;
      const path = fromFileUri(root, uri);
      // Files outside the workspace (stdlib, global typings) cannot be opened here.
      if (path === null) continue;
      const model = context.modelFor(path) ?? (await context.ensureModel(path));
      if (model !== null) locations.push({ uri: model.uri, range: toRange(range) });
    }
    return locations;
  }

  async function toWorkspaceEdit(edit: P.WorkspaceEdit): Promise<MonacoApi.languages.WorkspaceEdit> {
    const entries: [string, P.TextEdit[]][] = [];
    if (edit.documentChanges) {
      for (const change of edit.documentChanges) if ("textDocument" in change) entries.push([change.textDocument.uri, change.edits as P.TextEdit[]]);
    } else if (edit.changes) {
      entries.push(...Object.entries(edit.changes));
    }
    const edits: MonacoApi.languages.IWorkspaceTextEdit[] = [];
    for (const [uri, textEdits] of entries) {
      const path = fromFileUri(root, uri);
      if (path === null) continue;
      const model = context.modelFor(path) ?? (await context.ensureModel(path));
      if (model === null) continue;
      for (const textEdit of textEdits) {
        edits.push({ resource: model.uri, versionId: undefined, textEdit: { range: toRange(textEdit.range), text: textEdit.newText } });
      }
    }
    return { edits };
  }

  async function applyWorkspaceEdit(edit: P.WorkspaceEdit) {
    const converted = await toWorkspaceEdit(edit);
    const byModel = new Map<Model, MonacoApi.editor.IIdentifiedSingleEditOperation[]>();
    for (const item of converted.edits) {
      if (!("textEdit" in item)) continue;
      const model = monaco.editor.getModel(item.resource);
      if (model === null) continue;
      const list = byModel.get(model) ?? [];
      list.push({ range: item.textEdit.range, text: item.textEdit.text });
      byModel.set(model, list);
    }
    for (const [model, edits] of byModel) model.pushEditOperations([], edits, () => null);
  }

  // --- Providers -----------------------------------------------------------------
  const KIND = monaco.languages.CompletionItemKind;
  const COMPLETION_KIND: Record<number, MonacoApi.languages.CompletionItemKind> = {
    1: KIND.Text, 2: KIND.Method, 3: KIND.Function, 4: KIND.Constructor, 5: KIND.Field, 6: KIND.Variable, 7: KIND.Class,
    8: KIND.Interface, 9: KIND.Module, 10: KIND.Property, 11: KIND.Unit, 12: KIND.Value, 13: KIND.Enum, 14: KIND.Keyword,
    15: KIND.Snippet, 16: KIND.Color, 17: KIND.File, 18: KIND.Reference, 19: KIND.Folder, 20: KIND.EnumMember,
    21: KIND.Constant, 22: KIND.Struct, 23: KIND.Event, 24: KIND.Operator, 25: KIND.TypeParameter,
  };

  for (const languageId of MONACO_IDS[language]) {
    if (capabilities.completionProvider) {
      disposables.push(
        monaco.languages.registerCompletionItemProvider(languageId, {
          triggerCharacters: capabilities.completionProvider.triggerCharacters,
          async provideCompletionItems(model, position, completionContext) {
            if (!ours(model)) return null;
            const result = await connection.request<P.CompletionList | P.CompletionItem[] | null>("textDocument/completion", {
              ...docParams(model, position),
              context: completionContext.triggerCharacter
                ? { triggerKind: 2, triggerCharacter: completionContext.triggerCharacter }
                : { triggerKind: 1 },
            });
            const items = result === null ? [] : Array.isArray(result) ? result : result.items;
            const word = model.getWordUntilPosition(position);
            const fallback = { startLineNumber: position.lineNumber, endLineNumber: position.lineNumber, startColumn: word.startColumn, endColumn: word.endColumn };
            return {
              incomplete: !Array.isArray(result) && result !== null && result.isIncomplete,
              suggestions: items.map((item) => {
                const textEdit = item.textEdit && "range" in item.textEdit ? item.textEdit : undefined;
                return {
                  label: item.label,
                  kind: COMPLETION_KIND[item.kind ?? 1] ?? KIND.Text,
                  detail: item.detail,
                  documentation: item.documentation === undefined ? undefined : markdown(item.documentation),
                  insertText: textEdit?.newText ?? item.insertText ?? item.label,
                  insertTextRules: item.insertTextFormat === 2 ? monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet : undefined,
                  range: textEdit ? toRange(textEdit.range) : fallback,
                  sortText: item.sortText,
                  filterText: item.filterText,
                  additionalTextEdits: item.additionalTextEdits?.map((e) => ({ range: toRange(e.range), text: e.newText })),
                };
              }),
            };
          },
        }),
      );
    }
    if (capabilities.hoverProvider) {
      disposables.push(
        monaco.languages.registerHoverProvider(languageId, {
          async provideHover(model, position) {
            if (!ours(model)) return null;
            const hover = await connection.request<P.Hover | null>("textDocument/hover", docParams(model, position));
            if (hover === null) return null;
            const contents = Array.isArray(hover.contents) ? hover.contents : [hover.contents];
            return { contents: contents.map(markdown), range: hover.range ? toRange(hover.range) : undefined };
          },
        }),
      );
    }
    if (capabilities.definitionProvider) {
      disposables.push(
        monaco.languages.registerDefinitionProvider(languageId, {
          async provideDefinition(model, position) {
            if (!ours(model)) return null;
            return toLocations(await connection.request("textDocument/definition", docParams(model, position)));
          },
        }),
      );
    }
    if (capabilities.referencesProvider) {
      disposables.push(
        monaco.languages.registerReferenceProvider(languageId, {
          async provideReferences(model, position, referenceContext) {
            if (!ours(model)) return null;
            return toLocations(
              await connection.request("textDocument/references", { ...docParams(model, position), context: referenceContext }),
            );
          },
        }),
      );
    }
    if (capabilities.renameProvider) {
      disposables.push(
        monaco.languages.registerRenameProvider(languageId, {
          async provideRenameEdits(model, position, newName) {
            if (!ours(model)) return null;
            const edit = await connection.request<P.WorkspaceEdit | null>("textDocument/rename", { ...docParams(model, position), newName });
            return edit === null ? { edits: [] } : toWorkspaceEdit(edit);
          },
        }),
      );
    }
    if (capabilities.documentFormattingProvider) {
      disposables.push(
        monaco.languages.registerDocumentFormattingEditProvider(languageId, {
          async provideDocumentFormattingEdits(model, options) {
            if (!ours(model)) return null;
            flush(model);
            const edits = await connection.request<P.TextEdit[] | null>("textDocument/formatting", {
              textDocument: { uri: uriOf(model) },
              options: { tabSize: options.tabSize, insertSpaces: options.insertSpaces },
            });
            return (edits ?? []).map((e) => ({ range: toRange(e.range), text: e.newText }));
          },
        }),
      );
    }
  }

  const didSave = (path: string) => {
    const model = context.modelFor(path);
    if (model === null || !versions.has(model.uri.toString())) return;
    flush(model);
    connection.notify("textDocument/didSave", { textDocument: { uri: uriOf(model) } });
  };
  savedListeners.add(didSave);

  const dispose = () => {
    disposed = true;
    savedListeners.delete(didSave);
    for (const timer of pendingChanges.values()) clearTimeout(timer);
    for (const timer of pullTimers.values()) clearTimeout(timer);
    for (const model of monaco.editor.getModels()) if (versions.has(model.uri.toString())) monaco.editor.setModelMarkers(model, "lsp", []);
    disposables.forEach((d) => d.dispose());
    connection.close();
    onState({ status: "stopped" });
  };

  async function workspaceSymbols(query: string): Promise<WorkspaceSymbol[]> {
    if (!capabilities.workspaceSymbolProvider || disposed) return [];
    const result = await connection
      .request<(P.SymbolInformation | P.WorkspaceSymbol)[] | null>("workspace/symbol", { query }, 10_000)
      .catch(() => null);
    const symbols: WorkspaceSymbol[] = [];
    for (const symbol of result ?? []) {
      const path = fromFileUri(root, symbol.location.uri);
      if (path === null) continue;
      const range = "range" in symbol.location ? symbol.location.range : null;
      symbols.push({
        name: symbol.name,
        kind: symbol.kind,
        container: symbol.containerName ?? "",
        path,
        line: (range?.start.line ?? 0) + 1,
        column: (range?.start.character ?? 0) + 1,
      });
    }
    return symbols;
  }

  return { dispose, workspaceSymbols };
}

/** Saves notify every running client (didSave). */
const savedListeners = new Set<(path: string) => void>();
export function notifySaved(path: string) {
  for (const listener of savedListeners) listener(path);
}
