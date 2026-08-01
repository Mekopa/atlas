import { useEffect, useRef, useState } from "react";
import {
  startChat,
  type ActiveChat,
  type ChatMessage,
} from "../lib/acpService";

// AgentChat — a reusable ACP chat interface for one agent in one cwd.
//
// Used both by the Chat tab and by SpacesView: when a running pane's agent is
// ACP-capable, opening it shows this real chat (thread + input + streaming)
// instead of a terminal snapshot. A fresh ACP session is started on mount in
// the given cwd; messages stream in as the agent replies.

interface Props {
  /** ACP agent id (e.g. "opencode", "gemini", "claude"). */
  agentId: string;
  /** Display label. */
  label: string;
  /** Working directory for the session. */
  cwd: string;
}

export default function AgentChat({ agentId, label, cwd }: Props) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const chatRef = useRef<ActiveChat | null>(null);
  const threadRef = useRef<HTMLDivElement>(null);

  // Start the session once on mount.
  useEffect(() => {
    let cancelled = false;
    setError("");
    setBusy(true);
    startChat(agentId, cwd)
      .then((chat) => {
        if (cancelled) {
          chat.close().catch(() => undefined);
          return;
        }
        chatRef.current = chat;
        setMessages([
          { role: "agent", text: `session ready (${chat.agent.label})`, ts: Date.now() },
        ]);
      })
      .catch((e) => setError(String(e)))
      .finally(() => !cancelled && setBusy(false));
    return () => {
      cancelled = true;
      chatRef.current?.close().catch(() => undefined);
      chatRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [agentId, cwd]);

  useEffect(() => {
    threadRef.current?.scrollTo({ top: threadRef.current.scrollHeight });
  }, [messages]);

  async function send() {
    const text = input.trim();
    const chat = chatRef.current;
    if (!text || !chat || busy) return;
    setInput("");
    setBusy(true);
    setMessages((m) => [...m, { role: "user", text, ts: Date.now() }]);
    setMessages((m) => [...m, { role: "agent", text: "", ts: Date.now() }]);
    try {
      await chat.prompt(text, (chunk) => {
        setMessages((m) => {
          const copy = [...m];
          copy[copy.length - 1] = {
            ...copy[copy.length - 1],
            text: copy[copy.length - 1].text + chunk,
          };
          return copy;
        });
      });
    } catch (e) {
      setError(String(e));
      setMessages((m) => {
        const copy = [...m];
        copy[copy.length - 1] = { ...copy[copy.length - 1], text: `(error: ${e})` };
        return copy;
      });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="view agent-chat">
      <div className="chat-thread" ref={threadRef}>
        {messages.length === 0 && !error && (
          <div className="empty-state">
            <p>Starting {label} session…</p>
          </div>
        )}
        {messages.map((m, i) => (
          <div key={i} className={`chat-msg ${m.role}`}>
            <div className="chat-role">{m.role}</div>
            <div className="chat-text">{m.text}</div>
          </div>
        ))}
      </div>

      {error && <div className="error-banner">{error}</div>}

      <form
        className="prompt-bar"
        onSubmit={(e) => {
          e.preventDefault();
          send();
        }}
      >
        <input
          value={input}
          onChange={(e) => setInput(e.currentTarget.value)}
          placeholder={chatRef.current ? `send to ${label}…` : "session not ready…"}
          disabled={!chatRef.current || busy}
        />
        <button type="submit" disabled={!chatRef.current || busy}>
          Send
        </button>
      </form>
    </div>
  );
}
