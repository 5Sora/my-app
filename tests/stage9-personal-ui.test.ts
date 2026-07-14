import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

const dashboard = readFileSync(new URL("../views/dashboard.ejs", import.meta.url), "utf8");
const ledgerCss = readFileSync(new URL("../public/css/ledger.css", import.meta.url), "utf8");
const dashboardJs = readFileSync(new URL("../public/js/personal-dashboard.js", import.meta.url), "utf8");
const chartJs = readFileSync(new URL("../public/js/personal-charts.js", import.meta.url), "utf8");

test("Stage 9-3 personal page uses the shared top shell and open/closed 12-column lower shell", () => {
  assert.match(dashboard, /ledger-shell personal-shell/);
  assert.match(dashboard, /ledger-shell-top personal-shell-top/);
  assert.match(dashboard, /personal-layout<%= isContextOpen/);
  assert.match(ledgerCss, /personal-layout[\s\S]*grid-template-columns: repeat\(12, minmax\(0, 1fr\)\)/);
  assert.match(ledgerCss, /personal-context-column[\s\S]*grid-column: 1 \/ span 3/);
  assert.match(ledgerCss, /personal-operation-rail[\s\S]*grid-column: 4/);
  assert.match(ledgerCss, /personal-transaction-panel[\s\S]*grid-column: 5 \/ -1/);
});

test("Stage 9-3 personal ledger is five columns with fixed carryover and balance and a zero participation label", () => {
  assert.match(dashboard, /日付<\/span><span role="columnheader">収入内容/);
  assert.match(dashboard, /収入金額<\/span><span role="columnheader">支出内容/);
  assert.match(dashboard, /支出金額/);
  assert.match(dashboard, /personal-ledger-carryover/);
  assert.match(dashboard, /personal-ledger-scroll/);
  assert.match(dashboard, /personal-ledger-balance/);
  assert.match(dashboard, /参加・負担0円/);
});

test("Stage 9-3 transaction addition is exposed from the history heading and category charts switch between expense and income", () => {
  assert.match(dashboard, /personal-history-add/);
  assert.doesNotMatch(dashboard, /dashboard-contribution-panel/);
  assert.match(dashboard, /data-personal-chart-mode="expense"/);
  assert.match(dashboard, /data-personal-chart-mode="income"/);
  assert.match(chartJs, /render\("expense"\)/);
  assert.match(dashboardJs, /data-personal-context-state/);
});
