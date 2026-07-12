import assert from "node:assert/strict";
import test from "node:test";
import type { AiFoundation } from "../src/ai/client.js";
import {
  buildTransactionClassificationInstructions,
  classifyTransactionWithAi,
  createTargetClassificationSchema,
} from "../src/ai/transaction-classification.js";
import {
  createSuggestionToken,
  resolveTransactionClassification,
  verifySuggestionToken,
} from "../src/ai/suggestion-token.js";
import {
  classifyGroupPaymentKeyword,
  isGroupPaymentCategory,
} from "../src/transactions/group-payment-categories.js";
import {
  classifyFundExpenseKeyword,
  classifyFundIncomeKeyword,
  isFundExpenseCategory,
  isFundIncomeCategory,
} from "../src/transactions/fund-categories.js";

const groupSuggestion = {
  transactionType: "EXPENSE" as const,
  amount: 3000,
  transactionDate: "2026-07-11",
  category: "会場費" as const,
  summary: "部活動の会場利用料",
  fieldStatus: {
    transactionType: "DEFAULTED" as const,
    amount: "EXPLICIT" as const,
    transactionDate: "INFERRED" as const,
    category: "INFERRED" as const,
  },
  missingFields: [],
  warnings: [],
};

test("group and fund category definitions are shared by keyword and validation", () => {
  assert.equal(classifyGroupPaymentKeyword("部活動の会場利用料"), "会場費");
  assert.equal(classifyFundIncomeKeyword("外部団体から寄付"), "外部寄付");
  assert.equal(classifyFundExpenseKeyword("基金から備品を購入"), "備品費");
  assert.equal(isGroupPaymentCategory("会場費"), true);
  assert.equal(isFundIncomeCategory("外部寄付"), true);
  assert.equal(isFundExpenseCategory("備品費"), true);
  assert.equal(isFundIncomeCategory("食費"), false);
});

test("target schemas restrict transaction type and allowed category", () => {
  assert.equal(createTargetClassificationSchema("GROUP_PAYMENT").safeParse(groupSuggestion).success, true);
  assert.equal(createTargetClassificationSchema("FUND_INCOME").safeParse({
    ...groupSuggestion,
    transactionType: "INCOME",
    category: "外部寄付",
  }).success, true);
  assert.equal(createTargetClassificationSchema("FUND_EXPENSE").safeParse({
    ...groupSuggestion,
    category: "備品費",
  }).success, true);
  assert.equal(createTargetClassificationSchema("FUND_INCOME").safeParse(groupSuggestion).success, false);
  assert.equal(createTargetClassificationSchema("GROUP_PAYMENT").safeParse({ ...groupSuggestion, category: "外部寄付" }).success, false);
});

test("target instructions use only target categories and Asia/Tokyo reference date", () => {
  const instructions = buildTransactionClassificationInstructions({
    target: "FUND_INCOME",
    referenceDate: "2026-07-12",
  });
  assert.match(instructions, /2026-07-12/);
  assert.match(instructions, /Asia\/Tokyo/);
  assert.match(instructions, /外部寄付/);
  assert.doesNotMatch(instructions, /備品費/);
  assert.match(instructions, /transactionType must be INCOME/);
});

test("target classification service sends only natural text as user input", async () => {
  const calls: Array<Record<string, unknown>> = [];
  const foundation = {
    async executeStructured(request: Record<string, unknown>) {
      calls.push(request);
      return {
        data: groupSuggestion,
        model: "gpt-5.4-nano",
        attempts: 1,
        durationMs: 10,
        usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
      };
    },
  } as unknown as AiFoundation;

  await classifyTransactionWithAi({
    foundation,
    userId: 12,
    rawText: "昨日部活動の会場利用料を3000円払った",
    referenceDate: "2026-07-12",
    target: "GROUP_PAYMENT",
  });
  assert.equal(calls[0].input, "昨日部活動の会場利用料を3000円払った");
  assert.equal(calls[0].userId, 12);
  assert.equal(String(calls[0].instructions).includes("groupId"), false);
});

test("suggestion token is bound to target and group", () => {
  const token = createSuggestionToken({
    userId: 10,
    secret: "session-secret",
    target: "GROUP_PAYMENT",
    groupId: 7,
    source: "AI",
    model: "gpt-5.4-nano",
    suggestion: groupSuggestion,
    now: 1_000,
  });
  const payload = verifySuggestionToken({ token, userId: 10, secret: "session-secret", now: 2_000 });
  assert.ok(payload);

  const valid = resolveTransactionClassification({
    payload,
    expectedTarget: "GROUP_PAYMENT",
    expectedGroupId: 7,
    selectedCategory: "会場費",
    finalKind: "expense",
    finalAmount: 3000,
    finalTransactionDate: "2026-07-11",
    finalCategory: "会場費",
    finalRawText: "部活動の会場利用料",
  });
  assert.equal(valid.classificationSource, "AI");

  const wrongGroup = resolveTransactionClassification({
    payload,
    expectedTarget: "GROUP_PAYMENT",
    expectedGroupId: 8,
    selectedCategory: "会場費",
    finalKind: "expense",
    finalAmount: 3000,
    finalTransactionDate: "2026-07-11",
    finalCategory: "会場費",
    finalRawText: "部活動の会場利用料",
  });
  assert.equal(wrongGroup.classificationSource, "MANUAL");
  assert.equal(wrongGroup.aiResult, null);

  const wrongTarget = resolveTransactionClassification({
    payload,
    expectedTarget: "FUND_EXPENSE",
    expectedGroupId: 7,
    selectedCategory: "会場費",
    finalKind: "expense",
    finalAmount: 3000,
    finalTransactionDate: "2026-07-11",
    finalCategory: "会場費",
    finalRawText: "部活動の会場利用料",
  });
  assert.equal(wrongTarget.classificationSource, "MANUAL");
});

test("keyword target token remains KEYWORD and does not save aiResult", () => {
  const token = createSuggestionToken({
    userId: 10,
    secret: "session-secret",
    target: "FUND_EXPENSE",
    groupId: 5,
    source: "KEYWORD",
    model: null,
    suggestion: { ...groupSuggestion, category: "備品費", summary: "備品購入" },
    now: 1_000,
  });
  const payload = verifySuggestionToken({ token, userId: 10, secret: "session-secret", now: 2_000 });
  const result = resolveTransactionClassification({
    payload,
    expectedTarget: "FUND_EXPENSE",
    expectedGroupId: 5,
    selectedCategory: "備品費",
    finalKind: "expense",
    finalAmount: 3000,
    finalTransactionDate: "2026-07-11",
    finalCategory: "備品費",
    finalRawText: "備品購入",
  });
  assert.equal(result.classificationSource, "KEYWORD");
  assert.equal(result.aiResult, null);
});

test("group target schema is sent as strict Responses API structured output", async () => {
  const calls: Array<Record<string, unknown>> = [];
  const parser = {
    async parse(body: Record<string, unknown>) {
      calls.push(body);
      return { output_parsed: groupSuggestion };
    },
  };
  const { AiFoundation } = await import("../src/ai/client.js");
  const { loadAiConfig } = await import("../src/ai/config.js");
  const foundation = new AiFoundation(
    loadAiConfig({ OPENAI_API_KEY: "test-key", AI_SAFETY_SALT: "test-safety-salt" }),
    { parser },
  );
  await classifyTransactionWithAi({
    foundation,
    userId: 1,
    rawText: "昨日部活動の会場利用料を3000円払った",
    referenceDate: "2026-07-12",
    target: "GROUP_PAYMENT",
  });
  const text = calls[0].text as { format?: { type?: string; strict?: boolean } };
  assert.equal(text.format?.type, "json_schema");
  assert.equal(text.format?.strict, true);
  assert.equal(calls[0].store, false);
});
