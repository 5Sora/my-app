export type GroupPaymentVisualizationTransaction = {
  amount: number;
  userId: number | null;
  user?: {
    displayName: string;
  } | null;
};

export type GroupPaymentShareItem = {
  key: string;
  userId: number | null;
  label: string;
  amount: number;
  paymentCount: number;
  percentage: number;
  color: string;
};

export type GroupPaymentVisualization = {
  paymentComposition: GroupPaymentShareItem[];
  totals: {
    amount: number;
    paymentCount: number;
    participantCount: number;
  };
};

const memberPalette = [
  "#315f86",
  "#4d7c9f",
  "#6a94b2",
  "#2f6f50",
  "#598c6d",
  "#80a78f",
  "#8f5a3c",
  "#b17a58",
  "#725b8d",
  "#9078a6",
];

const roundToOne = (value: number) => Math.round(value * 10) / 10;

export function buildGroupPaymentVisualization(
  transactions: GroupPaymentVisualizationTransaction[],
): GroupPaymentVisualization {
  const byUser = new Map<
    number | "unknown",
    { userId: number | null; label: string; amount: number; paymentCount: number }
  >();

  for (const transaction of transactions) {
    const key = transaction.userId ?? "unknown";
    const current = byUser.get(key) ?? {
      userId: transaction.userId,
      label: transaction.user?.displayName ?? "退会済み・不明なユーザー",
      amount: 0,
      paymentCount: 0,
    };
    current.amount += transaction.amount;
    current.paymentCount += 1;
    byUser.set(key, current);
  }

  const totalAmount = transactions.reduce((sum, transaction) => sum + transaction.amount, 0);
  const rows = [...byUser.values()]
    .sort(
      (left, right) =>
        right.amount - left.amount ||
        left.label.localeCompare(right.label, "ja") ||
        (left.userId ?? Number.MAX_SAFE_INTEGER) - (right.userId ?? Number.MAX_SAFE_INTEGER),
    )
    .map((row, index) => ({
      key: `member-${row.userId ?? "unknown"}`,
      userId: row.userId,
      label: row.label,
      amount: row.amount,
      paymentCount: row.paymentCount,
      percentage: totalAmount > 0 ? roundToOne((row.amount / totalAmount) * 100) : 0,
      color: memberPalette[index % memberPalette.length],
    }));

  const positiveRows = rows.filter((row) => row.amount > 0);
  if (totalAmount > 0 && positiveRows.length > 0) {
    const lastPositive = positiveRows[positiveRows.length - 1];
    const preceding = positiveRows
      .slice(0, -1)
      .reduce((sum, row) => sum + row.percentage, 0);
    lastPositive.percentage = roundToOne(Math.max(0, 100 - preceding));
  }

  return {
    paymentComposition: rows,
    totals: {
      amount: totalAmount,
      paymentCount: transactions.length,
      participantCount: rows.length,
    },
  };
}
