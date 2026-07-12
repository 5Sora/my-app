export const PERSONAL_LEDGER_TRANSACTION_KINDS = [
  "PERSONAL_INCOME",
  "PERSONAL_EXPENSE",
  "GROUP_PAYMENT",
  "FUND_CONTRIBUTION",
  "FUND_REFUND",
] as const;

export type PersonalLedgerTransactionKind =
  (typeof PERSONAL_LEDGER_TRANSACTION_KINDS)[number];

export type PersonalLedgerTransaction = {
  kind: PersonalLedgerTransactionKind;
  amount: number;
  category: string;
  transactionDate: Date | string;
};

export type PersonalLedgerPeriod = {
  startDate: Date | string | null;
  endDate: Date | string | null;
};

export type CategorySummary = {
  category: string;
  amount: number;
  sharePercentage: number;
};

export type PersonalLedgerPeriodSummary = {
  incomeTotal: number;
  expenseTotal: number;
  net: number;
  incomeCount: number;
  expenseCount: number;
  transactionCount: number;
  incomeCategories: CategorySummary[];
  expenseCategories: CategorySummary[];
  groupPaymentTotal: number;
  fundContributionTotal: number;
};

export type PersonalLedgerComparison = {
  period: {
    startDate: string;
    endDate: string;
    dayCount: number;
  };
  summary: PersonalLedgerPeriodSummary;
  changes: {
    incomeAmount: number;
    expenseAmount: number;
    netAmount: number;
    incomePercentage: number | null;
    expensePercentage: number | null;
  };
};

export type PersonalLedgerWarningFlags = {
  negativeNet: boolean;
  expenseIncreaseAtLeast20Percent: boolean;
  expenseIncreasedFromZero: boolean;
  singleExpenseCategoryAtLeast50Percent: boolean;
  limitedTransactionCount: boolean;
  warningReasons: string[];
};

export type PersonalLedgerAnalysisAggregate = {
  period: {
    startDate: string | null;
    endDate: string | null;
    label: string;
    comparisonAvailable: boolean;
  };
  current: PersonalLedgerPeriodSummary & {
    carryover: number;
    closingBalance: number;
  };
  comparison: PersonalLedgerComparison | null;
  warningFlags: PersonalLedgerWarningFlags;
};

const DAY_MS = 24 * 60 * 60 * 1000;

export function buildPersonalLedgerAnalysisAggregate(input: {
  transactions: PersonalLedgerTransaction[];
  period: PersonalLedgerPeriod;
}): PersonalLedgerAnalysisAggregate {
  const startDate = normalizeDateOnly(input.period.startDate);
  const endDate = normalizeDateOnly(input.period.endDate);
  const normalizedTransactions = input.transactions.map((transaction) => ({
    ...transaction,
    transactionDate: normalizeRequiredDateOnly(transaction.transactionDate),
  }));

  const currentTransactions = normalizedTransactions.filter((transaction) =>
    isWithinPeriod(transaction.transactionDate, startDate, endDate),
  );
  const carryover = startDate
    ? normalizedTransactions
        .filter((transaction) => transaction.transactionDate < startDate)
        .reduce((sum, transaction) => sum + signedAmount(transaction), 0)
    : 0;
  const current = summarizeTransactions(currentTransactions);
  const comparisonPeriod = createPreviousPeriod(startDate, endDate);
  const comparison = comparisonPeriod
    ? buildComparison(normalizedTransactions, current, comparisonPeriod)
    : null;
  const warningFlags = calculatePersonalLedgerWarningFlags(current, comparison);

  return {
    period: {
      startDate,
      endDate,
      label: formatPeriodLabel(startDate, endDate),
      comparisonAvailable: comparison !== null,
    },
    current: {
      ...current,
      carryover,
      closingBalance: carryover + current.net,
    },
    comparison,
    warningFlags,
  };
}

export function createPreviousPeriod(
  startDateInput: Date | string | null,
  endDateInput: Date | string | null,
): { startDate: string; endDate: string; dayCount: number } | null {
  const startDate = normalizeDateOnly(startDateInput);
  const endDate = normalizeDateOnly(endDateInput);
  if (!startDate || !endDate) return null;

  const start = parseDateOnlyUtc(startDate);
  const end = parseDateOnlyUtc(endDate);
  if (start > end) return null;

  const dayCount = Math.floor((end.getTime() - start.getTime()) / DAY_MS) + 1;
  const comparisonEnd = new Date(start.getTime() - DAY_MS);
  const comparisonStart = new Date(comparisonEnd.getTime() - (dayCount - 1) * DAY_MS);
  return {
    startDate: toDateOnly(comparisonStart),
    endDate: toDateOnly(comparisonEnd),
    dayCount,
  };
}

export function calculatePersonalLedgerWarningFlags(
  current: PersonalLedgerPeriodSummary,
  comparison: PersonalLedgerComparison | null,
): PersonalLedgerWarningFlags {
  const topExpenseShare = current.expenseCategories[0]?.sharePercentage ?? 0;
  const negativeNet = current.net < 0;
  const expenseIncreaseAtLeast20Percent = Boolean(
    comparison &&
      comparison.summary.expenseTotal > 0 &&
      current.expenseTotal >= comparison.summary.expenseTotal * 1.2,
  );
  const expenseIncreasedFromZero = Boolean(
    comparison &&
      comparison.summary.expenseTotal === 0 &&
      current.expenseTotal > 0,
  );
  const singleExpenseCategoryAtLeast50Percent =
    current.expenseTotal > 0 && topExpenseShare >= 50;
  const limitedTransactionCount = current.transactionCount < 3;

  const warningReasons: string[] = [];
  if (negativeNet) warningReasons.push("期間内収支が赤字です。");
  if (expenseIncreaseAtLeast20Percent) {
    warningReasons.push("支出が前期間より20%以上増加しています。");
  }
  if (singleExpenseCategoryAtLeast50Percent) {
    warningReasons.push("単一の支出カテゴリが支出全体の50%以上です。");
  }

  return {
    negativeNet,
    expenseIncreaseAtLeast20Percent,
    expenseIncreasedFromZero,
    singleExpenseCategoryAtLeast50Percent,
    limitedTransactionCount,
    warningReasons,
  };
}

export function hasWarningEvidence(flags: PersonalLedgerWarningFlags): boolean {
  return (
    flags.negativeNet ||
    flags.expenseIncreaseAtLeast20Percent ||
    flags.singleExpenseCategoryAtLeast50Percent
  );
}

function buildComparison(
  transactions: Array<Omit<PersonalLedgerTransaction, "transactionDate"> & { transactionDate: string }>,
  current: PersonalLedgerPeriodSummary,
  period: { startDate: string; endDate: string; dayCount: number },
): PersonalLedgerComparison {
  const summary = summarizeTransactions(
    transactions.filter((transaction) =>
      isWithinPeriod(transaction.transactionDate, period.startDate, period.endDate),
    ),
  );
  return {
    period,
    summary,
    changes: {
      incomeAmount: current.incomeTotal - summary.incomeTotal,
      expenseAmount: current.expenseTotal - summary.expenseTotal,
      netAmount: current.net - summary.net,
      incomePercentage: percentageChange(current.incomeTotal, summary.incomeTotal),
      expensePercentage: percentageChange(current.expenseTotal, summary.expenseTotal),
    },
  };
}

function summarizeTransactions(
  transactions: Array<Omit<PersonalLedgerTransaction, "transactionDate"> & { transactionDate: string }>,
): PersonalLedgerPeriodSummary {
  let incomeTotal = 0;
  let expenseTotal = 0;
  let incomeCount = 0;
  let expenseCount = 0;
  let groupPaymentTotal = 0;
  let fundContributionTotal = 0;
  const incomeCategories = new Map<string, number>();
  const expenseCategories = new Map<string, number>();

  for (const transaction of transactions) {
    if (isIncomeKind(transaction.kind)) {
      incomeTotal += transaction.amount;
      incomeCount += 1;
      incrementCategory(incomeCategories, transaction.category, transaction.amount);
    } else {
      expenseTotal += transaction.amount;
      expenseCount += 1;
      incrementCategory(expenseCategories, transaction.category, transaction.amount);
    }
    if (transaction.kind === "GROUP_PAYMENT") {
      groupPaymentTotal += transaction.amount;
    }
    if (transaction.kind === "FUND_CONTRIBUTION") {
      fundContributionTotal += transaction.amount;
    }
  }

  return {
    incomeTotal,
    expenseTotal,
    net: incomeTotal - expenseTotal,
    incomeCount,
    expenseCount,
    transactionCount: transactions.length,
    incomeCategories: toCategorySummaries(incomeCategories, incomeTotal),
    expenseCategories: toCategorySummaries(expenseCategories, expenseTotal),
    groupPaymentTotal,
    fundContributionTotal,
  };
}

function incrementCategory(map: Map<string, number>, category: string, amount: number): void {
  map.set(category, (map.get(category) ?? 0) + amount);
}

function toCategorySummaries(map: Map<string, number>, total: number): CategorySummary[] {
  return [...map.entries()]
    .map(([category, amount]) => ({
      category,
      amount,
      sharePercentage: total > 0 ? roundToTwo((amount / total) * 100) : 0,
    }))
    .sort((left, right) => right.amount - left.amount || left.category.localeCompare(right.category, "ja"));
}

function signedAmount(transaction: PersonalLedgerTransaction): number {
  return isIncomeKind(transaction.kind) ? transaction.amount : -transaction.amount;
}

function isIncomeKind(kind: PersonalLedgerTransactionKind): boolean {
  return kind === "PERSONAL_INCOME" || kind === "FUND_REFUND";
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

function percentageChange(current: number, previous: number): number | null {
  if (previous === 0) return null;
  return roundToTwo(((current - previous) / previous) * 100);
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
  const parsed = parseDateOnlyUtc(text);
  if (toDateOnly(parsed) !== text) throw new Error("Invalid date-only value.");
  return text;
}

function parseDateOnlyUtc(value: string): Date {
  return new Date(`${value}T00:00:00.000Z`);
}

function toDateOnly(value: Date): string {
  return value.toISOString().slice(0, 10);
}

function roundToTwo(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}
