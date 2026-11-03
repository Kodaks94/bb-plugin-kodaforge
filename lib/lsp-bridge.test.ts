import { describe, expect, it } from "vitest";
import { createBridge, type BridgeHost } from "./lsp-bridge.js";

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

function fakeHost() {
  const sent: string[][] = [];
  const outbox: { seq: number; data: string }[] = [];
  let closed: string | null = null;
  let wake: (() => void) | null = null;
  const host: BridgeHost = {
    start: async () => ({ sessionId: "s", generation: 1 }),
    send: async (_id, _gen, messages) => {
      await tick();
      sent.push(messages);
    },
    receive: async (_id, _gen, after) => {
      while (outbox.every((m) => m.seq <= after) && closed === null) await new Promise<void>((r) => (wake = r));
      return { messages: outbox.filter((m) => m.seq > after), closed };
    },
  };
  return {
    host,
    sent,
    emit(data: string) {
      outbox.push({ seq: outbox.length + 1, data });
      wake?.();
    },
    close(reason: string) {
      closed = reason;
      wake?.();
    },
  };
}

describe("LSP bridge", () => {
  it("forwards client messages in order, batching while a send is in flight", async () => {
    const fake = fakeHost();
    const socket = { sent: [] as string[], send(d: string) { this.sent.push(d); }, close() {} };
    const bridge = createBridge(socket, fake.host);
    bridge.onMessage("1");
    bridge.onMessage("2");
    await bridge.ready;
    bridge.onMessage("3");
    bridge.onMessage("4");
    for (let i = 0; i < 10; i++) await tick();
    expect(fake.sent.flat()).toEqual(["1", "2", "3", "4"]);
    expect(fake.sent.length).toBeLessThan(4);
  });

  it("delivers server messages in sequence and closes when the server ends", async () => {
    const fake = fakeHost();
    const closes: [number | undefined, string | undefined][] = [];
    const socket = { sent: [] as string[], send(d: string) { this.sent.push(d); }, close(code?: number, reason?: string) { closes.push([code, reason]); } };
    const bridge = createBridge(socket, fake.host);
    await bridge.ready;
    fake.emit("a");
    fake.emit("b");
    await tick();
    fake.emit("c");
    await tick();
    fake.close("taken over by another IDE view");
    for (let i = 0; i < 5; i++) await tick();
    expect(socket.sent).toEqual(["a", "b", "c"]);
    expect(closes).toEqual([[4000, "taken over by another IDE view"]]);
  });

  it("closes the socket when the server cannot start", async () => {
    const closes: unknown[] = [];
    const host: BridgeHost = { ...fakeHost().host, start: async () => { throw new Error("No python language server found"); } };
    const bridge = createBridge({ send() {}, close: (code, reason) => closes.push([code, reason]) }, host);
    await bridge.ready;
    expect(closes).toEqual([[1011, "No python language server found"]]);
  });
});
