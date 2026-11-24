// A tab for a file that is not text: images, video and audio by the browser itself,
// PDF by its built-in viewer, office documents by a viewer bundle in a sandboxed frame.
import { useEffect, useRef, useState } from "react";
import { useRpc } from "@get-bb/plugin-sdk/app";
import type { rpcContract, Scope } from "../server";
import { MAX_DOCUMENT_BYTES, previewKind, VIEWERS, viewerPage } from "@/lib/preview";

export function PreviewView({ scope, path, revision, assetsUrl }: {
  scope: Scope;
  path: string;
  /** Grows when the file changes on disk: load it again. */
  revision: number;
  assetsUrl: string | null;
}) {
  const rpc = useRpc<typeof rpcContract>();
  const [url, setUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const kind = previewKind(path);
  useEffect(() => {
    let cancelled = false;
    setError(null);
    rpc.call("previewUrl", { scope, path }).then(
      (found) => !cancelled && setUrl(`${found.url}?v=${revision}`),
      (cause: Error) => !cancelled && setError(cause.message),
    );
    return () => {
      cancelled = true;
    };
  }, [rpc, scope, path, revision]);

  if (error !== null) return <Message text={`Could not open ${path}: ${error}`} />;
  if (url === null) return <Message text="Loading…" />;
  const failed = () => setError("this browser cannot show it");
  if (kind === "image") return <ImagePreview key={url} url={url} name={path} onError={failed} />;
  if (kind === "video") {
    return (
      <div className="flex h-full items-center justify-center bg-black">
        <video key={url} src={url} controls className="max-h-full max-w-full" onError={failed} />
      </div>
    );
  }
  if (kind === "audio") {
    return (
      <div className="flex h-full items-center justify-center p-6">
        <audio key={url} src={url} controls className="w-full max-w-xl" onError={failed} />
      </div>
    );
  }
  if (kind === "pdf") return <PdfPreview url={url} name={path} onError={setError} />;
  const viewer = kind === null ? undefined : VIEWERS[kind];
  if (viewer !== undefined && assetsUrl !== null) return <DocumentPreview url={url} name={path} viewer={viewer} assetsUrl={assetsUrl} onError={setError} />;
  return <Message text="This file is not text and has no preview." download={url} />;
}

function Message({ text, download }: { text: string; download?: string }) {
  return (
    <div role="status" className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center text-sm text-muted-foreground">
      <p className="max-w-lg break-words">{text}</p>
      {download ? <a href={download} download className="rounded border border-border px-2 py-1 text-xs hover:bg-muted">Download</a> : null}
    </div>
  );
}

/** Fits the tab; a click switches to the image's own size and back. */
function ImagePreview({ url, name, onError }: { url: string; name: string; onError(): void }) {
  const [actual, setActual] = useState(false);
  return (
    <div className={`h-full overflow-auto p-4 ${actual ? "" : "flex items-center justify-center"}`}>
      <img
        src={url}
        alt={name}
        className={actual ? "max-w-none cursor-zoom-out" : "max-h-full max-w-full cursor-zoom-in object-contain"}
        onClick={() => setActual((value) => !value)}
        onError={onError}
      />
    </div>
  );
}

/** The file's bytes, refused when parsing them would take too much memory. */
async function loadBytes(url: string, signal: AbortSignal): Promise<ArrayBuffer> {
  const response = await fetch(url, { signal });
  if (!response.ok) throw new Error(response.status === 404 ? "the file does not exist" : `the preview answered ${response.status}`);
  if (Number(response.headers.get("content-length") ?? 0) > MAX_DOCUMENT_BYTES) {
    await response.body?.cancel();
    throw new Error(`files over ${MAX_DOCUMENT_BYTES / 1024 / 1024} MB are not previewed`);
  }
  return response.arrayBuffer();
}

function PdfPreview({ url, name, onError }: { url: string; name: string; onError(message: string): void }) {
  const [blobUrl, setBlobUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!navigator.pdfViewerEnabled) return;
    const controller = new AbortController();
    let created: string | null = null;
    loadBytes(url, controller.signal).then(
      (bytes) => {
        // A fixed type: whatever the file holds, the browser treats it as PDF, never as a page.
        created = URL.createObjectURL(new Blob([bytes], { type: "application/pdf" }));
        setBlobUrl(created);
      },
      (cause: Error) => !controller.signal.aborted && onError(cause.message),
    );
    return () => {
      controller.abort();
      if (created !== null) URL.revokeObjectURL(created);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url]);
  if (!navigator.pdfViewerEnabled) return <Message text="This browser has no PDF viewer." download={url} />;
  return blobUrl === null ? <Message text="Loading…" /> : <iframe title={name} src={blobUrl} className="h-full w-full border-0" />;
}

const scripts = new Map<string, Promise<string>>();
/** A viewer bundle's source, fetched the first time a document of its kind opens. */
function viewerScript(url: string): Promise<string> {
  let script = scripts.get(url);
  if (script === undefined) {
    script = fetch(url).then((response) => {
      if (!response.ok) throw new Error(`the viewer answered ${response.status}`);
      return response.text();
    });
    script.catch(() => scripts.delete(url));
    scripts.set(url, script);
  }
  return script;
}

function DocumentPreview({ url, name, viewer, assetsUrl, onError }: { url: string; name: string; viewer: string; assetsUrl: string; onError(message: string): void }) {
  const frame = useRef<HTMLIFrameElement>(null);
  const bytes = useRef<ArrayBuffer | null>(null);
  const [page, setPage] = useState<string | null>(null);
  const [rendered, setRendered] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    setRendered(false);
    setPage(null);
    Promise.all([viewerScript(`${assetsUrl}/viewers/${viewer}.js`), loadBytes(url, controller.signal)]).then(
      ([script, data]) => {
        if (controller.signal.aborted) return;
        bytes.current = data;
        const theme = getComputedStyle(document.documentElement);
        const colors = Object.fromEntries(
          ["background", "foreground", "muted", "muted-foreground", "border"].map((key) => [key, theme.getPropertyValue(`--${key}`).trim()]),
        );
        setPage(viewerPage(script, crypto.randomUUID(), colors));
      },
      (cause: Error) => !controller.signal.aborted && onError(cause.message),
    );
    return () => controller.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url, viewer, assetsUrl]);
  useEffect(() => {
    const receive = (event: MessageEvent) => {
      if (event.source === null || event.source !== frame.current?.contentWindow) return;
      const message = event.data as { kodaforge?: string; message?: string } | null;
      if (message?.kodaforge === "ready" && bytes.current !== null) {
        // The sandboxed frame has no origin to name.
        frame.current.contentWindow.postMessage({ bytes: bytes.current }, "*");
      } else if (message?.kodaforge === "rendered") setRendered(true);
      else if (message?.kodaforge === "failed") onError(String(message.message).slice(0, 300));
    };
    window.addEventListener("message", receive);
    return () => window.removeEventListener("message", receive);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return (
    <div className="relative h-full">
      {page === null ? null : <iframe ref={frame} title={name} sandbox="allow-scripts" srcDoc={page} className="h-full w-full border-0" />}
      {rendered ? null : <div className="absolute inset-0 bg-background"><Message text="Loading…" /></div>}
    </div>
  );
}
