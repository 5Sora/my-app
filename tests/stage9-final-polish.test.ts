import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path: string) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("Stage 9-8 fund chart toggles between income and expense compositions without changing routes", async () => {
  const [view, script, visualization] = await Promise.all([
    read("views/fund.ejs"),
    read("public/js/fund-charts.js"),
    read("src/transactions/fund-visualization.ts"),
  ]);

  assert.match(view, /data-fund-chart-mode="income"/);
  assert.match(view, /data-fund-chart-mode="expense"/);
  assert.match(view, /fundVisualizationView\.expenseComposition/);
  assert.match(view, /data-fund-chart-data/);
  assert.match(view, /支出構成/);

  assert.match(script, /const modes = \{/);
  assert.match(script, /expense: \{/);
  assert.match(script, /基金支出はカテゴリ別、基金返金は返金先別/);
  assert.match(script, /aria-pressed/);
  assert.match(script, /render\(activeMode\)/);

  assert.match(visualization, /expenseComposition: FundExpenseCompositionItem\[\]/);
  assert.match(visualization, /sourceTypeLabel: "基金支出" \| "基金返金"/);
  assert.match(visualization, /refundByRecipient/);
});

test("Stage 9-8 disabled buttons retain a non-actionable appearance on hover", async () => {
  const [states, fund, payments] = await Promise.all([
    read("public/css/ui-states.css"),
    read("public/css/fund.css"),
    read("public/css/payments.css"),
  ]);

  assert.match(states, /button:disabled:not\(\.is-loading\):hover/);
  assert.match(states, /cursor: not-allowed !important/);
  assert.match(states, /box-shadow: none !important/);
  assert.match(fund, /\.fund-dialog-close:not\(:disabled\):hover/);
  assert.match(payments, /\.payments-dialog-close:not\(:disabled\):hover/);
});

test("Stage 9-8 safely escapes less-than characters in chart JSON script blocks", async () => {
  const views = await Promise.all([
    read("views/dashboard.ejs"),
    read("views/fund.ejs"),
    read("views/payments.ejs"),
  ]);

  for (const view of views) {
    assert.match(view, /replace\(\/<\/g, "\\\\u003c"\)/);
  }
});


test("Stage 9-8 aligns top thirds and lower twelfths on one shared desktop grid", async () => {
  const [shell, personal, fund, payments] = await Promise.all([
    read("public/css/app-shell.css"),
    read("public/css/ledger.css"),
    read("public/css/fund.css"),
    read("public/css/payments.css"),
  ]);

  assert.match(shell, /grid-template-columns: repeat\(12, minmax\(0, 1fr\)\)/);
  assert.match(shell, /\.ledger-shell-top > \.panel \{[\s\S]*grid-column: span 4/);
  assert.match(personal, /\.personal-context-column \{[\s\S]*grid-column: 1 \/ span 3/);
  assert.match(personal, /\.personal-operation-rail \{[\s\S]*grid-column: 4/);
  assert.match(personal, /\.personal-transaction-panel \{[\s\S]*grid-column: 5 \/ -1/);
  assert.match(fund, /\.fund-context-column \{[\s\S]*grid-column: 1 \/ span 3/);
  assert.match(fund, /\.fund-operation-rail \{[\s\S]*grid-column: 4/);
  assert.match(fund, /\.fund-transaction-panel \{[\s\S]*grid-column: 5 \/ -1/);
  assert.match(payments, /\.payments-context-column \{[\s\S]*grid-column: 1 \/ span 3/);
  assert.match(payments, /\.payments-operation-rail \{[\s\S]*grid-column: 4/);
  assert.match(payments, /\.payments-history-panel \{[\s\S]*grid-column: 5 \/ -1/);
});

test("Stage 9-8 renders related-payment shares with an expenditure red palette", async () => {
  const visualization = await read("src/transactions/group-payment-visualization.ts");
  assert.match(visualization, /const memberPalette = \[[\s\S]*#8f2f2a[\s\S]*#bf6258/);
  assert.doesNotMatch(visualization, /#315f86/);
});

test("Stage 9-8B gives AI close controls a dedicated busy-state appearance", async () => {
  const [states, script] = await Promise.all([
    read("public/css/ui-states.css"),
    read("public/js/ai-analysis-dialog.js"),
  ]);

  assert.match(states, /dialog\[data-ai-analysis-dialog\]\[aria-busy="true"\] \[data-close-ai-analysis-dialog\]/);
  assert.match(states, /cursor: not-allowed !important/);
  assert.match(states, /transition: none !important/);
  assert.match(script, /classList\.toggle\("is-busy-disabled", busy\)/);
  assert.match(script, /分析中は閉じられません/);
});

test("Stage 9-8B aligns the fund chart switch structure and styling with the personal chart switch", async () => {
  const [fundView, fundCss, personalCss] = await Promise.all([
    read("views/fund.ejs"),
    read("public/css/fund.css"),
    read("public/css/ledger.css"),
  ]);

  assert.match(fundView, /<\/div>\s*<div class="fund-chart-toggle" role="group"/);
  assert.match(fundCss, /\.fund-chart-toggle \{[\s\S]*width: 100%;[\s\S]*grid-template-columns: repeat\(2, minmax\(0, 1fr\)\)/);
  assert.match(fundCss, /\.fund-chart-toggle__button \{[\s\S]*padding: 6px 8px;[\s\S]*background: #faf8f5/);
  assert.match(personalCss, /\.personal-chart-switch \{[\s\S]*grid-template-columns: repeat\(2, minmax\(0, 1fr\)\)/);
  assert.match(personalCss, /\.personal-chart-switch button \{[\s\S]*padding: 6px 8px;[\s\S]*background: #faf8f5/);
});

