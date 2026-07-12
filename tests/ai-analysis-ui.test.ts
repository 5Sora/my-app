import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path: string) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("personal and group pages use the shared temporary analysis dialog", async () => {
  const [dashboard, payments, partial] = await Promise.all([
    read("views/dashboard.ejs"),
    read("views/payments.ejs"),
    read("views/partials/ai-analysis-dialog.ejs"),
  ]);
  assert.match(dashboard, /partials\/ai-analysis-dialog/);
  assert.match(payments, /partials\/ai-analysis-dialog/);
  assert.match(dashboard, /data-endpoint="\/api\/ai\/analyze-personal-ledger"/);
  assert.match(payments, /data-endpoint="\/api\/ai\/analyze-group-payments"/);
  assert.match(partial, /data-ai-analysis-dialog/);
  assert.match(partial, /data-ai-analysis-observations/);
});

test("shared analysis renderer uses text nodes and does not render provider HTML", async () => {
  const script = await read("public/js/ai-analysis-dialog.js");
  assert.match(script, /textContent/);
  assert.doesNotMatch(script, /innerHTML/);
  assert.match(script, /credentials: "same-origin"/);
  assert.match(script, /button\.disabled = true/);
});
