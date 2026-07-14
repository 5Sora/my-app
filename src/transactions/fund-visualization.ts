export type FundVisualizationTransactionKind =
  | "FUND_CONTRIBUTION"
  | "FUND_INCOME"
  | "FUND_EXPENSE"
  | "FUND_REFUND";

export type FundVisualizationTransaction = {
  kind: FundVisualizationTransactionKind;
  amount: number;
  category: string;
  userId: number | null;
  user?: {
    displayName: string;
  } | null;
};

export type FundIncomeCompositionItem = {
  key: string;
  label: string;
  sourceType: "INTERNAL" | "EXTERNAL";
  sourceTypeLabel: "内部拠出" | "外部収入";
  amount: number;
  percentage: number;
  color: string;
};

export type FundVisualization = {
  incomeComposition: FundIncomeCompositionItem[];
  totals: {
    internalContribution: number;
    externalIncome: number;
    income: number;
    fundExpense: number;
    refund: number;
    expense: number;
  };
  barScale: {
    incomePercent: number;
    expensePercent: number;
    internalSharePercent: number;
    externalSharePercent: number;
  };
};

const internalGreenPalette = [
  "#7fae78",
  "#91bb87",
  "#6c9b68",
  "#a6c89a",
  "#5f8b5c",
  "#b5d2aa",
  "#789f71",
  "#c1dab7",
];

const externalBluePalette = [
  "#245a8d",
  "#2e6da4",
  "#1f4f7a",
  "#3a78ae",
  "#315f86",
  "#447faf",
  "#254a6b",
  "#527fa5",
];

const roundToOne = (value: number) => Math.round(value * 10) / 10;

export function buildFundVisualization(
  transactions: FundVisualizationTransaction[],
): FundVisualization {
  const internalByUser = new Map<number | "unknown", { label: string; amount: number }>();
  const externalByCategory = new Map<string, number>();
  let internalContribution = 0;
  let externalIncome = 0;
  let fundExpense = 0;
  let refund = 0;

  for (const transaction of transactions) {
    if (transaction.kind === "FUND_CONTRIBUTION") {
      internalContribution += transaction.amount;
      const key = transaction.userId ?? "unknown";
      const label = transaction.user?.displayName
        ? `${transaction.user.displayName}の拠出`
        : "退会済み・不明メンバーの拠出";
      const current = internalByUser.get(key) ?? { label, amount: 0 };
      current.amount += transaction.amount;
      internalByUser.set(key, current);
      continue;
    }

    if (transaction.kind === "FUND_INCOME") {
      externalIncome += transaction.amount;
      const category = transaction.category.trim() || "外部収入・その他／不明";
      externalByCategory.set(category, (externalByCategory.get(category) ?? 0) + transaction.amount);
      continue;
    }

    if (transaction.kind === "FUND_EXPENSE") {
      fundExpense += transaction.amount;
      continue;
    }

    refund += transaction.amount;
  }

  const income = internalContribution + externalIncome;
  const expense = fundExpense + refund;
  const composition: FundIncomeCompositionItem[] = [];

  [...internalByUser.entries()]
    .sort((left, right) => right[1].amount - left[1].amount || String(left[0]).localeCompare(String(right[0])))
    .forEach(([userId, value], index) => {
      composition.push({
        key: `internal-${userId}`,
        label: value.label,
        sourceType: "INTERNAL",
        sourceTypeLabel: "内部拠出",
        amount: value.amount,
        percentage: income > 0 ? roundToOne((value.amount / income) * 100) : 0,
        color: internalGreenPalette[index % internalGreenPalette.length],
      });
    });

  [...externalByCategory.entries()]
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0], "ja"))
    .forEach(([category, amount], index) => {
      composition.push({
        key: `external-${category}`,
        label: category,
        sourceType: "EXTERNAL",
        sourceTypeLabel: "外部収入",
        amount,
        percentage: income > 0 ? roundToOne((amount / income) * 100) : 0,
        color: externalBluePalette[index % externalBluePalette.length],
      });
    });

  if (income > 0 && composition.length > 0) {
    const lastItem = composition[composition.length - 1];
    const precedingPercentage = composition
      .slice(0, -1)
      .reduce((sum, item) => sum + item.percentage, 0);
    lastItem.percentage = roundToOne(Math.max(0, 100 - precedingPercentage));
  }

  const scaleMax = Math.max(income, expense, 1);

  return {
    incomeComposition: composition,
    totals: {
      internalContribution,
      externalIncome,
      income,
      fundExpense,
      refund,
      expense,
    },
    barScale: {
      incomePercent: roundToOne((income / scaleMax) * 100),
      expensePercent: roundToOne((expense / scaleMax) * 100),
      internalSharePercent: income > 0 ? roundToOne((internalContribution / income) * 100) : 0,
      externalSharePercent: income > 0 ? roundToOne((externalIncome / income) * 100) : 0,
    },
  };
}
