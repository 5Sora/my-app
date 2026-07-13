import { createPreviousPeriod } from "./personal-ledger-summary.js";

export const GROUP_FUND_TRANSACTION_KINDS = [
  "FUND_CONTRIBUTION",
  "FUND_INCOME",
  "FUND_EXPENSE",
  "FUND_REFUND",
] as const;

export type GroupFundTransactionKind = (typeof GROUP_FUND_TRANSACTION_KINDS)[number];

export type GroupFundTransaction = {
  kind: GroupFundTransactionKind;
  amount: number;
  category: string;
  transactionDate: Date | string;
  userId: number | null;
};

export type GroupFundMember = {
  userId: number;
  displayName: string;
};

export type GroupFundPeriod = {
  startDate: Date | string | null;
  endDate: Date | string | null;
};

export type GroupFundCategorySummary = {
  category: string;
  amount: number;
  sharePercentage: number;
};

export type GroupFundMemberContribution = {
  memberKey: string;
  amount: number;
  count: number;
  sharePercentage: number;
};

export type GroupFundPeriodSummary = {
  incomeTotal: number;
  expenseTotal: number;
  net: number;
  transactionCount: number;
  internalContributionTotal: number;
  externalIncomeTotal: number;
  refundTotal: number;
  fundExpenseTotal: number;
  internalContributionDependencyPercentage: number | null;
  contributorCount: number;
  activeMemberCount: number;
  memberContributions: GroupFundMemberContribution[];
  maxContributorSharePercentage: number;
  topThreeContributorSharePercentage: number;
  expenseCategories: GroupFundCategorySummary[];
};

export type GroupFundComparison = {
  period: {
    startDate: string;
    endDate: string;
    dayCount: number;
  };
  summary: GroupFundPeriodSummary;
  changes: {
    incomeAmount: number;
    expenseAmount: number;
    netAmount: number;
    internalContributionAmount: number;
    externalIncomeAmount: number;
    refundAmount: number;
    expensePercentage: number | null;
    internalContributionDependencyPercentage: number | null;
    contributorCount: number;
    maxContributorSharePercentage: number;
    topThreeContributorSharePercentage: number;
  };
};

export type GroupFundWarningFlags = {
  negativeNet: boolean;
  expenseIncreaseAtLeast20Percent: boolean;
  expenseIncreasedFromZero: boolean;
  internalContributionDependencyAtLeast80Percent: boolean;
  maxContributorShareAtLeast50Percent: boolean;
  topThreeContributorShareAtLeast80Percent: boolean;
  singleExpenseCategoryAtLeast50Percent: boolean;
  noExternalIncome: boolean;
  contributorCoverageLimited: boolean;
  limitedTransactionCount: boolean;
  warningReasons: string[];
};

export type GroupFundAnalysisAggregate = {
  period: {
    startDate: string | null;
    endDate: string | null;
    label: string;
    comparisonAvailable: boolean;
  };
  current: GroupFundPeriodSummary & {
    carryover: number;
    closingBalance: number;
  };
  comparison: GroupFundComparison | null;
  warningFlags: GroupFundWarningFlags;
};

export type GroupFundAnalysisBundle = {
  aggregate: GroupFundAnalysisAggregate;
  memberNamesByKey: ReadonlyMap<string, string>;
};

type NormalizedTransaction = Omit<GroupFundTransaction, "transactionDate"> & {
  transactionDate: string;
};

export function buildGroupFundAnalysisBundle(input: {
  transactions: GroupFundTransaction[];
  activeMembers: GroupFundMember[];
  knownMembers?: GroupFundMember[];
  period: GroupFundPeriod;
  random?: () => number;
}): GroupFundAnalysisBundle {
  const startDate = normalizeDateOnly(input.period.startDate);
  const endDate = normalizeDateOnly(input.period.endDate);
  const transactions: NormalizedTransaction[] = input.transactions.map((transaction) => ({
    ...transaction,
    transactionDate: normalizeRequiredDateOnly(transaction.transactionDate),
  }));
  const previousPeriod = createPreviousPeriod(startDate, endDate);
  const relevantContributorIds = new Set<number>();
  for (const transaction of transactions) {
    if (
      transaction.kind === "FUND_CONTRIBUTION" &&
      transaction.userId !== null &&
      (isWithinPeriod(transaction.transactionDate, startDate, endDate) ||
        (previousPeriod && isWithinPeriod(transaction.transactionDate, previousPeriod.startDate, previousPeriod.endDate)))
    ) {
      relevantContributorIds.add(transaction.userId);
    }
  }

  const nameByUserId = new Map<number, string>();
  for (const member of [...input.activeMembers, ...(input.knownMembers ?? [])]) {
    if (!nameByUserId.has(member.userId)) nameByUserId.set(member.userId, member.displayName);
  }
  const aliases = createMemberAliases(
    [...relevantContributorIds].map((userId) => ({
      userId,
      displayName: nameByUserId.get(userId) ?? "退会済みメンバー",
    })),
    input.random ?? Math.random,
  );

  const currentTransactions = transactions.filter((transaction) =>
    isWithinPeriod(transaction.transactionDate, startDate, endDate),
  );
  const carryover = startDate
    ? transactions
        .filter((transaction) => transaction.transactionDate < startDate)
        .reduce((sum, transaction) => sum + signedAmount(transaction), 0)
    : 0;
  const current = summarizeGroupFundTransactions(
    currentTransactions,
    aliases.keyByUserId,
    input.activeMembers.length,
  );
  const comparison = previousPeriod
    ? buildComparison(transactions, current, previousPeriod, aliases.keyByUserId, input.activeMembers.length)
    : null;
  const warningFlags = calculateGroupFundWarningFlags(current, comparison);

  return {
    aggregate: {
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
    },
    memberNamesByKey: aliases.nameByKey,
  };
}

export function calculateGroupFundWarningFlags(
  current: GroupFundPeriodSummary,
  comparison: GroupFundComparison | null,
): GroupFundWarningFlags {
  const negativeNet = current.net < 0;
  const expenseIncreaseAtLeast20Percent = Boolean(
    comparison &&
      comparison.summary.expenseTotal > 0 &&
      current.expenseTotal >= comparison.summary.expenseTotal * 1.2,
  );
  const expenseIncreasedFromZero = Boolean(
    comparison && comparison.summary.expenseTotal === 0 && current.expenseTotal > 0,
  );
  const internalContributionDependencyAtLeast80Percent =
    current.internalContributionDependencyPercentage !== null &&
    current.internalContributionDependencyPercentage >= 80;
  const maxContributorShareAtLeast50Percent = current.maxContributorSharePercentage >= 50;
  const topThreeContributorShareAtLeast80Percent =
    current.internalContributionTotal > 0 && current.topThreeContributorSharePercentage >= 80;
  const singleExpenseCategoryAtLeast50Percent =
    current.fundExpenseTotal > 0 && (current.expenseCategories[0]?.sharePercentage ?? 0) >= 50;
  const noExternalIncome = current.externalIncomeTotal === 0;
  const contributorCoverageLimited =
    current.activeMemberCount > 0 && current.contributorCount < current.activeMemberCount;
  const limitedTransactionCount = current.transactionCount > 0 && current.transactionCount < 3;
  const warningReasons: string[] = [];

  if (negativeNet) warningReasons.push("期間内の基金増減が赤字です。");
  if (expenseIncreaseAtLeast20Percent) warningReasons.push("基金支出が前期間より20%以上増加しています。");
  if (internalContributionDependencyAtLeast80Percent) warningReasons.push("基金収入の80%以上を内部拠出が占めています。");
  if (maxContributorShareAtLeast50Percent) warningReasons.push("最大拠出割合が50%以上です。");
  if (topThreeContributorShareAtLeast80Percent) warningReasons.push("上位3名の拠出割合が80%以上です。");
  if (singleExpenseCategoryAtLeast50Percent) warningReasons.push("単一の基金支出カテゴリが基金支出の50%以上です。");

  return {
    negativeNet,
    expenseIncreaseAtLeast20Percent,
    expenseIncreasedFromZero,
    internalContributionDependencyAtLeast80Percent,
    maxContributorShareAtLeast50Percent,
    topThreeContributorShareAtLeast80Percent,
    singleExpenseCategoryAtLeast50Percent,
    noExternalIncome,
    contributorCoverageLimited,
    limitedTransactionCount,
    warningReasons,
  };
}

export function summarizeGroupFundTransactions(
  transactions: NormalizedTransaction[],
  memberKeyByUserId: ReadonlyMap<number, string>,
  activeMemberCount: number,
): GroupFundPeriodSummary {
  let internalContributionTotal = 0;
  let externalIncomeTotal = 0;
  let refundTotal = 0;
  let fundExpenseTotal = 0;
  const contributionByUserId = new Map<number, { amount: number; count: number }>();
  const expenseCategories = new Map<string, number>();

  for (const transaction of transactions) {
    if (transaction.kind === "FUND_CONTRIBUTION") {
      internalContributionTotal += transaction.amount;
      if (transaction.userId !== null) {
        const current = contributionByUserId.get(transaction.userId) ?? { amount: 0, count: 0 };
        current.amount += transaction.amount;
        current.count += 1;
        contributionByUserId.set(transaction.userId, current);
      }
    } else if (transaction.kind === "FUND_INCOME") {
      externalIncomeTotal += transaction.amount;
    } else if (transaction.kind === "FUND_REFUND") {
      refundTotal += transaction.amount;
    } else if (transaction.kind === "FUND_EXPENSE") {
      fundExpenseTotal += transaction.amount;
      expenseCategories.set(
        transaction.category,
        (expenseCategories.get(transaction.category) ?? 0) + transaction.amount,
      );
    }
  }

  const incomeTotal = internalContributionTotal + externalIncomeTotal;
  const expenseTotal = fundExpenseTotal + refundTotal;
  const memberContributions = [...contributionByUserId.entries()]
    .map(([userId, value]) => ({
      memberKey: memberKeyByUserId.get(userId) ?? "MEMBER_UNKNOWN",
      amount: value.amount,
      count: value.count,
      sharePercentage:
        internalContributionTotal > 0
          ? roundToTwo((value.amount / internalContributionTotal) * 100)
          : 0,
    }))
    .sort((left, right) => right.amount - left.amount || left.memberKey.localeCompare(right.memberKey));
  const dependencyBase = internalContributionTotal + externalIncomeTotal;

  return {
    incomeTotal,
    expenseTotal,
    net: incomeTotal - expenseTotal,
    transactionCount: transactions.length,
    internalContributionTotal,
    externalIncomeTotal,
    refundTotal,
    fundExpenseTotal,
    internalContributionDependencyPercentage:
      dependencyBase > 0 ? roundToTwo((internalContributionTotal / dependencyBase) * 100) : null,
    contributorCount: contributionByUserId.size,
    activeMemberCount,
    memberContributions,
    maxContributorSharePercentage: memberContributions[0]?.sharePercentage ?? 0,
    topThreeContributorSharePercentage: roundToTwo(
      memberContributions.slice(0, 3).reduce((sum, item) => sum + item.sharePercentage, 0),
    ),
    expenseCategories: [...expenseCategories.entries()]
      .map(([category, amount]) => ({
        category,
        amount,
        sharePercentage: fundExpenseTotal > 0 ? roundToTwo((amount / fundExpenseTotal) * 100) : 0,
      }))
      .sort((left, right) => right.amount - left.amount || left.category.localeCompare(right.category, "ja")),
  };
}

function buildComparison(
  transactions: NormalizedTransaction[],
  current: GroupFundPeriodSummary,
  period: { startDate: string; endDate: string; dayCount: number },
  memberKeyByUserId: ReadonlyMap<number, string>,
  activeMemberCount: number,
): GroupFundComparison {
  const summary = summarizeGroupFundTransactions(
    transactions.filter((transaction) =>
      isWithinPeriod(transaction.transactionDate, period.startDate, period.endDate),
    ),
    memberKeyByUserId,
    activeMemberCount,
  );

  return {
    period,
    summary,
    changes: {
      incomeAmount: current.incomeTotal - summary.incomeTotal,
      expenseAmount: current.expenseTotal - summary.expenseTotal,
      netAmount: current.net - summary.net,
      internalContributionAmount:
        current.internalContributionTotal - summary.internalContributionTotal,
      externalIncomeAmount: current.externalIncomeTotal - summary.externalIncomeTotal,
      refundAmount: current.refundTotal - summary.refundTotal,
      expensePercentage: percentageChange(current.expenseTotal, summary.expenseTotal),
      internalContributionDependencyPercentage:
        current.internalContributionDependencyPercentage === null ||
        summary.internalContributionDependencyPercentage === null
          ? null
          : roundToTwo(
              current.internalContributionDependencyPercentage -
                summary.internalContributionDependencyPercentage,
            ),
      contributorCount: current.contributorCount - summary.contributorCount,
      maxContributorSharePercentage:
        current.maxContributorSharePercentage - summary.maxContributorSharePercentage,
      topThreeContributorSharePercentage:
        current.topThreeContributorSharePercentage - summary.topThreeContributorSharePercentage,
    },
  };
}

function createMemberAliases(
  members: GroupFundMember[],
  random: () => number,
): {
  keyByUserId: ReadonlyMap<number, string>;
  nameByKey: ReadonlyMap<string, string>;
} {
  const shuffled = [...members].sort((left, right) => left.userId - right.userId);
  for (let index = shuffled.length - 1; index > 0; index -= 1) {
    const randomIndex = Math.floor(Math.max(0, Math.min(0.999999999, random())) * (index + 1));
    [shuffled[index], shuffled[randomIndex]] = [shuffled[randomIndex], shuffled[index]];
  }
  const keyByUserId = new Map<number, string>();
  const nameByKey = new Map<string, string>();
  shuffled.forEach((member, index) => {
    const memberKey = `MEMBER_${index + 1}`;
    keyByUserId.set(member.userId, memberKey);
    nameByKey.set(memberKey, member.displayName);
  });
  return { keyByUserId, nameByKey };
}

function signedAmount(transaction: NormalizedTransaction): number {
  return transaction.kind === "FUND_CONTRIBUTION" || transaction.kind === "FUND_INCOME"
    ? transaction.amount
    : -transaction.amount;
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
  const parsed = new Date(`${text}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== text) {
    throw new Error("Invalid date-only value.");
  }
  return text;
}

function roundToTwo(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}
