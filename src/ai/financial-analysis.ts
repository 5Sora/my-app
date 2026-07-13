import { z } from "zod";
import type { AiFoundation, AiStructuredResult } from "./client.js";
import type { PersonalLedgerAnalysisAggregate } from "../transactions/personal-ledger-summary.js";

export const ANALYSIS_LEVEL_VALUES = ["INFO", "NOTICE", "WARNING"] as const;
export const FINANCIAL_ANALYSIS_DISCLAIMER =
  "AIによる参考情報であり、金融・投資・税務上の助言ではありません。";

const observationSchema = z
  .object({
    title: z.string().trim().min(1).max(80),
    description: z.string().trim().min(1).max(300),
    level: z.enum(ANALYSIS_LEVEL_VALUES),
  })
  .strict();

const suggestionSchema = z
  .object({
    title: z.string().trim().min(1).max(80),
    description: z.string().trim().min(1).max(300),
  })
  .strict();

export const financialAnalysisSchema = z
  .object({
    overview: z.string().trim().min(1).max(500),
    observations: z.array(observationSchema).max(6),
    suggestions: z.array(suggestionSchema).max(5),
    limitations: z.array(z.string().trim().min(1).max(200)).max(5),
    disclaimer: z.string().trim().min(1).max(200),
  })
  .strict();

export type FinancialAnalysis = z.infer<typeof financialAnalysisSchema>;
export type FinancialAnalysisResult = AiStructuredResult<FinancialAnalysis>;
export type FinancialAnalysisDisplay = FinancialAnalysis & {
  source: "AI" | "AUTOMATIC_SUMMARY";
  sourceLabel: string;
};

export function buildPersonalLedgerAnalysisInstructions(): string {
  return [
    "You explain a Japanese personal bookkeeping aggregate.",
    "Return only the requested structured output in Japanese.",
    "The input contains aggregate values calculated by the application. Treat them as the only facts available.",
    "Do not claim to have reviewed individual transactions, descriptions, identities, names, groups, families, or lifestyles.",
    "Do not infer personality, wastefulness, responsibility, living standards, family circumstances, or financial hardship.",
    "Do not provide financial, investment, tax, legal, or medical advice.",
    "Use WARNING only when warningFlags.warningReasons contains an application-calculated reason. Otherwise use INFO or NOTICE.",
    "Mention comparison only when period.comparisonAvailable is true and comparison is not null.",
    "Keep observations factual and tied to totals, counts, category shares, or period-over-period changes.",
    `Use this exact disclaimer: ${FINANCIAL_ANALYSIS_DISCLAIMER}`,
  ].join("\n");
}

export async function analyzePersonalLedgerWithAi(input: {
  foundation: AiFoundation;
  userId: number;
  aggregate: PersonalLedgerAnalysisAggregate;
}): Promise<FinancialAnalysisResult> {
  return input.foundation.executeStructured({
    feature: "analysis",
    userId: input.userId,
    fallbackOnError: true,
    schema: financialAnalysisSchema,
    schemaName: "personal_ledger_financial_analysis",
    instructions: buildPersonalLedgerAnalysisInstructions(),
    input: JSON.stringify(input.aggregate),
  });
}

export function normalizeFinancialAnalysis(
  analysis: FinancialAnalysis,
  aggregate: { warningFlags: { warningReasons: string[] } },
): FinancialAnalysisDisplay {
  const warningAllowed = aggregate.warningFlags.warningReasons.length > 0;
  const limitations = uniqueStrings([
    "この分析は集計値だけを使用しており、個別取引の事情は考慮していません。",
    ...analysis.limitations,
  ]).slice(0, 5);

  return {
    source: "AI",
    sourceLabel: "AI分析",
    overview: analysis.overview,
    observations: analysis.observations.map((observation) => ({
      ...observation,
      level:
        observation.level === "WARNING" && !warningAllowed
          ? ("NOTICE" as const)
          : observation.level,
    })),
    suggestions: analysis.suggestions,
    limitations,
    disclaimer: FINANCIAL_ANALYSIS_DISCLAIMER,
  };
}

export function buildPersonalLedgerAutomaticSummary(
  aggregate: PersonalLedgerAnalysisAggregate,
): FinancialAnalysisDisplay {
  const currency = (value: number) => `${value.toLocaleString("ja-JP")}円`;
  const observations: FinancialAnalysis["observations"] = [];
  const suggestions: FinancialAnalysis["suggestions"] = [];
  const topExpense = aggregate.current.expenseCategories[0] ?? null;

  observations.push({
    title: "期間内収支",
    description: `収入は${currency(aggregate.current.incomeTotal)}、支出は${currency(aggregate.current.expenseTotal)}、期間内収支は${currency(aggregate.current.net)}です。`,
    level: aggregate.warningFlags.negativeNet ? "WARNING" : "INFO",
  });

  if (topExpense) {
    observations.push({
      title: "最大の支出カテゴリ",
      description: `${topExpense.category}が${currency(topExpense.amount)}で、支出全体の${topExpense.sharePercentage}%です。`,
      level: aggregate.warningFlags.singleExpenseCategoryAtLeast50Percent
        ? "WARNING"
        : "INFO",
    });
  }

  if (aggregate.comparison) {
    const change = aggregate.comparison.changes.expenseAmount;
    const direction = change > 0 ? "増加" : change < 0 ? "減少" : "同額";
    observations.push({
      title: "前期間との支出比較",
      description: `前期間の支出は${currency(aggregate.comparison.summary.expenseTotal)}で、現在期間は${currency(Math.abs(change))}${direction === "同額" ? "の差がなく同額" : `${direction}`}です。`,
      level: aggregate.warningFlags.expenseIncreaseAtLeast20Percent
        ? "WARNING"
        : change !== 0
          ? "NOTICE"
          : "INFO",
    });
  }

  observations.push({
    title: "連動取引",
    description: `グループ関連支出は${currency(aggregate.current.groupPaymentTotal)}、基金拠出は${currency(aggregate.current.fundContributionTotal)}です。`,
    level: "INFO",
  });

  if (aggregate.warningFlags.limitedTransactionCount) {
    suggestions.push({
      title: "データ件数の確認",
      description: "対象期間の取引件数が少ないため、傾向ではなく現在の集計値として確認してください。",
    });
  }
  if (topExpense) {
    suggestions.push({
      title: "カテゴリ別内訳の確認",
      description: `支出割合が最も大きい「${topExpense.category}」の内訳を確認すると、期間の変化を把握しやすくなります。`,
    });
  }
  if (suggestions.length === 0) {
    suggestions.push({
      title: "期間別の比較",
      description: "必要に応じて開始日と終了日を設定すると、同日数の前期間と比較できます。",
    });
  }

  return {
    source: "AUTOMATIC_SUMMARY",
    sourceLabel: "自動集計（AI分析ではありません）",
    overview: `${aggregate.period.label}の集計です。期末残高は${currency(aggregate.current.closingBalance)}です。`,
    observations,
    suggestions,
    limitations: [
      "この表示はアプリが計算した集計値であり、AIによる説明ではありません。",
      "個別取引の背景や事情は評価していません。",
    ],
    disclaimer: FINANCIAL_ANALYSIS_DISCLAIMER,
  };
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}
