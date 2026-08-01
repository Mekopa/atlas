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

`SpacesView.tsx` polls `listAgents()` + `listWorkspaces()` every 3s and re-reads the selected pane.
No event stream yet.

**Why:** the herdr CLI is request/response only; there is no push channel to consume. 3s keeps
status dots fresh without hammering the daemon. A subscription API or direct socket would
replace the poll loop later, without touching the rest of the UI.

### D5 — four first-class tab surfaces, each with its own sync path

Atlas is a tabbed GUI, not a single cockpit. `App.tsx` is a thin shell hosting four tabs, each
its own component with its own backend boundary:

| Tab | Component | Backend | Sync path |
| --- | --- | --- | --- |
| Spaces | `SpacesView.tsx` | herdr (pane read/send) | 3s poll via `agentService.ts` |
| Chat | `ChatView.tsx` | ACP agents (JSON-RPC/stdio) | live stream via `acpService.ts` |
| Apps | `AppsView.tsx` | Icarus webview apps (registry stub) | — |
| MCP Hub | `McpHubView.tsx` | local Atlas manifest | `mcpService.ts` (localStorage) |

herdr owns running chats/spaces; ACP is a first-class *parallel* chat backend (claude-code,
gemini-cli, goose, codex). Apps and MCP are separate surfaces. The shell knows none of the
backends directly.

### D6 — ACP is a second boundary, `acpService.ts`

ACP (Agent Client Protocol) chat is JSON-RPC over stdio, entirely separate from herdr. Just as
`agentService.ts` is the only herdr boundary, `acpService.ts` is the only ACP boundary: it
spawns an ACP-capable binary via `tauri-plugin-shell`, speaks the protocol through the official
`@agentclientprotocol/sdk`, and exposes a minimal `startChat/prompt/close` surface. The UI never
sees the SDK or wire format. Replacing either backend only touches its one service file.

Agent binaries are spawned through the shell plugin and scoped in
`src-tauri/capabilities/default.json` (gemini, claude, goose, codex). Availability is probed
once with `--version` at first list.

### D7 — MCP Hub uses a local Atlas manifest (first pass)

MCP servers are configured per agent CLI (e.g. claude-code's `~/.claude.json`). Atlas does not
write to those files yet; it keeps its own registry of known MCP servers persisted in
localStorage (`mcpService.ts`), with add/remove/enable/disable. Wiring to real agent configs is
a later step; the surface and its data shape are established now.

### D8 — realtime layer: persistent API-socket subscription, not polling

`src-tauri/src/realtime.rs` keeps ONE persistent connection to herdr's public API socket
(`~/.config/herdr/herdr.sock`) and subscribes via `events.subscribe`. Structure/status events
are re-emitted to the webview as Tauri events (`herdr:structure`, `herdr:status`,
`herdr:pane`); the React `herdrStore` refreshes the hierarchy on them.

- herdr does **not** push pane output over the API (a `pane.output_changed` schema exists on
  main but the runtime loop never emits it), so pane text is still fetched on demand via
  `readPane`, triggered by pane events with a light 1s fallback poll.
- **Resilience:** the subscribe request fails wholesale if any tag is unknown. Older herdr
  (0.6.x, AGPL) rejects `pane.updated`, `pane.moved`, `tab.moved`,
  `pane.agent_status_changed`; the module probes each tag with a short-lived connection at
  startup and subscribes only to what the server accepts.
- Only the **public** API socket is used — never herdr's private TUI client socket
  (`herdr-client.sock`) and never herdr's code.

### D9 — Spaces view is a herdr hierarchy (workspace → tab → pane)

`SpacesView.tsx` renders herdr's structure layer as a tree — workspaces, each with its tabs,
each tab with its agent panes + live status dots — fed by `herdrStore`. This is the "what's
running" shell. The parallel ACP path (`acpService.ts`) is the "what am I talking to"
intelligence layer (agents, sessions, context-config); the two stay separate backends under
the same tab shell.

### D10 — herdr binary: Apache-2.0 main build, installed as `~/.local/bin/herdr-dev`

The daily daemon was brew 0.6.10 (AGPL, protocol 13). Atlas targets the Apache-2.0 main build
(relicense cd5ea1be) which speaks protocol 19 and accepts the newer event tags. Built herdr
from main → `~/.local/bin/herdr-dev` (Zig 0.15.2 required for vendored libghostty-vt, installed
at `~/.local/bin/zig`). Swap = edit the launchd plist `dev.herdr.server` to point at
`herdr-dev` + kickstart. Client and daemon must move together (protocol mismatch otherwise).
Atlas keeps using whatever daemon owns the socket; it never bundles its own herdr.

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
