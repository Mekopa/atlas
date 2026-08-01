// agentService — the ONE layer the Atlas UI talks to.
//
// All fleet operations go through here. Today it shells out to the herdr CLI
// (via the Tauri `herdr` command in src-tauri). If herdr is ever replaced with
// a different daemon, ONLY this file changes — the UI never knows.
//
// herdr CLI prints `{"id": "...", "result": <payload>}` to stdout for every
// successful subcommand. We unwrap `.result` and return it.

import { invoke } from "@tauri-apps/api/core";

export interface Agent {
  agent: string;
  agent_status: string;
  cwd: string;
  focused: boolean;
  pane_id: string;
  tab_id: string;
  workspace_id: string;
  agent_session?: { value?: string };
}

export interface Workspace {
  label: string;
  number: number;
  pane_count: number;
  tab_count: number;
  focused: boolean;
  active_tab_id?: string;
}

export interface Tab {
  label: string;
  tab_id: string;
  workspace_id: string;
}

type HerdrResult = {
  ok: boolean;
  json: { id?: string; result?: unknown; error?: { code?: string; message?: string } } | null;
  error?: string;
};

async function herdr(...args: string[]): Promise<unknown> {
  const res = (await invoke("herdr", { args })) as HerdrResult;
  if (!res.ok || !res.json) {
    throw new Error(res.error ?? "herdr call failed");
  }
  if (res.json.error) {
    throw new Error(res.json.error.message ?? JSON.stringify(res.json.error));
  }
  return res.json.result;
}

/** All agents across every workspace, with their status. */
export async function listAgents(): Promise<Agent[]> {
  const result = (await herdr("agent", "list")) as { agents: Agent[] };
  return result.agents ?? [];
}

/** Workspaces, each with its tab/pane counts. */
export async function listWorkspaces(): Promise<Workspace[]> {
  const result = (await herdr("workspace", "list")) as { workspaces: Workspace[] };
  return result.workspaces ?? [];
}

/** Tabs across all workspaces. */
export async function listTabs(): Promise<Tab[]> {
  const result = (await herdr("tab", "list")) as { tabs: Tab[] };
  return result.tabs ?? [];
}

/** Read the recent output of a pane (by pane_id), with ANSI escape sequences intact. */
export async function readPane(paneId: string): Promise<string> {
  const result = (await herdr(
    "agent",
    "read",
    paneId,
    "--source",
    "recent",
    "--format",
    "ansi",
    "--lines",
    "500",
  )) as { read?: { text?: string } };
  return result.read?.text ?? "";
}

/** Send text to an agent's pane and press Enter. */
export async function sendToAgent(paneId: string, text: string): Promise<void> {
  await herdr("pane", "run", paneId, text);
}

/** Focus a pane (bring its terminal to the foreground). */
export async function focusPane(paneId: string): Promise<void> {
  await herdr("agent", "focus", paneId);
}

/** Wait for an agent to reach a status ("idle"|"working"|"blocked"|"unknown"). */
export async function waitAgent(
  target: string,
  status: string,
  timeoutMs = 600_000,
): Promise<void> {
  await herdr("agent", "wait", target, "--status", status, "--timeout", String(timeoutMs));
}
