# Changelog

All notable changes to KodaForge. Versions follow [semver](https://semver.org); BB installs
them from the `vX.Y.Z` tags.

## [0.7.0] - 2026-11-04

### Added
- **Agent Network App mode.** A Coding / App switch in the Agent Network's header. App shows
  the AI architecture the project's own code builds, as the same solar system:
  - Agents are planets with their tools as moons. Agent frameworks are recognised, and so
    are direct LLM calls.
  - MCP servers sit further out, with their tools.
  - Models and skills are on the outer belt.

  Click anything to open its code at that line. It is read from the source, never run, and
  rescans every 30 s while shown.

### Changed
- In the Agent Network, Koda (the sun) wears sunglasses. Everywhere else he looks as before.
- The Agent Network's activity-bar icon is a Saturn instead of a target.
- A calmer Agent Network:
  - The header is one row: the title, a single line of counts with zeros left out, the
    Coding / App switch and the controls.
  - The legend moved behind a Key button.
  - Only agents, runs and app MCP servers are labelled; everything else names itself on hover.
- Activity-bar icons show their name and shortcut on hover, as in VS Code.
- The README opens with every feature at a glance and screenshots. The store description,
  tags and overview now name each capability, so a search for "debugger", "lsp",
  "find in files" or "mcp" finds KodaForge.

## [0.6.0] - 2026-11-04

### Added
- **Editor tab management.** Drag tabs to reorder them, onto another group to move them
  (hold ⌥ to copy), or onto the left or right edge of an editor to split it there. Up to
  four groups side by side. Right-click a tab for Close, Close Others, Close to the Right,
  Close All, Pin, Split Right, Move to Next/Previous Group and Copy Path. Pinned tabs stay
  first and survive bulk closes; unsaved tabs are never closed by them. Files dragged in
  from the Explorer open where they're dropped.
- **Tab shortcuts.** ⌘W close, ⌘⇧T reopen closed, ⌥⌘T close others, ⌃Tab / ⌥⌘←→ switch
  tabs, ⌃⌘←→ move a tab to the previous/next group, ⌘1–4 focus a group.
- **Agent Network (⌘⇧A).** This project's agents as a solar system with Koda as the sun:
  working agents on the inner orbit with energy flowing from the sun, idle ones further out,
  sub-agents as moons, workflow runs as ringed planets with their agents circling them, and
  MCP servers (Claude, Codex, the project's and Claude plugins') as stations on the outer
  belt. Hover for details, click to open a thread or a run's graph, scroll to zoom, drag to
  pan. It opens as an editor tab, so it can sit beside your code.

## [0.5.0] - 2026-11-04

### Added
- **Agent graph for workflow runs.** Click a run in the Workflows panel to see it as a
  vertical graph: start, each phase in order, every agent with its model and time, then the
  result. Running phases animate, partly failed phases turn amber, and clicking an agent
  opens the thread it worked in. Updates live while the run is going.
- **Settings (⌘,).** A searchable Settings view with VS Code's most-changed preferences:
  auto save (after a delay or when focus leaves the editor), format on save, trim trailing
  whitespace, final newline, font, size and ligatures, tab size, word wrap, line numbers,
  minimap, sticky scroll, bracket colours, whitespace, cursor, and terminal font and cursor.
  Changes apply at once to every open workspace.

### Fixed
- Typing in the editor lost focus after the first character in the KodaForge page: marking
  the workspace tab "unsaved" re-rendered every workbench.
- The Workflows panel needed a chat thread picked before it could list runs.
- A sidebar view saved by a newer version no longer crashes an older one.

## [0.4.0] - 2026-11-03

### Added
- **Python environments.** KodaForge finds the interpreters a workspace can use: venvs inside
  the workspace (venv, uv, Poetry's in-project `.venv`), conda, pyenv, Poetry's cache, and
  Python on PATH. The status bar shows the one in use (the workspace's own venv by default),
  and a click switches it, creates a `.venv`, or rescans. The choice drives pyright
  (`python.pythonPath`), the debugger, new terminals (activated automatically) and tasks.
- **Tasks view.** Makefile targets (with their `## help`) and package.json scripts, at the
  root or two folders down. Run one with a click; it runs in a terminal with the selected
  Python environment first on PATH. Click a name to jump to its definition.
- **Search everything (⌘P).** One box for files, symbols (from the language servers), text
  in files and commands. Prefixes narrow it, as in VS Code: `>` commands, `#` symbols,
  `%` text, `:12` or `:12:5` go to a line.

## [0.3.0] - 2026-11-03

### Added
- Open several projects at once: workspaces sit as tabs in the title bar, each colour-coded by
  project, with a dot for unsaved changes. The **+** menu lists every project checkout,
  worktree and thread workspace, grouped by project. Switching keeps each workspace's
  editors, unsaved buffers, terminals and debugger alive, and the open tabs come back next time.
- Thread workspaces that are their own folder (such as personal workspaces) now appear in
  the workspace list, named after their thread.

- A 20-second launch video at the top of the README (`docs/kodaforge-launch.mp4`).

### Fixed
- The workspace picker showed a raw id (`environment/env_…`) for a workspace opened by link.

## [0.2.2] - 2026-11-03

### Changed
- Removed 12 dependencies the plugin never used (scaffold leftovers and `vscode-jsonrpc`):
  smaller installs, and fewer packages for Dependabot to check.

## [0.2.1] - 2026-11-03

### Fixed
- Searching, git and formatting could fail with `EPIPE` (and take the host worker down) when
  a program exited before reading its input, for example `git` in a folder that is not a
  repository. Commands without input no longer get a stdin pipe, and stdin errors are handled.

## [0.2.0] - 2026-11-03

### Added
- Run and Debug for Python (debugpy): gutter breakpoints, F5/F10/F11 stepping, variables,
  call stack, and a Debug Console that evaluates in the selected frame.
- Terminals survive leaving KodaForge: the same terminal reattaches with its screen and
  scrollback, and the layout and open tabs are restored per workspace.
- Material Icon Theme icons for files and folders.
- A BB marketplace file, so KodaForge appears in BB's plugin store.

### Fixed
- A crash when the bottom panel opened: Chromium's `scrollIntoView` returns a Promise, which
  React received as an effect cleanup.
- Keyboard shortcuts after a clicked button disappeared (focus fell back to the page).

## [0.1.0] - 2026-11-03

### Added
- Monaco editor with tabs, split view, hash-guarded saves, auto-reload, Quick Open, command
  palette, find and replace, and BB's themes.
- Explorer, search and replace with a preview, Python and TS/JS language servers (including
  TypeScript 7), split terminals, and source control.
- Agent chat, threads and workflows in a right-hand panel.
- Koda the bear, and colour coding from the BB theme.

[0.6.0]: https://github.com/Kodaks94/bb-plugin-kodaforge/compare/v0.5.0...v0.6.0
[0.5.0]: https://github.com/Kodaks94/bb-plugin-kodaforge/compare/v0.4.0...v0.5.0
[0.4.0]: https://github.com/Kodaks94/bb-plugin-kodaforge/compare/v0.3.0...v0.4.0
[0.3.0]: https://github.com/Kodaks94/bb-plugin-kodaforge/compare/v0.2.2...v0.3.0
[0.2.2]: https://github.com/Kodaks94/bb-plugin-kodaforge/compare/v0.2.1...v0.2.2
[0.2.1]: https://github.com/Kodaks94/bb-plugin-kodaforge/compare/v0.2.0...v0.2.1
[0.2.0]: https://github.com/Kodaks94/bb-plugin-kodaforge/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/Kodaks94/bb-plugin-kodaforge/releases/tag/v0.1.0
