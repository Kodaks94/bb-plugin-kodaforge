import { init } from "pptx-preview";
import { serve } from "./frame.js";

// The library scrolls in a box of the slide's size; let the page scroll instead.
const CSS = `.pptx-preview-wrapper { width: auto !important; height: auto !important; min-height: 100vh; overflow: visible !important; background: var(--muted) !important; }`;

serve((bytes, root) => {
  document.head.append(Object.assign(document.createElement("style"), { textContent: CSS }));
  const width = Math.min(960, Math.max(320, document.documentElement.clientWidth - 48));
  return init(root, { width, height: Math.round((width * 9) / 16) }).preview(bytes);
});
