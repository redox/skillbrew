import { describe, expect, test } from "bun:test";
import { resolve } from "node:path";
import { lintDistribution } from "../src/distribution.ts";

describe("distribution adapters", () => {
  test("stay aligned with package metadata and the generated skills directory", async () => {
    const root = resolve(import.meta.dir, "..");
    expect(await lintDistribution(root)).toEqual([]);
  });
});
