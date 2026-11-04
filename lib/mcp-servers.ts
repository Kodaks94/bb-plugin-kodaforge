// MCP servers the agents in this workspace can reach, for the Agent Network. Read from
// the agents' own config files. Only names, where each is configured, and the transport
// leave the host: never commands, URLs, headers or env (those can hold secrets).
import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";

export type McpSource = "claude" | "project" | "codex" | "plugin";

export interface McpServer {
  name: string;
  source: McpSource;
  transport: "stdio" | "http" | "sse";
  /** The Claude plugin that provides it, for source "plugin". */
  plugin: string | null;
}

async function readJson(file: string): Promise<Record<string, unknown> | null> {
  try {
    const value: unknown = JSON.parse(await readFile(file, "utf8"));
    return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

const record = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};

function transportOf(config: unknown): McpServer["transport"] {
  const c = record(config);
  if (c.type === "sse") return "sse";
  return c.type === "http" || typeof c.url === "string" ? "http" : "stdio";
}

/** `[mcp_servers.<name>]` tables in Codex's config.toml; nested tables (`.env`) are skipped. */
export function codexServers(toml: string): { name: string; transport: McpServer["transport"] }[] {
  const out: { name: string; transport: McpServer["transport"] }[] = [];
  let current: { name: string; transport: McpServer["transport"] } | null = null;
  for (const line of toml.split("\n")) {
    const header = /^\s*\[([^\]]+)\]\s*$/.exec(line);
    if (header) {
      const match = /^mcp_servers\.("([^"]+)"|[A-Za-z0-9_-]+)$/.exec(header[1]!.trim());
      current = match ? { name: match[2] ?? match[1]!, transport: "stdio" } : null;
      if (current) out.push(current);
      continue;
    }
    if (current && /^\s*url\s*=/.test(line)) current.transport = "http";
  }
  return out;
}

export async function discoverMcpServers(root: string, home = homedir()): Promise<McpServer[]> {
  const found: McpServer[] = [];
  const add = (servers: unknown, source: McpSource, plugin: string | null = null) => {
    for (const [name, config] of Object.entries(record(servers))) {
      if (!found.some((s) => s.name === name && s.source === source && s.plugin === plugin)) found.push({ name, source, transport: transportOf(config), plugin });
    }
  };

  const claude = await readJson(path.join(home, ".claude.json"));
  add(claude?.mcpServers, "claude");
  add(record(record(claude?.projects)[root]).mcpServers, "project");
  add((await readJson(path.join(root, ".mcp.json")))?.mcpServers, "project");

  const toml = await readFile(path.join(home, ".codex", "config.toml"), "utf8").catch(() => "");
  for (const server of codexServers(toml)) found.push({ ...server, source: "codex", plugin: null });

  // Claude plugins that are installed and enabled, and ship a .mcp.json.
  const installed = record((await readJson(path.join(home, ".claude", "plugins", "installed_plugins.json")))?.plugins);
  const enabled = record((await readJson(path.join(home, ".claude", "settings.json")))?.enabledPlugins);
  for (const [id, installs] of Object.entries(installed)) {
    if (enabled[id] !== true || !Array.isArray(installs)) continue;
    const installPath = record(installs[installs.length - 1]).installPath;
    if (typeof installPath !== "string") continue;
    const manifest = await readJson(path.join(installPath, ".mcp.json"));
    add(manifest?.mcpServers ?? manifest, "plugin", id.split("@")[0]!);
  }
  return found;
}
