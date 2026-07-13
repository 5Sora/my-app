import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path: string) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("personal, group payment, and fund pages use the shared temporary analysis dialog", async () => {
  const [dashboard, payments, fund, partial] = await Promise.all([
    read("views/dashboard.ejs"),
    read("views/payments.ejs"),
    read("views/fund.ejs"),
    read("views/partials/ai-analysis-dialog.ejs"),
  ]);
  assert.match(dashboard, /partials\/ai-analysis-dialog/);
  assert.match(payments, /partials\/ai-analysis-dialog/);
  assert.match(fund, /partials\/ai-analysis-dialog/);
  assert.match(dashboard, /data-endpoint="\/api\/ai\/analyze-personal-ledger"/);
  assert.match(payments, /data-endpoint="\/api\/ai\/analyze-group-payments"/);
  assert.match(fund, /data-endpoint="\/api\/ai\/analyze-group-fund"/);
  assert.match(partial, /data-ai-analysis-dialog/);
  assert.match(partial, /data-ai-analysis-observations/);
  assert.match(partial, /data-ai-analysis-fixed-summary/);
  assert.match(partial, /data-ai-analysis-metrics/);
});

test("shared analysis renderer uses text nodes and does not render provider HTML", async () => {
  const script = await read("public/js/ai-analysis-dialog.js");
  assert.match(script, /textContent/);
  assert.doesNotMatch(script, /innerHTML/);
  assert.match(script, /credentials: "same-origin"/);
  assert.match(script, /button\.disabled = true/);
  assert.match(script, /payload\?\.metrics/);
  assert.match(script, /document\.createElement\("dt"\)/);
  assert.match(script, /document\.createElement\("dd"\)/);
});

test("group fund analysis route returns application-calculated fixed metrics for AI and fallback", async () => {
  const index = await read("index.ts");
  assert.match(index, /const fixedMetrics = buildGroupFundFixedMetrics\(bundle\.aggregate\)/);
  assert.equal((index.match(/metrics: fixedMetrics/g) || []).length, 2);
});
