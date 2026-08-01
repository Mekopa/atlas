import { useEffect, useRef, useState } from "react";
import {
  listAcpAgents,
  startChat,
  type AcpAgent,
  type ActiveChat,
  type ChatMessage,
} from "../lib/acpService";

// ChatView — the ACP tab. Picks an ACP-capable agent (gemini-cli, claude-code,
// goose, codex), starts a session over JSON-RPC/stdio via acpService, and shows
// a simple message thread with an input bar. Fully independent of the herdr
// pane path in Spaces.

const DEFAULT_CWD = "/Users/mekopa";

export default function ChatView() {
  const [agents, setAgents] = useState<AcpAgent[]>([]);
  const [agentId, setAgentId] = useState<string>("");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const chatRef = useRef<ActiveChat | null>(null);
  const threadRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    listAcpAgents().then((a) => {
      setAgents(a);
      const first = a.find((x) => x.available);
      if (first) setAgentId(first.id);
    });
  }, []);

  useEffect(() => {
    threadRef.current?.scrollTo({ top: threadRef.current.scrollHeight });
  }, [messages]);

  async function begin() {
    if (!agentId) return;
    setError("");
    setMessages([]);
    setBusy(true);
    try {
      const chat = await startChat(agentId, DEFAULT_CWD);
      chatRef.current = chat;
      setMessages([{ role: "agent", text: `session ready (${chat.agent.label})`, ts: Date.now() }]);
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }

  async function endChat() {
    await chatRef.current?.close().catch(() => undefined);
    chatRef.current = null;
    setMessages([]);
  }

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
          copy[copy.length - 1] = { ...copy[copy.length - 1], text: copy[copy.length - 1].text + chunk };
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
    <div className="view chat-view">
      <div className="chat-toolbar">
        <select value={agentId} onChange={(e) => setAgentId(e.currentTarget.value)}>
          <option value="">choose agent…</option>
          {agents.map((a) => (
            <option key={a.id} value={a.id} disabled={!a.available}>
              {a.label} {a.available ? "" : "(not found)"}
            </option>
          ))}
        </select>
        {!chatRef.current ? (
          <button onClick={begin} disabled={!agentId || busy}>
            Start session
          </button>
        ) : (
          <button onClick={endChat} disabled={busy}>
            End session
          </button>
        )}
      </div>

      {error && <div className="error-banner">{error}</div>}

      <div className="chat-thread" ref={threadRef}>
        {messages.length === 0 && (
          <div className="empty-state">
            <p>Pick an ACP agent and start a session to chat.</p>
          </div>
        )}
        {messages.map((m, i) => (
          <div key={i} className={`chat-msg ${m.role}`}>
            <div className="chat-role">{m.role}</div>
            <div className="chat-text">{m.text}</div>
          </div>
        ))}
      </div>

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
          placeholder={chatRef.current ? "send to agent…" : "start a session first…"}
          disabled={!chatRef.current || busy}
        />
        <button type="submit" disabled={!chatRef.current || busy}>
          Send
        </button>
      </form>
    </div>
  );
}
