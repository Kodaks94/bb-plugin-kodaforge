# Explorer menu items from other plugins

A BB plugin can add entries to the Explorer's context menu. When the menu opens, KodaForge
dispatches a `CustomEvent` named `kodaforge:explorer-menu` on `window`, synchronously:

```ts
window.addEventListener("kodaforge:explorer-menu", (event) => {
  const { version, hostId, path, kind, items } = (event as CustomEvent).detail;
  if (version !== 1) return;
  items.push({ label: "Open in Finder", run: () => openFolder(hostId, path) });
});
```

| Field | Value |
| --- | --- |
| `version` | `1`. It changes only if a listener for an older version could misread the event. |
| `hostId` | The BB machine the workspace is on. |
| `path` | Absolute path on that machine, in its own flavour. The blank area is the workspace root. |
| `kind` | `"file"` or `"directory"`. |
| `items` | Push `{ label, run }` here while the event is dispatched; later additions are ignored. |

Items appear after Open in Terminal, in the order pushed (at most 8, labels up to 80
characters). `run` may be async. If it throws or rejects, or a listener throws, the menu
still works: the failure of an item is shown to the user with its label.
