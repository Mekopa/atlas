import { useEffect, useState } from "react";
import AgentChat from "./AgentChat";
import { listAcpAgents, type AcpAgent } from "../lib/acpService";

// ChatView — the ACP tab. Pick an ACP-capable agent, then chat with it in a
// fresh session. Reuses AgentChat, the same chat component Spaces uses for
// opened panes, so there's a single chat implementation.

const DEFAULT_CWD = "/Users/mekopa";

export default function ChatView() {
  const [agents, setAgents] = useState<AcpAgent[]>([]);
  const [agentId, setAgentId] = useState<string>("");

  useEffect(() => {
    listAcpAgents().then((a) => {
      setAgents(a);
      const first = a.find((x) => x.available);
      if (first) setAgentId(first.id);
    });
  }, []);

  const agent = agents.find((a) => a.id === agentId);

  return (
    <div className="view chat-view">
      <div className="chat-toolbar">
        <select value={agentId} onChange={(e) => setAgentId(e.currentTarget.value)}>
          <option value="">choose agent…</option>
          {agents.map((a) => (
            <option key={a.id} value={a.id} disabled={!a.available}>
              {a.label} {a.available ? "" : "(not found)"}
            </option>
          ))}
        </select>
        <span className="muted">chat in {DEFAULT_CWD}</span>
      </div>

      {agent ? (
        <AgentChat key={agent.id} agentId={agent.id} label={agent.label} cwd={DEFAULT_CWD} />
      ) : (
        <div className="empty-state">
          <p>Pick an ACP agent to start a chat.</p>
        </div>
      )}
    </div>
  );
}
