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
  assert.match(view, /支出カテゴリ/);

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

  assert.match(fundView, /<\/div>\s*<div class="fund-chart-toggle ledger-chart-controls" role="group"/);
  assert.match(fundCss, /\.fund-chart-toggle \{[\s\S]*width: 100%;[\s\S]*grid-template-columns: repeat\(2, minmax\(0, 1fr\)\)/);
  assert.match(fundCss, /\.fund-chart-toggle__button \{[\s\S]*padding: 6px 8px;[\s\S]*background: #faf8f5/);
  assert.match(personalCss, /\.personal-chart-switch \{[\s\S]*grid-template-columns: repeat\(2, minmax\(0, 1fr\)\)/);
  assert.match(personalCss, /\.personal-chart-switch button \{[\s\S]*padding: 6px 8px;[\s\S]*background: #faf8f5/);
});



test("cross-ledger visual normalization keeps titles, charts, icons and ledgers consistent", async () => {
  const [shellCss, fundView] = await Promise.all([
    read("public/css/app-shell.css"),
    read("views/fund.ejs"),
  ]);

  assert.match(shellCss, /Cross-ledger visual normalization/);
  assert.match(shellCss, /\.personal-title-card h1,[\s\S]*\.fund-title-card h1,[\s\S]*\.payments-title-card h1/);
  assert.match(shellCss, /text-align: left/);
  assert.match(shellCss, /--ledger-chart-size: 158px/);
  assert.match(shellCss, /\.ledger-operation-button > span\[aria-hidden="true"\]/);
  assert.match(shellCss, /\.personal-ledger-row,[\s\S]*\.fund-ledger-row,[\s\S]*\.payments-ledger-row/);
  assert.match(fundView, />＋ 収入</);
  assert.match(fundView, />－ 支出</);
  assert.match(fundView, />＝ 残高</);
  assert.doesNotMatch(fundView, />＋ 基金収入<|>－ 基金支出<|>＝ 基金残高</);
});


test("cross-ledger detail pass aligns history typography, summary rows and desktop operation spacing", async () => {
  const shellCss = await read("public/css/app-shell.css");

  assert.match(shellCss, /Final cross-ledger detail pass/);
  assert.match(shellCss, /\.payments-ledger-heading > \* \{[\s\S]*font-size: 12px/);
  assert.match(shellCss, /\.payments-ledger-text \{[\s\S]*font-size: var\(--ledger-body-text-size\);[\s\S]*font-weight: 800/);
  assert.match(shellCss, /\.fund-ledger-summary-row > \* \{[\s\S]*align-items: center/);
  assert.match(shellCss, /@media \(min-width: 821px\) \{[\s\S]*\.personal-operation-rail \{[\s\S]*gap: 8px;[\s\S]*border: 0/);
  assert.match(shellCss, /\.personal-operation-rail button:last-child \{[\s\S]*border: 1px solid var\(--border\)/);
});


test("shared context lists and endpoint labels align ledger and overview panels", async () => {
  const [shellCss, personal, fund, payments, group] = await Promise.all([
    read("public/css/app-shell.css"),
    read("views/dashboard.ejs"),
    read("views/fund.ejs"),
    read("views/payments.ejs"),
    read("views/group.ejs"),
  ]);

  assert.match(shellCss, /Shared context-list and panel-header system/);
  assert.match(shellCss, /\.ledger-context-panel > \.panel-heading h2,[\s\S]*font-size: var\(--ledger-panel-title-size\)/);
  assert.match(shellCss, /\.personal-ai-analysis-button,[\s\S]*\.payments-ai-analysis-button \{[\s\S]*min-height: 38px/);
  assert.match(shellCss, /\.ledger-feature-panel > \.panel-heading h2 \{[\s\S]*font-size: var\(--ledger-panel-title-size\)/);
  assert.match(shellCss, /\.ledger-feature-panel > \.panel-heading \{[\s\S]*align-items: flex-start/);
  assert.match(personal, /: "はじめ"/);
  assert.match(personal, /: "おわり"/);
  assert.match(personal, /aria-label="<%= carryoverDateAriaLabel %>"/);
  assert.match(fund, /: "はじめ"/);
  assert.match(fund, /: "おわり"/);
  assert.match(payments, /payments-page-panel ledger-context-panel/);
  assert.match(payments, /payments-latest-batch ledger-feature-panel/);
  assert.match(group, /group-fund-pages-panel ledger-context-panel/);
  assert.match(group, /group-payment-pages-panel ledger-context-panel/);
  assert.match(group, /group-overview-page-list ledger-context-list/);
  assert.match(shellCss, /\.payments-member-list\.ledger-context-list > li \{[\s\S]*grid-template-columns: 42px minmax\(0, 1fr\)/);
});

test("browser tab titles follow one page-type-first convention", async () => {
  const [personal, fund, payments, group] = await Promise.all([
    read("views/dashboard.ejs"),
    read("views/fund.ejs"),
    read("views/payments.ejs"),
    read("views/group.ejs"),
  ]);

  assert.match(personal, /<title>家計簿｜<%= user\.displayName %>｜<%= selectedPage\.name %><\/title>/);
  assert.match(fund, /<title>基金｜<%= group\.name %>｜<%= selectedPage\.name %><\/title>/);
  assert.match(payments, /<title>割り勘｜<%= group\.name %>｜<%= selectedPage\.name %><\/title>/);
  assert.match(group, /<title>概要｜<%= group\.name %><\/title>/);
});

test("category charts use one responsive three-row panel grid without padding compensation", async () => {
  const [shellCss, personal, fund, payments] = await Promise.all([
    read("public/css/app-shell.css"),
    read("views/dashboard.ejs"),
    read("views/fund.ejs"),
    read("views/payments.ejs"),
  ]);

  assert.match(shellCss, /\.ledger-chart-panel \{[\s\S]*grid-template-rows: auto var\(--ledger-chart-control-height\) minmax\(0, 1fr\)/);
  assert.match(shellCss, /\.ledger-chart-panel > \.ledger-chart-controls \{[\s\S]*grid-row: 2;[\s\S]*height: var\(--ledger-chart-control-height\)/);
  assert.match(shellCss, /\.ledger-chart-panel > \.ledger-chart-content \{[\s\S]*grid-row: 3/);
  assert.doesNotMatch(shellCss, /\.payments-share-chart \{[\s\S]{0,180}padding-top:/);
  assert.match(personal, /personal-insight-card ledger-chart-panel/);
  assert.match(personal, /personal-chart-switch ledger-chart-controls/);
  assert.match(fund, /fund-insight-card ledger-chart-panel/);
  assert.match(fund, /fund-chart-toggle ledger-chart-controls/);
  assert.match(payments, /payments-insight-card ledger-chart-panel/);
  assert.match(payments, /ledger-chart-controls ledger-chart-controls--placeholder/);
  assert.match(payments, /payments-share-chart ledger-chart-content/);
  assert.match(payments, /payments-chart-empty ledger-chart-content/);
});


test("mobile ledger history uses compact endpoint cards and one page-level scroll", async () => {
  const [shellCss, ledgerCss, fundCss, paymentsCss, personal, fund] = await Promise.all([
    read("public/css/app-shell.css"),
    read("public/css/ledger.css"),
    read("public/css/fund.css"),
    read("public/css/payments.css"),
    read("views/dashboard.ejs"),
    read("views/fund.ejs"),
  ]);

  assert.match(shellCss, /Mobile endpoint rows use the same compact two-column card as ordinary history rows/);
  assert.match(shellCss, /\.personal-ledger-summary-row > \.personal-ledger-empty-cell,[\s\S]*display: none/);
  assert.match(shellCss, /\.fund-ledger-summary-row > \.fund-ledger-empty-cell \{[\s\S]*display: none/);
  assert.match(shellCss, /@media \(min-width: 821px\) \{[\s\S]*\.personal-ledger-summary-row > \*,[\s\S]*min-height: 52px/);

  assert.match(ledgerCss, /\.personal-transaction-panel,[\s\S]*min-height: 0;[\s\S]*height: auto;[\s\S]*overflow: visible/);
  assert.match(ledgerCss, /\.personal-ledger-scroll \{[\s\S]*max-height: none;[\s\S]*overflow: visible;[\s\S]*scrollbar-gutter: auto/);
  assert.doesNotMatch(ledgerCss, /\.personal-ledger-scroll \{[\s\S]{0,180}max-height: 62dvh/);

  assert.match(fundCss, /\.fund-transaction-panel,[\s\S]*min-height: 0;[\s\S]*height: auto;[\s\S]*overflow: visible/);
  assert.match(fundCss, /\.fund-ledger-scroll \{[\s\S]*max-height: none;[\s\S]*overflow: visible;[\s\S]*scrollbar-gutter: auto/);
  assert.doesNotMatch(fundCss, /\.fund-ledger-scroll \{[\s\S]{0,180}max-height: 62dvh/);

  assert.match(paymentsCss, /\.payments-history-panel \{[\s\S]*min-height: 0;[\s\S]*height: auto;[\s\S]*overflow: visible/);
  assert.match(paymentsCss, /\.payments-ledger-scroll \{[\s\S]*max-height: none;[\s\S]*overflow: visible;[\s\S]*scrollbar-gutter: auto/);

  assert.doesNotMatch(personal, /<time title="<%= carryoverDateLabel %>"/);
  assert.doesNotMatch(personal, /<time title="<%= balanceDateLabel %>"/);
  assert.doesNotMatch(fund, /<time title="<%= carryoverDateLabel %>"/);
  assert.doesNotMatch(fund, /<time title="<%= balanceDateLabel %>"/);
});
