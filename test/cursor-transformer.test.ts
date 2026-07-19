import { describe, expect, test } from "bun:test";
import { runCursorTransformer } from "../src/cursor-transformer.ts";

describe("Cursor SDK transformer", () => {
  test("requires an API key before creating an agent", async () => {
    await expect(runCursorTransformer({
      name: "test",
      mode: "rewrite",
      workspace: process.cwd(),
      contextDirectory: process.cwd(),
      prompt: "Do nothing.",
      model: "composer-2.5",
      timeoutMs: 1_000,
      apiKey: "",
    })).rejects.toThrow("CURSOR_API_KEY is required");
  });
});
