import type { AiFoundation } from "./client.js";
import {
  FINANCIAL_ANALYSIS_DISCLAIMER,
  financialAnalysisSchema,
  type FinancialAnalysis,
  type FinancialAnalysisDisplay,
  type FinancialAnalysisResult,
} from "./financial-analysis.js";
import type { GroupFundAnalysisAggregate } from "../transactions/group-fund-summary.js";

export function buildGroupFundAnalysisInstructions(): string {
  return [
    "You explain a Japanese group fund aggregate.",
    "Return only the requested structured output in Japanese.",
    "The input contains aggregate values calculated by the application. Treat them as the only facts available.",
    "Member identifiers such as MEMBER_1 are temporary aliases. You may use only aliases present in the input.",
    "Do not mention aliases, pseudonyms, member keys, anonymization, or the identity-protection mechanism in the output.",
    "Do not claim to know identities, names, user IDs, transaction descriptions, relationships, or private circumstances.",
    "Do not infer responsibility, motivation, insufficient contribution, fairness, unfairness, payment ability, economic circumstances, personality, or relationships.",
    "Do not urge, shame, rank, or blame members. Describe contribution concentration only as an aggregate structure.",
    "Do not provide financial, investment, tax, legal, or medical advice.",
    "Use WARNING only when warningFlags.warningReasons contains an application-calculated reason. Otherwise use INFO or NOTICE.",
    "Mention comparison only when period.comparisonAvailable is true and comparison is not null.",
    "Keep observations factual and tied to balance, internal contributions, external income, refunds, fund expenses, contributor counts, contribution shares, expense category shares, or period-over-period changes.",
    `Use this exact disclaimer: ${FINANCIAL_ANALYSIS_DISCLAIMER}`,
  ].join("\n");
}


export type GroupFundFixedMetric = {
  label: string;
  value: string;
};

export function buildGroupFundFixedMetrics(
  aggregate: GroupFundAnalysisAggregate,
): GroupFundFixedMetric[] {
  const percentage = (value: number | null): string =>
    value === null ? "算出不可" : `${value}%`;

  return [
    { label: "拠出者数", value: `${aggregate.current.contributorCount}名` },
    { label: "有効メンバー数", value: `${aggregate.current.activeMemberCount}名` },
    {
      label: "内部拠出依存率",
      value: percentage(aggregate.current.internalContributionDependencyPercentage),
    },
    {
      label: "最大拠出割合",
      value: `${aggregate.current.maxContributorSharePercentage}%`,
    },
    {
      label: "上位3名割合",
      value: `${aggregate.current.topThreeContributorSharePercentage}%`,
    },
  ];
}

export async function analyzeGroupFundWithAi(input: {
  foundation: AiFoundation;
  userId: number;
  aggregate: GroupFundAnalysisAggregate;
}): Promise<FinancialAnalysisResult> {
  return input.foundation.executeStructured({
    feature: "analysis",
    userId: input.userId,
    fallbackOnError: true,
    schema: financialAnalysisSchema,
    schemaName: "group_fund_financial_analysis",
    instructions: buildGroupFundAnalysisInstructions(),
    input: JSON.stringify(input.aggregate),
  });
}

export function replaceFundMemberKeysInAnalysis(
  analysis: FinancialAnalysisDisplay,
  memberNamesByKey: ReadonlyMap<string, string>,
): FinancialAnalysisDisplay {
  const replace = (value: string): string =>
    value.replace(/MEMBER_[A-Z0-9]+/g, (memberKey) => memberNamesByKey.get(memberKey) ?? "匿名メンバー");

  return {
    ...analysis,
    overview: replace(analysis.overview),
    observations: analysis.observations.map((observation) => ({
      ...observation,
      title: replace(observation.title),
      description: replace(observation.description),
    })),
    suggestions: analysis.suggestions.map((suggestion) => ({
      title: replace(suggestion.title),
      description: replace(suggestion.description),
    })),
    limitations: analysis.limitations.map(replace),
    disclaimer: replace(analysis.disclaimer),
  };
}

export function buildGroupFundAutomaticSummary(
  aggregate: GroupFundAnalysisAggregate,
  memberNamesByKey: ReadonlyMap<string, string>,
): FinancialAnalysisDisplay {
  const currency = (value: number) => `${value.toLocaleString("ja-JP")}円`;
  const percentage = (value: number | null) => value === null ? "算出不可" : `${value}%`;
  const topExpense = aggregate.current.expenseCategories[0] ?? null;
  const topContributor = aggregate.current.memberContributions[0] ?? null;
  const observations: FinancialAnalysis["observations"] = [
    {
      title: "基金収支",
      description: `基金収入は${currency(aggregate.current.incomeTotal)}、基金支出は${currency(aggregate.current.expenseTotal)}、期間内増減は${currency(aggregate.current.net)}、期末残高は${currency(aggregate.current.closingBalance)}です。`,
      level: aggregate.warningFlags.negativeNet ? "WARNING" : "INFO",
    },
    {
      title: "収入構造",
      description: `内部拠出は${currency(aggregate.current.internalContributionTotal)}、外部収入は${currency(aggregate.current.externalIncomeTotal)}、内部拠出依存率は${percentage(aggregate.current.internalContributionDependencyPercentage)}です。`,
      level: aggregate.warningFlags.internalContributionDependencyAtLeast80Percent ? "WARNING" : "INFO",
    },
    {
      title: "拠出構造",
      description: `拠出者は${aggregate.current.contributorCount}名、有効メンバーは${aggregate.current.activeMemberCount}名です。最大拠出割合は${aggregate.current.maxContributorSharePercentage}%、上位3名の合計割合は${aggregate.current.topThreeContributorSharePercentage}%です。`,
      level:
        aggregate.warningFlags.maxContributorShareAtLeast50Percent ||
        aggregate.warningFlags.topThreeContributorShareAtLeast80Percent
          ? "WARNING"
          : "INFO",
    },
  ];

  if (topContributor) {
    observations.push({
      title: "最大拠出額",
      description: `${memberNamesByKey.get(topContributor.memberKey) ?? "匿名メンバー"}の期間内拠出は${currency(topContributor.amount)}、${topContributor.count}回、内部拠出全体の${topContributor.sharePercentage}%です。`,
      level: aggregate.warningFlags.maxContributorShareAtLeast50Percent ? "WARNING" : "INFO",
    });
  }
  if (topExpense) {
    observations.push({
      title: "最大の基金支出カテゴリ",
      description: `${topExpense.category}が${currency(topExpense.amount)}で、基金支出の${topExpense.sharePercentage}%です。`,
      level: aggregate.warningFlags.singleExpenseCategoryAtLeast50Percent ? "WARNING" : "INFO",
    });
  }
  if (aggregate.comparison) {
    const change = aggregate.comparison.changes.expenseAmount;
    const direction = change > 0 ? "増加" : change < 0 ? "減少" : "同額";
    observations.push({
      title: "前期間との基金支出比較",
      description: `前期間の基金支出は${currency(aggregate.comparison.summary.expenseTotal)}で、現在期間は${direction === "同額" ? "同額" : `${currency(Math.abs(change))}${direction}`}です。`,
      level: aggregate.warningFlags.expenseIncreaseAtLeast20Percent
        ? "WARNING"
        : change !== 0
          ? "NOTICE"
          : "INFO",
    });
  }

  const suggestions: FinancialAnalysis["suggestions"] = [];
  if (topExpense) {
    suggestions.push({
      title: "支出カテゴリの確認",
      description: `割合が最も大きい「${topExpense.category}」を確認すると、基金支出の構成を把握しやすくなります。`,
    });
  }
  if (aggregate.current.internalContributionDependencyPercentage !== null) {
    suggestions.push({
      title: "収入構成の継続確認",
      description: "内部拠出と外部収入を分けて期間ごとに確認すると、基金収入の構成変化を把握しやすくなります。",
    });
  }
  if (suggestions.length === 0) {
    suggestions.push({
      title: "期間別の比較",
      description: "開始日と終了日を設定すると、直前の同日数期間と比較できます。",
    });
  }

  return {
    source: "AUTOMATIC_SUMMARY",
    sourceLabel: "自動集計（AI分析ではありません）",
    overview: `${aggregate.period.label}の基金集計です。繰越金は${currency(aggregate.current.carryover)}、期末残高は${currency(aggregate.current.closingBalance)}です。`,
    observations,
    suggestions,
    limitations: [
      "この表示はアプリが計算した集計値であり、AIによる説明ではありません。",
      "拠出額や割合は集計事実のみを示し、責任感、公平性、経済状態、貢献度を評価していません。",
    ],
    disclaimer: FINANCIAL_ANALYSIS_DISCLAIMER,
  };
}
