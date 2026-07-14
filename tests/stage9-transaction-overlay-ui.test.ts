import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path: string) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("Stage 9-4 personal, fund, and group payment additions use one shared natural-language-first overlay", async () => {
  const [dashboard, fund, payments, partial] = await Promise.all([
    read("views/dashboard.ejs"),
    read("views/fund.ejs"),
    read("views/payments.ejs"),
    read("views/partials/transaction-add-overlay.ejs"),
  ]);

  for (const view of [dashboard, fund, payments]) {
    assert.match(view, /partials\/transaction-add-overlay/);
    assert.match(view, /\/css\/transaction-overlay\.css/);
    assert.match(view, /\/js\/transaction-overlay\.js/);
    assert.match(view, /data-open-transaction-overlay/);
  }

  assert.match(partial, /data-transaction-overlay/);
  assert.match(partial, /自然文章・内容/);
  assert.match(partial, /data-overlay-manual>手動入力/);
  assert.match(partial, /data-overlay-ai>AIで推定/);
  assert.match(partial, /data-overlay-details hidden/);
  assert.match(partial, /aria-modal="true"/);
});

test("Stage 9-4 fund overlay preserves four existing routes while limiting AI to income and expense", async () => {
  const [fund, script] = await Promise.all([
    read("views/fund.ejs"),
    read("public/js/transaction-overlay.js"),
  ]);

  assert.match(fund, /fund\/transactions\/income/);
  assert.match(fund, /fund\/transactions\/expense/);
  assert.match(fund, /fund\/transactions\/contribution/);
  assert.match(fund, /fund\/transactions\/refund/);
  assert.doesNotMatch(fund, /fund-transaction-type-dialog/);
  assert.match(script, /target === "FUND_CONTRIBUTION" \|\| target === "FUND_REFUND"/);
  assert.match(script, /拠出・返金はAI分類対象外/);
  assert.match(script, /return incomePattern\.test\(text\) \? "FUND_INCOME" : "FUND_EXPENSE"/);
});

test("Stage 9-4 overlay keeps editable AI candidates, loading state, and submit locking", async () => {
  const [script, css] = await Promise.all([
    read("public/js/transaction-overlay.js"),
    read("public/css/transaction-overlay.css"),
  ]);

  assert.match(script, /fetch\("\/api\/ai\/classify-transaction"/);
  assert.match(script, /credentials: "same-origin"/);
  assert.match(script, /revealDetails/);
  assert.match(script, /form\.dataset\.overlaySubmitting/);
  assert.match(script, /opener\?\.focus\(\)/);
  assert.match(css, /height: min\(760px, calc\(100dvh - 32px\)\)/);
  assert.match(css, /transaction-overlay__body[\s\S]*overflow-y: auto/);
  assert.match(css, /@media \(max-width: 720px\)[\s\S]*height: 100dvh/);
});
