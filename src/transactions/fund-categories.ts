export const FUND_INCOME_CATEGORIES = [
  "外部寄付",
  "助成金",
  "イベント収益",
  "その他基金収入",
] as const;

export const FUND_EXPENSE_CATEGORIES = [
  "備品費",
  "会場費",
  "交通費",
  "飲食費",
  "活動費",
  "その他基金支出",
] as const;

export type FundIncomeCategory = (typeof FUND_INCOME_CATEGORIES)[number];
export type FundExpenseCategory = (typeof FUND_EXPENSE_CATEGORIES)[number];

export function isFundIncomeCategory(value: string): value is FundIncomeCategory {
  return FUND_INCOME_CATEGORIES.includes(value as FundIncomeCategory);
}

export function isFundExpenseCategory(value: string): value is FundExpenseCategory {
  return FUND_EXPENSE_CATEGORIES.includes(value as FundExpenseCategory);
}

export function classifyFundIncomeKeyword(rawText: string): FundIncomeCategory {
  if (/寄付|寄贈|協賛/.test(rawText)) return "外部寄付";
  if (/助成金|補助金/.test(rawText)) return "助成金";
  if (/イベント|売上|収益|参加費収入/.test(rawText)) return "イベント収益";
  return "その他基金収入";
}

export function classifyFundExpenseKeyword(rawText: string): FundExpenseCategory {
  if (/備品|道具|機材|消耗品/.test(rawText)) return "備品費";
  if (/会場|施設|使用料|利用料/.test(rawText)) return "会場費";
  if (/電車|バス|タクシー|交通|切符|移動/.test(rawText)) return "交通費";
  if (/飲食|食事|弁当|ランチ|カフェ/.test(rawText)) return "飲食費";
  if (/活動|イベント|参加費/.test(rawText)) return "活動費";
  return "その他基金支出";
}
