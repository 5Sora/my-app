import type { AiFoundation } from "./client.js";
import {
  FINANCIAL_ANALYSIS_DISCLAIMER,
  financialAnalysisSchema,
  type FinancialAnalysisDisplay,
  type FinancialAnalysisResult,
} from "./financial-analysis.js";
import type { GroupPaymentAnalysisAggregate } from "../transactions/group-payment-summary.js";

export function buildGroupPaymentAnalysisInstructions(): string {
  return [
    "You explain a Japanese group payment aggregate.",
    "Return only the requested structured output in Japanese.",
    "The input contains aggregate values calculated by the application. Treat them as the only facts available.",
    "Do not claim to have reviewed individual transactions, descriptions, identities, names, members, or participants.",
    "Do not infer who paid more, fairness, unfairness, responsibility, contribution, relationships, payment ability, or economic circumstances.",
    "Do not provide financial, investment, tax, legal, or medical advice.",
    "Use WARNING only when warningFlags.warningReasons contains an application-calculated reason. Otherwise use INFO or NOTICE.",
    "Mention comparison only when period.comparisonAvailable is true and comparison is not null.",
    "Keep observations factual and tied to total amount, transaction count, single payment count, confirmed batch count, average amount, category shares, or period-over-period changes.",
    "A confirmed batch count is the number of distinct payment batches, not the number of participants.",
    `Use this exact disclaimer: ${FINANCIAL_ANALYSIS_DISCLAIMER}`,
  ].join("\n");
}

export async function analyzeGroupPaymentsWithAi(input: {
  foundation: AiFoundation;
  userId: number;
  aggregate: GroupPaymentAnalysisAggregate;
}): Promise<FinancialAnalysisResult> {
  return input.foundation.executeStructured({
    feature: "analysis",
    userId: input.userId,
    schema: financialAnalysisSchema,
    schemaName: "group_payment_financial_analysis",
    instructions: buildGroupPaymentAnalysisInstructions(),
    input: JSON.stringify(input.aggregate),
  });
}

export function buildGroupPaymentAutomaticSummary(
  aggregate: GroupPaymentAnalysisAggregate,
): FinancialAnalysisDisplay {
  const currency = (value: number) => `${value.toLocaleString("ja-JP")}円`;
  const topCategory = aggregate.current.categories[0] ?? null;
  const observations: FinancialAnalysisDisplay["observations"] = [
    {
      title: "関連支払いの集計",
      description: `総額は${currency(aggregate.current.totalAmount)}、Transactionは${aggregate.current.transactionCount}件です。単独支払いは${aggregate.current.singlePaymentCount}件、確定batchは${aggregate.current.confirmedBatchCount}件です。`,
      level: aggregate.warningFlags.noPayments ? "INFO" : "INFO",
    },
    {
      title: "平均Transaction金額",
      description: `1Transactionあたりの平均は${currency(aggregate.current.averageTransactionAmount)}です。`,
      level: "INFO",
    },
  ];

  if (topCategory) {
    observations.push({
      title: "最大のカテゴリ",
      description: `${topCategory.category}が${currency(topCategory.amount)}で、総額の${topCategory.sharePercentage}%です。`,
      level: aggregate.warningFlags.singleCategoryAtLeast50Percent ? "WARNING" : "INFO",
    });
  }

  if (aggregate.comparison) {
    const change = aggregate.comparison.changes.totalAmount;
    const direction = change > 0 ? "増加" : change < 0 ? "減少" : "同額";
    observations.push({
      title: "前期間との総額比較",
      description: `前期間の総額は${currency(aggregate.comparison.summary.totalAmount)}で、現在期間は${direction === "同額" ? "同額" : `${currency(Math.abs(change))}${direction}`}です。`,
      level: aggregate.warningFlags.totalIncreaseAtLeast20Percent
        ? "WARNING"
        : change !== 0
          ? "NOTICE"
          : "INFO",
    });
  }

  const suggestions: FinancialAnalysisDisplay["suggestions"] = [];
  if (topCategory) {
    suggestions.push({
      title: "カテゴリ別集計の確認",
      description: `割合が最も大きい「${topCategory.category}」を確認すると、関連支払いの構成を把握しやすくなります。`,
    });
  }
  if (aggregate.warningFlags.limitedTransactionCount) {
    suggestions.push({
      title: "件数の確認",
      description: "対象期間のTransaction件数が少ないため、傾向ではなく現在の集計値として確認してください。",
    });
  }
  if (suggestions.length === 0) {
    suggestions.push({
      title: "期間別の比較",
      description: "開始日と終了日を設定すると、同日数の前期間と比較できます。",
    });
  }

  return {
    source: "AUTOMATIC_SUMMARY",
    sourceLabel: "自動集計（AI分析ではありません）",
    overview: `${aggregate.period.label}の関連支払い集計です。支払いイベントは${aggregate.current.paymentEventCount}件です。`,
    observations,
    suggestions,
    limitations: [
      "この表示はアプリが計算した集計値であり、AIによる説明ではありません。",
      "個人別支払額、氏名、参加者別割合、公平性は評価していません。",
    ],
    disclaimer: FINANCIAL_ANALYSIS_DISCLAIMER,
  };
}
