# Changelog

All notable changes to KodaForge. Versions follow [semver](https://semver.org); BB installs
them from the `vX.Y.Z` tags.

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

[0.3.0]: https://github.com/Kodaks94/bb-plugin-kodaforge/compare/v0.2.2...v0.3.0
[0.2.2]: https://github.com/Kodaks94/bb-plugin-kodaforge/compare/v0.2.1...v0.2.2
[0.2.1]: https://github.com/Kodaks94/bb-plugin-kodaforge/compare/v0.2.0...v0.2.1
[0.2.0]: https://github.com/Kodaks94/bb-plugin-kodaforge/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/Kodaks94/bb-plugin-kodaforge/releases/tag/v0.1.0
