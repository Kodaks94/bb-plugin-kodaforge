import { PassThrough } from "node:stream";
import { EventEmitter } from "node:events";
import { mkdtemp, mkdir, rm, writeFile, chmod } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, expect, it } from "vitest";
import { encodeMessage, FrameDecoder } from "./lsp-framing.js";
import { LspHost, withInitializationOptions } from "./lsp-host.js";

let root: string;
beforeAll(async () => {
  root = await mkdtemp(path.join(tmpdir(), "ide-lsp-"));
  await mkdir(path.join(root, "node_modules", ".bin"), { recursive: true });
  const bin = path.join(root, "node_modules", ".bin", "typescript-language-server");
  await writeFile(bin, "#!/bin/sh\n");
  await chmod(bin, 0o755);
});
afterAll(() => rm(root, { recursive: true, force: true }));

/** A fake language server: echoes each request back as a result, in order. */
function fakeServer() {
  const stdin = new PassThrough();
  const stdout = new PassThrough();
  const child = Object.assign(new EventEmitter(), { stdin, stdout, stderr: new PassThrough(), kill: () => child.emit("exit", 0) });
  const decoder = new FrameDecoder();
  const received: string[] = [];
  stdin.on("data", (chunk: Buffer) => {
    for (const message of decoder.push(chunk)) {
      received.push(message);
      const { id } = JSON.parse(message);
      stdout.write(encodeMessage(JSON.stringify({ id, result: received.length })));
    }
  });
  return { child: child as never, received };
}

it("starts one server per root and language, relays in order, and lets a new client take over", async () => {
  const servers: ReturnType<typeof fakeServer>[] = [];
  const host = new LspHost(() => {
    const server = fakeServer();
    servers.push(server);
    return server.child;
  });
  const first = await host.start(root, "typescript");
  host.send(first.sessionId, first.generation, ['{"id":1,"method":"initialize","params":{}}', '{"id":2,"method":"x"}']);
  const got = await host.receive(first.sessionId, first.generation, 0, 1000);
  expect(got.messages.map((m) => JSON.parse(m.data).id)).toEqual([1, 2]);
  expect((await host.receive(first.sessionId, first.generation, got.messages[1]!.seq, 10)).messages).toEqual([]);

  const second = await host.start(root, "typescript");
  expect(servers).toHaveLength(2);
  expect((await host.receive(first.sessionId, first.generation, 0, 10)).closed).toMatch(/taken over/);
  expect(() => host.send(first.sessionId, first.generation, ["{}"])).toThrow();
  host.disposeAll();
  expect(second.generation).toBeGreaterThan(first.generation);
});

it("reports a missing server clearly", async () => {
  const host = new LspHost(undefined, async () => null);
  await expect(host.start(root, "python")).rejects.toThrow(/No Python language server/);
  host.disposeAll();
});

it("injects host-only initialization options into initialize only", () => {
  const extra = { tsserver: { fallbackPath: "/ts/lib" } };
  expect(JSON.parse(withInitializationOptions('{"id":1,"method":"initialize","params":{"initializationOptions":{"a":1}}}', extra)).params.initializationOptions).toEqual({ tsserver: { fallbackPath: "/ts/lib" }, a: 1 });
  expect(withInitializationOptions('{"method":"textDocument/didOpen"}', extra)).toBe('{"method":"textDocument/didOpen"}');
});
