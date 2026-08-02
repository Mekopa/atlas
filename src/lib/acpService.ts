// acpService — the ONE layer the Atlas Chat tab uses for ACP (Agent Client
// Protocol) agents.
//
// ACP is JSON-RPC over stdio, and a first-class chat backend *parallel* to the
// herdr path. Where agentService.ts is the only herdr boundary, this file is the
// only ACP boundary: it spawns an ACP-capable agent binary (opencode,
// gemini-cli, claude-code, goose, codex), speaks the protocol via the official
// @agentclientprotocol/sdk, and exposes a minimal prompt/reply surface to the UI.
//
// The UI never sees the SDK or the wire format — only Agent/ActiveChat below.

import { ClientApp, methods, ndJsonStream } from "@agentclientprotocol/sdk";
import { Command, type Child } from "@tauri-apps/plugin-shell";
import { StreamBuilder } from "./acpStream";
import type { ChatMessage as ModelChatMessage } from "./chatModel";

export interface AcpAgent {
  id: string;
  label: string;
  /** Shell-scope name (resolves to the real binary via capabilities). */
  binary: string;
  /** Extra argv, e.g. ["acp"]. */
  acpArgs: string[];
  available: boolean;
}

export interface ChatMessage {
  role: "user" | "agent";
  text: string;
  ts: number;
}

export interface ActiveChat {
  agent: AcpAgent;
  /** Sends a prompt and resolves when the agent's turn finishes. */
  prompt(text: string, onChunk?: (chunk: string) => void): Promise<string>;
  close(): Promise<void>;
}

const AGENTS: Omit<AcpAgent, "available">[] = [
  { id: "opencode", label: "OpenCode", binary: "opencode", acpArgs: ["acp"] },
  { id: "gemini", label: "Gemini CLI", binary: "gemini", acpArgs: ["--acp"] },
  { id: "claude", label: "Claude Code", binary: "claude", acpArgs: ["--acp"] },
  { id: "goose", label: "Goose", binary: "goose", acpArgs: ["--acp"] },
  { id: "codex", label: "Codex", binary: "codex", acpArgs: ["--acp"] },
];

/**
 * Maps a herdr agent name (e.g. "claude", "opencode") to an ACP agent id, or
 * undefined if that agent isn't ACP-capable.
 */
export function acpAgentIdForHerdrName(name: string): string | undefined {
  const found = AGENTS.find((a) => a.id === name);
  return found?.id;
}

let availabilityChecked = false;
let availability: Record<string, boolean> = {};

async function probe(binary: string): Promise<boolean> {
  try {
    const command = Command.create(binary, ["--version"]);
    const out = await command.execute();
    return out.code === 0;
  } catch {
    return false;
  }
}

/** All known ACP agents, with live availability (spawn probe run once). */
export async function listAcpAgents(): Promise<AcpAgent[]> {
  if (!availabilityChecked) {
    await Promise.all(
      AGENTS.map(async (a) => {
        availability[a.id] = await probe(a.binary);
      }),
    );
    availabilityChecked = true;
  }
  return AGENTS.map((a) => ({ ...a, available: availability[a.id] ?? false }));
}

/**
 * Spawns an ACP agent, connects, and initializes. Returns a handle with the
 * client context plus cleanup. The session stays open until close()/kill().
 * `configureApp` (optional) runs after the ClientApp is created but before
 * connect, so callers can register notification/request handlers (e.g. to
 * capture the `session/update` stream during a `session/load` replay).
 */
async function connectAgent(
  spec: (typeof AGENTS)[number],
  cwd: string,
  configureApp?: (app: ClientApp) => void,
) {
  const command = Command.create(spec.binary, spec.acpArgs, {
    cwd,
    encoding: "raw",
  });

  let stderrTail = "";
  command.stderr.on("data", (d) => {
    stderrTail = (stderrTail + String.fromCharCode(...d)).slice(-2000);
  });

  let child: Child;
  try {
    child = await command.spawn();
  } catch (e) {
    throw new Error(
      `failed to spawn ${spec.label}: ${e}. Is it installed and allowed in capabilities?`,
    );
  }

  // Bridge the shell child (EventEmitter stdout + child.write) into the
  // WHATWG streams the ACP SDK expects. stdout carries newline-delimited JSON.
  // The shell plugin's raw payload arrives as a plain Array at runtime, so
  // coerce to Uint8Array (the SDK's LineBuffer needs .subarray).
  const releaseOut: Array<() => void> = [];
  let outController: ReadableStreamDefaultController<Uint8Array> | null = null;
  const onOutData = (d: unknown) => {
    const bytes =
      d instanceof Uint8Array ? d : Uint8Array.from(d as ArrayLike<number>);
    outController?.enqueue(bytes);
  };
  const onClose = () => outController?.close();
  const onError = (e: unknown) => outController?.error(String(e));

  const output = new ReadableStream<Uint8Array>({
    start(controller) {
      outController = controller;
    },
    cancel() {
      outController = null;
    },
  });

  command.stdout.on("data", onOutData);
  command.on("close", onClose);
  command.on("error", onError);
  releaseOut.push(() => {
    command.stdout.off("data", onOutData);
    command.off("close", onClose);
    command.off("error", onError);
  });

  const input = new WritableStream<Uint8Array>({
    write(chunk) {
      return child.write(chunk);
    },
  });

  const stream = ndJsonStream(input, output);
  const app = new ClientApp({ name: "Atlas" });
  configureApp?.(app);

  let connection: ReturnType<ClientApp["connect"]>;
  try {
    connection = app.connect(stream);
  } catch (e) {
    releaseOut.forEach((f) => f());
    await child.kill().catch(() => undefined);
    throw new Error(`ACP connect failed for ${spec.label}: ${e}`);
  }

  const ctx = connection.agent;
  try {
    await ctx.request(methods.agent.initialize, {
      protocolVersion: 1,
      clientCapabilities: {},
      clientInfo: { name: "Atlas", version: "0.1.0" },
    });
  } catch (e) {
    releaseOut.forEach((f) => f());
    connection.close();
    await child.kill().catch(() => undefined);
    throw new Error(`ACP initialize failed for ${spec.label}: ${e}`);
  }

  return {
    ctx,
    connection,
    app,
    cleanup: () => releaseOut.forEach((f) => f()),
    kill: () => child.kill().catch(() => undefined),
    stderrTail: () => stderrTail,
  };
}

/** A session summary from an ACP agent. */
export interface AcpSessionSummary {
  sessionId: string;
  cwd: string;
  title?: string;
  updatedAt?: string;
}

/**
 * Lists past sessions for an ACP agent (short-lived connection).
 */
export async function listAcpSessions(
  agentId: string,
  cwd = "/Users/mekopa",
): Promise<AcpSessionSummary[]> {
  const spec = AGENTS.find((a) => a.id === agentId);
  if (!spec) throw new Error(`unknown ACP agent: ${agentId}`);
  const { ctx, cleanup, kill } = await connectAgent(spec, cwd);
  try {
    const res = (await ctx.request(methods.agent.session.list, {})) as {
      sessions?: AcpSessionSummary[];
    };
    return res.sessions ?? [];
  } finally {
    cleanup();
    await kill();
  }
}

/**
 * Spawns an ACP agent and starts a chat session in `cwd`.
 * Returns a handle with prompt/close; the session stays open until close().
 */
export async function startChat(agentId: string, cwd: string): Promise<ActiveChat> {
  const spec = AGENTS.find((a) => a.id === agentId);
  if (!spec) throw new Error(`unknown ACP agent: ${agentId}`);

  const { ctx, connection, cleanup, kill } = await connectAgent(spec, cwd);
  const session = await ctx.buildSession(cwd).start();

  return {
    agent: { ...spec, available: true },
    async prompt(text, onChunk) {
      const textP = session.readText();
      const respP = session.prompt(text);
      const [textResult, resp] = await Promise.all([textP, respP]);
      if (onChunk) onChunk(textResult);
      return (
        resp.stopReason === "end_turn" ? textResult : `(stop: ${resp.stopReason})\n${textResult}`
      ).trim();
    },
    async close() {
      cleanup();
      connection.close();
      await kill();
    },
  };
}

// --- Rich ACP session (replay + live stream) ------------------------------

/**
 * A connected ACP session that replays history and can be prompted live,
 * normalizing the `session/update` stream into ChatMessage[].
 */
export interface OpenAcpSession {
  agentId: string;
  sessionId: string;
  cwd: string;
  /** Normalized messages from the replay (and appended to on live turns). */
  getMessages(): ModelChatMessage[];
  /** Subscribe to message changes. Returns an unsubscribe fn. */
  onMessages(cb: () => void): () => void;
  /** Sends a prompt on the same session; resolves when the turn ends. */
  prompt(text: string): Promise<string>;
  close(): Promise<void>;
}

/**
 * Opens an existing ACP session (via `session/load`), captures the replayed
 * `session/update` stream, and returns a handle that can continue the same
 * session with `session/prompt`.
 */
export async function loadAcpSession(
  agentId: string,
  sessionId: string,
  cwd: string,
): Promise<OpenAcpSession> {
  const spec = AGENTS.find((a) => a.id === agentId);
  if (!spec) throw new Error(`unknown ACP agent: ${agentId}`);

  const builder = new StreamBuilder();
  const listeners = new Set<() => void>();
  const notify = () => listeners.forEach((cb) => cb());

  const { ctx, connection, cleanup, kill } = await connectAgent(
    spec,
    cwd,
    (app) => {
      app.onNotification(
        methods.client.session.update,
        (c) => {
          const update = c.params.update as {
            sessionUpdate?: string;
          } & Record<string, unknown>;
          const changed = builder.apply(update as never);
          if (changed) notify();
        },
      );
    },
  );

  try {
    await ctx.request(methods.agent.session.load, {
      sessionId,
      cwd,
      mcpServers: [],
    });
    builder.finalize();
    notify();
  } catch (e) {
    cleanup();
    connection.close();
    await kill();
    throw new Error(`ACP load failed for ${spec.label} (${sessionId}): ${e}`);
  }

  return {
    agentId,
    sessionId,
    cwd,
    getMessages: () => builder.messages,
    onMessages: (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    async prompt(text: string): Promise<string> {
      const resp = (await ctx.request(methods.agent.session.prompt, {
        sessionId,
        prompt: [{ type: "text", text }],
      })) as { stopReason?: string };
      builder.finalize();
      notify();
      return resp.stopReason ?? "end_turn";
    },
    async close() {
      cleanup();
      connection.close();
      await kill();
    },
  };
}
