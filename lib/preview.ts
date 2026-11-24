/** Files that open as a preview tab instead of text, and how each one is shown. */
export type PreviewKind = "image" | "video" | "audio" | "pdf" | "document" | "sheet" | "slides";

const EXTENSIONS: Record<PreviewKind, readonly string[]> = {
  image: ["png", "jpg", "jpeg", "gif", "webp", "avif", "bmp", "ico"],
  video: ["mp4", "m4v", "webm", "mov", "ogv"],
  audio: ["mp3", "wav", "ogg", "oga", "m4a", "aac", "flac", "opus"],
  pdf: ["pdf"],
  document: ["docx"],
  sheet: ["xlsx", "xlsm", "xlsb", "xls", "ods"],
  slides: ["pptx"],
};

const KIND_OF = new Map(
  (Object.keys(EXTENSIONS) as PreviewKind[]).flatMap((kind) => EXTENSIONS[kind].map((extension) => [extension, kind] as const)),
);

export function previewKind(path: string): PreviewKind | null {
  const name = path.slice(path.lastIndexOf("/") + 1);
  const dot = name.lastIndexOf(".");
  return dot <= 0 ? null : (KIND_OF.get(name.slice(dot + 1).toLowerCase()) ?? null);
}

/** The viewer bundle (monaco/viewers/<name>.js) for the kinds a browser cannot show itself. */
export const VIEWERS: Partial<Record<PreviewKind, string>> = { document: "docx", sheet: "sheet", slides: "slides" };

/** Parsing a file costs several times its size in memory. */
export const MAX_DOCUMENT_BYTES = 40 * 1024 * 1024;

/**
 * The page a document viewer runs in. The file comes from the workspace and is not
 * trusted, so the frame that shows it is sandboxed without allow-same-origin (it cannot
 * reach BB), may run only the viewer script, and may load nothing from the network.
 */
export function viewerPage(script: string, nonce: string, colors: Readonly<Record<string, string>>): string {
  const policy = [
    "default-src 'none'",
    `script-src 'nonce-${nonce}'`,
    "style-src 'unsafe-inline'",
    "img-src data: blob:",
    "font-src data: blob:",
    "media-src data: blob:",
  ].join("; ");
  const variables = Object.entries(colors)
    .map(([name, value]) => `--${name}: ${value.replace(/[<>{};]/g, "")};`)
    .join(" ");
  return [
    '<!doctype html><html><head><meta charset="utf-8">',
    `<meta http-equiv="Content-Security-Policy" content="${policy}">`,
    `<style>:root { ${variables} } html, body { margin: 0; height: 100%; background: var(--background); color: var(--foreground); }</style>`,
    '</head><body><div id="root"></div>',
    `<script nonce="${nonce}">${script.replace(/<\/(script)/gi, "<\\/$1")}</script>`,
    "</body></html>",
  ].join("\n");
}
