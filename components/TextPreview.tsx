// The rendered side of a text file: Markdown as BB shows it in chat, SVG as an image.
import { useDeferredValue, useEffect, useRef, useState } from "react";
import { Markdown } from "@get-bb/plugin-sdk/app";
import type { TextPreview as Kind } from "@/lib/text-preview";

export function TextPreview({ kind, content, name, focused }: { kind: Kind; content: string; name: string; focused: boolean }) {
  // Typing in the source beside it must not wait for the preview.
  const shown = useDeferredValue(content);
  const scroller = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (focused) scroller.current?.focus();
  }, [focused]);
  return (
    <div ref={scroller} tabIndex={-1} aria-label={`Preview of ${name}`} className="h-full overflow-auto bg-background outline-none">
      {kind === "markdown" ? (
        <div className="mx-auto max-w-3xl px-6 py-5">
          <Markdown content={shown} />
        </div>
      ) : (
        <SvgImage source={shown} name={name} />
      )}
    </div>
  );
}

/** As an image, never as a document: scripts inside an SVG do not run. */
function SvgImage({ source, name }: { source: string; name: string }) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    const created = URL.createObjectURL(new Blob([source], { type: "image/svg+xml" }));
    setUrl(created);
    return () => URL.revokeObjectURL(created);
  }, [source]);
  return <div className="flex min-h-full items-center justify-center p-4">{url === null ? null : <img src={url} alt={name} className="max-w-full" />}</div>;
}
