// Server side of the language-server bridge: one browser WebSocket <-> one host
// session. Client messages go to the host in order, in batches; server messages
// come back through a long-poll on the host's numbered outbox, so none are lost
// or reordered even though host signals are best-effort.

export interface BridgeSocket {
  send(data: string): void;
  close(code?: number, reason?: string): void;
}

export interface BridgeHost {
  start(): Promise<{ sessionId: string; generation: number }>;
  send(sessionId: string, generation: number, messages: string[]): Promise<void>;
  receive(sessionId: string, generation: number, after: number): Promise<{ messages: { seq: number; data: string }[]; closed: string | null }>;
}

export function createBridge(socket: BridgeSocket, host: BridgeHost, log: (line: string) => void = () => undefined) {
  let session: { sessionId: string; generation: number } | null = null;
  let open = true;
  let queue: string[] = [];
  let sending = false;

  const fail = (reason: string) => {
    if (!open) return;
    open = false;
    log(`lsp bridge closed: ${reason}`);
    socket.close(reason.startsWith("taken over") ? 4000 : 1011, reason.slice(0, 120));
  };

  const flush = async () => {
    if (sending || session === null || queue.length === 0 || !open) return;
    sending = true;
    const batch = queue;
    queue = [];
    try {
      await host.send(session.sessionId, session.generation, batch);
    } catch (error) {
      fail((error as Error).message);
    } finally {
      sending = false;
    }
    if (queue.length > 0) void flush();
  };

  const pump = async () => {
    let after = 0;
    while (open && session !== null) {
      try {
        const { messages, closed } = await host.receive(session.sessionId, session.generation, after);
        for (const message of messages) {
          if (!open) return;
          socket.send(message.data);
          after = message.seq;
        }
        if (closed !== null && messages.length === 0) return fail(closed);
      } catch (error) {
        return fail((error as Error).message);
      }
    }
  };

  const ready = host.start().then(
    (started) => {
      session = started;
      void pump();
      void flush();
    },
    (error: Error) => fail(error.message),
  );

  return {
    ready,
    onMessage(data: string) {
      if (!open) return;
      queue.push(data);
      void flush();
    },
    /** The browser went away; the host session stays until idle or taken over. */
    close() {
      open = false;
    },
  };
}
