// opencodeHistory — a ChatHistorySource backed by the opencode CLI (`export`).
//
// opencode keeps all sessions in its own SQLite store and exposes them via
// `opencode export <sessionID>` → JSON. This adapter shells out to that via the
// Tauri `opencode` command and normalizes the result into ChatMessage[].
//
// This is ONE implementation of the ChatHistorySource contract — Atlas also
// persists its own history and can add other adapters (claude-code, gemini,
// goose) without touching the components.

import { invoke } from "@tauri-apps/api/core";
import type {
  ChatHistorySource,
  ChatMessage,
  ChatPart,
  ChatSessionMeta,
} from "./chatModel";

type CliResult = {
  ok: boolean;
  json: { info?: unknown; messages?: unknown } | null;
  error?: string;
};

async function opencode(...args: string[]): Promise<unknown> {
  const res = (await invoke("opencode", { args })) as CliResult;
  if (!res.ok || !res.json) throw new Error(res.error ?? "opencode call failed");
  return res.json;
}

// --- raw opencode export shapes ---------------------------------------------

type RawExport = {
  info?: {
    id?: string;
    title?: string;
    directory?: string;
  };
  messages?: RawMessage[];
};

type RawMessage = {
  info?: {
    role?: string;
    time?: { created?: number };
    id?: string;
    model?: { providerID?: string; modelID?: string };
  };
  parts?: RawPart[];
};

type RawPart =
  | { type: "text"; text?: string }
  | { type: "reasoning"; text?: string }
  | {
      type: "tool";
      tool?: string;
      callID?: string;
      state?: { input?: unknown; output?: unknown; status?: string };
    }
  | { type: "step-start" }
  | { type: "step-finish"; reason?: string };

function normalizePart(raw: RawPart): ChatPart | null {
  switch (raw.type) {
    case "text":
      return raw.text ? { kind: "text", text: raw.text } : null;
    case "reasoning":
      return raw.text ? { kind: "reasoning", text: raw.text } : null;
    case "tool": {
      const out = raw.state?.output;
      return {
        kind: "tool-call",
        name: raw.tool ?? "tool",
        callId: raw.callID ?? "",
        input: raw.state?.input,
        output: typeof out === "string" ? out : out != null ? JSON.stringify(out) : undefined,
      };
    }
    case "step-start":
      return { kind: "step-start" };
    case "step-finish":
      return { kind: "step-finish", reason: raw.reason };
    default:
      return null;
  }
}

function normalizeMessage(raw: RawMessage, sessionId: string): ChatMessage {
  const role = (raw.info?.role ?? "assistant") as ChatMessage["role"];
  const parts = (raw.parts ?? [])
    .map(normalizePart)
    .filter((p): p is ChatPart => p !== null);
  return {
    id: raw.info?.id ?? `msg-${Math.random().toString(36).slice(2)}`,
    sessionId,
    role,
    ts: raw.info?.time?.created ?? Date.now(),
    parts,
  };
}

function roleLabel(r?: string): string {
  return r ?? "assistant";
}

/** opencode `export` adapter. */
export const opencodeHistory: ChatHistorySource = {
  id: "opencode",

  async listSessions(): Promise<ChatSessionMeta[]> {
    // opencode has no bulk "list as JSON" export; the ACP session/list path
    // (acpService) provides the session index. This adapter leaves the index
    // to the caller; it only materializes messages on demand.
    return [];
  },

  async getMessages(sessionId: string): Promise<ChatMessage[]> {
    const raw = (await opencode("export", sessionId)) as RawExport;
    const messages = (raw.messages ?? [])
      .filter((m) => roleLabel(m.info?.role) !== "system")
      .map((m) => normalizeMessage(m, sessionId));
    // Sort oldest → newest so the thread reads top-to-bottom.
    messages.sort((a, b) => a.ts - b.ts);
    return messages;
  },
};
