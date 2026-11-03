KodaForge: a VS Code-style IDE inside BB, with Koda the bear cub keeping you company.

## What you get

- A **KodaForge** page in the sidebar, marked with Koda's bear icon, and a KodaForge tab
  beside any thread.
- Monaco with tabs and split view, an explorer with git colours, search and replace with a
  preview, language servers for Python and TS/JS (including TypeScript 7), split terminals,
  and source control.
- Agent chat, the project's threads and workflow runs in a right-hand panel, like VS Code's
  chat.
- Colour coding everywhere, taken from your BB theme.
- Saves that never clobber an agent's edit.

## How it works

Files, git, search, language servers and terminals run on the machine that holds the
workspace, inside the workspace root. Chat and threads are BB's own components. The plugin
opens no ports.
