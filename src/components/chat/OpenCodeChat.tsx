import { useEffect, useRef, useState } from "react";
import {
  loadAcpSession,
  cancelOpenAcpSession,
  type OpenAcpSession,
} from "../../lib/acpService";
import type { ChatMessage, ChatSessionMeta } from "../../lib/chatModel";
import ChatThread from "./ChatThread";
import ChatInput from "./ChatInput";

// OpenCodeChat — the rich ACP chat for an existing opencode session.
//
// Opens the session via `session/load`, which REPLAYS the full conversation
// (text + CoT reasoning + tool calls + plans + usage) as session/update
// notifications. Everything normalizes into ChatMessage[] and renders with
// the chat component library. Sending continues the SAME session via
// session/prompt, streaming the live turn into the thread.

interface Props {
  sessionId: string;
  cwd: string;
  title?: string;
}

export default function OpenCodeChat({ sessionId, cwd, title }: Props) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [sessionMeta, setSessionMeta] = useState<ChatSessionMeta | null>(null);
  const [busy, setBusy] = useState(false);
  const sessionRef = useRef<OpenAcpSession | null>(null);

  useEffect(() => {
    let alive = true;
    let unsub: (() => void) | null = null;
    setLoading(true);
    setError("");
    setMessages([]);

    loadAcpSession("opencode", sessionId, cwd)
      .then((sess) => {
        if (!alive) {
          sess.close().catch(() => undefined);
          return;
        }
        sessionRef.current = sess;
        setMessages(sess.getMessages());
        setSessionMeta({
          sessionId,
          title: title ?? "session",
          cwd,
          updatedAt: Date.now(),
          messageCount: sess.getMessages().length,
        });
        unsub = sess.onMessages(() => {
          if (alive) setMessages([...sess.getMessages()]);
        });
      })
      .catch((e) => alive && setError(String(e)))
      .finally(() => alive && setLoading(false));

    return () => {
      alive = false;
      unsub?.();
      // Kill any in-flight child even if loadAcpSession hasn't resolved yet
      // (StrictMode double-mount, pane switches) — this was leaking processes.
      cancelOpenAcpSession(sessionId);
      sessionRef.current?.close().catch(() => undefined);
      sessionRef.current = null;
    };
  }, [sessionId, cwd, title]);

  async function send(text: string) {
    const sess = sessionRef.current;
    if (!sess || !text.trim() || busy) return;
    setBusy(true);
    // Optimistic append: opencode doesn't echo the user's message back on
    // session/prompt, so render it immediately or the input "disappears".
    setMessages((m) => [
      ...m,
      {
        id: `user-${Date.now()}`,
        sessionId,
        role: "user",
        ts: Date.now(),
        parts: [{ kind: "text", text }],
      },
    ]);
    try {
      await sess.prompt(text.trim());
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="view opencode-chat">
      <div className="pane-head">
        <strong>{sessionMeta?.title ?? title ?? "Session"}</strong>
        <span className="muted">
          {sessionId.slice(0, 12)} · {sessionMeta?.messageCount ?? "?"} messages
        </span>
      </div>
      {error && (
        <div className="error-state">
          <p>Failed to load session</p>
          <pre>{error}</pre>
        </div>
      )}
      {!error && (
        <ChatThread
          messages={messages}
          loading={loading}
          emptyText="No messages in this session."
        />
      )}
      <ChatInput placeholder="send to opencode…" disabled={!sessionRef.current || busy} onSend={send} />
    </div>
  );
}
