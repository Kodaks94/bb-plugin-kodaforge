// Bundles Monaco into ./monaco (editor.js, editor.css, editor.worker.js + chunks),
// which server.ts serves through bb.sdk.files.createPreview and the app import()s
// only when an editor opens — the way BB's builtin monaco-editor plugin does it.
import { build } from "esbuild";
import { rm } from "node:fs/promises";

await rm("monaco", { recursive: true, force: true });
await build({
  entryPoints: {
    editor: "scripts/monaco-entry.js",
    "editor.worker": "monaco-editor/esm/vs/editor/editor.worker.js",
  },
  outdir: "monaco",
  bundle: true,
  format: "esm",
  splitting: true,
  minify: true,
  target: "es2022",
  loader: { ".ttf": "file" },
  chunkNames: "chunks/[name]-[hash]",
  assetNames: "[name]-[hash]",
  logLevel: "warning",
});
