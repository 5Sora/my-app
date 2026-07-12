import assert from "node:assert/strict";
import test from "node:test";
import {
  buildPersonalLedgerAnalysisAggregate,
  createPreviousPeriod,
  type PersonalLedgerTransaction,
} from "../src/transactions/personal-ledger-summary.js";

const transactions: PersonalLedgerTransaction[] = [
  { kind: "PERSONAL_INCOME", amount: 1_000, category: "給与・副業", transactionDate: "2026-06-01" },
  { kind: "PERSONAL_EXPENSE", amount: 200, category: "食費", transactionDate: "2026-06-02" },
  { kind: "PERSONAL_INCOME", amount: 1_000, category: "給与・副業", transactionDate: "2026-06-21" },
  { kind: "PERSONAL_EXPENSE", amount: 1_000, category: "交通費", transactionDate: "2026-06-30" },
  { kind: "PERSONAL_INCOME", amount: 5_000, category: "給与・副業", transactionDate: "2026-07-01" },
  { kind: "FUND_REFUND", amount: 300, category: "基金返金", transactionDate: "2026-07-02" },
  { kind: "PERSONAL_EXPENSE", amount: 1_000, category: "食費", transactionDate: "2026-07-03" },
  { kind: "GROUP_PAYMENT", amount: 1_000, category: "会場費", transactionDate: "2026-07-04" },
  { kind: "FUND_CONTRIBUTION", amount: 500, category: "基金拠出", transactionDate: "2026-07-05" },
  { kind: "PERSONAL_EXPENSE", amount: 9_999, category: "食費", transactionDate: "2026-07-11" },
];

test("personal ledger aggregate calculates income, expense, carryover and closing balance", () => {
  const aggregate = buildPersonalLedgerAnalysisAggregate({
    transactions,
    period: { startDate: "2026-07-01", endDate: "2026-07-10" },
  });

  assert.equal(aggregate.current.incomeTotal, 5_300);
  assert.equal(aggregate.current.expenseTotal, 2_500);
  assert.equal(aggregate.current.net, 2_800);
  assert.equal(aggregate.current.carryover, 800);
  assert.equal(aggregate.current.closingBalance, 3_600);
  assert.equal(aggregate.current.incomeCount, 2);
  assert.equal(aggregate.current.expenseCount, 3);
});

test("fund refund is income while group payment and fund contribution are expenses", () => {
  const aggregate = buildPersonalLedgerAnalysisAggregate({
    transactions,
    period: { startDate: "2026-07-01", endDate: "2026-07-10" },
  });

  assert.equal(aggregate.current.groupPaymentTotal, 1_000);
  assert.equal(aggregate.current.fundContributionTotal, 500);
  assert.equal(aggregate.current.incomeCategories.find((item) => item.category === "基金返金")?.amount, 300);
  assert.equal(aggregate.current.expenseCategories.find((item) => item.category === "会場費")?.amount, 1_000);
});

test("category totals and shares are calculated and sorted by amount", () => {
  const aggregate = buildPersonalLedgerAnalysisAggregate({
    transactions,
    period: { startDate: "2026-07-01", endDate: "2026-07-10" },
  });

  assert.equal(aggregate.current.expenseCategories[0].amount, 1_000);
  assert.equal(aggregate.current.expenseCategories[0].sharePercentage, 40);
  assert.equal(aggregate.current.expenseCategories.at(-1)?.amount, 500);
  assert.equal(aggregate.current.expenseCategories.at(-1)?.sharePercentage, 20);
});

test("comparison period is the immediately preceding inclusive day range", () => {
  assert.deepEqual(createPreviousPeriod("2026-07-01", "2026-07-10"), {
    startDate: "2026-06-21",
    endDate: "2026-06-30",
    dayCount: 10,
  });

  const aggregate = buildPersonalLedgerAnalysisAggregate({
    transactions,
    period: { startDate: "2026-07-01", endDate: "2026-07-10" },
  });
  assert.equal(aggregate.comparison?.summary.incomeTotal, 1_000);
  assert.equal(aggregate.comparison?.summary.expenseTotal, 1_000);
  assert.equal(aggregate.comparison?.changes.expenseAmount, 1_500);
  assert.equal(aggregate.comparison?.changes.expensePercentage, 150);
});

test("all-time and one-sided periods do not create a comparison period", () => {
  assert.equal(createPreviousPeriod(null, null), null);
  assert.equal(createPreviousPeriod("2026-07-01", null), null);
  assert.equal(createPreviousPeriod(null, "2026-07-10"), null);

  const aggregate = buildPersonalLedgerAnalysisAggregate({
    transactions,
    period: { startDate: null, endDate: null },
  });
  assert.equal(aggregate.period.label, "全期間");
  assert.equal(aggregate.current.carryover, 0);
  assert.equal(aggregate.comparison, null);
});

test("warning flags are calculated by the application", () => {
  const aggregate = buildPersonalLedgerAnalysisAggregate({
    transactions: [
      { kind: "PERSONAL_EXPENSE", amount: 100, category: "食費", transactionDate: "2026-06-30" },
      { kind: "PERSONAL_INCOME", amount: 100, category: "給与・副業", transactionDate: "2026-07-01" },
      { kind: "PERSONAL_EXPENSE", amount: 600, category: "食費", transactionDate: "2026-07-02" },
      { kind: "PERSONAL_EXPENSE", amount: 200, category: "交通費", transactionDate: "2026-07-03" },
    ],
    period: { startDate: "2026-07-01", endDate: "2026-07-03" },
  });

  assert.equal(aggregate.warningFlags.negativeNet, true);
  assert.equal(aggregate.warningFlags.expenseIncreaseAtLeast20Percent, true);
  assert.equal(aggregate.warningFlags.singleExpenseCategoryAtLeast50Percent, true);
  assert.equal(aggregate.warningFlags.warningReasons.length, 3);
});
