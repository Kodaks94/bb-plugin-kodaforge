// LSP base protocol: `Content-Length: N\r\n\r\n` followed by N bytes of JSON.

export function encodeMessage(json: string): Buffer {
  const body = Buffer.from(json, "utf8");
  return Buffer.concat([Buffer.from(`Content-Length: ${body.length}\r\n\r\n`, "ascii"), body]);
}

/** Incremental decoder: feed it stdout chunks, get whole message bodies out. */
export class FrameDecoder {
  private buffer: Buffer = Buffer.alloc(0);

  push(chunk: Buffer): string[] {
    this.buffer = this.buffer.length === 0 ? chunk : Buffer.concat([this.buffer, chunk]);
    const messages: string[] = [];
    for (;;) {
      const headerEnd = this.buffer.indexOf("\r\n\r\n");
      if (headerEnd === -1) break;
      const header = this.buffer.subarray(0, headerEnd).toString("ascii");
      const length = /content-length:\s*(\d+)/i.exec(header);
      if (length === null) {
        // Not a frame we understand: drop the header so one bad write cannot wedge the stream.
        this.buffer = this.buffer.subarray(headerEnd + 4);
        continue;
      }
      const start = headerEnd + 4;
      const end = start + Number(length[1]);
      if (this.buffer.length < end) break;
      messages.push(this.buffer.subarray(start, end).toString("utf8"));
      this.buffer = this.buffer.subarray(end);
    }
    return messages;
  }
}
