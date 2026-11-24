// Bundles the document viewers into ./monaco/viewers, one script per file kind. The app
// fetches one the first time such a file opens and runs it in a sandboxed frame.
import { build } from "esbuild";

await build({
  entryPoints: { docx: "scripts/viewers/docx.js", sheet: "scripts/viewers/sheet.js", slides: "scripts/viewers/slides.js" },
  outdir: "monaco/viewers",
  bundle: true,
  format: "iife",
  minify: true,
  target: "es2022",
  legalComments: "eof",
  logLevel: "warning",
});
