// Copies the Material Icon Theme (MIT, PKief) into ./monaco/file-icons with a
// compact lookup map, served beside the Monaco bundle. Only icons the map can
// reach are copied.
import { cpSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const root = path.dirname(require.resolve("material-icon-theme/package.json"));
const manifest = JSON.parse(readFileSync(path.join(root, "dist", "material-icons.json"), "utf8"));
const out = "monaco/file-icons";
mkdirSync(out, { recursive: true });

// Extensions VS Code resolves through a language id rather than fileExtensions.
const LANGUAGE_BY_EXTENSION = {
  ts: "typescript", mts: "typescript", cts: "typescript", tsx: "typescriptreact",
  js: "javascript", mjs: "javascript", cjs: "javascript", jsx: "javascriptreact",
  py: "python", pyi: "python", json: "json", jsonc: "jsonc", md: "markdown", css: "css", scss: "scss",
  less: "less", html: "html", go: "go", rs: "rust", java: "java", c: "c", h: "c", cpp: "cpp", hpp: "cpp",
  cs: "csharp", rb: "ruby", php: "php", sh: "shellscript", bash: "shellscript", zsh: "shellscript",
  yml: "yaml", yaml: "yaml", sql: "sql", xml: "xml", swift: "swift", kt: "kotlin", lua: "lua",
  r: "r", dart: "dart", vue: "vue", svelte: "svelte", ps1: "powershell", bat: "bat", ini: "ini",
  dockerfile: "dockerfile", makefile: "makefile", txt: "plaintext", log: "log", diff: "diff",
};

const used = new Set([manifest.file, manifest.folder, manifest.folderExpanded]);
const pick = (table = {}) => {
  const result = {};
  for (const [key, icon] of Object.entries(table)) {
    result[key.toLowerCase()] = icon;
    used.add(icon);
  }
  return result;
};
const languages = {};
for (const [ext, language] of Object.entries(LANGUAGE_BY_EXTENSION)) {
  const icon = manifest.languageIds[language];
  if (icon) {
    languages[ext] = icon;
    used.add(icon);
  }
}
const map = {
  file: manifest.file,
  folder: manifest.folder,
  folderOpen: manifest.folderExpanded,
  names: pick(manifest.fileNames),
  extensions: pick(manifest.fileExtensions),
  languages,
  folders: pick(manifest.folderNames),
  foldersOpen: pick(manifest.folderNamesExpanded),
  light: {
    names: pick(manifest.light?.fileNames),
    extensions: pick(manifest.light?.fileExtensions),
    folders: pick(manifest.light?.folderNames),
    foldersOpen: pick(manifest.light?.folderNamesExpanded),
  },
};
let copied = 0;
for (const icon of used) {
  const definition = manifest.iconDefinitions[icon];
  if (!definition) continue;
  cpSync(path.join(root, "dist", definition.iconPath), path.join(out, `${icon}.svg`));
  copied++;
}
writeFileSync(path.join(out, "map.json"), JSON.stringify(map));
cpSync(path.join(root, "LICENSE"), path.join(out, "LICENSE"));
console.log(`file icons: ${copied} icons, map ${(JSON.stringify(map).length / 1024).toFixed(0)} KB`);
