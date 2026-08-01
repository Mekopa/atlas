// herdrStore — React-side live view of herdr's structure layer.
//
// Holds the hierarchy workspaces → tabs → panes (the "what's running" shell)
// and stays in sync with herdr two ways:
//   1. initial pull via agentService (listWorkspaces/listTabs/listAgents)
//   2. push via Tauri events emitted by src-tauri/src/realtime.rs
//
// Pane output is fetched on demand (readPane) when a pane event fires; on
// servers without the output tags (old herdr) the caller falls back to a poll.

import { useEffect, useState } from "react";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import {
  listAgents,
  listTabs,
  listWorkspaces,
  readPane,
  type Agent,
  type Tab,
  type Workspace,
} from "./agentService";

export interface HerdrSnapshot {
  workspaces: Workspace[];
  tabs: Tab[];
  agents: Agent[];
  /** revision bump = refresh the hierarchy */
  rev: number;
}

export const EMPTY: HerdrSnapshot = { workspaces: [], tabs: [], agents: [], rev: 0 };

const EVENT_STRUCTURE = "herdr:structure";
const EVENT_STATUS = "herdr:status";
const EVENT_PANE = "herdr:pane";

/** Pulls the full hierarchy from herdr (used on mount + after structure events). */
export async function fetchHierarchy(): Promise<HerdrSnapshot> {
  const [workspaces, tabs, agents] = await Promise.all([
    listWorkspaces(),
    listTabs(),
    listAgents(),
  ]);
  return { workspaces, tabs, agents, rev: Date.now() };
}

/** Re-reads a pane's recent ANSI output. Returns text. */
export async function fetchPane(paneId: string): Promise<string> {
  return readPane(paneId);
}

/**
 * Subscribes to herdr push events. Calls onPane when a specific pane changed
 * (so the caller can re-read output) and onRefresh for structural changes.
 * Returns an unsubscribe function.
 */
export function subscribeHerdr(opts: {
  onPane?: (paneId: string) => void;
  onRefresh?: () => void;
  onStatus?: (agentId: string, status: string) => void;
}): Promise<UnlistenFn> {
  const unlisteners: UnlistenFn[] = [];

  const attach = (event: string, handler: (payload: unknown) => void) => {
    listen(event, (e) => handler(e.payload)).then((u) => unlisteners.push(u));
  };

  attach(EVENT_PANE, (payload) => {
    const paneId = (payload as { pane_id?: string })?.pane_id;
    if (paneId) opts.onPane?.(paneId);
  });

  attach(EVENT_STATUS, (payload) => {
    const p = payload as {
      data?: { pane_id?: string; agent?: string; agent_status?: string };
    };
    const paneId = p?.data?.pane_id;
    const agent = p?.data?.agent;
    const status = p?.data?.agent_status;
    if (paneId) opts.onStatus?.(agent ?? paneId, status ?? "");
    opts.onRefresh?.();
  });

  attach(EVENT_STRUCTURE, () => opts.onRefresh?.());

  return Promise.all(unlisteners).then(
    (us) => async () => {
      for (const u of us) await u();
    },
  );
}

/**
 * React hook: live herdr hierarchy + helpers to fetch pane output.
 * Workspaces/tabs/agents refresh on push events; panes read on demand.
 */
export function useHerdr() {
  const [snapshot, setSnapshot] = useState<HerdrSnapshot>(EMPTY);

  useEffect(() => {
    let alive = true;
    let unlisten: UnlistenFn | null = null;

    const refresh = async () => {
      try {
        const s = await fetchHierarchy();
        if (alive) setSnapshot(s);
      } catch {
        /* herdr unreachable — keep last snapshot */
      }
    };

    refresh();
    subscribeHerdr({
      onRefresh: refresh,
      onPane: () => {
        // Pane output is owned by the specific pane's view (PaneChat/Terminal),
        // which subscribes to onPane itself. We must NOT bump snapshot.rev here
        // — doing so re-rendered the whole hierarchy on every pane event.
      },
    }).then((u) => (unlisten = u));

    return () => {
      alive = false;
      unlisten?.();
    };
  }, []);

  return { snapshot, fetchPane };
}
