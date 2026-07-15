import { createPreviousPeriod } from "./personal-ledger-summary.js";

export type GroupPaymentTransaction = {
  amount: number;
  category: string;
  transactionDate: Date | string;
  paymentBatchId: string | null;
};

export type GroupPaymentPeriod = {
  startDate: Date | string | null;
  endDate: Date | string | null;
};

export type GroupPaymentCategorySummary = {
  category: string;
  amount: number;
  sharePercentage: number;
};

export type GroupPaymentPeriodSummary = {
  totalAmount: number;
  transactionCount: number;
  singlePaymentCount: number;
  confirmedBatchCount: number;
  paymentEventCount: number;
  averageTransactionAmount: number;
  categories: GroupPaymentCategorySummary[];
};

export type GroupPaymentComparison = {
  period: {
    startDate: string;
    endDate: string;
    dayCount: number;
  };
  summary: GroupPaymentPeriodSummary;
  changes: {
    totalAmount: number;
    totalPercentage: number | null;
    transactionCount: number;
    singlePaymentCount: number;
    confirmedBatchCount: number;
    averageTransactionAmount: number;
  };
};

export type GroupPaymentWarningFlags = {
  totalIncreaseAtLeast20Percent: boolean;
  totalIncreasedFromZero: boolean;
  singleCategoryAtLeast50Percent: boolean;
  limitedTransactionCount: boolean;
  noPayments: boolean;
  warningReasons: string[];
};

export type GroupPaymentAnalysisAggregate = {
  period: {
    startDate: string | null;
    endDate: string | null;
    label: string;
    comparisonAvailable: boolean;
  };
  current: GroupPaymentPeriodSummary;
  comparison: GroupPaymentComparison | null;
  warningFlags: GroupPaymentWarningFlags;
};

export function buildGroupPaymentAnalysisAggregate(input: {
  transactions: GroupPaymentTransaction[];
  period: GroupPaymentPeriod;
}): GroupPaymentAnalysisAggregate {
  const startDate = normalizeDateOnly(input.period.startDate);
  const endDate = normalizeDateOnly(input.period.endDate);
  const transactions = input.transactions.map((transaction) => ({
    ...transaction,
    transactionDate: normalizeRequiredDateOnly(transaction.transactionDate),
  }));

  const current = summarizeGroupPayments(
    transactions.filter((transaction) =>
      isWithinPeriod(transaction.transactionDate, startDate, endDate),
    ),
  );
  const previousPeriod = createPreviousPeriod(startDate, endDate);
  const comparison = previousPeriod
    ? buildComparison(transactions, current, previousPeriod)
    : null;
  const warningFlags = calculateGroupPaymentWarningFlags(current, comparison);

  return {
    period: {
      startDate,
      endDate,
      label: formatPeriodLabel(startDate, endDate),
      comparisonAvailable: comparison !== null,
    },
    current,
    comparison,
    warningFlags,
  };
}

export function calculateGroupPaymentWarningFlags(
  current: GroupPaymentPeriodSummary,
  comparison: GroupPaymentComparison | null,
): GroupPaymentWarningFlags {
  const totalIncreaseAtLeast20Percent = Boolean(
    comparison &&
      comparison.summary.totalAmount > 0 &&
      current.totalAmount >= comparison.summary.totalAmount * 1.2,
  );
  const totalIncreasedFromZero = Boolean(
    comparison && comparison.summary.totalAmount === 0 && current.totalAmount > 0,
  );
  const singleCategoryAtLeast50Percent =
    current.totalAmount > 0 && (current.categories[0]?.sharePercentage ?? 0) >= 50;
  const limitedTransactionCount = current.transactionCount > 0 && current.transactionCount < 3;
  const noPayments = current.transactionCount === 0;
  const warningReasons: string[] = [];

  if (totalIncreaseAtLeast20Percent) {
    warningReasons.push("割り勘総額が前期間より20%以上増加しています。");
  }
  if (singleCategoryAtLeast50Percent) {
    warningReasons.push("単一カテゴリが割り勘総額の50%以上です。");
  }

  return {
    totalIncreaseAtLeast20Percent,
    totalIncreasedFromZero,
    singleCategoryAtLeast50Percent,
    limitedTransactionCount,
    noPayments,
    warningReasons,
  };
}

export function summarizeGroupPayments(
  transactions: Array<Omit<GroupPaymentTransaction, "transactionDate"> & { transactionDate: string }>,
): GroupPaymentPeriodSummary {
  const categories = new Map<string, number>();
  const batchIds = new Set<string>();
  let totalAmount = 0;
  let singlePaymentCount = 0;

  for (const transaction of transactions) {
    totalAmount += transaction.amount;
    categories.set(transaction.category, (categories.get(transaction.category) ?? 0) + transaction.amount);
    if (transaction.paymentBatchId) batchIds.add(transaction.paymentBatchId);
    else singlePaymentCount += 1;
  }

  const transactionCount = transactions.length;
  const confirmedBatchCount = batchIds.size;
  return {
    totalAmount,
    transactionCount,
    singlePaymentCount,
    confirmedBatchCount,
    paymentEventCount: singlePaymentCount + confirmedBatchCount,
    averageTransactionAmount:
      transactionCount > 0 ? roundToTwo(totalAmount / transactionCount) : 0,
    categories: [...categories.entries()]
      .map(([category, amount]) => ({
        category,
        amount,
        sharePercentage: totalAmount > 0 ? roundToTwo((amount / totalAmount) * 100) : 0,
      }))
      .sort((left, right) => right.amount - left.amount || left.category.localeCompare(right.category, "ja")),
  };
}

function buildComparison(
  transactions: Array<Omit<GroupPaymentTransaction, "transactionDate"> & { transactionDate: string }>,
  current: GroupPaymentPeriodSummary,
  period: { startDate: string; endDate: string; dayCount: number },
): GroupPaymentComparison {
  const summary = summarizeGroupPayments(
    transactions.filter((transaction) =>
      isWithinPeriod(transaction.transactionDate, period.startDate, period.endDate),
    ),
  );

  return {
    period,
    summary,
    changes: {
      totalAmount: current.totalAmount - summary.totalAmount,
      totalPercentage: percentageChange(current.totalAmount, summary.totalAmount),
      transactionCount: current.transactionCount - summary.transactionCount,
      singlePaymentCount: current.singlePaymentCount - summary.singlePaymentCount,
      confirmedBatchCount: current.confirmedBatchCount - summary.confirmedBatchCount,
      averageTransactionAmount:
        current.averageTransactionAmount - summary.averageTransactionAmount,
    },
  };
}

function isWithinPeriod(
  transactionDate: string,
  startDate: string | null,
  endDate: string | null,
): boolean {
  if (startDate && transactionDate < startDate) return false;
  if (endDate && transactionDate > endDate) return false;
  return true;
}

function formatPeriodLabel(startDate: string | null, endDate: string | null): string {
  if (startDate && endDate) return `${startDate}〜${endDate}`;
  if (startDate) return `${startDate}以降`;
  if (endDate) return `${endDate}以前`;
  return "全期間";
}

function normalizeRequiredDateOnly(value: Date | string): string {
  const normalized = normalizeDateOnly(value);
  if (!normalized) throw new Error("Transaction date is required.");
  return normalized;
}

function normalizeDateOnly(value: Date | string | null): string | null {
  if (value === null) return null;
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) throw new Error("Invalid date.");
    return value.toISOString().slice(0, 10);
  }
  const text = String(value).trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) throw new Error("Invalid date-only value.");
  const parsed = new Date(`${text}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== text) {
    throw new Error("Invalid date-only value.");
  }
  return text;
}

function percentageChange(current: number, previous: number): number | null {
  if (previous === 0) return null;
  return roundToTwo(((current - previous) / previous) * 100);
}

function roundToTwo(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}
