// mcpService — the ONLY layer the MCP Hub tab uses for MCP server management.
//
// MCP servers are configured per agent CLI (e.g. claude-code's ~/.claude.json).
// Rather than touching those configs, Atlas keeps its own local registry of
// known MCP servers — a manifest persisted in localStorage — and exposes
// list/add/remove/enable/disable. This is the first-pass "local Atlas
// manifest" decision; wiring through to real agent configs comes later.

export interface McpServer {
  id: string;
  name: string;
  command: string;
  args: string[];
  enabled: boolean;
  description?: string;
}

const STORAGE_KEY = "atlas.mcp.servers.v1";

const DEFAULTS: McpServer[] = [
  {
    id: "legal-mcp",
    name: "Legal MCP",
    command: "npx",
    args: ["-y", "@legal/mcp"],
    enabled: true,
    description: "Lithuanian legal corpus (LITEKO) tools",
  },
];

export async function listMcpServers(): Promise<McpServer[]> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return JSON.parse(raw) as McpServer[];
  } catch {
    /* fall through to defaults */
  }
  return DEFAULTS.map((s) => ({ ...s }));
}

function persist(servers: McpServer[]) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(servers));
}

export async function setMcpEnabled(id: string, enabled: boolean): Promise<McpServer[]> {
  const servers = await listMcpServers();
  const next = servers.map((s) => (s.id === id ? { ...s, enabled } : s));
  persist(next);
  return next;
}

export async function addMcpServer(server: Omit<McpServer, "id" | "enabled">): Promise<McpServer[]> {
  const servers = await listMcpServers();
  const id = server.name.toLowerCase().replace(/[^a-z0-9]+/g, "-");
  const next = [
    ...servers,
    { ...server, id: `${id}-${Date.now().toString(36)}`, enabled: true },
  ];
  persist(next);
  return next;
}

export async function removeMcpServer(id: string): Promise<McpServer[]> {
  const servers = await listMcpServers();
  const next = servers.filter((s) => s.id !== id);
  persist(next);
  return next;
}
