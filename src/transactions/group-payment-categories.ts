export const GROUP_PAYMENT_CATEGORIES = [
  "飲食費",
  "交通費",
  "宿泊費",
  "会場費",
  "備品費",
  "活動費",
  "その他グループ支出",
] as const;

export type GroupPaymentCategory = (typeof GROUP_PAYMENT_CATEGORIES)[number];

export function isGroupPaymentCategory(value: string): value is GroupPaymentCategory {
  return GROUP_PAYMENT_CATEGORIES.includes(value as GroupPaymentCategory);
}

export function classifyGroupPaymentKeyword(rawText: string): GroupPaymentCategory {
  if (/飲食|食事|弁当|ランチ|カフェ|懇親会/.test(rawText)) return "飲食費";
  if (/電車|バス|タクシー|交通|切符|移動/.test(rawText)) return "交通費";
  if (/宿泊|ホテル|旅館/.test(rawText)) return "宿泊費";
  if (/会場|施設|使用料|利用料/.test(rawText)) return "会場費";
  if (/備品|道具|機材|消耗品/.test(rawText)) return "備品費";
  if (/活動|参加費|イベント/.test(rawText)) return "活動費";
  return "その他グループ支出";
}
