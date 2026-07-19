import { Agent, JsonlLocalAgentStore } from "@cursor/sdk";
import { join } from "node:path";
import { SkillbrewError, assert } from "./util.ts";

export interface TransformerRequest {
  name: string;
  mode: "rewrite" | "semantic-rebase";
  workspace: string;
  contextDirectory: string;
  prompt: string;
  model: string;
  timeoutMs: number;
  apiKey?: string;
}

export interface TransformerResult {
  output: string;
}

export type TransformerRunner = (request: TransformerRequest) => Promise<TransformerResult>;

export const runCursorTransformer: TransformerRunner = async (request) => {
  const apiKey = request.apiKey === undefined ? process.env.CURSOR_API_KEY : request.apiKey;
  assert(apiKey, "CURSOR_API_KEY is required for Cursor SDK transforms");

  const agent = await Agent.create({
    apiKey,
    name: `Skillbrew: ${request.name}`,
    model: { id: request.model },
    mode: "agent",
    local: {
      cwd: request.workspace,
      store: new JsonlLocalAgentStore(join(request.contextDirectory, "cursor-state")),
      settingSources: [],
      sandboxOptions: { enabled: true },
    },
  });

  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    const run = await agent.send(request.prompt, { mode: "agent" });
    const execution = (async () => {
      let output = "";
      for await (const event of run.stream()) {
        if (event.type !== "assistant") continue;
        for (const block of event.message.content) {
          if (block.type === "text") output += block.text;
        }
      }
      const result = await run.wait();
      if (result.status !== "finished") {
        throw new SkillbrewError(result.error?.message ?? `Cursor SDK run ended with status ${result.status}`);
      }
      return { output: output || result.result || "" };
    })();

    const deadline = new Promise<never>((_, reject) => {
      timeout = setTimeout(() => {
        void run.cancel().catch(() => undefined);
        reject(new SkillbrewError(`Cursor SDK transform timed out after ${request.timeoutMs}ms`));
      }, request.timeoutMs);
    });
    return await Promise.race([execution, deadline]);
  } finally {
    if (timeout) clearTimeout(timeout);
    agent.close();
  }
};
