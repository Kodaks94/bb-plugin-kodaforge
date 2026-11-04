import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, expect, it } from "vitest";
import { codexServers, discoverMcpServers } from "./mcp-servers.js";

const base = await mkdtemp(path.join(tmpdir(), "kf-mcp-"));
afterAll(() => rm(base, { recursive: true, force: true }));

it("reads Codex mcp_servers tables and skips their nested tables", () => {
  const toml = '[model]\nx = 1\n[mcp_servers.repl]\ncommand = "node"\n[mcp_servers.repl.env]\nTOKEN = "s3cret"\n[mcp_servers."web search"]\nurl = "https://x"\n';
  expect(codexServers(toml)).toEqual([
    { name: "repl", transport: "stdio" },
    { name: "web search", transport: "http" },
  ]);
});

it("lists servers from every config without leaking commands, URLs or env", async () => {
  const home = path.join(base, "home");
  const root = path.join(base, "repo");
  const plugin = path.join(home, ".claude", "plugins", "cache", "p");
  await mkdir(plugin, { recursive: true });
  await mkdir(path.join(home, ".codex"), { recursive: true });
  await mkdir(root, { recursive: true });
  await writeFile(
    path.join(home, ".claude.json"),
    JSON.stringify({
      mcpServers: { notes: { type: "http", url: "https://notes", headers: { Authorization: "Bearer s3cret" } } },
      projects: { [root]: { mcpServers: { db: { command: "pg", env: { PASSWORD: "s3cret" } } } } },
    }),
  );
  await writeFile(path.join(root, ".mcp.json"), JSON.stringify({ mcpServers: { files: { command: "fs" } } }));
  await writeFile(path.join(home, ".codex", "config.toml"), "[mcp_servers.repl]\ncommand = \"node\"\n");
  await writeFile(path.join(plugin, ".mcp.json"), JSON.stringify({ browser: { command: "chrome" } }));
  await writeFile(path.join(home, ".claude", "plugins", "installed_plugins.json"), JSON.stringify({ plugins: { "web@market": [{ installPath: plugin }], "off@market": [{ installPath: plugin }] } }));
  await writeFile(path.join(home, ".claude", "settings.json"), JSON.stringify({ enabledPlugins: { "web@market": true, "off@market": false } }));

  const servers = await discoverMcpServers(root, home);
  expect(servers).toEqual([
    { name: "notes", source: "claude", transport: "http", plugin: null },
    { name: "db", source: "project", transport: "stdio", plugin: null },
    { name: "files", source: "project", transport: "stdio", plugin: null },
    { name: "repl", source: "codex", transport: "stdio", plugin: null },
    { name: "browser", source: "plugin", transport: "stdio", plugin: "web" },
  ]);
  expect(JSON.stringify(servers)).not.toMatch(/s3cret|https:|pg|node|chrome/);
  expect(await discoverMcpServers(path.join(base, "empty"), path.join(base, "nohome"))).toEqual([]);
});
