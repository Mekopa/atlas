// chatModel — the ONE message model for all of Atlas chat.
//
// Every source (herdr panes, ACP streaming, opencode export, local history)
// normalizes into these types, so React components consume a single shape.
// Kept dependency-free so it can be lifted into a shared component library.

export type MessageRole = "user" | "assistant" | "system";

export type ToolCallStatus = "pending" | "in_progress" | "completed" | "failed";

export type ToolKind =
  | "read"
  | "edit"
  | "delete"
  | "move"
  | "search"
  | "execute"
  | "think"
  | "fetch"
  | "switch_mode"
  | "other";

export interface ToolCallLocation {
  path: string;
  line?: number;
}

export interface ToolCallDiff {
  path: string;
  oldText?: string;
  newText: string;
  deleted?: boolean;
}

export interface PlanEntry {
  content: string;
  priority?: string;
  status?: string;
}

/** A single content part inside a message. */
export type ChatPart =
  | { kind: "text"; text: string }
  | { kind: "reasoning"; text: string }
  | {
      kind: "tool-call";
      callId: string;
      name?: string;
      title?: string;
      toolKind?: ToolKind;
      status?: ToolCallStatus;
      input?: unknown;
      output?: string;
      locations?: ToolCallLocation[];
      diffs?: ToolCallDiff[];
    }
  | { kind: "plan"; entries: PlanEntry[] }
  | { kind: "usage"; used: number; size: number; cost?: { amount: number; currency: string } }
  | { kind: "step-start"; label?: string }
  | { kind: "step-finish"; reason?: string };

/** A normalized chat message. */
export interface ChatMessage {
  id: string;
  sessionId: string;
  role: MessageRole;
  /** Wall-clock ms timestamp. */
  ts: number;
  /** Whether this message is still streaming (its parts are incomplete). */
  streaming?: boolean;
  parts: ChatPart[];
}

/** A session summary (for the sidebar / session list). */
export interface ChatSessionMeta {
  sessionId: string;
  title: string;
  cwd: string;
  updatedAt: number;
  messageCount?: number;
}

/** Contract every history backend implements. */
export interface ChatHistorySource {
  id: string;
  listSessions(): Promise<ChatSessionMeta[]>;
  getMessages(sessionId: string): Promise<ChatMessage[]>;
}

/** Convenience: flatten a message's parts into plain text (for summaries etc). */
export function messageText(m: ChatMessage): string {
  return m.parts
    .filter((p) => p.kind === "text")
    .map((p) => (p.kind === "text" ? p.text : ""))
    .join("\n");
}
