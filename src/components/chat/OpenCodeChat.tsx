import { useEffect, useState } from "react";
import { opencodeHistory } from "../../lib/opencodeHistory";
import type { ChatMessage, ChatSessionMeta } from "../../lib/chatModel";
import ChatThread from "./ChatThread";
import ChatInput from "./ChatInput";

// OpenCodeChat — sample composition of the chat component library pieces:
// backfills message history from opencode via the ChatHistorySource contract
// and renders it with ChatThread + ChatInput. ACP streaming wiring comes next.

interface Props {
  sessionId: string;
  title?: string;
  onSend?: (text: string) => Promise<void>;
}

export default function OpenCodeChat({ sessionId, title }: Props) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [sessionMeta, setSessionMeta] = useState<ChatSessionMeta | null>(null);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setMessages([]);
    opencodeHistory
      .getMessages(sessionId)
      .then((msgs) => {
        if (!alive) return;
        setMessages(msgs);
        setSessionMeta({
          sessionId,
          title: title ?? "session",
          cwd: "",
          updatedAt: Date.now(),
          messageCount: msgs.length,
        });
      })
      .catch((e) => alive && setError(String(e)))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [sessionId, title]);

  return (
    <div className="view opencode-chat">
      <div className="pane-head">
        <strong>{sessionMeta?.title ?? title ?? "Session"}</strong>
        <span className="muted">
          {sessionId.slice(0, 12)} · {sessionMeta?.messageCount ?? "?"} messages
        </span>
      </div>
      {error && <div className="error-banner">{error}</div>}
      <ChatThread messages={messages} loading={loading} emptyText="No messages in this session." />
      <ChatInput
        placeholder="send a message… (streaming coming next)"
        disabled
        onSend={() => {}}
      />
    </div>
  );
}
