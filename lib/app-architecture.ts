// The AI architecture a project's own code builds: its agents, the tools and MCP servers they
// use, the models they call and the skills they load. Found by reading the source (nothing is
// run), so it works on any project; it is a map, not a proof, and links are by file and name.

export type ArchKind = "agent" | "tool" | "mcp" | "model" | "skill";

export interface ArchNode {
  id: string;
  kind: ArchKind;
  name: string;
  /** Framework or role, e.g. "pydantic-ai", "LLM call", "MCP server", "MCP client". */
  detail: string;
  path: string;
  line: number;
  /** An agent given toolsets / MCP servers, which may be defined in another file. */
  usesMcp?: boolean;
}

export interface Architecture {
  nodes: ArchNode[];
  /** from → to: agent → tool / mcp / model / skill, mcp → tool. */
  links: { from: string; to: string }[];
}

export const CODE_FILE = /\.(py|ts|tsx|js|jsx|mjs|cjs)$/;
/** Folders that hold the coding agents' own config (mode 1), not the app's. */
export const DEV_DIRS = [".claude", ".agents", ".codex", ".bb", ".cursor", ".github"];

/** App code and skills; not the coding agents' folders, tests (mock agents) or vendored code. */
export function isAppSource(path: string): boolean {
  const parts = path.split("/");
  if (parts.some((part) => DEV_DIRS.includes(part) || part === "node_modules" || part === "tests" || part === "test" || part === "__tests__")) return false;
  if (path.endsWith("SKILL.md")) return true;
  return CODE_FILE.test(path) && !/(^|\/)(test_[^/]*|[^/]*_test\.py|[^/]*\.(test|spec)\.[jt]sx?|[^/]*\.d\.ts)$/.test(path);
}

const FRAMEWORKS: [RegExp, string][] = [
  [/pydantic_ai/, "pydantic-ai"],
  [/from agents import|import agents\b|openai-agents/, "OpenAI Agents"],
  [/claude_agent_sdk|@anthropic-ai\/claude-agent-sdk/, "Claude Agent SDK"],
  [/langgraph|langchain/, "LangChain"],
  [/crewai/, "CrewAI"],
  [/\bagno\b/, "Agno"],
  [/@mastra\//, "Mastra"],
  [/from ["']ai["']|@ai-sdk\//, "Vercel AI SDK"],
];

const AGENT_DEFS: RegExp[] = [
  /(?:self\.)?(\w+)\s*(?::\s*[\w[\], ]+)?=\s*(?:\w+\.)?(?:Agent|ToolLoopAgent|Experimental_Agent|AgentExecutor|StateGraph)\s*[([]/,
  /(?:self\.)?(\w+)\s*=\s*(?:create_react_agent|create_deep_agent|create_agent|initialize_agent)\s*\(/,
  /(?:const|let|var)\s+(\w+)\s*=\s*new\s+(?:Agent|ToolLoopAgent)\s*\(/,
];
/** A direct model call (no agent framework): named after the function it sits in. */
const LLM_CALL = /\.(?:messages|chat\.completions|responses)\.create\(|\b(?:generateText|streamText|generateObject|streamObject)\s*\(|\bquery\s*\(\s*\{?\s*prompt\b/;
const MCP_SERVER = [/(\w+)\s*=\s*FastMCP\(\s*(?:name\s*=\s*)?["']([^"']+)["']/, /new\s+McpServer\(\s*\{\s*name:\s*["']([^"']+)["']/];
const MCP_CLIENT = /\b(MCPServerStdio|MCPServerStreamableHTTP|MCPServerSSE|MCPServerHTTP|MultiServerMCPClient|StdioClientTransport|StreamableHTTPClientTransport|experimental_createMCPClient)\s*\(\s*(?:["']([^"']+)["'])?/;
const TOOL_DECORATOR = /^\s*@(?:(\w+)\.)?(tool|tool_plain|function_tool)\b/;
const TS_TOOL = [/(?:const|let)\s+(\w+)\s*=\s*(?:tool|createTool)\s*\(/, /\.(?:tool|registerTool)\(\s*["']([^"']+)["']/];
const DEF = /^\s*(?:async\s+)?def\s+(\w+)|^\s*(?:export\s+)?(?:async\s+)?function\s+(\w+)|^\s*(?:export\s+)?const\s+(\w+)\s*=\s*(?:async\s*)?\(/;
const MODEL = /["'`]((?:openai|anthropic|ollama|google-gla|google-vertex|groq|mistral|bedrock|openrouter|gemini)[:/][\w.\-:/]+|(?:gpt-|claude-|gemini-|o[134]-|qwen|llama|mistral-|deepseek|gemma)[\w.\-:]*)["'`]/g;

/** Agents, tools, servers and models declared in one file. */
export function scanFile(path: string, text: string): Architecture {
  const nodes: ArchNode[] = [];
  const add = (kind: ArchKind, name: string, detail: string, line: number) => {
    const id = `${kind}:${path}:${name}`;
    if (!nodes.some((n) => n.id === id)) nodes.push({ id, kind, name, detail, path, line });
    return id;
  };
  const framework = FRAMEWORKS.find(([pattern]) => pattern.test(text))?.[1] ?? "agent";
  const lines = text.split("\n");
  const toolOwners: { id: string; owner: string | null }[] = [];
  const servers: { id: string; variable: string | null }[] = [];
  let pendingTool: string | null | undefined; // owner of a decorator waiting for its def
  let fn = "";
  lines.forEach((source, i) => {
    const line = i + 1;
    const def = DEF.exec(source);
    if (def) {
      fn = def[1] ?? def[2] ?? def[3] ?? fn;
      if (pendingTool !== undefined) {
        toolOwners.push({ id: add("tool", fn, "tool", line), owner: pendingTool });
        pendingTool = undefined;
      }
    }
    if (/^\s*(?:#|\/\/|\*)/.test(source)) return;
    for (const pattern of AGENT_DEFS) {
      const m = pattern.exec(source);
      if (m) {
        const id = add("agent", m[1]!, framework, line);
        if (/toolsets\s*=|mcp_servers\s*=|mcpServers|toolsets:/.test(source)) nodes.find((n) => n.id === id)!.usesMcp = true;
      }
    }
    if (LLM_CALL.test(source)) add("agent", fn || "llm call", "LLM call", line);
    const server = MCP_SERVER[0]!.exec(source);
    if (server) servers.push({ id: add("mcp", server[2]!, "MCP server", line), variable: server[1]! });
    const tsServer = MCP_SERVER[1]!.exec(source);
    if (tsServer) servers.push({ id: add("mcp", tsServer[1]!, "MCP server", line), variable: null });
    const client = MCP_CLIENT.exec(source);
    if (client) add("mcp", client[2] ?? client[1]!, "MCP client", line);
    const decorator = TOOL_DECORATOR.exec(source);
    if (decorator) pendingTool = decorator[1] ?? null;
    for (const pattern of TS_TOOL) {
      const m = pattern.exec(source);
      if (m) toolOwners.push({ id: add("tool", m[1]!, "tool", line), owner: null });
    }
    for (const m of source.matchAll(MODEL)) add("model", m[1]!, "model", line);
  });

  // Links, by name first and file second: a tool belongs to the server or agent it is
  // registered on, else to this file's MCP server, else to this file's agents.
  const links: Architecture["links"] = [];
  const agents = nodes.filter((n) => n.kind === "agent");
  for (const { id, owner } of toolOwners) {
    const named = owner && (servers.find((s) => s.variable === owner)?.id ?? agents.find((a) => a.name === owner)?.id);
    const targets = named ? [named] : servers.length ? servers.map((s) => s.id) : agents.map((a) => a.id);
    for (const from of targets) links.push({ from, to: id });
  }
  for (const agent of agents) {
    for (const other of nodes) if (other.kind === "model" || (other.kind === "mcp" && other.detail === "MCP client")) links.push({ from: agent.id, to: other.id });
  }
  return { nodes, links };
}

/** A SKILL.md the app loads at runtime (outside the coding agents' folders). */
export function scanSkill(path: string, text: string): ArchNode {
  const name = /^name:\s*["']?([^"'\n]+)/m.exec(text)?.[1]?.trim() ?? path.split("/").at(-2) ?? path;
  return { id: `skill:${path}`, kind: "skill", name, detail: "skill", path, line: 1 };
}

/** Whole project: per-file scans merged; models and MCP servers deduplicated by name. */
export function mergeArchitecture(files: { path: string; text: string }[]): Architecture {
  const nodes: ArchNode[] = [];
  const links: Architecture["links"] = [];
  const canonical = new Map<string, string>(); // file-scoped id → shared id
  const loadsSkills = new Set<string>();
  for (const { path, text } of files) {
    if (/skill/i.test(text)) loadsSkills.add(path);
    if (path.endsWith("SKILL.md")) {
      nodes.push(scanSkill(path, text));
      continue;
    }
    const found = scanFile(path, text);
    for (const node of found.nodes) {
      const key = node.kind === "model" || node.kind === "mcp" ? `${node.kind}:${node.name}` : node.id;
      canonical.set(node.id, key);
      const existing = nodes.find((n) => n.id === key);
      if (existing === undefined) nodes.push({ ...node, id: key });
      else if (node.detail === "MCP server") Object.assign(existing, { detail: node.detail, path: node.path, line: node.line });
    }
    for (const link of found.links) {
      const next = { from: canonical.get(link.from)!, to: canonical.get(link.to)! };
      if (!links.some((l) => l.from === next.from && l.to === next.to)) links.push(next);
    }
  }
  // Agents handed toolsets reach the project's own MCP servers.
  for (const agent of nodes.filter((n) => n.usesMcp)) for (const server of nodes.filter((n) => n.detail === "MCP server")) links.push({ from: agent.id, to: server.id });
  // Skills go to the agents whose file mentions skills (a loader or a load_skill tool).
  const skills = nodes.filter((n) => n.kind === "skill");
  for (const agent of nodes.filter((n) => n.kind === "agent" && loadsSkills.has(n.path))) for (const skill of skills) links.push({ from: agent.id, to: skill.id });
  return { nodes, links };
}
