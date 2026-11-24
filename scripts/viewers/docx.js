import { renderAsync } from "docx-preview";
import { serve } from "./frame.js";

// A page wider than the tab scrolls from its left edge instead of losing it.
const CSS = `.docx-wrapper { background: var(--muted) !important; padding: 16px !important; align-items: safe center !important; }`;

// Embedded HTML parts (altChunks) stay out; comments and tracked changes are shown as in Word.
serve(async (bytes, root) => {
  await renderAsync(bytes, root, document.head, { renderAltChunks: false, useBase64URL: true, ignoreLastRenderedPageBreak: false });
  document.head.append(Object.assign(document.createElement("style"), { textContent: CSS }));
});
