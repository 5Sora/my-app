export const PERSONAL_INCOME_CATEGORIES = [
  "給与・副業",
  "仕送り",
  "返金・還付",
  "その他収入",
] as const;

export const PERSONAL_EXPENSE_CATEGORIES = [
  "食費",
  "交通費",
  "学習費",
  "維持費",
  "その他支出",
] as const;

export type PersonalTransactionKind = "income" | "expense";
export type PersonalIncomeCategory = (typeof PERSONAL_INCOME_CATEGORIES)[number];
export type PersonalExpenseCategory = (typeof PERSONAL_EXPENSE_CATEGORIES)[number];
export type PersonalCategory = PersonalIncomeCategory | PersonalExpenseCategory;

export function getPersonalCategories(kind: PersonalTransactionKind): readonly PersonalCategory[] {
  return kind === "income" ? PERSONAL_INCOME_CATEGORIES : PERSONAL_EXPENSE_CATEGORIES;
}

export function isAllowedPersonalCategory(
  kind: PersonalTransactionKind,
  category: string,
): category is PersonalCategory {
  return getPersonalCategories(kind).includes(category as PersonalCategory);
}

export function classifyPersonalTransactionKeyword(
  rawText: string,
  kind: PersonalTransactionKind,
): PersonalCategory {
  if (kind === "income") {
    if (/給与|給料|バイト|アルバイト|報酬/.test(rawText)) return "給与・副業";
    if (/仕送り/.test(rawText)) return "仕送り";
    if (/返金|還付/.test(rawText)) return "返金・還付";
    return "その他収入";
  }

  if (/コンビニ|スーパー|ご飯|食事|ランチ|カフェ|弁当/.test(rawText)) {
    return "食費";
  }
  if (/電車|バス|タクシー|交通|切符|定期/.test(rawText)) {
    return "交通費";
  }
  if (/本|参考書|文具|授業|学習/.test(rawText)) {
    return "学習費";
  }
  if (/家賃|光熱|電気|ガス|水道|通信|携帯/.test(rawText)) {
    return "維持費";
  }
  return "その他支出";
}
