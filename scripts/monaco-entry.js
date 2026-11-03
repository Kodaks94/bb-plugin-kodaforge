// The editor core with every editor feature (find/replace, minimap, folding…)
// plus Monarch syntax highlighting for ~80 languages. No TS/JSON/CSS language
// workers: language smarts come from real language servers (phase 4).
import * as monaco from "monaco-editor/esm/vs/editor/edcore.main.js";
import "monaco-editor/esm/vs/basic-languages/monaco.contribution.js";
export { monaco };
