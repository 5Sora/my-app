import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path: string) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("Stage 10 fund page defaults to the expense category pie with a persistent legend and accessible empty state", async () => {
  const [view, css, script] = await Promise.all([
    read("views/fund.ejs"),
    read("public/css/fund.css"),
    read("public/js/fund-charts.js"),
  ]);

  assert.match(view, /data-fund-income-chart/);
  assert.match(view, /data-fund-pie-segments/);
  assert.match(view, /fundVisualizationView\.expenseComposition\.forEach/);
  assert.match(view, /id="fund-composition-title">カテゴリ/);
  assert.match(view, /表示できる基金支出がありません/);
  assert.doesNotMatch(view, /data-fund-chart-mode-help/);
  assert.match(view, /\/js\/fund-charts\.js/);

  const incomeButtonIndex = view.indexOf('data-fund-chart-mode="income"');
  const expenseButtonIndex = view.indexOf('data-fund-chart-mode="expense"');
  assert.ok(incomeButtonIndex >= 0 && expenseButtonIndex > incomeButtonIndex);
  assert.match(view, /class="fund-chart-toggle__button"\s+data-fund-chart-mode="income"\s+aria-pressed="false"/);
  assert.match(view, /class="fund-chart-toggle__button is-active"\s+data-fund-chart-mode="expense"\s+aria-pressed="true"/);
  assert.match(script, /let activeMode = "expense";/);

  assert.match(css, /\.fund-income-chart__legend\s*\{[\s\S]*overflow-y: auto/);
  assert.match(css, /\.fund-income-chart__legend-item:focus-visible/);
  assert.match(css, /\.fund-chart-empty/);
  assert.match(script, /setAttribute\("tabindex", "0"\)/);
  assert.match(script, /pointerenter/);
  assert.match(script, /event\.key === "Escape"/);
});

test("Stage 9-2 closed fund context shows a vertical two-column comparison with stacked internal and external income", async () => {
  const [view, css] = await Promise.all([
    read("views/fund.ejs"),
    read("public/css/fund.css"),
  ]);

  assert.match(view, /class="fund-bar-chart__plot"/);
  assert.match(view, /class="fund-bar-chart__column"/);
  assert.match(view, /class="fund-bar-chart__income" style="height:/);
  assert.match(view, /class="fund-bar-chart__internal" style="height:/);
  assert.match(view, /class="fund-bar-chart__external" style="height:/);
  assert.ok(
    view.indexOf('class="fund-bar-chart__internal"') < view.indexOf('class="fund-bar-chart__external"'),
    "internal contribution must be rendered above external income in the vertical stack",
  );
  assert.match(view, /class="fund-bar-chart__expense" style="height:/);
  assert.doesNotMatch(view, /class="fund-bar-chart__(?:income|expense)" style="width:/);
  assert.match(view, /基金支出・返金/);
  assert.match(view, /collapsedSummary\?\.setAttribute\("aria-hidden", String\(isOpen\)\)/);

  assert.match(css, /\.fund-bar-chart__plot\s*\{[\s\S]*min-height: clamp\(230px, 32vh, 300px\)/);
  assert.match(css, /\.fund-bar-chart__plot\s*\{[\s\S]*grid-template-columns: repeat\(2,/);
  assert.match(css, /\.fund-bar-chart__track\s*\{[\s\S]*width: min\(68px, 78%\)/);
  assert.match(css, /\.fund-bar-chart__track\s*\{[\s\S]*align-items: flex-end/);
  assert.match(css, /@media \(max-width: 820px\) \{[\s\S]*\.fund-bar-chart__plot \{[\s\S]*min-height: 190px/);
  assert.match(css, /\.fund-bar-chart__income\s*\{[\s\S]*flex-direction: column;/);
  assert.match(css, /\.fund-bar-chart__internal\s*\{[\s\S]*background: #9fbe8f/);
  assert.match(css, /\.fund-bar-chart__external\s*\{[\s\S]*background: #245a8d/);
  assert.match(css, /\.fund-bar-chart__expense\s*\{[\s\S]*background:/);
});


test("final fund UI mirrors the personal title, chart, bar, and five-column ledger language", async () => {
  const [view, css] = await Promise.all([read("views/fund.ejs"), read("public/css/fund.css")]);
  assert.match(view, /<%= group\.name %> の基金/);
  assert.match(view, /id="fund-summary-title">サマリー/);
  assert.match(view, />収入カテゴリ<\/button>/);
  assert.match(view, />支出カテゴリ<\/button>/);
  assert.match(view, />所属メンバー</);
  assert.doesNotMatch(view, /member\.role === "ADMIN" \? "管理者" : "メンバー"/);
  assert.doesNotMatch(view, /member\.userId === currentUserId/);
  assert.match(view, />履歴詳細</);
  assert.match(view, /収入内容/);
  assert.match(view, /収入金額/);
  assert.match(view, /支出内容/);
  assert.match(view, /支出金額/);
  assert.doesNotMatch(view, /fund-bar-chart__value/);
  assert.match(css, /fund-bar-chart__category[\s\S]*font-size: 0\.9rem/);
  assert.match(css, /--fund-ledger-columns: 12% 30% 14% 30% 14%/);
});
