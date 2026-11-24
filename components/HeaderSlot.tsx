// The title bar's end of lib/header-slot.ts, and the hook that finds it from the page.
import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore, type RefObject } from "react";
import { currentSlots, HEADER_RESERVE, MIN_HEADER_WIDTH, registerSlot, slotFor, slotsVersion, subscribeSlots } from "@/lib/header-slot";
import { useHues } from "./colors";

/** Rendered by BB on the right of the shared title bar; empty until a page fills it. */
export function HeaderSlot() {
  const slot = useRef<HTMLDivElement>(null);
  const hues = useHues();
  useLayoutEffect(() => {
    return registerSlot(slot.current!);
  }, []);
  return (
    <>
      {/* The bar already shows Koda and the name: give Koda his own colour back there. */}
      <style>{`header:has([data-kodaforge-header]:not(:empty)) [data-icon="KodaBear"] { color: ${hues.orange}; } [data-kodaforge-header] [role="tablist"] { scrollbar-width: none; }`}</style>
      {/* Only the width of its content, so the rest of the bar still drags the window. */}
      <div ref={slot} data-kodaforge-header className="flex min-w-0 items-center gap-2 text-xs text-muted-foreground" />
    </>
  );
}

/** The title bar to draw into, or null: turned off, an older BB, a split without one, a narrow pane. */
export function useHeaderSlot(enabled: boolean): [RefObject<HTMLDivElement | null>, HTMLElement | null] {
  const page = useRef<HTMLDivElement>(null);
  useSyncExternalStore(subscribeSlots, slotsVersion);
  const [width, setWidth] = useState(0);
  const [slot, setSlot] = useState<HTMLElement | null>(null);
  useEffect(() => {
    const element = page.current;
    if (element === null) return;
    const measure = () => setWidth(element.clientWidth);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  });
  // After every render: the page's element appears only once a workspace is known.
  useLayoutEffect(() => {
    setSlot(enabled && page.current !== null ? slotFor<HTMLElement>(page.current, currentSlots()) : null);
  });
  const used = width >= MIN_HEADER_WIDTH ? slot : null;
  // BB gives the content the width it asks for: more tabs than fit scroll instead.
  useLayoutEffect(() => {
    if (used !== null) used.style.maxWidth = `${width - HEADER_RESERVE}px`;
  }, [used, width]);
  return [page, used];
}
