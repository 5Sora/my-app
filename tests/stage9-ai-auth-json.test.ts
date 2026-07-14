import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path: string) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("Stage 9-7 unauthenticated AI API requests return 401 JSON instead of an HTML redirect", async () => {
  const index = await read("index.ts");
  assert.match(index, /function requireAuthenticationForAiJson[\s\S]*res\.status\(401\)\.json\([\s\S]*AUTH_REQUIRED/);
  for (const route of [
    "/api/ai/analyze-personal-ledger",
    "/api/ai/analyze-group-payments",
    "/api/ai/analyze-group-fund",
    "/api/ai/classify-transaction",
  ]) {
    const escaped = route.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    assert.match(index, new RegExp(`"${escaped}",\\s*requireAuthenticationForAiJson`));
  }
});
