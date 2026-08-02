import { useState } from "react";

// ChatInput — the message composer. Controlled by the parent; emits the
// submit event with the text. Pure presentational, library-ready.

interface Props {
  placeholder?: string;
  disabled?: boolean;
  busy?: boolean;
  submitLabel?: string;
  onSend: (text: string) => void;
}

export default function ChatInput({
  placeholder,
  disabled,
  busy,
  submitLabel = "Send",
  onSend,
}: Props) {
  const [value, setValue] = useState("");

  function submit() {
    const text = value.trim();
    if (!text || disabled || busy) return;
    onSend(text);
    setValue("");
  }

  return (
    <form
      className="prompt-bar"
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      <input
        value={value}
        onChange={(e) => setValue(e.currentTarget.value)}
        placeholder={placeholder ?? "Send a message…"}
        disabled={disabled || busy}
      />
      <button type="submit" disabled={disabled || busy || !value.trim()}>
        {submitLabel}
      </button>
    </form>
  );
}
