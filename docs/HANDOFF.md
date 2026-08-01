# Atlas — Build Handoff (2026-08-02)

This file is the complete context for the Atlas build session. Read it fully before writing any code.

## What Atlas is

A **new Tauri + React desktop GUI** ("cockpit") over the **herdr daemon**. It lives at
`/Users/mekopa/Documents/GitHub/atlas`. It is **NOT a fork of herdr** — it talks to herdr as a
separate process via its CLI and renders its own UI.

Goal: a GUI product for **non-terminal users** — universal chat interface, build/sharable apps,
a central MCP hub (visualize/manage MCPs), later voice. herdr runs in the background as the agent
daemon (opens agents, keeps them alive, restores sessions across reboots). The UI is Atlas's
value; the daemon is herdr's value.

## License status (important)

- herdr was dual-licensed **AGPL-3.0-or-later OR commercial**. On **2026-07-22** the main branch
  was relicensed to **Apache-2.0** (commit `cd5ea1be`, repo moved to `github.com/herdrdev/herdr`).
- **Tagged releases (v0.6.x – v0.7.5) are still AGPL.** Homebrew-installed herdr 0.6.10 is AGPL.
- Plan: **bundle the herdr binary**, call it as a separate process. Never fork/embed its code.
  Apache-2.0 makes even a later rewrite legal. Keep a clean boundary: **ONLY
  `src/lib/agentService.ts` knows herdr**; the UI never does.
- herdr source is cloned read-only at `/Users/mekopa/Documents/GitHub/herdr` — reference only,
  do NOT modify it.

## Already built (verified: tsc, vite build, cargo check all pass)

1. Scaffold via `create-tauri-app` (react-ts). Node 23, Rust 1.93.1, Tauri v2.11.5.
   `@xterm/xterm` + `@xterm/addon-fit` installed.
2. `src-tauri/src/lib.rs` — ONE tauri command `herdr(args: Vec<String>)` that runs the herdr CLI
   and returns `HerdrResult { ok, json, error }` (parses stdout JSON).
3. `src/lib/agentService.ts` — the ONLY boundary layer. Exports: `listAgents()`, `listWorkspaces()`,
   `listTabs()`, `readPane(paneId)`, `sendToAgent(paneId, text)` (pane run = types + Enter),
   `focusPane(paneId)`, `waitAgent(target, status)`.
4. `src/App.tsx` + `src/App.css` — working cockpit: top bar with workspace chips, sidebar of agents
   with colored status dots (working/blocked/done/idle), click agent → readPane → output in `<pre>`,
   prompt bar → sendToAgent. Polls every 3s.

## Verified herdr CLI commands

- `herdr agent list` → `{"id":..., "result": {"agents":[...]}}`
- `herdr agent get <target>`
- `herdr agent read <target> [--source visible|recent|recent-unwrapped] [--lines N] [--format text|ansi]`
- `herdr agent send <target> <text>` (literal, no Enter) — use `pane run` for Enter
- `herdr agent focus <target>`
- `herdr agent wait <target> --status <idle|working|blocked|unknown> [--timeout MS]` (NOT "done")
- `herdr agent start <name> [--cwd PATH] [--workspace ID] [--tab ID] [--split right|down] -- <argv...>`
- `herdr agent explain <target> [--json]`
- `herdr pane list [--workspace <id>]`, `herdr pane get <pane_id>`,
  `herdr pane read <pane_id> [--source visible|recent] [--lines N] [--format text|ansi]`
- `herdr pane run <pane_id> <command>` (types + Enter)
- `herdr pane send-text <pane_id> <text>`, `herdr pane send-keys <pane_id> <key...>`
- `herdr pane split [<pane_id>] --direction right|down [--ratio] [--cwd] [--focus]`
- `herdr pane close <pane_id>`
- `herdr workspace list`, `herdr tab list`
- Agent statuses: `idle|working|blocked|unknown`

## Architecture decision (locked)

- Atlas = Tauri/React GUI product. herdr = background daemon (bundle binary later).
  Boundary = `agentService.ts` only. Do NOT rewrite or fork herdr.
- Product-value insight: the cockpit alone is commodity (Codex/Claude Code/Goose/Buzz all do
  chat+MCP+voice). Atlas's real value must come from **verticals** — e.g. ADIM legal + TR LEX
  corpus + local qwen privacy. Build the generic cockpit well, keep the architecture open for a
  legal vertical wedge.

## Next steps (recommended order)

1. `npm run tauri dev` to see the app live (herdr daemon is running). Verify agent list renders
   and pane read works. GUI blocks the terminal — run it in a pane/background.
2. Consider `xterm.js` for real terminal rendering in the pane view (replace the `<pre>`).
   `herdr agent read --source recent` gives live-ish output.
3. Build out layout: workspace/tab structure like herdr's TUI but as GUI (drag/split panes),
   agent status sidebar, per-agent pane.
4. Later: MCP hub (list/enable/disable), apps surface, chat interface, voice (Pipecat + qwen).
5. Write `docs/DECISIONS.md` recording architecture + tradeoffs (herdr-as-process boundary,
   Apache-2.0, agentService as single swap point).
6. Do NOT commit anything unless asked. Keep code clean, no comments unless needed, follow
   existing conventions.

Report back concisely what you find when you run it, and recommend the first real feature.
