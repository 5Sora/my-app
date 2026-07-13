import assert from "node:assert/strict";
import test from "node:test";
import type { AiFoundation } from "../src/ai/client.js";
import { AiFoundation as RealAiFoundation } from "../src/ai/client.js";
import { loadAiConfig } from "../src/ai/config.js";
import {
  analyzeGroupFundWithAi,
  buildGroupFundAnalysisInstructions,
  buildGroupFundAutomaticSummary,
  buildGroupFundFixedMetrics,
  replaceFundMemberKeysInAnalysis,
} from "../src/ai/group-fund-analysis.js";
import {
  FINANCIAL_ANALYSIS_DISCLAIMER,
  normalizeFinancialAnalysis,
  type FinancialAnalysisDisplay,
} from "../src/ai/financial-analysis.js";
import {
  buildGroupFundAnalysisBundle,
  type GroupFundTransaction,
} from "../src/transactions/group-fund-summary.js";

const transactions: GroupFundTransaction[] = [
  { kind: "FUND_CONTRIBUTION", amount: 10_000, category: "基金拠出", transactionDate: "2026-06-01", userId: 1 },
  { kind: "FUND_INCOME", amount: 5_000, category: "外部寄付", transactionDate: "2026-06-02", userId: null },
  { kind: "FUND_EXPENSE", amount: 2_000, category: "備品費", transactionDate: "2026-06-03", userId: null },
  { kind: "FUND_REFUND", amount: 1_000, category: "基金返金", transactionDate: "2026-06-04", userId: 1 },

  { kind: "FUND_CONTRIBUTION", amount: 10_000, category: "基金拠出", transactionDate: "2026-06-21", userId: 1 },
  { kind: "FUND_CONTRIBUTION", amount: 10_000, category: "基金拠出", transactionDate: "2026-06-22", userId: 2 },
  { kind: "FUND_INCOME", amount: 10_000, category: "助成金", transactionDate: "2026-06-23", userId: null },
  { kind: "FUND_EXPENSE", amount: 10_000, category: "会場費", transactionDate: "2026-06-24", userId: null },
  { kind: "FUND_REFUND", amount: 2_000, category: "基金返金", transactionDate: "2026-06-25", userId: 2 },

  { kind: "FUND_CONTRIBUTION", amount: 40_000, category: "基金拠出", transactionDate: "2026-07-01", userId: 1 },
  { kind: "FUND_CONTRIBUTION", amount: 10_000, category: "基金拠出", transactionDate: "2026-07-02", userId: 2 },
  { kind: "FUND_INCOME", amount: 10_000, category: "イベント収益", transactionDate: "2026-07-03", userId: null },
  { kind: "FUND_EXPENSE", amount: 30_000, category: "会場費", transactionDate: "2026-07-04", userId: null },
  { kind: "FUND_EXPENSE", amount: 10_000, category: "飲食費", transactionDate: "2026-07-05", userId: null },
  { kind: "FUND_REFUND", amount: 5_000, category: "基金返金", transactionDate: "2026-07-06", userId: 2 },
];

const activeMembers = [
  { userId: 1, displayName: "青木" },
  { userId: 2, displayName: "伊藤" },
  { userId: 3, displayName: "上田" },
  { userId: 4, displayName: "江藤" },
];

const bundle = buildGroupFundAnalysisBundle({
  transactions,
  activeMembers,
  period: { startDate: "2026-07-01", endDate: "2026-07-10" },
  random: () => 0.999,
});

const aiAnalysis = {
  overview: "MEMBER_1の拠出割合を含む基金集計です。",
  observations: [
    {
      title: "MEMBER_1の拠出構造",
      description: "MEMBER_1が内部拠出の80%を占めます。",
      level: "WARNING" as const,
    },
    {
      title: "不明な識別子",
      description: "MEMBER_999については判断できません。",
      level: "INFO" as const,
    },
  ],
  suggestions: [
    { title: "構成確認", description: "MEMBER_2を含む割合を集計として確認してください。" },
  ],
  limitations: ["MEMBER_1の個別事情は確認していません。"],
  disclaimer: FINANCIAL_ANALYSIS_DISCLAIMER,
};

test("group fund aggregate separates internal contribution, external income, refund, and expense", () => {
  const { aggregate } = bundle;
  assert.equal(aggregate.current.carryover, 30_000);
  assert.equal(aggregate.current.internalContributionTotal, 50_000);
  assert.equal(aggregate.current.externalIncomeTotal, 10_000);
  assert.equal(aggregate.current.incomeTotal, 60_000);
  assert.equal(aggregate.current.fundExpenseTotal, 40_000);
  assert.equal(aggregate.current.refundTotal, 5_000);
  assert.equal(aggregate.current.expenseTotal, 45_000);
  assert.equal(aggregate.current.net, 15_000);
  assert.equal(aggregate.current.closingBalance, 45_000);
  assert.equal(aggregate.current.internalContributionDependencyPercentage, 83.33);
});

test("group fund aggregate calculates anonymous contribution concentration and expense categories", () => {
  const { current } = bundle.aggregate;
  assert.equal(current.contributorCount, 2);
  assert.equal(current.activeMemberCount, 4);
  assert.equal(current.memberContributions.length, 2);
  assert.equal(current.memberContributions[0].amount, 40_000);
  assert.equal(current.memberContributions[0].sharePercentage, 80);
  assert.match(current.memberContributions[0].memberKey, /^MEMBER_\d+$/);
  assert.equal(current.maxContributorSharePercentage, 80);
  assert.equal(current.topThreeContributorSharePercentage, 100);
  assert.deepEqual(current.expenseCategories, [
    { category: "会場費", amount: 30_000, sharePercentage: 75 },
    { category: "飲食費", amount: 10_000, sharePercentage: 25 },
  ]);
  assert.equal(JSON.stringify(bundle.aggregate).includes("青木"), false);
  assert.equal(JSON.stringify(bundle.aggregate).includes("伊藤"), false);
  assert.equal(JSON.stringify(bundle.aggregate).includes("userId"), false);
});

test("group fund comparison uses the immediately preceding inclusive period", () => {
  const comparison = bundle.aggregate.comparison;
  assert.ok(comparison);
  assert.deepEqual(comparison.period, {
    startDate: "2026-06-21",
    endDate: "2026-06-30",
    dayCount: 10,
  });
  assert.equal(comparison.summary.incomeTotal, 30_000);
  assert.equal(comparison.summary.expenseTotal, 12_000);
  assert.equal(comparison.summary.internalContributionDependencyPercentage, 66.67);
  assert.equal(comparison.changes.expenseAmount, 33_000);
  assert.equal(comparison.changes.internalContributionAmount, 30_000);
  assert.equal(comparison.changes.expensePercentage, 275);
});

test("group fund warning evidence is calculated by the application", () => {
  const flags = bundle.aggregate.warningFlags;
  assert.equal(flags.negativeNet, false);
  assert.equal(flags.expenseIncreaseAtLeast20Percent, true);
  assert.equal(flags.internalContributionDependencyAtLeast80Percent, true);
  assert.equal(flags.maxContributorShareAtLeast50Percent, true);
  assert.equal(flags.topThreeContributorShareAtLeast80Percent, true);
  assert.equal(flags.singleExpenseCategoryAtLeast50Percent, true);
  assert.equal(flags.contributorCoverageLimited, true);
  assert.equal(flags.warningReasons.length, 5);
});

test("all-time group fund analysis has no comparison", () => {
  const allTime = buildGroupFundAnalysisBundle({
    transactions,
    activeMembers,
    period: { startDate: null, endDate: null },
    random: () => 0,
  });
  assert.equal(allTime.aggregate.period.label, "全期間");
  assert.equal(allTime.aggregate.comparison, null);
});

test("member aliases are recreated for each request and mapping is not inside aggregate", () => {
  const first = buildGroupFundAnalysisBundle({
    transactions,
    activeMembers,
    period: { startDate: "2026-07-01", endDate: "2026-07-10" },
    random: () => 0,
  });
  const second = buildGroupFundAnalysisBundle({
    transactions,
    activeMembers,
    period: { startDate: "2026-07-01", endDate: "2026-07-10" },
    random: () => 0.999,
  });
  const firstKeyForAoki = [...first.memberNamesByKey.entries()].find(([, name]) => name === "青木")?.[0];
  const secondKeyForAoki = [...second.memberNamesByKey.entries()].find(([, name]) => name === "青木")?.[0];
  assert.notEqual(firstKeyForAoki, secondKeyForAoki);
  assert.equal("memberNamesByKey" in first.aggregate, false);
});

test("group fund instructions prohibit identity, fairness, responsibility, and economic inference", () => {
  const instructions = buildGroupFundAnalysisInstructions();
  assert.match(instructions, /temporary aliases/);
  assert.match(instructions, /Do not infer responsibility/);
  assert.match(instructions, /fairness/);
  assert.match(instructions, /economic circumstances/);
  assert.match(instructions, /Do not urge, shame, rank, or blame/);
  assert.match(instructions, new RegExp(FINANCIAL_ANALYSIS_DISCLAIMER));
});

test("group fund AI request sends only anonymous aggregate values", async () => {
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

  await analyzeGroupFundWithAi({ foundation, userId: 7, aggregate: bundle.aggregate });
  const request = calls[0];
  assert.equal(request.feature, "analysis");
  assert.equal(request.userId, 7);
  assert.equal(request.schemaName, "group_fund_financial_analysis");
  const serialized = String(request.input);
  assert.deepEqual(JSON.parse(serialized), bundle.aggregate);
  for (const forbidden of ["青木", "伊藤", "displayName", "userId", "groupId", "pageId", "rawText", "transactionId"]) {
    assert.equal(serialized.includes(forbidden), false);
  }
  assert.match(serialized, /MEMBER_\d+/);
});

test("group fund analysis uses gpt-5.4-mini, store:false, and strict output", async () => {
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

  await analyzeGroupFundWithAi({ foundation, userId: 1, aggregate: bundle.aggregate });
  const body = calls[0];
  const text = body.text as { format?: { type?: string; strict?: boolean } };
  assert.equal(body.model, "gpt-5.4-mini");
  assert.equal(body.store, false);
  assert.equal(text.format?.type, "json_schema");
  assert.equal(text.format?.strict, true);
});

test("member keys are replaced before display and unknown keys become generic", () => {
  const normalized = normalizeFinancialAnalysis(aiAnalysis, bundle.aggregate);
  const replaced = replaceFundMemberKeysInAnalysis(normalized, bundle.memberNamesByKey);
  const serialized = JSON.stringify(replaced);
  assert.equal(serialized.includes("MEMBER_"), false);
  assert.match(serialized, /青木/);
  assert.match(serialized, /伊藤/);
  assert.match(serialized, /匿名メンバー/);
});

test("group fund automatic summary is clearly labeled and contains exact fund structures", () => {
  const fallback = buildGroupFundAutomaticSummary(bundle.aggregate, bundle.memberNamesByKey);
  assert.equal(fallback.source, "AUTOMATIC_SUMMARY");
  assert.match(fallback.sourceLabel, /AI分析ではありません/);
  assert.match(fallback.overview, /期末残高は45,000円/);
  assert.match(JSON.stringify(fallback), /内部拠出は50,000円/);
  assert.match(JSON.stringify(fallback), /外部収入は10,000円/);
  assert.match(JSON.stringify(fallback), /最大拠出割合は80%/);
  assert.equal(JSON.stringify(fallback).includes("MEMBER_"), false);
});

test("unfounded WARNING is downgraded before member-name replacement", () => {
  const withoutWarning = {
    ...bundle.aggregate,
    warningFlags: { ...bundle.aggregate.warningFlags, warningReasons: [] },
  };
  const normalized = normalizeFinancialAnalysis(aiAnalysis, withoutWarning);
  assert.equal(normalized.observations[0].level, "NOTICE");
});

test("group fund fixed metrics always expose contributor and active-member counts", () => {
  const metrics = buildGroupFundFixedMetrics(bundle.aggregate);
  assert.deepEqual(metrics, [
    { label: "拠出者数", value: "2名" },
    { label: "有効メンバー数", value: "4名" },
    { label: "内部拠出依存率", value: "83.33%" },
    { label: "最大拠出割合", value: "80%" },
    { label: "上位3名割合", value: "100%" },
  ]);
});

test("group fund instructions prohibit explaining aliases or anonymization mechanics", () => {
  const instructions = buildGroupFundAnalysisInstructions();
  assert.match(instructions, /Do not mention aliases, pseudonyms, member keys, anonymization/);
});
