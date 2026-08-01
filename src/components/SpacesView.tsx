import { useCallback, useEffect, useRef, useState } from "react";
import TerminalPane from "./TerminalPane";
import AgentChat from "./AgentChat";
import { sendToAgent, type Agent, type Tab } from "../lib/agentService";
import { acpAgentIdForHerdrName } from "../lib/acpService";
import { useHerdr } from "../lib/herdrStore";

// SpacesView — the SPACES tab (herdr-sync path). Shows herdr's structure layer
// as a hierarchy (workspace → tab → pane, each with its detected agent + live
// status). Opening a pane shows either a REAL chat interface (AgentChat via
// ACP, when the agent is ACP-capable) or the raw terminal output. Structure and
// status arrive via push events (herdrStore); pane output is re-read on demand.

const STATUS_COLOR: Record<string, string> = {
  working: "#f5a623",
  blocked: "#e05b4f",
  done: "#4bbf73",
  idle: "#8a8f98",
};

function statusDot(status?: string) {
  return { background: STATUS_COLOR[status ?? ""] ?? "#8a8f98" };
}

type ViewMode = "chat" | "terminal";

export default function SpacesView() {
  const { snapshot, fetchPane } = useHerdr();
  const [selected, setSelected] = useState<Agent | null>(null);
  const [mode, setMode] = useState<ViewMode>("chat");
  const [output, setOutput] = useState("");
  const [prompt, setPrompt] = useState("");
  const [error, setError] = useState("");
  const selectedRef = useRef<Agent | null>(null);
  selectedRef.current = selected;

  // ACP capability decides the default view for the opened chat.
  const acpId = selected ? acpAgentIdForHerdrName(selected.agent) : undefined;
  const cwd = selected?.cwd ?? "/Users/mekopa";

  // Re-read the selected pane's output (for terminal view + fallback).
  const readSelected = useCallback(async () => {
    const cur = selectedRef.current;
    if (!cur) return;
    try {
      const text = await fetchPane(cur.pane_id);
      setOutput(text);
    } catch {
      /* keep last output */
    }
  }, [fetchPane]);

  useEffect(() => {
    if (!selected) return;
    readSelected();
  }, [selected, readSelected, snapshot.rev]);

  useEffect(() => {
    if (!selected) return;
    const t = setInterval(readSelected, 1000);
    return () => clearInterval(t);
  }, [selected, readSelected]);

  // Reset view mode to chat whenever a new agent is opened.
  useEffect(() => {
    setMode("chat");
  }, [selected?.pane_id]);

  async function runPrompt() {
    if (!selected || !prompt.trim()) return;
    try {
      await sendToAgent(selected.pane_id, prompt.trim());
      setPrompt("");
      setTimeout(readSelected, 300);
    } catch (e) {
      setError(String(e));
    }
  }

  // Group agents by workspace → tab for the hierarchy.
  const tabsByWs = new Map<string, Tab[]>();
  snapshot.tabs.forEach((t) => {
    const list = tabsByWs.get(t.workspace_id) ?? [];
    list.push(t);
    tabsByWs.set(t.workspace_id, list);
  });
  const agentsByWsTab = new Map<string, Map<string, Agent[]>>();
  snapshot.agents.forEach((a) => {
    const ws = agentsByWsTab.get(a.workspace_id) ?? new Map();
    const list = ws.get(a.tab_id) ?? [];
    list.push(a);
    ws.set(a.tab_id, list);
    agentsByWsTab.set(a.workspace_id, ws);
  });

  return (
    <div className="view spaces-view">
      {error && <div className="error-banner">{error}</div>}

      <div className="layout">
        <aside className="sidebar">
          <h2>Spaces</h2>
          <div className="hierarchy">
            {snapshot.workspaces.length === 0 && (
              <p className="muted pad">No spaces (herdr unreachable?).</p>
            )}
            {snapshot.workspaces.map((ws) => {
              const wsId = ws.workspace_id ?? "";
              const tabs: Tab[] = tabsByWs.get(wsId) ?? [];
              const tabAgents = agentsByWsTab.get(wsId) ?? new Map();
              return (
                <div key={wsId || ws.number} className="ws-node">
                  <div className="ws-head">
                    <span className="ws-name">{ws.label || `#${ws.number}`}</span>
                    <span className="muted">
                      {tabs.length}t · {ws.pane_count}p
                    </span>
                  </div>
                  {tabs.map((tab) => {
                    const agents: Agent[] = tabAgents.get(tab.tab_id) ?? [];
                    return (
                      <div key={tab.tab_id} className="tab-node">
                        <div className="tab-head">
                          <span className="muted">tab {tab.label}</span>
                        </div>
                        <ul className="agent-list">
                          {agents.map((a) => (
                            <li key={a.pane_id}>
                              <button
                                className={`agent-row ${selected?.pane_id === a.pane_id ? "active" : ""}`}
                                onClick={() => setSelected(a)}
                              >
                                <span className="status-dot" style={statusDot(a.agent_status)} />
                                <span className="agent-name">
                                  {a.agent}
                                  {a.agent_status ? (
                                    <span className="agent-status"> · {a.agent_status}</span>
                                  ) : null}
                                </span>
                              </button>
                            </li>
                          ))}
                        </ul>
                      </div>
                    );
                  })}
                </div>
              );
            })}
          </div>
        </aside>

        <section className="pane-view">
          {selected ? (
            <>
              <div className="pane-head">
                <strong>{selected.agent}</strong>
                <span className="muted">
                  {selected.workspace_id.slice(-6)} · {selected.pane_id}
                </span>
                <span className="view-toggle">
                  {acpId && (
                    <button
                      className={mode === "chat" ? "active" : ""}
                      onClick={() => setMode("chat")}
                    >
                      Chat
                    </button>
                  )}
                  <button
                    className={mode === "terminal" ? "active" : ""}
                    onClick={() => setMode("terminal")}
                  >
                    Terminal
                  </button>
                </span>
              </div>

              {mode === "chat" && acpId ? (
                <AgentChat key={selected.pane_id} agentId={acpId} label={selected.agent} cwd={cwd} />
              ) : mode === "chat" ? (
                <div className="empty-state">
                  <p>{selected.agent} isn't ACP-capable — switch to Terminal view.</p>
                </div>
              ) : (
                <>
                  <TerminalPane data={output} />
                  <form
                    className="prompt-bar"
                    onSubmit={(e) => {
                      e.preventDefault();
                      runPrompt();
                    }}
                  >
                    <input
                      value={prompt}
                      onChange={(e) => setPrompt(e.currentTarget.value)}
                      placeholder={`send to ${selected.agent}…`}
                    />
                    <button type="submit">Send</button>
                  </form>
                </>
              )}
            </>
          ) : (
            <div className="empty-state">
              <p>Select an agent on the left to open its chat.</p>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
