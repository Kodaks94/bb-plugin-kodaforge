/** KodaForge terminals are titled "Koda 1", "Koda 2"… so a reopened IDE finds its own and not BB's others. */
export const TITLE_PREFIX = "Koda ";

/** UTF-8 text → base64, for terminals.input. */
export function encodeBase64(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

/** base64 → bytes, for xterm.write (it decodes UTF-8 itself, across chunk boundaries). */
export function decodeBase64(data: string): Uint8Array {
  const binary = atob(data);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/** Poll fast while output flows, back off when idle, and slowest when hidden. */
export function nextPollDelay(current: number, hadData: boolean, visible: boolean): number {
  if (hadData) return 30;
  return Math.min(current * 1.6, visible ? 400 : 2000);
}
