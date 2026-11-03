# KodaForge

<img src="assets/icon.svg" width="64" alt="Koda, the KodaForge bear cub" style="image-rendering: pixelated">

A VS Code-style IDE inside BB for any project checkout, worktree or thread workspace, on
this machine or a remote one. Agent chat, threads and workflows sit beside your code, and
Koda the bear keeps you company.

It opens in two places, both marked with Koda's bear icon:

- **KodaForge** in the sidebar: a full page with a workspace picker.
- **KodaForge** in a thread's side-panel actions: a tab pinned to that thread's workspace.

## Koda

Koda is a 16×14 pixel bear cub. He lives at the bottom of the activity bar and on the
welcome screen, and shows how things are going:

- **Ready:** blinks now and then.
- **Working:** bobs while a language server starts or a file saves.
- **Happy:** hops after a save, a commit, a replace, or a workflow start.
- **Worried:** a sweat drop when there are errors or a save conflict.
- **Asleep:** after three idle minutes.

Click him for a tip. Every animation is off when the system asks for reduced motion.

## Chat, threads and workflows (right-hand panel, ⌘⌥B)

- **Chat** runs BB's own chat for a thread beside the editor. **New chat** opens BB's own
  composer, set to reuse this workspace, so the agent edits the same files you have open.
  Untouched tabs reload as it writes, and the hash guard protects your unsaved edits.
- **Threads** lists the project's threads with BB's status glyphs. Threads on this workspace
  come first and are marked.
- **Workflows** shows recent workflow runs, colour-coded by state, with their details.
  It also runs any `.bb/workflows/<name>.js` in the workspace with one click. A run reports
  back to the chat thread, which is why a thread must be picked first.

## Colour coding

Every colour comes from BB's current code theme (its terminal ANSI colours), so it follows
light and dark themes:
- **Files:** by type, in the tree, tabs and search (TS blue, JS yellow, Python cyan,
  config red or orange, and so on).
- **Panels and the activity bar:** each view, side-panel tab and terminal tab has its own
  colour.
- **States:** git changes, language-server state, problem counts, workflow runs.
- **Browser chrome:** scrollbars, selection and focus rings use the theme too.

## Features

**Editor (phase 1)**
- Monaco, loaded only when the IDE opens, with syntax colours for ~80 languages and BB's
  current code theme (light and dark).
- Tabs with dirty markers and up to three side-by-side groups (⌘\\). A file open in two
  groups shares one buffer.
- ⌘S saves with compare-and-swap on the file's SHA-256. If the file changed on disk since
  you opened it (an agent edited it, say), the save stops and a banner offers **Reload** or
  **Overwrite**.
- A debounced watcher on the workspace's machine reloads unmodified tabs when their file
  changes. Modified tabs keep your edits and show the banner.
- ⌘P Quick Open, ⌘⇧P command palette (IDE commands plus every Monaco action), ⌘F / ⌥⌘F
  find and replace with regex, minimap.
- Files over 2 MB open read-only.

**Explorer (phase 2)**
- A virtualised file tree. New file, new folder, rename (F2) and delete (asks first) from the
  toolbar or the context menu. Drag a file or folder onto a folder to move it.
- Open tabs follow renames and moves, keeping unsaved edits. Clean tabs of deleted files close.
- Git status colours and letters (M, A, U, D, R, !) on files and their folders, from the theme's
  `gitDecoration.*` colours.
- Reveals the active file, a dotfiles toggle, and an **Excluded directories** setting.

**Search (phase 3)** (⌘⇧F)
- Search across files with match case, whole word and regex, plus include and exclude globs.
  .gitignore is honoured in git workspaces. Binary files, files over 1 MB and symlinks are skipped.
- Replace previews every change inline (old text struck through, new text beside it) with
  a checkbox per match and per file. **Replace All** asks first and writes only the ticked
  matches. A file that changed since the preview is skipped and reported, never overwritten.
- `$1`, `$<name>`, `$&` and `$$` work in regex replacements.

**Language intelligence (phase 4)**
- Python: basedpyright, or pyright.
- TS/JS picks the server the way VS Code does:
  1. The project's TypeScript 5, through typescript-language-server.
  2. The project's TypeScript 7 (native `tsc --lsp`), or `tsgo`.
  3. typescript-language-server with a global TypeScript 5.
  4. A global TypeScript 7.
- Completion, hover, go to definition (F12, opens other files), find references (⇧F12),
  rename symbol across files (F2), diagnostics in the Problems panel, and Format Document.
- Format on save: ruff for Python, prettier for TS/JS, from the project or PATH. There's a
  setting to turn it off, and **File: Save without Formatting** skips it once.
- A server starts the first time a matching file opens: one per workspace and language,
  stopped after 10 idle minutes. Its state shows in the status bar; click a failed one to retry.

**Terminal (phase 5)** (Ctrl+\`, or **Terminal** in the status bar)
- xterm.js on BB's persistent terminals, starting in the workspace root. Terminals survive
  closing the IDE; reopening it reattaches them, with their scrollback and split layout.
  Colours follow the theme.
- Tabs on the right. **Split** (toolbar, or ⌘\\ inside a terminal) puts up to four terminals
  side by side in one tab, with resizable dividers.
- The toolbar has new terminal (Ctrl+Shift+\`), split, clear (⌘K), kill, and maximize panel.

**Source control (phase 6)** (⌘⇧G)
- Staged and unstaged changes. Stage or unstage one file or all of them. Commit with ⌘Enter,
  which offers to stage everything when nothing is staged.
- A side-by-side Monaco diff per file. Working-tree changes are editable on the right;
  staged changes show HEAD against the index.
- **Discard** (per file, or all) puts tracked files back to their index version and deletes
  untracked files. It always asks first.
- Stash, including untracked files, with an optional message. Apply, pop or drop any stash
  from the **⋯** menu.
- Pull (fast-forward only), push (publishes a branch that has no upstream), fetch, and a sync
  button showing ↓behind ↑ahead. These run in a visible terminal tab, so you see progress,
  git can ask for credentials, and long pushes aren't cut off.
- A branch picker (status bar or the Source Control header): switch, track a remote branch,
  or create a new one.

## Limits

- Quick Open and the tree list at most 10,000 entries (BB's listing limit).
- Search stops after 5,000 matches or 15 seconds.
- **Terminal output is polled.** BB has no push for terminal output, so the IDE polls by
  sequence number: every 30 ms while text flows, backing off to 400 ms when idle.
- **One IDE view per language server.** Opening the same workspace in a second IDE view takes
  its language servers over, and the first view's status bar shows "stopped". Click to take
  them back.
- **Your servers and formatters.** Install basedpyright or pyright, typescript-language-server,
  ruff and prettier yourself, in the project (`node_modules/.bin`, `.venv/bin`) or on PATH.
  Under TypeScript 7 some editor features may be missing; this depends on what that server
  implements (it uses pull diagnostics, which the IDE supports).
- **Rename edits stay unsaved.** Edits in files that aren't open as tabs change the buffer
  only. Use **File: Save All**.
- Source control has no merge or rebase UI, no conflict editor and no commit history. Use the
  terminal for those.
- Keyboard shortcuts work while the IDE has focus. Outside it, BB's own shortcuts apply.

## Security

- Every path is checked twice before BB touches it. The server rejects `..` and absolute paths.
  The host's realpath check rejects symlinks that lead outside the workspace root, even for
  files that don't exist yet. BB's own `rootPath` confinement is a third layer. Mutations may
  not target the root itself.
- No save is unconditional. Overwrite and Replace All are compare-and-swap against a known hash.
- Git runs without a shell, with paths after `--`. Branch names must pass
  `git check-ref-format` and may not start with `-`.
- Language servers, formatters, git and search run on the workspace's machine with the
  workspace root as their working directory.
- **No new ports.** The language-server WebSocket is mounted on BB's own server
  (`/api/v1/plugins/kodaforge/http/lsp`) and requires the plugin token. Rotate the token with
  `bb plugin token kodaforge --rotate`.

## Architecture

| Part | Runs on | Does |
| --- | --- | --- |
| `app.tsx`, `components/` | BB app | The workbench UI. Monaco and xterm.js. A small LSP client (`components/lsp.ts`). |
| `server.ts` | BB server | Workspace resolution, guarded file I/O through `bb.sdk.files`, the Monaco asset URL, the LSP WebSocket bridge, and RPCs that relay to the host. |
| `host.ts`, `lib/` | The workspace's machine | Symlink guard, file watcher, search, git, language-server processes, formatters. |

Workspace resolution and the path guard are adapted from
[bb-plugin-files-editor](https://github.com/abdoutelb/bb-plugin-files-editor) (MIT). Monaco is
served the way BB's builtin monaco-editor plugin does it: a prebuilt bundle behind
`bb.sdk.files.createPreview`, imported on first use.

**How LSP messages travel**

```text
browser --WebSocket--> server bridge --host RPC (lspSend)------------> host --stdio--> language server
browser <--WebSocket-- server bridge <--long-poll (lspReceive, seq)--- host <--stdio--- language server
```

Host signals are best-effort, so server-to-browser messages are pulled from a numbered outbox.
Order and delivery are guaranteed.

## Libraries

| Library | Use | Licence |
| --- | --- | --- |
| monaco-editor 0.52 | Editor, diff editor | MIT |
| @xterm/xterm, @xterm/addon-fit | Terminal | MIT |
| @tanstack/react-virtual | Virtual file tree | MIT |
| react-resizable-panels | Side bar, groups, panel | MIT |
| vscode-languageserver-protocol | LSP types (type-only) | MIT |
| TypeScript 7 native (`tsc --lsp`), yours | TS/JS language server option | Apache-2.0 |
| zod | Validation | MIT |
| esbuild, vitest (dev) | Monaco bundle, tests | MIT |
| basedpyright / pyright, typescript-language-server, ruff, prettier (yours) | Language features | MIT / MIT, Apache-2.0, MIT, MIT |

## Install from git

`monaco/` (the prebuilt editor bundle) is committed, because git installs don't run build
scripts. Push this folder to a repository, then:

```sh
bb plugin install git:https://github.com/<you>/bb-plugin-kodaforge.git --yes
```

## Install from a local path

```sh
cd bb-plugin-ide
npm install --include=dev
npm run build            # bundles Monaco into ./monaco, then `bb plugin build`
bb plugin install path:$(pwd) --yes
```

While developing, run `bb plugin dev` to rebuild and reload on save. After changing
`scripts/monaco-entry.js`, run `npm run build:monaco` again.

Settings live in `bb plugin config kodaforge`: **Excluded directories** and **Format on save**.

## Tests

```sh
npm test            # vitest
npm run typecheck
```

The vitest suite covers:
- the path guard and symlink guard
- the hash-guarded save and tree mutations
- editor groups and rename remapping
- git status parsing, plus git operations against a real throwaway repo
- search and replace (engine and workspace search)
- LSP framing, the LSP bridge and the host session manager, with a fake server
- terminal I/O helpers and the theme conversion

## Manual check lists

**Phase 1: editor**
1. Open **KodaForge** (bear icon) from the sidebar and pick a workspace. In a thread's side
   panel choose **KodaForge**: it shows that thread's workspace.
2. ⌘P, type part of a name, Enter. The file opens with syntax colours.
3. Type. The tab shows a dot. ⌘S. The dot clears and the file on disk changes.
4. Change the file outside the IDE (`echo x >> file`). The clean tab updates within a second.
5. Make the tab dirty, then change the file outside. The red banner appears. **Overwrite**
   saves yours; **Reload** brings back the disk version.
6. ⌘\\ opens a second group. Typing in one updates the other.
7. ⌘⇧P → "Replace". Toggle regex (.*) and replace a pattern.
8. Switch BB between light and dark. The editor follows.
9. Open a file over 2 MB. It's read-only and says so.

**Phase 2: explorer**
1. Click a folder to expand it. Click a file to open it. Opening a file through ⌘P reveals it.
2. Toolbar **+** creates a file and opens it. The folder button creates a folder. Nested names
   (`a/b.ts`) work.
3. F2 on a file with an open, dirty tab, then rename it. The tab follows and keeps its edits.
4. Drag a file onto a folder. It moves, and any open tab follows.
5. Delete from the context menu. It asks first, and the clean tab closes.
6. In a git workspace, changed files are coloured with a letter, and so are their folders.
7. The eye toggle hides and shows dotfiles. Add a folder name under Excluded directories
   (`bb plugin config kodaforge`), reload the plugin, and it disappears.

**Phase 3: search**
1. ⌘⇧F, type a word. Results are grouped by file. Clicking one opens the file with the match selected.
2. Toggle Aa / ab / .* and see the counts change. An invalid regex shows an error.
3. Fill "files to include" with `*.ts`. Only TS files remain.
4. Open replace (chevron) and type a replacement. Every match shows old → new.
   Untick one match and one file.
5. **Replace All** asks with the exact count and writes only the ticked matches.
6. Edit a file between preview and Replace All. That file is skipped and reported in Output.

**Phase 4: language intelligence**
1. In a TS project with `typescript` installed, open a `.ts` file. The status bar shows
   "TS/JS: ready". A type error shows a squiggle and appears in Problems.
2. Hover a symbol: type info. Type `.` after an object: completions.
3. F12 on an imported symbol opens its file at the definition. ⇧F12 lists references.
4. F2 on a declaration and rename it. Every file using it updates; Save All writes them.
5. With prettier installed, save messy TS. It's formatted on save.
6. In a Python project with pyright, open a `.py` file. Python diagnostics and hover work.
   With ruff installed, it formats on save.
7. Close the IDE and wait 10 minutes. The server process is gone (`ps aux | grep langserver`).

**Phase 5: terminal**
1. Ctrl+\` opens the terminal in the workspace root (`pwd`).
2. Run a long command, close the IDE page, reopen it. Ctrl+\` reattaches with the output.
3. **New terminal** adds a second tab. The trash icon kills a terminal.
4. Resize the panel. Columns follow (`tput cols`).
5. Split twice (toolbar or ⌘\\ in a terminal): three terminals side by side, each its own shell.
   Drag the dividers. Kill the middle one; the others stay.
6. Reload the page. The split tab comes back with the same three terminals.
7. Maximize the panel: the editors hide. Restore brings them back.

**Chat, threads, workflows**
1. ⌘⌥B opens the right-hand panel. Chat shows the thread (in a thread tab) or the composer.
2. Start a new chat. It appears in Threads, marked "this workspace". When the agent edits a
   file you have open and clean, the tab updates.
3. Workflows lists recent runs. Add `.bb/workflows/hello.js` and a Run button appears.

**Koda**
1. Save a file: Koda hops. Make a type error: he sweats. Leave the IDE idle for 3 minutes: he
   sleeps.
2. Click Koda: a tip appears.

**Phase 6: source control**
1. ⌘⇧G in a git workspace. Changed files appear under Changes, coloured.
2. Click a modified file: a side-by-side diff. Edit the right side and save.
3. **+** stages a file (it moves to Staged Changes). **−** unstages it. Stage All and Unstage All work.
4. Click a staged file: a HEAD ↔ index diff.
5. Type a message and press ⌘Enter. It commits, the lists clear, and Output shows the summary.
6. Discard a file's changes (it asks first). Discard an untracked file: it is deleted.
7. ⋯ → Stash with a message. The changes disappear and the stash is listed. Pop brings them back.
8. ⋯ → Push. A terminal tab shows git's output, and the ↓↑ counts update afterwards.
9. Click the branch in the status bar. Switch branches, and the explorer and open clean tabs
   follow. **Create new branch…** creates one and switches to it.
