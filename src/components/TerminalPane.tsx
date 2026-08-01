import { useEffect, useRef } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import "@xterm/xterm/css/xterm.css";

// TerminalPane — renders an agent pane's ANSI output in a real xterm.js
// terminal instead of a <pre>. Receives the raw ANSI string from the parent;
// every update is diffed against the previous snapshot so xterm only parses
// the delta, keeping the cursor position intact (like a live terminal).

interface Props {
  /** Raw ANSI output for the pane (from herdr agent read --format ansi). */
  data: string;
}

export default function TerminalPane({ data }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<Terminal | null>(null);
  const prevRef = useRef<string>("");

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const term = new Terminal({
      fontFamily: '"SF Mono", Menlo, Consolas, monospace',
      fontSize: 12,
      cursorBlink: false,
      allowTransparency: false,
      theme: {
        background: "#141416",
        foreground: "#d4d4d8",
      },
      scrollback: 10_000,
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(container);
    fit.fit();

    termRef.current = term;

    const ro = new ResizeObserver(() => {
      try {
        fit.fit();
      } catch {
        /* ignore */
      }
    });
    ro.observe(container);

    return () => {
      ro.disconnect();
      term.dispose();
      termRef.current = null;
      prevRef.current = "";
    };
  }, []);

  useEffect(() => {
    const term = termRef.current;
    if (!term) return;

    const prev = prevRef.current;
    // herdr's read is a bounded viewport snapshot; once the pane scrolls the
    // oldest lines drop off so it's not a strict prefix. Redraw the snapshot
    // with a clear-screen (not reset(), which clears scrollback and flickers).
    if (data.length > prev.length && data.startsWith(prev)) {
      term.write(data.slice(prev.length));
    } else if (data !== prev) {
      term.write("\x1b[2J\x1b[H");
      term.write(data);
    }
    prevRef.current = data;
  }, [data]);

  return <div className="terminal-pane" ref={containerRef} />;
}
