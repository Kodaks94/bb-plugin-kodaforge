import { expect, it } from "vitest";
import { decodeBase64, encodeBase64, nextPollDelay } from "./terminal-io.js";

it("round-trips UTF-8 through base64", () => {
  const text = "ls -la ✓ é\r";
  expect(new TextDecoder().decode(decodeBase64(encodeBase64(text)))).toBe(text);
  expect(encodeBase64("\x03")).toBe("Aw==");
});

it("polls fast while output flows and backs off when idle", () => {
  expect(nextPollDelay(400, true, true)).toBe(30);
  let delay = 30;
  for (let i = 0; i < 20; i++) delay = nextPollDelay(delay, false, true);
  expect(delay).toBe(400);
  expect(nextPollDelay(1500, false, false)).toBe(2000);
});
