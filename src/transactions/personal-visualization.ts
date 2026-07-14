export type PersonalVisualizationTransactionKind =
  | "PERSONAL_INCOME"
  | "PERSONAL_EXPENSE"
  | "GROUP_PAYMENT"
  | "FUND_CONTRIBUTION"
  | "FUND_REFUND";

export type PersonalVisualizationTransaction = {
  kind: PersonalVisualizationTransactionKind;
  amount: number;
  category: string;
};

export type PersonalCategoryCompositionItem = {
  key: string;
  label: string;
  amount: number;
  percentage: number;
  color: string;
};

export type PersonalVisualization = {
  incomeComposition: PersonalCategoryCompositionItem[];
  expenseComposition: PersonalCategoryCompositionItem[];
  totals: {
    income: number;
    expense: number;
  };
  barScale: {
    incomePercent: number;
    expensePercent: number;
  };
};

const incomePalette = [
  "#2f6f50",
  "#468463",
  "#5b9676",
  "#72a98a",
  "#8ab99f",
  "#a2c9b2",
  "#3e795a",
  "#679f7e",
];

const expensePalette = [
  "#9f3f38",
  "#b55249",
  "#c66a5f",
  "#d68175",
  "#a95a3d",
  "#bf7354",
  "#8d4b46",
  "#cf8f83",
];

const roundToOne = (value: number) => Math.round(value * 10) / 10;

export function buildPersonalVisualization(
  transactions: PersonalVisualizationTransaction[],
): PersonalVisualization {
  const incomeByCategory = new Map<string, number>();
  const expenseByCategory = new Map<string, number>();
  let income = 0;
  let expense = 0;

  for (const transaction of transactions) {
    const category = transaction.category.trim() || "未分類";
    const isIncome =
      transaction.kind === "PERSONAL_INCOME" || transaction.kind === "FUND_REFUND";

    if (isIncome) {
      income += transaction.amount;
      if (transaction.amount > 0) {
        incomeByCategory.set(category, (incomeByCategory.get(category) ?? 0) + transaction.amount);
      }
      continue;
    }

    expense += transaction.amount;
    if (transaction.amount > 0) {
      expenseByCategory.set(category, (expenseByCategory.get(category) ?? 0) + transaction.amount);
    }
  }

  const incomeComposition = buildComposition(incomeByCategory, income, incomePalette, "income");
  const expenseComposition = buildComposition(expenseByCategory, expense, expensePalette, "expense");
  const scaleMax = Math.max(income, expense, 1);

  return {
    incomeComposition,
    expenseComposition,
    totals: { income, expense },
    barScale: {
      incomePercent: roundToOne((income / scaleMax) * 100),
      expensePercent: roundToOne((expense / scaleMax) * 100),
    },
  };
}

function buildComposition(
  categories: Map<string, number>,
  total: number,
  palette: string[],
  prefix: string,
): PersonalCategoryCompositionItem[] {
  const items = [...categories.entries()]
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0], "ja"))
    .map(([label, amount], index) => ({
      key: `${prefix}-${label}`,
      label,
      amount,
      percentage: total > 0 ? roundToOne((amount / total) * 100) : 0,
      color: palette[index % palette.length],
    }));

  if (total > 0 && items.length > 0) {
    const lastItem = items[items.length - 1];
    const preceding = items.slice(0, -1).reduce((sum, item) => sum + item.percentage, 0);
    lastItem.percentage = roundToOne(Math.max(0, 100 - preceding));
  }

  return items;
}
