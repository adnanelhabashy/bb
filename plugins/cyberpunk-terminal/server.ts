// bb-plugin-cyberpunk-terminal — backend.
//
// Each browser tab is a real shell process (bash -i) spawned on the host.
// Input goes in over RPC, output streams out over a per-session realtime
// channel. No pty (node-pty isn't installed), so ANSI codes are stripped —
// plain text only, no color/cursor control from the shell itself.
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { randomUUID } from "node:crypto";
import { defineRpcContract, type BbPluginApi } from "@get-bb/plugin-sdk";
import { z } from "zod";

export const rpcContract = defineRpcContract({
  terminal_create: {
    input: z.null(),
    output: z.object({ id: z.string() }),
  },
  terminal_input: {
    input: z.object({ id: z.string(), data: z.string() }),
    output: z.object({ ok: z.boolean() }),
  },
  terminal_close: {
    input: z.object({ id: z.string() }),
    output: z.object({ ok: z.boolean() }),
  },
});

// ponytail: strips ANSI escape codes rather than parsing them; swap in
// xterm.js on the frontend + drop this if colored output is needed.
const ANSI_PATTERN = new RegExp("\\x1B\\[[0-9;?]*[ -/]*[@-~]", "g");
function stripAnsi(text: string): string {
  return text.replace(ANSI_PATTERN, "");
}

export default async function plugin(bb: BbPluginApi) {
  bb.log.info("loaded");

  const sessions = new Map<string, ChildProcessWithoutNullStreams>();

  function channel(id: string): string {
    return `terminal-output:${id}`;
  }

  function spawnSession(): string {
    const id = randomUUID();
    const shell = process.env.SHELL ?? "bash";
    const proc = spawn(shell, ["-i"], {
      cwd: process.cwd(),
      env: { ...process.env, TERM: "xterm-256color" },
      stdio: "pipe",
    });
    sessions.set(id, proc);
    const onData = (chunk: Buffer) => {
      bb.realtime.publish(channel(id), { text: stripAnsi(chunk.toString("utf8")) });
    };
    proc.stdout.on("data", onData);
    proc.stderr.on("data", onData);
    proc.on("exit", (code) => {
      bb.realtime.publish(channel(id), { exit: code ?? 0 });
      sessions.delete(id);
    });
    return id;
  }

  bb.rpc.register(rpcContract, {
    terminal_create: async () => ({ id: spawnSession() }),
    terminal_input: async ({ id, data }) => {
      const proc = sessions.get(id);
      if (proc === undefined) return { ok: false };
      proc.stdin.write(data);
      return { ok: true };
    },
    terminal_close: async ({ id }) => {
      const proc = sessions.get(id);
      if (proc === undefined) return { ok: false };
      proc.kill();
      sessions.delete(id);
      return { ok: true };
    },
  });

  bb.onDispose(() => {
    for (const proc of sessions.values()) proc.kill();
    sessions.clear();
    bb.log.info("disposed");
  });
}
