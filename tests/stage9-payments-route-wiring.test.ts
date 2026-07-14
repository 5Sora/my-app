import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path: string) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("Stage 9-5 wires selected-period GROUP_PAYMENT transactions into the payment visualization", async () => {
  const index = await read("index.ts");
  assert.match(index, /buildGroupPaymentVisualization/);
  assert.match(index, /const paymentVisualization = buildGroupPaymentVisualization\(transactions\)/);
  assert.match(index, /historyTotal,[\s\S]*paymentVisualization,[\s\S]*latestBatch/);
});
