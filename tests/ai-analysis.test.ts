import assert from "node:assert/strict";
import test from "node:test";
import type { AiFoundation } from "../src/ai/client.js";
import { AiFoundation as RealAiFoundation } from "../src/ai/client.js";
import { loadAiConfig } from "../src/ai/config.js";
import {
  FINANCIAL_ANALYSIS_DISCLAIMER,
  analyzePersonalLedgerWithAi,
  buildPersonalLedgerAnalysisInstructions,
  buildPersonalLedgerAutomaticSummary,
  financialAnalysisSchema,
  normalizeFinancialAnalysis,
} from "../src/ai/financial-analysis.js";
import type { PersonalLedgerAnalysisAggregate } from "../src/transactions/personal-ledger-summary.js";

const aggregate: PersonalLedgerAnalysisAggregate = {
  period: {
    startDate: "2026-07-01",
    endDate: "2026-07-10",
    label: "2026-07-01〜2026-07-10",
    comparisonAvailable: true,
  },
  current: {
    carryover: 1_000,
    incomeTotal: 10_000,
    expenseTotal: 6_000,
    net: 4_000,
    closingBalance: 5_000,
    incomeCount: 1,
    expenseCount: 3,
    transactionCount: 4,
    incomeCategories: [{ category: "給与・副業", amount: 10_000, sharePercentage: 100 }],
    expenseCategories: [
      { category: "食費", amount: 3_000, sharePercentage: 50 },
      { category: "交通費", amount: 3_000, sharePercentage: 50 },
    ],
    groupPaymentTotal: 1_000,
    fundContributionTotal: 500,
  },
  comparison: {
    period: { startDate: "2026-06-21", endDate: "2026-06-30", dayCount: 10 },
    summary: {
      incomeTotal: 8_000,
      expenseTotal: 5_000,
      net: 3_000,
      incomeCount: 1,
      expenseCount: 2,
      transactionCount: 3,
      incomeCategories: [{ category: "給与・副業", amount: 8_000, sharePercentage: 100 }],
      expenseCategories: [{ category: "食費", amount: 5_000, sharePercentage: 100 }],
      groupPaymentTotal: 0,
      fundContributionTotal: 0,
    },
    changes: {
      incomeAmount: 2_000,
      expenseAmount: 1_000,
      netAmount: 1_000,
      incomePercentage: 25,
      expensePercentage: 20,
    },
  },
  warningFlags: {
    negativeNet: false,
    expenseIncreaseAtLeast20Percent: true,
    expenseIncreasedFromZero: false,
    singleExpenseCategoryAtLeast50Percent: true,
    limitedTransactionCount: false,
    warningReasons: [
      "支出が前期間より20%以上増加しています。",
      "単一の支出カテゴリが支出全体の50%以上です。",
    ],
  },
};

const aiAnalysis = {
  overview: "収入が支出を上回っています。",
  observations: [
    { title: "支出の増加", description: "前期間より支出が20%増えています。", level: "WARNING" as const },
  ],
  suggestions: [
    { title: "カテゴリ確認", description: "食費と交通費の内訳を確認してください。" },
  ],
  limitations: ["集計値だけを使用しています。"],
  disclaimer: FINANCIAL_ANALYSIS_DISCLAIMER,
};

test("financial analysis schema validates the strict structured output", () => {
  assert.equal(financialAnalysisSchema.safeParse(aiAnalysis).success, true);
  assert.equal(financialAnalysisSchema.safeParse({ ...aiAnalysis, extra: true }).success, false);
  assert.equal(financialAnalysisSchema.safeParse({
    ...aiAnalysis,
    observations: [{ ...aiAnalysis.observations[0], level: "CRITICAL" }],
  }).success, false);
});

test("analysis instructions prohibit identity and personality inference", () => {
  const instructions = buildPersonalLedgerAnalysisInstructions();
  assert.match(instructions, /aggregate values/);
  assert.match(instructions, /Do not infer personality/);
  assert.match(instructions, /Use WARNING only/);
  assert.match(instructions, new RegExp(FINANCIAL_ANALYSIS_DISCLAIMER));
});

test("personal ledger analysis sends only aggregate JSON with the analysis feature", async () => {
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

  await analyzePersonalLedgerWithAi({ foundation, userId: 42, aggregate });
  const request = calls[0];
  assert.equal(request.feature, "analysis");
  assert.equal(request.userId, 42);
  assert.equal(request.schemaName, "personal_ledger_financial_analysis");
  const serializedInput = String(request.input);
  assert.deepEqual(JSON.parse(serializedInput), aggregate);
  assert.equal(serializedInput.includes("rawText"), false);
  assert.equal(serializedInput.includes("displayName"), false);
  assert.equal(serializedInput.includes("userId"), false);
  assert.equal(serializedInput.includes("pageId"), false);
});

test("analysis uses gpt-5.4-mini, store:false and strict Responses API output", async () => {
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

  await analyzePersonalLedgerWithAi({ foundation, userId: 1, aggregate });
  const body = calls[0];
  const text = body.text as { format?: { type?: string; strict?: boolean } };
  assert.equal(body.model, "gpt-5.4-mini");
  assert.equal(body.store, false);
  assert.equal("userId" in body, false);
  assert.equal("pageId" in body, false);
  assert.equal(String(body.input).includes("rawText"), false);
  assert.match(String(body.safety_identifier), /^ai_[0-9a-f]+$/);
  assert.equal(text.format?.type, "json_schema");
  assert.equal(text.format?.strict, true);
});

test("WARNING is downgraded when application warning evidence is absent", () => {
  const noWarningAggregate: PersonalLedgerAnalysisAggregate = {
    ...aggregate,
    warningFlags: {
      ...aggregate.warningFlags,
      negativeNet: false,
      expenseIncreaseAtLeast20Percent: false,
      singleExpenseCategoryAtLeast50Percent: false,
      warningReasons: [],
    },
  };
  const normalized = normalizeFinancialAnalysis(aiAnalysis, noWarningAggregate);
  assert.equal(normalized.observations[0].level, "NOTICE");
  assert.equal(normalized.disclaimer, FINANCIAL_ANALYSIS_DISCLAIMER);
  assert.match(normalized.limitations.at(-1) ?? "", /集計値だけ/);
});

test("application automatic summary is clearly not labeled as AI analysis", () => {
  const fallback = buildPersonalLedgerAutomaticSummary(aggregate);
  assert.equal(fallback.source, "AUTOMATIC_SUMMARY");
  assert.match(fallback.sourceLabel, /AI分析ではありません/);
  assert.match(fallback.overview, /期末残高/);
  assert.equal(fallback.observations.some((item) => item.level === "WARNING"), true);
  assert.equal(fallback.disclaimer, FINANCIAL_ANALYSIS_DISCLAIMER);
});
