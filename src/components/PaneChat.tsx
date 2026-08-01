// PaneChat — a chat interface over a RUNNING herdr pane.
//
// The pane's terminal output IS the actual conversation. This shows the pane's
// transcript as clean PLAIN TEXT (ANSI stripped — no escape-code glitch, no
// raw TUI rendering) and keeps it live via herdr push events + a light poll.
// Sending continues the SAME pane through herdr, so GUI and TUI stay in sync.

import { useCallback, useEffect, useRef, useState } from "react";
import { readPaneText, sendToAgent } from "../lib/agentService";
import { subscribeHerdr } from "../lib/herdrStore";

interface Props {
  paneId: string;
  label: string;
}

export default function PaneChat({ paneId, label }: Props) {
  const [text, setText] = useState("");
  const [prompt, setPrompt] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const paneRef = useRef(paneId);
  paneRef.current = paneId;
  const threadRef = useRef<HTMLDivElement>(null);

  const refresh = useCallback(async () => {
    const pid = paneRef.current;
    try {
      const t = await readPaneText(pid);
      setText(t);
      setLoading(false);
    } catch {
      /* keep last */
    }
  }, []);

  // Fetch history immediately, then keep it live on pane events + poll.
  useEffect(() => {
    setLoading(true);
    setText("");
    refresh();

    const t = setInterval(refresh, 1000);
    return () => clearInterval(t);
  }, [refresh]);

  useEffect(() => {
    let un: (() => void) | null = null;
    subscribeHerdr({
      onPane: (id) => {
        if (id === paneRef.current) refresh();
      },
    }).then((u) => (un = u));
    return () => un?.();
  }, [refresh]);

  useEffect(() => {
    threadRef.current?.scrollTo({ top: threadRef.current.scrollHeight });
  }, [text]);

  async function send() {
    const value = prompt.trim();
    if (!value) return;
    setPrompt("");
    try {
      await sendToAgent(paneId, value);
      setTimeout(refresh, 300);
    } catch (e) {
      setError(String(e));
    }
  }

  return (
    <div className="view pane-chat">
      {error && <div className="error-banner">{error}</div>}
      <div className="pane-chat-body" ref={threadRef}>
        {loading ? (
          <div className="empty-state">
            <p>Loading {label}'s history…</p>
          </div>
        ) : text ? (
          <pre className="pane-transcript">{text}</pre>
        ) : (
          <div className="empty-state">
            <p>No output yet in {label}.</p>
          </div>
        )}
      </div>
      <form
        className="prompt-bar"
        onSubmit={(e) => {
          e.preventDefault();
          send();
        }}
      >
        <input
          value={prompt}
          onChange={(e) => setPrompt(e.currentTarget.value)}
          placeholder={`continue chat in ${label}…`}
        />
        <button type="submit">Send</button>
      </form>
    </div>
  );
}
