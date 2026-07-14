import assert from "node:assert/strict";
import test from "node:test";
import { buildFundVisualization } from "../src/transactions/fund-visualization.js";

test("fund visualization combines member contributions and external income in one composition", () => {
  const result = buildFundVisualization([
    { kind: "FUND_CONTRIBUTION", amount: 6000, category: "基金拠出", userId: 1, user: { displayName: "佐藤" } },
    { kind: "FUND_CONTRIBUTION", amount: 2000, category: "基金拠出", userId: 2, user: { displayName: "田中" } },
    { kind: "FUND_INCOME", amount: 1500, category: "外部寄付", userId: null },
    { kind: "FUND_INCOME", amount: 500, category: "外部寄付", userId: null },
  ]);

  assert.deepEqual(result.totals, {
    internalContribution: 8000,
    externalIncome: 2000,
    income: 10000,
    fundExpense: 0,
    refund: 0,
    expense: 0,
  });
  assert.deepEqual(
    result.incomeComposition.map(({ label, sourceType, amount, percentage }) => ({ label, sourceType, amount, percentage })),
    [
      { label: "佐藤の拠出", sourceType: "INTERNAL", amount: 6000, percentage: 60 },
      { label: "田中の拠出", sourceType: "INTERNAL", amount: 2000, percentage: 20 },
      { label: "外部寄付", sourceType: "EXTERNAL", amount: 2000, percentage: 20 },
    ],
  );
  assert.equal(result.incomeComposition[0]?.color, "#7fae78");
  assert.equal(result.incomeComposition[2]?.color, "#245a8d");
});

test("fund visualization keeps expense and refund out of the income pie and inside the expense bar", () => {
  const result = buildFundVisualization([
    { kind: "FUND_INCOME", amount: 4000, category: "助成金", userId: null },
    { kind: "FUND_EXPENSE", amount: 2500, category: "会場費", userId: null },
    { kind: "FUND_REFUND", amount: 500, category: "基金返金", userId: null },
  ]);

  assert.equal(result.incomeComposition.length, 1);
  assert.equal(result.incomeComposition[0]?.label, "助成金");
  assert.equal(result.totals.expense, 3000);
  assert.equal(result.barScale.incomePercent, 100);
  assert.equal(result.barScale.expensePercent, 75);
});

test("fund visualization returns safe empty percentages when no transactions exist", () => {
  const result = buildFundVisualization([]);
  assert.deepEqual(result.incomeComposition, []);
  assert.deepEqual(result.barScale, {
    incomePercent: 0,
    expensePercent: 0,
    internalSharePercent: 0,
    externalSharePercent: 0,
  });
});
