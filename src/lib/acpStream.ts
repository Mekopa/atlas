// acpStream — normalizes the ACP `session/update` notification stream into the
// Atlas chat model (ChatMessage[] / ChatPart[]).
//
// ACP streams a session as an ordered list of update notifications:
//   user_message_chunk / agent_message_chunk  -> text (grouped by messageId)
//   agent_thought_chunk                       -> CoT reasoning
//   tool_call / tool_call_update              -> tool lifecycle (by toolCallId)
//   plan / plan_update                        -> the agent's todo list
//   usage_update                              -> context/cost
//
// This module is pure (no I/O): feed it updates, get a live ChatMessage[].

import type {
  ChatMessage,
  ChatPart,
  PlanEntry,
  ToolCallDiff,
} from "./chatModel";

export interface StreamUpdate {
  sessionUpdate: string;
  messageId?: string;
  toolCallId?: string;
  content?: unknown;
  status?: string;
  kind?: string;
  title?: string;
  name?: string;
  rawInput?: unknown;
  rawOutput?: unknown;
  locations?: unknown;
  entries?: unknown;
  used?: number;
  size?: number;
  cost?: unknown;
}

type ContentBlock =
  | { type: "text"; text?: string }
  | { type: "diff"; path?: string; oldText?: string; newText?: string }
  | { type: "content"; content?: ContentBlock };

function textOf(content: unknown): string {
  const c = content as ContentBlock | undefined;
  if (!c) return "";
  if (c.type === "content" && c.content) return textOf(c.content);
  if (c.type === "text") return c.text ?? "";
  return "";
}

function diffsOf(content: unknown): ToolCallDiff[] | undefined {
  const c = content as ContentBlock | undefined;
  if (!c) return undefined;
  if (c.type === "content" && c.content) return diffsOf(c.content);
  if (c.type === "diff" && c.path && c.newText) {
    return [
      {
        path: c.path,
        oldText: c.oldText,
        newText: c.newText,
      },
    ];
  }
  return undefined;
}

/**
 * Accumulates ACP updates into a normalized message list.
 * - text/reasoning chunks with the same messageId merge into one message
 * - tool calls live in their own assistant "activity" message, keyed by
 *   toolCallId so later tool_call_update events mutate the same part
 */
export class StreamBuilder {
  private _messages: ChatMessage[] = [];
  private msgIdx = new Map<string, number>();
  private toolIdx = new Map<string, { msg: number; part: number }>();

  get messages(): ChatMessage[] {
    return this._messages;
  }

  /** Applies one ACP update. Mutates in place; returns true if anything changed. */
  apply(update: StreamUpdate): boolean {
    switch (update.sessionUpdate) {
      case "user_message_chunk":
        this.chunk("user", update.messageId, "text", textOf(update.content));
        return true;
      case "agent_message_chunk":
        this.chunk("assistant", update.messageId, "text", textOf(update.content));
        return true;
      case "agent_thought_chunk":
        this.chunk("assistant", update.messageId, "reasoning", textOf(update.content));
        return true;
      case "tool_call":
        this.toolStart(update);
        return true;
      case "tool_call_update":
        this.toolUpdate(update);
        return true;
      case "plan":
      case "plan_update":
        this.plan(update);
        return true;
      case "usage_update":
        this.usage(update);
        return true;
      default:
        return false;
    }
  }

  private newMessage(role: ChatMessage["role"], id: string, part: ChatPart): number {
    this._messages.push({
      id,
      sessionId: "",
      role,
      ts: Date.now(),
      parts: [part],
    });
    return this._messages.length - 1;
  }

  private chunk(
    role: ChatMessage["role"],
    messageId: string | undefined,
    kind: "text" | "reasoning",
    text: string,
  ) {
    if (!messageId) return;
    const existing = this.msgIdx.get(messageId);
    if (existing !== undefined && this._messages[existing]) {
      const msg = this._messages[existing];
      const part = msg.parts[msg.parts.length - 1];
      if (part && part.kind === kind && "text" in part) {
        (part as { text: string }).text += text;
      } else {
        msg.parts.push(kind === "text" ? { kind, text } : { kind, text });
      }
    } else {
      const idx = this.newMessage(role, messageId, { kind, text });
      this.msgIdx.set(messageId, idx);
    }
  }

  private toolStart(u: StreamUpdate) {
    const part: Extract<ChatPart, { kind: "tool-call" }> = {
      kind: "tool-call",
      callId: u.toolCallId ?? "",
      name: u.name,
      title: u.title,
      status: (u.status as Extract<ChatPart, { kind: "tool-call" }>["status"]) ?? "pending",
      input: u.rawInput,
      locations: (u.locations as Extract<ChatPart, { kind: "tool-call" }>["locations"]) ?? [],
    };
    if (u.kind) part.toolKind = u.kind as Extract<ChatPart, { kind: "tool-call" }>["toolKind"];
    const idx = this.newMessage("assistant", `tool-${u.toolCallId ?? Math.random()}`, part);
    if (u.toolCallId) this.toolIdx.set(u.toolCallId, { msg: idx, part: 0 });
  }

  private toolUpdate(u: StreamUpdate) {
    const ref = u.toolCallId ? this.toolIdx.get(u.toolCallId) : undefined;
    if (!ref) return;
    const msg = this._messages[ref.msg];
    const part = msg?.parts[ref.part] as
      | Extract<ChatPart, { kind: "tool-call" }>
      | undefined;
    if (!part) return;
    if (u.status) part.status = u.status as typeof part.status;
    if (u.title) part.title = u.title;
    if (u.kind) part.toolKind = u.kind as typeof part.toolKind;
    if (u.locations) part.locations = u.locations as typeof part.locations;
    if (u.rawOutput !== undefined) {
      part.output =
        typeof u.rawOutput === "string"
          ? u.rawOutput
          : JSON.stringify(u.rawOutput);
    }
    const diff = diffsOf(u.content);
    if (diff) part.diffs = [...(part.diffs ?? []), ...diff];
    const text = textOf(u.content);
    if (text && !part.output) part.output = text;
  }

  private plan(u: StreamUpdate) {
    const entries = (u.entries ?? []) as PlanEntry[];
    if (entries.length === 0) return;
    const idx = this.newMessage("assistant", `plan-${Date.now()}`, {
      kind: "plan",
      entries,
    });
    this.msgIdx.set(`plan-${idx}`, idx);
  }

  private usage(u: StreamUpdate) {
    if (u.used === undefined) return;
    this._messages.push({
      id: `usage-${Date.now()}`,
      sessionId: "",
      role: "system",
      ts: Date.now(),
      parts: [
        {
          kind: "usage",
          used: u.used,
          size: u.size ?? 0,
          cost:
            typeof u.cost === "object" && u.cost && "amount" in u.cost
              ? (u.cost as { amount: number; currency: string })
              : undefined,
        },
      ],
    });
  }

  /** Marks the last assistant message as done streaming. */
  finalize() {
    for (let i = this._messages.length - 1; i >= 0; i--) {
      const m = this._messages[i];
      if (m.role === "assistant") {
        m.streaming = false;
        break;
      }
    }
  }
}
