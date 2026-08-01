import { useEffect, useState } from "react";
import { listAcpAgents, type AcpAgent } from "../lib/acpService";

// AppsView — the APPS tab (Icarus webview apps).
//
// First pass: a registry grid backed by available ACP agents and a local list
// of Icarus app stubs. Real webview embedding of Icarus apps is a later
// milestone; this pass establishes the surface and its data shape.

export interface AppEntry {
  id: string;
  name: string;
  description: string;
  launchable: boolean;
}

const ICARUS_APPS: AppEntry[] = [
  {
    id: "icarus",
    name: "Icarus",
    description: "AI coding agent (deepagents SDK) — launchable CLI",
    launchable: true,
  },
];

export default function AppsView() {
  const [agents, setAgents] = useState<AcpAgent[]>([]);

  useEffect(() => {
    listAcpAgents().then(setAgents).catch(() => undefined);
  }, []);

  const availableAgents = agents
    .filter((a) => a.available)
    .map((a) => ({ id: a.id, name: a.label, description: `ACP agent (${a.binary})`, launchable: true }));

  const entries = [...ICARUS_APPS, ...availableAgents];

  return (
    <div className="view apps-view">
      <div className="view-head">
        <h2>Apps</h2>
        <span className="muted">Icarus webview apps · registry stub</span>
      </div>
      <div className="apps-grid">
        {entries.map((e) => (
          <div key={e.id} className={`app-card ${e.launchable ? "" : "stub"}`}>
            <strong>{e.name}</strong>
            <span className="muted">{e.description}</span>
            {e.launchable ? (
              <button disabled title="webview launch coming in a later pass">
                Launch
              </button>
            ) : (
              <span className="badge">stub</span>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
