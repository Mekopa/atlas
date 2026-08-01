# Atlas — Architecture Decisions

This file records the significant architecture decisions for Atlas, the Tauri + React
cockpit over the herdr daemon, and the tradeoffs behind them. Update it whenever a
decision is locked in.

## Decision log

### D1 — herdr runs as a separate process; Atlas is a UI, not a fork

Atlas never embeds or forks herdr's code. It shells out to the `herdr` binary and renders
its own UI on top. The boundary is a single TS module — `src/lib/agentService.ts` — and the
single Rust bridge command `herdr(args)` in `src-tauri/src/lib.rs`. No other code knows herdr
exists.

**Why:** keeps a clean legal and technical boundary. herdr's tagged releases (v0.6.x–v0.7.5)
are AGPL-3.0-or-later; the main branch was relicensed to Apache-2.0 on 2026-07-22 (commit
`cd5ea1be`). We bundle the binary as a separate process and never copy its source, so Atlas's
license is never contaminated. If herdr is later replaced, only `agentService.ts` changes.

### D2 — all herdr I/O is JSON on stdout, unwrapped by the TS layer

Every herdr subcommand prints `{"id": ..., "result": ...}` (or `{"error": ...}`) to stdout.
The Rust bridge returns the raw stdout; `agentService.ts` unwraps `.result` and throws on
`.error`. The UI never sees herdr's wire format.

**Exception (found in practice):** `herdr pane read <id>` writes **raw text** to stdout, not
JSON — its text goes directly to the terminal. The JSON path for reading a pane is
`herdr agent read <id> --source recent --format ansi`, which returns `result.read.text`.
`readPane()` therefore uses the `agent read` form.

### D3 — pane output is rendered in xterm.js, not a `<pre>`

Agent pane output is shown in a real xterm.js terminal (`@xterm/xterm` + `@xterm/addon-fit`)
rather than a monospace `<pre>`. `readPane()` requests `--format ansi` so escape sequences
survive; `TerminalPane` (src/components/TerminalPane.tsx) diffs each poll against the previous
snapshot and only writes the delta, so xterm keeps its cursor state like a live terminal.

**Why:** output uses rich ANSI (box-drawing separators, dimmed text, prompts). A `<pre>`
rendered that as garbage. xterm gives faithful rendering and future-proofs real PTY streaming
once herdr supports it. Cost: ~330KB added to the JS bundle — acceptable for a desktop app.

### D4 — polling refresh (3s), not push

`App.tsx` polls `listAgents()` + `listWorkspaces()` every 3s and re-reads the selected pane.
No event stream yet.

**Why:** the herdr CLI is request/response only; there is no push channel to consume. 3s keeps
status dots fresh without hammering the daemon. A subscription API or direct socket would
replace the poll loop later, without touching the rest of the UI.

## Tradeoffs considered

- **xterm `<pre>` replacement** — xterm is heavier but correct; a `<pre>` cannot render ANSI.
- **Poll vs stream** — poll is simpler and works with the CLI today; streaming needs a herdr
  API change and can be layered in behind `readPane()`.
- **JSON vs raw reads** — the CLI is inconsistent (`pane read` raw vs `agent read` JSON); the
  agent-service layer absorbs that inconsistency so the UI is uniform.

## Product direction

The generic cockpit (chat + panes + status) is commodity. Atlas's durable value is expected to
come from verticals — e.g. the ADIM legal / TR LEX corpus with local qwen privacy. The
architecture stays open for a legal vertical wedge: `agentService.ts` is the only integration
point, so a vertical's data sources and UI can be added alongside the cockpit without coupling
to herdr.
