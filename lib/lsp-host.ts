// Host side of the language-server bridge: one process per workspace root and
// language, started on demand, read through a numbered outbox the server pulls
// from, and stopped after ten idle minutes.
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { access, constants } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import { encodeMessage, FrameDecoder } from "./lsp-framing.js";
import { resolveTypeScriptServer, type ServerCommand } from "./ts-server.js";

export type LspLanguage = "python" | "typescript";

const PYTHON_SERVERS = ["basedpyright-langserver", "pyright-langserver"];

/** The command for a language in this workspace; throws a message the status bar can show. */
export async function resolveServer(root: string, language: LspLanguage, find: typeof findBinary): Promise<ServerCommand> {
  if (language === "typescript") return resolveTypeScriptServer(root, find);
  const binary = await find(root, PYTHON_SERVERS);
  if (binary === null) throw new Error(`No Python language server found. Install ${PYTHON_SERVERS.join(" or ")} in the project or on PATH.`);
  return { command: binary, args: ["--stdio"], initializationOptions: {}, label: path.basename(binary) };
}

export const IDLE_MS = 10 * 60_000;
const OUTBOX_LIMIT = 10_000;

/**
 * Project-local binaries first (node_modules/.bin, .venv/bin), then PATH plus the
 * usual install dirs a GUI-launched daemon's PATH tends to miss.
 */
export async function findBinary(root: string, names: readonly string[]): Promise<string | null> {
  const dirs = [
    path.join(root, "node_modules", ".bin"),
    path.join(root, ".venv", "bin"),
    path.join(root, "venv", "bin"),
    ...(process.env.PATH ?? "").split(path.delimiter),
    "/opt/homebrew/bin",
    "/usr/local/bin",
    path.join(homedir(), ".local", "bin"),
    path.join(homedir(), ".cargo", "bin"),
  ].filter(Boolean);
  for (const name of names) {
    for (const dir of dirs) {
      const candidate = path.join(dir, process.platform === "win32" ? `${name}.cmd` : name);
      try {
        await access(candidate, constants.X_OK);
        return candidate;
      } catch {
        // keep looking
      }
    }
  }
  return null;
}

/** Merge host-only settings into the client's `initialize` request; other messages pass through. */
export function withInitializationOptions(message: string, extra: Record<string, unknown>): string {
  if (!message.includes('"initialize"')) return message;
  try {
    const parsed = JSON.parse(message);
    if (parsed.method !== "initialize") return message;
    parsed.params = parsed.params ?? {};
    parsed.params.initializationOptions = { ...extra, ...(parsed.params.initializationOptions ?? {}) };
    return JSON.stringify(parsed);
  } catch {
    return message;
  }
}

interface Session {
  id: string;
  root: string;
  language: LspLanguage;
  generation: number;
  child: ChildProcessWithoutNullStreams;
  outbox: { seq: number; data: string }[];
  nextSeq: number;
  closed: string | null;
  lastUsed: number;
  waiters: Set<() => void>;
  initializationOptions: Record<string, unknown>;
}

export class LspHost {
  private sessions = new Map<string, Session>();
  private generations = 0;
  private sweeper: ReturnType<typeof setInterval>;

  constructor(
    private readonly spawnServer = spawnProcess,
    private readonly find: typeof findBinary = findBinary,
  ) {
    this.sweeper = setInterval(() => this.reap(), 30_000);
    this.sweeper.unref?.();
  }

  /** Start (or restart, for a new client) the server for this root and language. */
  async start(root: string, language: LspLanguage): Promise<{ sessionId: string; generation: number; command: string }> {
    const server = await resolveServer(root, language, this.find);
    const id = `${language}:${root}`;
    // One client per server: a new IDE view takes the session over (a server cannot be initialized twice).
    this.stop(id, "taken over by another IDE view");
    const child = this.spawnServer(server.command, server.args, root);
    const session: Session = {
      id,
      root,
      language,
      generation: ++this.generations,
      child,
      outbox: [],
      nextSeq: 1,
      closed: null,
      lastUsed: Date.now(),
      waiters: new Set(),
      initializationOptions: server.initializationOptions,
    };
    const decoder = new FrameDecoder();
    child.stdout.on("data", (chunk: Buffer) => {
      for (const data of decoder.push(chunk)) {
        session.outbox.push({ seq: session.nextSeq++, data });
        if (session.outbox.length > OUTBOX_LIMIT) session.outbox.shift();
      }
      this.wake(session);
    });
    child.stderr.on("data", () => undefined);
    child.on("exit", (code) => {
      session.closed ??= `language server exited (${code ?? "signal"})`;
      this.wake(session);
    });
    child.on("error", (error) => {
      session.closed ??= error.message;
      this.wake(session);
    });
    this.sessions.set(id, session);
    return { sessionId: id, generation: session.generation, command: server.label };
  }

  send(sessionId: string, generation: number, messages: readonly string[]): void {
    const session = this.current(sessionId, generation);
    session.lastUsed = Date.now();
    for (const message of messages) {
      session.child.stdin.write(encodeMessage(withInitializationOptions(message, session.initializationOptions)));
    }
  }

  /** Long-poll: messages after `after`, waiting up to `waitMs` for the first one. */
  async receive(
    sessionId: string,
    generation: number,
    after: number,
    waitMs: number,
    signal?: AbortSignal,
  ): Promise<{ messages: { seq: number; data: string }[]; closed: string | null }> {
    const session = this.sessions.get(sessionId);
    if (session === undefined || session.generation !== generation) {
      return { messages: [], closed: "taken over by another IDE view" };
    }
    session.lastUsed = Date.now();
    const pending = () => session.outbox.filter((entry) => entry.seq > after);
    if (pending().length === 0 && session.closed === null) {
      await new Promise<void>((resolve) => {
        const done = () => {
          clearTimeout(timer);
          session.waiters.delete(done);
          resolve();
        };
        const timer = setTimeout(done, waitMs);
        session.waiters.add(done);
        signal?.addEventListener("abort", done, { once: true });
      });
    }
    return { messages: pending().slice(0, 500), closed: session.closed };
  }

  stop(sessionId: string, reason = "stopped"): void {
    const session = this.sessions.get(sessionId);
    if (session === undefined) return;
    this.sessions.delete(sessionId);
    session.closed ??= reason;
    this.wake(session);
    session.child.kill();
  }

  disposeAll(): void {
    clearInterval(this.sweeper);
    for (const id of [...this.sessions.keys()]) this.stop(id, "plugin stopped");
  }

  private current(sessionId: string, generation: number): Session {
    const session = this.sessions.get(sessionId);
    if (session === undefined || session.generation !== generation) throw new Error("Language server session is gone");
    if (session.closed !== null) throw new Error(session.closed);
    return session;
  }

  private wake(session: Session) {
    for (const waiter of [...session.waiters]) waiter();
  }

  private reap() {
    const now = Date.now();
    for (const session of [...this.sessions.values()]) {
      if (now - session.lastUsed > IDLE_MS) this.stop(session.id, "idle");
    }
  }
}

function spawnProcess(command: string, args: readonly string[], root: string): ChildProcessWithoutNullStreams {
  return spawn(command, args, { cwd: root, stdio: ["pipe", "pipe", "pipe"], env: process.env });
}
