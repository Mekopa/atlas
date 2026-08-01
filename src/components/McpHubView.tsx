import { useCallback, useEffect, useState } from "react";
import {
  addMcpServer,
  listMcpServers,
  removeMcpServer,
  setMcpEnabled,
  type McpServer,
} from "../lib/mcpService";

// McpHubView — the MCP Hub tab. Lists the Atlas-managed MCP server registry
// (local manifest) with enable/disable toggles, add, and remove.

export default function McpHubView() {
  const [servers, setServers] = useState<McpServer[]>([]);
  const [name, setName] = useState("");
  const [command, setCommand] = useState("");
  const [args, setArgs] = useState("");
  const [error, setError] = useState("");

  const refresh = useCallback(() => {
    listMcpServers().then(setServers).catch((e) => setError(String(e)));
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  async function toggle(s: McpServer) {
    setServers(await setMcpEnabled(s.id, !s.enabled));
  }

  async function remove(s: McpServer) {
    setServers(await removeMcpServer(s.id));
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim() || !command.trim()) return;
    const servers = await addMcpServer({
      name: name.trim(),
      command: command.trim(),
      args: args.split(/\s+/).filter(Boolean),
      description: "",
    });
    setServers(servers);
    setName("");
    setCommand("");
    setArgs("");
  }

  return (
    <div className="view mcp-view">
      <div className="view-head">
        <h2>MCP Servers</h2>
        <span className="muted">Atlas-managed registry</span>
      </div>

      {error && <div className="error-banner">{error}</div>}

      <ul className="mcp-list">
        {servers.length === 0 && (
          <li className="empty-state">
            <p>No MCP servers registered.</p>
          </li>
        )}
        {servers.map((s) => (
          <li key={s.id} className="mcp-row">
            <div className="mcp-info">
              <strong>{s.name}</strong>
              <span className="muted">
                {s.command} {s.args.join(" ")}
              </span>
              {s.description && <span className="muted">{s.description}</span>}
            </div>
            <div className="mcp-actions">
              <button className={s.enabled ? "toggle on" : "toggle"} onClick={() => toggle(s)}>
                {s.enabled ? "enabled" : "disabled"}
              </button>
              <button className="danger" onClick={() => remove(s)}>
                remove
              </button>
            </div>
          </li>
        ))}
      </ul>

      <form className="mcp-add" onSubmit={submit}>
        <input
          value={name}
          onChange={(e) => setName(e.currentTarget.value)}
          placeholder="name"
        />
        <input
          value={command}
          onChange={(e) => setCommand(e.currentTarget.value)}
          placeholder="command (e.g. npx)"
        />
        <input
          value={args}
          onChange={(e) => setArgs(e.currentTarget.value)}
          placeholder="args"
        />
        <button type="submit">Add</button>
      </form>
    </div>
  );
}
