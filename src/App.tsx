import { useEffect, useState, useCallback } from "react";
import "./App.css";
import TerminalPane from "./components/TerminalPane";
import {
  listAgents,
  listWorkspaces,
  readPane,
  sendToAgent,
  type Agent,
  type Workspace,
} from "./lib/agentService";

const STATUS_COLOR: Record<string, string> = {
  working: "#f5a623",
  blocked: "#e05b4f",
  done: "#4bbf73",
  idle: "#8a8f98",
};

function App() {
  const [agents, setAgents] = useState<Agent[]>([]);
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [selected, setSelected] = useState<Agent | null>(null);
  const [output, setOutput] = useState("");
  const [prompt, setPrompt] = useState("");
  const [error, setError] = useState("");

  const refresh = useCallback(async () => {
    try {
      const [a, w] = await Promise.all([listAgents(), listWorkspaces()]);
      setAgents(a);
      setWorkspaces(w);
      setError("");
    } catch (e) {
      setError(String(e));
    }
  }, []);

  useEffect(() => {
    refresh();
    const t = setInterval(refresh, 3000);
    return () => clearInterval(t);
  }, [refresh]);

  async function openPane(agent: Agent) {
    setSelected(agent);
    try {
      const text = await readPane(agent.pane_id);
      setOutput(text);
    } catch (e) {
      setOutput(`(read failed: ${e})`);
    }
  }

  async function runPrompt() {
    if (!selected || !prompt.trim()) return;
    try {
      await sendToAgent(selected.pane_id, prompt.trim());
      setPrompt("");
      // Give herdr a moment, then pull the pane again.
      setTimeout(async () => {
        try {
          setOutput(await readPane(selected.pane_id));
        } catch {
          /* ignore */
        }
      }, 800);
    } catch (e) {
      setError(String(e));
    }
  }

  return (
    <main className="container">
      <header className="topbar">
        <h1>Atlas</h1>
        <span className="subtitle">cockpit over herdr</span>
        <div className="topbar-right">
          {workspaces.map((w) => (
            <span key={w.number} className="ws-chip">
              {w.label} <small>({w.pane_count}p)</small>
            </span>
          ))}
        </div>
      </header>

      {error && <div className="error-banner">{error}</div>}

      <div className="layout">
        <aside className="sidebar">
          <h2>Agents</h2>
          <ul className="agent-list">
            {agents.map((a) => (
              <li key={a.pane_id}>
                <button
                  className={`agent-row ${selected?.pane_id === a.pane_id ? "active" : ""}`}
                  onClick={() => openPane(a)}
                >
                  <span
                    className="status-dot"
                    style={{ background: STATUS_COLOR[a.agent_status] ?? "#8a8f98" }}
                  />
                  <span className="agent-name">{a.agent}</span>
                  <span className="agent-status">{a.agent_status}</span>
                </button>
              </li>
            ))}
          </ul>
        </aside>

        <section className="pane-view">
          {selected ? (
            <>
              <div className="pane-head">
                <strong>{selected.agent}</strong>
                <span className="muted">
                  {selected.workspace_id.slice(-6)} · {selected.pane_id}
                </span>
              </div>
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
          ) : (
            <div className="empty-state">
              <p>Select an agent on the left to inspect its pane.</p>
            </div>
          )}
        </section>
      </div>
    </main>
  );
}

export default App;
