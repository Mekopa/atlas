import { useState } from "react";
import "./App.css";
import SpacesView from "./components/SpacesView";
import ChatView from "./components/ChatView";
import AppsView from "./components/AppsView";
import McpHubView from "./components/McpHubView";

// App — the Atlas shell. Hosts the top bar and the four first-class surfaces
// as tabs: Spaces (herdr panes), Chat (ACP), Apps (Icarus webview apps),
// MCP Hub (server registry). Each tab is its own component with its own sync
// path; nothing here knows herdr or ACP directly.

type TabId = "spaces" | "chat" | "apps" | "mcp";

const TABS: { id: TabId; label: string }[] = [
  { id: "spaces", label: "Spaces" },
  { id: "chat", label: "Chat" },
  { id: "apps", label: "Apps" },
  { id: "mcp", label: "MCP Hub" },
];

function App() {
  const [tab, setTab] = useState<TabId>("spaces");

  return (
    <main className="container">
      <header className="topbar">
        <h1>Atlas</h1>
        <span className="subtitle">cockpit over herdr + ACP</span>
        <nav className="tabbar">
          {TABS.map((t) => (
            <button
              key={t.id}
              className={`tab ${tab === t.id ? "active" : ""}`}
              onClick={() => setTab(t.id)}
            >
              {t.label}
            </button>
          ))}
        </nav>
      </header>

      {tab === "spaces" && <SpacesView />}
      {tab === "chat" && <ChatView />}
      {tab === "apps" && <AppsView />}
      {tab === "mcp" && <McpHubView />}
    </main>
  );
}

export default App;
