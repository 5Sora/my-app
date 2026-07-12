import assert from "node:assert/strict";
import test from "node:test";
import type { AiFoundation } from "../src/ai/client.js";
import { AiFoundation as RealAiFoundation } from "../src/ai/client.js";
import { loadAiConfig } from "../src/ai/config.js";
import {
  FINANCIAL_ANALYSIS_DISCLAIMER,
  normalizeFinancialAnalysis,
} from "../src/ai/financial-analysis.js";
import {
  analyzeGroupPaymentsWithAi,
  buildGroupPaymentAnalysisInstructions,
  buildGroupPaymentAutomaticSummary,
} from "../src/ai/group-payment-analysis.js";
import {
  buildGroupPaymentAnalysisAggregate,
  type GroupPaymentAnalysisAggregate,
  type GroupPaymentTransaction,
} from "../src/transactions/group-payment-summary.js";

const transactions: GroupPaymentTransaction[] = [
  { amount: 5_000, category: "会場費", transactionDate: "2026-06-21", paymentBatchId: null },
  { amount: 2_000, category: "交通費", transactionDate: "2026-06-30", paymentBatchId: "11111111-1111-1111-1111-111111111111" },
  { amount: 3_000, category: "交通費", transactionDate: "2026-06-30", paymentBatchId: "11111111-1111-1111-1111-111111111111" },
  { amount: 10_000, category: "会場費", transactionDate: "2026-07-01", paymentBatchId: null },
  { amount: 4_000, category: "飲食費", transactionDate: "2026-07-02", paymentBatchId: "22222222-2222-2222-2222-222222222222" },
  { amount: 6_000, category: "飲食費", transactionDate: "2026-07-02", paymentBatchId: "22222222-2222-2222-2222-222222222222" },
  { amount: 2_000, category: "備品費", transactionDate: "2026-07-03", paymentBatchId: "33333333-3333-3333-3333-333333333333" },
  { amount: 8_000, category: "会場費", transactionDate: "2026-07-04", paymentBatchId: "33333333-3333-3333-3333-333333333333" },
];

const aggregate = buildGroupPaymentAnalysisAggregate({
  transactions,
  period: { startDate: "2026-07-01", endDate: "2026-07-10" },
});

const aiAnalysis = {
  overview: "関連支払い総額とカテゴリ構成を集計しました。",
  observations: [
    { title: "会場費の割合", description: "会場費が総額の60%です。", level: "WARNING" as const },
  ],
  suggestions: [
    { title: "カテゴリ確認", description: "割合の大きいカテゴリを確認してください。" },
  ],
  limitations: ["集計値だけを使用しています。"],
  disclaimer: FINANCIAL_ANALYSIS_DISCLAIMER,
};

test("group payment aggregate counts rows, singles, distinct batches and events", () => {
  assert.equal(aggregate.current.totalAmount, 30_000);
  assert.equal(aggregate.current.transactionCount, 5);
  assert.equal(aggregate.current.singlePaymentCount, 1);
  assert.equal(aggregate.current.confirmedBatchCount, 2);
  assert.equal(aggregate.current.paymentEventCount, 3);
  assert.equal(aggregate.current.averageTransactionAmount, 6_000);
});

test("group payment categories are totaled without double-counting batch totals", () => {
  assert.deepEqual(aggregate.current.categories, [
    { category: "会場費", amount: 18_000, sharePercentage: 60 },
    { category: "飲食費", amount: 10_000, sharePercentage: 33.33 },
    { category: "備品費", amount: 2_000, sharePercentage: 6.67 },
  ]);
});

test("group payment comparison uses the immediately preceding inclusive period", () => {
  assert.equal(aggregate.comparison?.period.startDate, "2026-06-21");
  assert.equal(aggregate.comparison?.period.endDate, "2026-06-30");
  assert.equal(aggregate.comparison?.summary.totalAmount, 10_000);
  assert.equal(aggregate.comparison?.summary.transactionCount, 3);
  assert.equal(aggregate.comparison?.summary.singlePaymentCount, 1);
  assert.equal(aggregate.comparison?.summary.confirmedBatchCount, 1);
  assert.equal(aggregate.comparison?.changes.totalAmount, 20_000);
  assert.equal(aggregate.comparison?.changes.totalPercentage, 200);
});

test("group payment warning evidence is calculated by the application", () => {
  assert.equal(aggregate.warningFlags.totalIncreaseAtLeast20Percent, true);
  assert.equal(aggregate.warningFlags.singleCategoryAtLeast50Percent, true);
  assert.equal(aggregate.warningFlags.warningReasons.length, 2);
});

test("all-time group payment analysis does not create comparison", () => {
  const allTime = buildGroupPaymentAnalysisAggregate({
    transactions,
    period: { startDate: null, endDate: null },
  });
  assert.equal(allTime.period.label, "全期間");
  assert.equal(allTime.comparison, null);
});

test("group payment instructions prohibit personal and fairness evaluation", () => {
  const instructions = buildGroupPaymentAnalysisInstructions();
  assert.match(instructions, /Do not infer who paid more/);
  assert.match(instructions, /fairness/);
  assert.match(instructions, /distinct payment batches/);
  assert.match(instructions, new RegExp(FINANCIAL_ANALYSIS_DISCLAIMER));
});

test("group payment AI request contains only aggregates and uses analysis feature", async () => {
  const calls: Array<Record<string, unknown>> = [];
  const foundation = {
    async executeStructured(request: Record<string, unknown>) {
      calls.push(request);
      return {
        data: aiAnalysis,
        model: "gpt-5.4-mini",
        attempts: 1,
        durationMs: 10,
        usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
      };
    },
  } as unknown as AiFoundation;

  await analyzeGroupPaymentsWithAi({ foundation, userId: 7, aggregate });
  const request = calls[0];
  assert.equal(request.feature, "analysis");
  assert.equal(request.userId, 7);
  assert.equal(request.schemaName, "group_payment_financial_analysis");
  const serialized = String(request.input);
  assert.deepEqual(JSON.parse(serialized), aggregate);
  for (const forbidden of ["rawText", "displayName", "userId", "groupId", "pageId", "paymentBatchId"]) {
    assert.equal(serialized.includes(forbidden), false);
  }
});

test("group payment analysis uses gpt-5.4-mini, store:false and strict output", async () => {
  const calls: Array<Record<string, unknown>> = [];
  const parser = {
    async parse(body: Record<string, unknown>) {
      calls.push(body);
      return { output_parsed: aiAnalysis };
    },
  };
  const foundation = new RealAiFoundation(
    loadAiConfig({ OPENAI_API_KEY: "test-key", AI_SAFETY_SALT: "test-safety-salt" }),
    { parser },
  );

  await analyzeGroupPaymentsWithAi({ foundation, userId: 1, aggregate });
  const body = calls[0];
  const text = body.text as { format?: { type?: string; strict?: boolean } };
  assert.equal(body.model, "gpt-5.4-mini");
  assert.equal(body.store, false);
  assert.equal(text.format?.type, "json_schema");
  assert.equal(text.format?.strict, true);
  assert.equal(String(body.input).includes("paymentBatchId"), false);
});

test("group payment automatic summary is clearly labeled and WARNING normalization uses app evidence", () => {
  const fallback = buildGroupPaymentAutomaticSummary(aggregate);
  assert.equal(fallback.source, "AUTOMATIC_SUMMARY");
  assert.match(fallback.sourceLabel, /AI分析ではありません/);
  assert.match(fallback.overview, /支払いイベントは3件/);
  assert.equal(fallback.observations.some((item) => item.level === "WARNING"), true);

  const withoutWarning: GroupPaymentAnalysisAggregate = {
    ...aggregate,
    warningFlags: { ...aggregate.warningFlags, warningReasons: [] },
  };
  const normalized = normalizeFinancialAnalysis(aiAnalysis, withoutWarning);
  assert.equal(normalized.observations[0].level, "NOTICE");
});
