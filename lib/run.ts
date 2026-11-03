import { spawn } from "node:child_process";

export interface RunResult {
  code: number | null;
  stdout: string;
  stderr: string;
}

/**
 * Run a program without a shell, in `cwd`, with a time and output cap. Host-side
 * only: every caller passes the workspace root as `cwd`.
 */
export function run(
  command: string,
  args: readonly string[],
  options: { cwd: string; input?: string; timeoutMs?: number; maxBytes?: number; signal?: AbortSignal; env?: Record<string, string> },
): Promise<RunResult> {
  const maxBytes = options.maxBytes ?? 20 * 1024 * 1024;
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      // No stdin pipe unless there is input: a program that exits without reading
      // it would otherwise make the write fail with EPIPE.
      stdio: [options.input === undefined ? "ignore" : "pipe", "pipe", "pipe"],
      env: { ...process.env, GIT_TERMINAL_PROMPT: "0", GIT_OPTIONAL_LOCKS: "0", ...options.env },
      signal: options.signal,
    });
    const out: Buffer[] = [];
    const err: Buffer[] = [];
    let size = 0;
    const timer = setTimeout(() => child.kill("SIGKILL"), options.timeoutMs ?? 30_000);
    child.stdout!.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > maxBytes) child.kill("SIGKILL");
      else out.push(chunk);
    });
    child.stderr!.on("data", (chunk: Buffer) => err.push(chunk));
    child.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ code, stdout: Buffer.concat(out).toString("utf8"), stderr: Buffer.concat(err).toString("utf8") });
    });
    if (child.stdin !== null) {
      // A program may exit before reading all of its input; that is not an error here.
      child.stdin.on("error", () => undefined);
      child.stdin.end(options.input);
    }
  });
}
