# Changelog

All notable changes to KodaForge. Versions follow [semver](https://semver.org); BB installs
them from the `vX.Y.Z` tags.

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

[0.2.0]: https://github.com/Kodaks94/bb-plugin-kodaforge/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/Kodaks94/bb-plugin-kodaforge/releases/tag/v0.1.0
