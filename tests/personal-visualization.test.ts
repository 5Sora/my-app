import assert from "node:assert/strict";
import test from "node:test";
import { buildPersonalVisualization } from "../src/transactions/personal-visualization.js";

test("personal visualization separates income and expense category composition", () => {
  const result = buildPersonalVisualization([
    { kind: "PERSONAL_INCOME", amount: 100000, category: "給与" },
    { kind: "FUND_REFUND", amount: 5000, category: "基金返金" },
    { kind: "PERSONAL_EXPENSE", amount: 30000, category: "食費" },
    { kind: "GROUP_PAYMENT", amount: 20000, category: "会食" },
    { kind: "FUND_CONTRIBUTION", amount: 10000, category: "基金拠出" },
  ]);

  assert.equal(result.totals.income, 105000);
  assert.equal(result.totals.expense, 60000);
  assert.deepEqual(result.incomeComposition.map((item) => item.label), ["給与", "基金返金"]);
  assert.deepEqual(result.expenseComposition.map((item) => item.label), ["食費", "会食", "基金拠出"]);
});

test("zero-yen group participation stays out of pie totals without causing invalid percentages", () => {
  const result = buildPersonalVisualization([
    { kind: "GROUP_PAYMENT", amount: 0, category: "会食" },
  ]);

  assert.equal(result.totals.expense, 0);
  assert.deepEqual(result.expenseComposition, []);
  assert.equal(result.barScale.expensePercent, 0);
});

test("personal bar scale compares income and expense against one shared maximum", () => {
  const result = buildPersonalVisualization([
    { kind: "PERSONAL_INCOME", amount: 40000, category: "給与" },
    { kind: "PERSONAL_EXPENSE", amount: 20000, category: "食費" },
  ]);

  assert.equal(result.barScale.incomePercent, 100);
  assert.equal(result.barScale.expensePercent, 50);
});
