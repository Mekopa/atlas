import type { ChatPart } from "../../lib/chatModel";

// MessagePart — renders a single normalized chat part. Separated from the
// message bubble so each kind (text / CoT reasoning / tool call) can be
// styled and evolved independently (and later lifted into a component lib).

function ToolCallView({ part }: { part: Extract<ChatPart, { kind: "tool-call" }> }) {
  let inputPreview: string;
  try {
    inputPreview =
      typeof part.input === "string"
        ? part.input
        : part.input != null
          ? JSON.stringify(part.input)
          : "";
  } catch {
    inputPreview = "";
  }
  return (
    <details className="tool-call">
      <summary>
        <span className="tool-badge">{part.name}</span>
        {part.callId && <span className="tool-id">{part.callId.slice(0, 20)}</span>}
      </summary>
      {inputPreview && (
        <pre className="tool-input">{inputPreview.slice(0, 2000)}</pre>
      )}
      {part.output !== undefined && (
        <pre className="tool-output">{part.output.slice(0, 4000)}</pre>
      )}
    </details>
  );
}

export default function MessagePart({ part }: { part: ChatPart }) {
  switch (part.kind) {
    case "text":
      return <div className="msg-text">{part.text}</div>;
    case "reasoning":
      return (
        <details className="reasoning">
          <summary>Thought</summary>
          <pre className="reasoning-body">{part.text}</pre>
        </details>
      );
    case "tool-call":
      return <ToolCallView part={part} />;
    case "step-start":
      return <div className="step-start">{part.label ?? "step"}</div>;
    case "step-finish":
      return (
        <div className="step-finish">
          {part.reason ? `finish (${part.reason})` : "finish"}
        </div>
      );
    default:
      return null;
  }
}
