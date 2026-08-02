import { useEffect, useRef } from "react";
import type { ChatMessage } from "../../lib/chatModel";
import MessagePart from "./MessagePart";

// ChatThread — renders a list of normalized messages with autoscroll.
// Purely presentational: it takes ChatMessage[] and renders. It has no idea
// where messages come from (herdr, ACP, export). Library-ready.

interface Props {
  messages: ChatMessage[];
  loading?: boolean;
  emptyText?: string;
}

export default function ChatThread({ messages, loading, emptyText }: Props) {
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages]);

  return (
    <div className="chat-thread" ref={scrollRef}>
      {loading && <div className="empty-state"><p>Loading…</p></div>}
      {!loading && messages.length === 0 && (
        <div className="empty-state"><p>{emptyText ?? "No messages."}</p></div>
      )}
      {messages.map((m) => (
        <div key={m.id} className={`chat-msg ${m.role}`}>
          <div className="chat-role">
            {m.role}
            {m.streaming ? " · streaming" : ""}
          </div>
          {m.parts.length === 0 ? (
            <div className="msg-text muted">(no content)</div>
          ) : (
            m.parts.map((p, i) => <MessagePart key={i} part={p} />)
          )}
        </div>
      ))}
    </div>
  );
}
