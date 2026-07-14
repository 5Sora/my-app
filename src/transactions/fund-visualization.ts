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

type FundCompositionBaseItem = {
  key: string;
  label: string;
  amount: number;
  percentage: number;
  color: string;
};

export type FundIncomeCompositionItem = FundCompositionBaseItem & {
  sourceType: "INTERNAL" | "EXTERNAL";
  sourceTypeLabel: "内部拠出" | "外部収入";
};

export type FundExpenseCompositionItem = FundCompositionBaseItem & {
  sourceType: "FUND_EXPENSE" | "REFUND";
  sourceTypeLabel: "基金支出" | "基金返金";
};

export type FundVisualization = {
  incomeComposition: FundIncomeCompositionItem[];
  expenseComposition: FundExpenseCompositionItem[];
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

const expenseRedPalette = [
  "#a54a43",
  "#b45d55",
  "#8f3f39",
  "#c16d64",
  "#7f3733",
  "#cc8178",
  "#9d5952",
  "#d2958e",
];

const refundAmberPalette = [
  "#9a6a25",
  "#ad7a31",
  "#80561f",
  "#bd8b42",
  "#70491b",
  "#c99b59",
  "#8e642d",
  "#d3ab70",
];

const roundToOne = (value: number) => Math.round(value * 10) / 10;

const normalizePercentages = <T extends FundCompositionBaseItem>(
  items: T[],
  total: number,
): T[] => {
  if (total <= 0 || items.length === 0) return items;

  const lastItem = items[items.length - 1];
  const precedingPercentage = items
    .slice(0, -1)
    .reduce((sum, item) => sum + item.percentage, 0);
  lastItem.percentage = roundToOne(Math.max(0, 100 - precedingPercentage));
  return items;
};

export function buildFundVisualization(
  transactions: FundVisualizationTransaction[],
): FundVisualization {
  const internalByUser = new Map<number | "unknown", { label: string; amount: number }>();
  const externalByCategory = new Map<string, number>();
  const expenseByCategory = new Map<string, number>();
  const refundByRecipient = new Map<number | "external", { label: string; amount: number }>();
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
      const category = transaction.category.trim() || "基金支出・その他／不明";
      expenseByCategory.set(category, (expenseByCategory.get(category) ?? 0) + transaction.amount);
      continue;
    }

    refund += transaction.amount;
    const key = transaction.userId ?? "external";
    const label = transaction.user?.displayName
      ? `${transaction.user.displayName}への返金`
      : "外部・不明な返金";
    const current = refundByRecipient.get(key) ?? { label, amount: 0 };
    current.amount += transaction.amount;
    refundByRecipient.set(key, current);
  }

  const income = internalContribution + externalIncome;
  const expense = fundExpense + refund;
  const incomeComposition: FundIncomeCompositionItem[] = [];
  const expenseComposition: FundExpenseCompositionItem[] = [];

  [...internalByUser.entries()]
    .sort((left, right) => right[1].amount - left[1].amount || String(left[0]).localeCompare(String(right[0])))
    .forEach(([userId, value], index) => {
      incomeComposition.push({
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
      incomeComposition.push({
        key: `external-${category}`,
        label: category,
        sourceType: "EXTERNAL",
        sourceTypeLabel: "外部収入",
        amount,
        percentage: income > 0 ? roundToOne((amount / income) * 100) : 0,
        color: externalBluePalette[index % externalBluePalette.length],
      });
    });

  [...expenseByCategory.entries()]
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0], "ja"))
    .forEach(([category, amount], index) => {
      expenseComposition.push({
        key: `expense-${category}`,
        label: category,
        sourceType: "FUND_EXPENSE",
        sourceTypeLabel: "基金支出",
        amount,
        percentage: expense > 0 ? roundToOne((amount / expense) * 100) : 0,
        color: expenseRedPalette[index % expenseRedPalette.length],
      });
    });

  [...refundByRecipient.entries()]
    .sort((left, right) => right[1].amount - left[1].amount || String(left[0]).localeCompare(String(right[0])))
    .forEach(([recipientKey, value], index) => {
      expenseComposition.push({
        key: `refund-${recipientKey}`,
        label: value.label,
        sourceType: "REFUND",
        sourceTypeLabel: "基金返金",
        amount: value.amount,
        percentage: expense > 0 ? roundToOne((value.amount / expense) * 100) : 0,
        color: refundAmberPalette[index % refundAmberPalette.length],
      });
    });

  normalizePercentages(incomeComposition, income);
  normalizePercentages(expenseComposition, expense);

  const scaleMax = Math.max(income, expense, 1);

  return {
    incomeComposition,
    expenseComposition,
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
