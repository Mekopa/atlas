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
 * Spawns an ACP agent and starts a chat session in `cwd`.
 * Returns a handle with prompt/close; the session stays open until close().
 */
export async function startChat(agentId: string, cwd: string): Promise<ActiveChat> {
  const spec = AGENTS.find((a) => a.id === agentId);
  if (!spec) throw new Error(`unknown ACP agent: ${agentId}`);

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
  const releaseOut: Array<() => void> = [];
  let outController: ReadableStreamDefaultController<Uint8Array> | null = null;
  const onOutData = (d: Uint8Array) => outController?.enqueue(d);
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
      releaseOut.forEach((f) => f());
      connection.close();
      await child.kill().catch(() => undefined);
    },
  };
}
