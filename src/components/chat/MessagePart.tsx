import type { ChatPart, PlanEntry, ToolCallDiff, ToolCallStatus } from "../../lib/chatModel";

// MessagePart — renders a single normalized chat part. Separated from the
// message bubble so each kind (text / CoT reasoning / tool call / plan /
// usage) can be styled and evolved independently.

function statusBadge(status?: ToolCallStatus): string {
  return status ?? "pending";
}

function ToolCallView({
  part,
}: {
  part: Extract<ChatPart, { kind: "tool-call" }>;
}) {
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
    <details className="tool-call" open={part.status !== "completed"}>
      <summary>
        <span className={`tool-badge tool-${part.toolKind ?? "other"}`}>
          {part.name ?? part.title ?? part.toolKind ?? "tool"}
        </span>
        {part.title && part.title !== part.name && (
          <span className="tool-title">{part.title}</span>
        )}
        <span className={`tool-status ${statusBadge(part.status)}`}>
          {statusBadge(part.status)}
        </span>
        {part.callId && <span className="tool-id">{part.callId.slice(0, 20)}</span>}
      </summary>
      {part.locations && part.locations.length > 0 && (
        <div className="tool-locations">
          {part.locations.map((loc, i) => (
            <span key={i} className="tool-location">
              {loc.path}
              {loc.line != null ? `:${loc.line}` : ""}
            </span>
          ))}
        </div>
      )}
      {inputPreview && <pre className="tool-input">{inputPreview.slice(0, 2000)}</pre>}
      {part.diffs && part.diffs.length > 0 && <Diffs diffs={part.diffs} />}
      {part.output !== undefined && (
        <pre className="tool-output">{part.output.slice(0, 4000)}</pre>
      )}
    </details>
  );
}

function Diffs({ diffs }: { diffs: ToolCallDiff[] }) {
  return (
    <div className="tool-diffs">
      {diffs.map((d, i) => {
        const oldLines = (d.oldText ?? "").split("\n");
        const newLines = d.newText.split("\n");
        return (
          <div key={i} className="tool-diff">
            <div className="diff-path">
              {d.deleted ? "DEL " : ""}
              {d.path}
            </div>
            {oldLines.length > 0 && (
              <pre className="diff-block diff-old">
                {oldLines.map((l, j) => (
                  <span key={j} className="diff-line">
                    {l}
                  </span>
                ))}
              </pre>
            )}
            <pre className="diff-block diff-new">
              {newLines.map((l, j) => (
                <span key={j} className="diff-line">
                  {l}
                </span>
              ))}
            </pre>
          </div>
        );
      })}
    </div>
  );
}

function PlanView({ entries }: { entries: PlanEntry[] }) {
  return (
    <details className="plan">
      <summary>Plan</summary>
      <ol className="plan-entries">
        {entries.map((e, i) => (
          <li key={i} className={`plan-entry plan-${e.status ?? ""}`}>
            <span className="plan-priority">{e.priority ?? ""}</span>
            <span className="plan-content">{e.content}</span>
          </li>
        ))}
      </ol>
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
    case "plan":
      return <PlanView entries={part.entries} />;
    case "usage":
      return (
        <div className="usage">
          {part.used}/{part.size} ctx
          {part.cost
            ? ` · ${part.cost.amount} ${part.cost.currency}`
            : ""}
        </div>
      );
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
