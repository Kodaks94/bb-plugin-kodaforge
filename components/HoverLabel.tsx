// A label that slides out beside an activity-bar icon on hover or keyboard focus, as in VS Code.
// BB's webview shows the native title tooltip late or not at all, so the bar uses this instead.
// Put it inside a button that has `group relative`.
export function HoverLabel({ text, keys }: { text: string; keys?: string }) {
  return (
    <span
      role="tooltip"
      className="pointer-events-none absolute left-full top-1/2 z-50 ml-2 -translate-y-1/2 whitespace-nowrap rounded-md border border-border bg-popover px-2 py-1 text-xs text-popover-foreground opacity-0 shadow-lg transition-opacity duration-100 group-hover:opacity-100 group-hover:delay-300 group-focus-visible:opacity-100"
    >
      {text}
      {keys ? <span className="ml-2 text-muted-foreground">{keys}</span> : null}
    </span>
  );
}
