import { expect, it } from "vitest";
import { encodeMessage, FrameDecoder } from "./lsp-framing.js";

it("round-trips messages split at any byte, with multibyte text", () => {
  const messages = ['{"id":1,"result":"héllo ✓"}', '{"method":"x"}', "{}"];
  const stream = Buffer.concat(messages.map(encodeMessage));
  for (const size of [1, 2, 7, stream.length]) {
    const decoder = new FrameDecoder();
    const out: string[] = [];
    for (let i = 0; i < stream.length; i += size) out.push(...decoder.push(stream.subarray(i, i + size)));
    expect(out).toEqual(messages);
  }
});

it("skips a header without Content-Length", () => {
  const decoder = new FrameDecoder();
  const out = decoder.push(Buffer.concat([Buffer.from("X-Junk: 1\r\n\r\n"), encodeMessage('{"ok":1}')]));
  expect(out).toEqual(['{"ok":1}']);
});
