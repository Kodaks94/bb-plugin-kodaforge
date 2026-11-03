// Debugging over the Debug Adapter Protocol: a small DAP client on the plugin's
// /dap WebSocket (debugpy behind it), and the hook the Run and Debug view uses.
import { useCallback, useEffect, useRef, useState } from "react";
import { useRpc } from "@get-bb/plugin-sdk/app";
import type { rpcContract, Scope } from "../server";
import { fromFileUri } from "./lsp";

export type DebugStatus = "idle" | "starting" | "running" | "stopped" | "terminated";

export interface Frame {
  id: number;
  name: string;
  path: string | null;
  line: number;
  column: number;
}

export interface Variable {
  name: string;
  value: string;
  type?: string;
  variablesReference: number;
}

export interface ConsoleLine {
  category: "stdout" | "stderr" | "console" | "input" | "result" | "error";
  text: string;
}

class DapConnection {
  private seq = 1;
  private pending = new Map<number, { resolve(body: any): void; reject(error: Error): void }>();
  private handlers = new Map<string, (body: any) => void>();
  onClose: (reason: string) => void = () => undefined;

  private constructor(private readonly socket: WebSocket) {
    socket.addEventListener("message", (event) => this.receive(String(event.data)));
    socket.addEventListener("close", (event) => {
      for (const { reject } of this.pending.values()) reject(new Error("debugger disconnected"));
      this.pending.clear();
      this.onClose(event.reason || "closed");
    });
  }

  static open(url: string): Promise<DapConnection> {
    return new Promise((resolve, reject) => {
      const socket = new WebSocket(url);
      socket.addEventListener("open", () => resolve(new DapConnection(socket)), { once: true });
      socket.addEventListener("error", () => reject(new Error("could not reach the debug adapter")), { once: true });
    });
  }

  request<T = any>(command: string, args?: unknown, timeoutMs = 30_000): Promise<T> {
    const seq = this.seq++;
    this.socket.send(JSON.stringify({ seq, type: "request", command, arguments: args }));
    return new Promise<T>((resolve, reject) => {
      const timer = timeoutMs > 0 ? setTimeout(() => (this.pending.delete(seq), reject(new Error(`${command} timed out`))), timeoutMs) : null;
      this.pending.set(seq, {
        resolve: (body) => (timer && clearTimeout(timer), resolve(body)),
        reject: (error) => (timer && clearTimeout(timer), reject(error)),
      });
    });
  }

  on(event: string, handler: (body: any) => void) {
    this.handlers.set(event, handler);
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
    if (message.type === "response") {
      const waiter = this.pending.get(message.request_seq);
      this.pending.delete(message.request_seq);
      if (message.success) waiter?.resolve(message.body ?? {});
      else waiter?.reject(new Error(message.message ?? `${message.command} failed`));
    } else if (message.type === "event") {
      this.handlers.get(message.event)?.(message.body ?? {});
    } else if (message.type === "request") {
      // KodaForge runs programs in the debug console only; refuse reverse requests.
      this.socket.send(
        JSON.stringify({ seq: this.seq++, type: "response", request_seq: message.seq, command: message.command, success: false, message: "not supported" }),
      );
    }
  }
}

const BP_KEY = (scope: Scope) => `kodaforge:breakpoints:${scope.kind}:${scope.id}`;

export function useDebugger(scope: Scope, root: string | null, log: (line: string) => void) {
  const rpc = useRpc<typeof rpcContract>();
  const conn = useRef<DapConnection | null>(null);
  const configured = useRef(false);
  const [status, setStatus] = useState<DebugStatus>("idle");
  const [stopped, setStopped] = useState<{ threadId: number; reason: string; description?: string } | null>(null);
  const [frames, setFrames] = useState<Frame[]>([]);
  const [frameId, setFrameId] = useState<number | null>(null);
  const [scopes, setScopes] = useState<{ name: string; variablesReference: number; expensive: boolean }[]>([]);
  const [variables, setVariables] = useState<Record<number, Variable[]>>({});
  const [consoleLines, setConsoleLines] = useState<ConsoleLine[]>([]);
  const [program, setProgram] = useState<{ path: string; args: string } | null>(null);
  const [breakpoints, setBreakpoints] = useState<Record<string, number[]>>(() => {
    try {
      return JSON.parse(localStorage.getItem(BP_KEY(scope)) ?? "{}");
    } catch {
      return {};
    }
  });
  const breakpointsRef = useRef(breakpoints);
  breakpointsRef.current = breakpoints;
  useEffect(() => {
    localStorage.setItem(BP_KEY(scope), JSON.stringify(breakpoints));
  }, [scope, breakpoints]);

  const print = useCallback((category: ConsoleLine["category"], text: string) => {
    setConsoleLines((lines) => [...lines.slice(-1999), { category, text }]);
  }, []);

  const abs = useCallback((path: string) => `${root!.replace(/\/+$/, "")}/${path}`, [root]);
  const rel = useCallback(
    (sourcePath: string | undefined) => (sourcePath && root ? fromFileUri(root, `file://${encodeURI(sourcePath)}`) : null),
    [root],
  );

  const sendBreakpoints = useCallback(
    async (path: string, lines: number[]) => {
      if (conn.current === null || !configured.current) return;
      await conn.current
        .request("setBreakpoints", { source: { path: abs(path) }, breakpoints: lines.map((line) => ({ line })) })
        .catch((error: Error) => print("error", `Breakpoints for ${path}: ${error.message}`));
    },
    [abs, print],
  );

  const loadVariables = useCallback(async (reference: number) => {
    if (conn.current === null || reference === 0) return;
    const body = await conn.current.request<{ variables: Variable[] }>("variables", { variablesReference: reference }).catch(() => ({ variables: [] }));
    setVariables((current) => ({ ...current, [reference]: body.variables }));
  }, []);

  const selectFrame = useCallback(
    async (id: number) => {
      if (conn.current === null) return;
      setFrameId(id);
      const body = await conn.current.request<{ scopes: { name: string; variablesReference: number; expensive: boolean }[] }>("scopes", { frameId: id }).catch(() => ({ scopes: [] }));
      setScopes(body.scopes);
      setVariables({});
      for (const entry of body.scopes) if (!entry.expensive) void loadVariables(entry.variablesReference);
    },
    [loadVariables],
  );

  const reset = useCallback(() => {
    conn.current = null;
    configured.current = false;
    setStopped(null);
    setFrames([]);
    setFrameId(null);
    setScopes([]);
    setVariables({});
  }, []);

  const start = useCallback(
    async (path: string, args: string) => {
      if (root === null || conn.current !== null) return;
      setProgram({ path, args });
      setStatus("starting");
      setConsoleLines([]);
      print("console", `Running python ${path}${args ? ` ${args}` : ""}`);
      try {
        const { dapPath, token } = await rpc.call("lspEndpoint", null);
        const url = new URL(dapPath, window.location.origin);
        url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
        url.search = new URLSearchParams({ token, kind: scope.kind, id: scope.id, language: "python" }).toString();
        const connection = await DapConnection.open(url.toString());
        conn.current = connection;
        connection.onClose = (reason) => {
          if (conn.current !== connection) return;
          if (reason !== "closed") print("console", `Debugger: ${reason}`);
          reset();
          setStatus("terminated");
        };
        connection.on("output", (body) => {
          if (body.category === "telemetry") return;
          print(body.category === "stderr" ? "stderr" : body.category === "stdout" ? "stdout" : "console", String(body.output ?? "").replace(/\n$/, ""));
        });
        connection.on("stopped", async (body) => {
          setStatus("stopped");
          setStopped({ threadId: body.threadId, reason: body.reason, description: body.description ?? body.text });
          const trace = await connection
            .request<{ stackFrames: { id: number; name: string; source?: { path?: string }; line: number; column: number }[] }>("stackTrace", {
              threadId: body.threadId,
              startFrame: 0,
              levels: 50,
            })
            .catch(() => ({ stackFrames: [] }));
          const list = trace.stackFrames.map((frame) => ({ id: frame.id, name: frame.name, path: rel(frame.source?.path), line: frame.line, column: frame.column }));
          setFrames(list);
          if (list[0]) void selectFrame(list[0].id);
          if (body.reason === "exception") print("stderr", `Paused on exception${body.text ? `: ${body.text}` : ""}`);
        });
        connection.on("continued", () => {
          setStatus("running");
          setStopped(null);
          setFrames([]);
          setScopes([]);
        });
        connection.on("terminated", () => {
          print("console", "Program ended");
          setStatus("terminated");
          reset();
          connection.close();
        });
        connection.on("exited", (body) => print("console", `Exit code ${body.exitCode}`));

        await connection.request("initialize", {
          clientID: "kodaforge",
          clientName: "KodaForge",
          adapterID: "debugpy",
          pathFormat: "path",
          linesStartAt1: true,
          columnsStartAt1: true,
          supportsVariableType: true,
          supportsRunInTerminalRequest: false,
        });
        const initialized = new Promise<void>((resolve) => connection.on("initialized", () => resolve()));
        // debugpy answers `launch` only after configurationDone, so it is not awaited yet.
        const launched = connection.request(
          "launch",
          {
            name: "KodaForge",
            type: "python",
            request: "launch",
            program: abs(path),
            args: args.trim() === "" ? [] : args.trim().split(/\s+/),
            cwd: root,
            console: "internalConsole",
            redirectOutput: true,
            justMyCode: true,
          },
          0,
        );
        await initialized;
        configured.current = true;
        for (const [file, lines] of Object.entries(breakpointsRef.current)) if (lines.length > 0) await sendBreakpoints(file, lines);
        await connection.request("setExceptionBreakpoints", { filters: ["uncaught"] }).catch(() => undefined);
        await connection.request("configurationDone");
        await launched;
        setStatus((current) => (current === "starting" ? "running" : current));
        log(`Debugging ${path}`);
      } catch (error) {
        print("error", (error as Error).message);
        log(`Debugger: ${(error as Error).message}`);
        conn.current?.close();
        reset();
        setStatus("idle");
      }
    },
    [root, rpc, scope, print, reset, abs, rel, selectFrame, sendBreakpoints, log],
  );

  const threadOf = useCallback(async () => {
    if (stopped) return stopped.threadId;
    const body = await conn.current?.request<{ threads: { id: number }[] }>("threads").catch(() => ({ threads: [] }));
    return body?.threads[0]?.id ?? 1;
  }, [stopped]);

  const step = useCallback(
    async (command: "continue" | "next" | "stepIn" | "stepOut" | "pause") => {
      if (conn.current === null) return;
      const threadId = await threadOf();
      await conn.current.request(command, { threadId }).catch((error: Error) => print("error", `${command}: ${error.message}`));
      if (command !== "pause") {
        setStatus("running");
        setStopped(null);
      }
    },
    [threadOf, print],
  );

  const stop = useCallback(async () => {
    const connection = conn.current;
    if (connection === null) return;
    await connection.request("disconnect", { terminateDebuggee: true }, 5000).catch(() => undefined);
    connection.close();
    reset();
    setStatus("terminated");
  }, [reset]);

  const restart = useCallback(async () => {
    if (program === null) return;
    await stop();
    await start(program.path, program.args);
  }, [program, stop, start]);

  const evaluate = useCallback(
    async (expression: string) => {
      print("input", `> ${expression}`);
      if (conn.current === null) return print("error", "Start debugging to evaluate expressions.");
      try {
        const body = await conn.current.request<{ result: string }>("evaluate", { expression, frameId: frameId ?? undefined, context: "repl" });
        print("result", body.result);
      } catch (error) {
        print("error", (error as Error).message);
      }
    },
    [frameId, print],
  );

  const toggleBreakpoint = useCallback(
    (path: string, line: number) => {
      const current = breakpointsRef.current[path] ?? [];
      const lines = current.includes(line) ? current.filter((l) => l !== line) : [...current, line].sort((a, b) => a - b);
      setBreakpoints((all) => {
        const next = { ...all, [path]: lines };
        if (lines.length === 0) delete next[path];
        return next;
      });
      void sendBreakpoints(path, lines);
    },
    [sendBreakpoints],
  );

  const clearBreakpoints = useCallback(() => {
    for (const path of Object.keys(breakpointsRef.current)) void sendBreakpoints(path, []);
    setBreakpoints({});
  }, [sendBreakpoints]);

  useEffect(() => {
    () => conn.current?.close();
  }, []);

  const frame = frames.find((f) => f.id === frameId) ?? null;
  return {
    status,
    active: status === "starting" || status === "running" || status === "stopped",
    stopped,
    frames,
    frame,
    scopes,
    variables,
    consoleLines,
    program,
    breakpoints,
    start,
    step,
    stop,
    restart,
    evaluate,
    selectFrame,
    loadVariables,
    toggleBreakpoint,
    clearBreakpoints,
    clearConsole: () => setConsoleLines([]),
  };
}

export type Debugger = ReturnType<typeof useDebugger>;
