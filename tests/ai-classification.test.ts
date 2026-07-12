import assert from "node:assert/strict";
import test from "node:test";
import type { AiFoundation } from "../src/ai/client.js";
import {
  buildPersonalTransactionClassificationInstructions,
  classifyPersonalTransactionWithAi,
  personalTransactionClassificationSchema,
} from "../src/ai/transaction-classification.js";
import {
  createSuggestionToken,
  resolvePersonalTransactionClassification,
  verifySuggestionToken,
} from "../src/ai/suggestion-token.js";
import {
  classifyPersonalTransactionKeyword,
  isAllowedPersonalCategory,
} from "../src/transactions/personal-categories.js";

const aiSuggestion = {
  transactionType: "EXPENSE" as const,
  amount: 800,
  transactionDate: "2026-07-11",
  category: "食費" as const,
  summary: "コンビニで昼食",
  fieldStatus: {
    transactionType: "INFERRED" as const,
    amount: "EXPLICIT" as const,
    transactionDate: "INFERRED" as const,
    category: "INFERRED" as const,
  },
  missingFields: [],
  warnings: [],
};

test("personal category definitions are shared by keyword and validation", () => {
  assert.equal(classifyPersonalTransactionKeyword("コンビニで昼食", "expense"), "食費");
  assert.equal(classifyPersonalTransactionKeyword("アルバイト代", "income"), "給与・副業");
  assert.equal(isAllowedPersonalCategory("expense", "食費"), true);
  assert.equal(isAllowedPersonalCategory("income", "食費"), false);
});

test("classification schema accepts null amount and date but rejects category/type mismatch", () => {
  const missing = personalTransactionClassificationSchema.parse({
    ...aiSuggestion,
    amount: null,
    transactionDate: null,
    fieldStatus: {
      ...aiSuggestion.fieldStatus,
      amount: "MISSING",
      transactionDate: "MISSING",
    },
    missingFields: ["amount", "transactionDate"],
  });
  assert.equal(missing.amount, null);
  assert.equal(missing.transactionDate, null);

  const mismatched = personalTransactionClassificationSchema.safeParse({
    ...aiSuggestion,
    transactionType: "INCOME",
    category: "食費",
  });
  assert.equal(mismatched.success, false);

  const impossibleDate = personalTransactionClassificationSchema.safeParse({
    ...aiSuggestion,
    transactionDate: "2026-02-30",
  });
  assert.equal(impossibleDate.success, false);
});

test("classification instructions use Asia/Tokyo reference date and prohibit silent date default", () => {
  const instructions = buildPersonalTransactionClassificationInstructions("2026-07-12");
  assert.match(instructions, /2026-07-12/);
  assert.match(instructions, /Asia\/Tokyo/);
  assert.match(instructions, /return transactionDate as null/);
  assert.match(instructions, /食費/);
});

test("classification service sends only supplied natural text as the user input", async () => {
  const calls: unknown[] = [];
  const foundation = {
    async executeStructured(request: unknown) {
      calls.push(request);
      return {
        data: aiSuggestion,
        model: "gpt-5.4-nano",
        attempts: 1,
        durationMs: 10,
        usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
      };
    },
  } as unknown as AiFoundation;

  const result = await classifyPersonalTransactionWithAi({
    foundation,
    userId: 12,
    rawText: "昨日コンビニで昼食を800円買った",
    referenceDate: "2026-07-12",
  });

  assert.equal(result.data.category, "食費");
  const request = calls[0] as { input: string; userId: number; feature: string };
  assert.equal(request.input, "昨日コンビニで昼食を800円買った");
  assert.equal(request.userId, 12);
  assert.equal(request.feature, "classification");
});

test("suggestion token is user-bound, tamper-resistant, and expires", () => {
  const token = createSuggestionToken({
    userId: 10,
    secret: "session-secret",
    source: "AI",
    model: "gpt-5.4-nano",
    suggestion: aiSuggestion,
    now: 1_000,
  });

  assert.equal(verifySuggestionToken({ token, userId: 11, secret: "session-secret", now: 2_000 }), null);
  assert.equal(verifySuggestionToken({ token: `${token}x`, userId: 10, secret: "session-secret", now: 2_000 }), null);
  assert.equal(verifySuggestionToken({ token, userId: 10, secret: "session-secret", now: 1_000 + 31 * 60 * 1_000 }), null);

  const verified = verifySuggestionToken({ token, userId: 10, secret: "session-secret", now: 2_000 });
  assert.equal(verified?.source, "AI");
  assert.equal(verified?.suggestion.category, "食費");
});

test("unchanged AI category saves AI source and minimum audit data", () => {
  const token = createSuggestionToken({
    userId: 10,
    secret: "session-secret",
    source: "AI",
    model: "gpt-5.4-nano",
    suggestion: aiSuggestion,
    now: 1_000,
  });
  const payload = verifySuggestionToken({ token, userId: 10, secret: "session-secret", now: 2_000 });
  assert.ok(payload);

  const result = resolvePersonalTransactionClassification({
    payload,
    selectedCategory: "食費",
    finalKind: "expense",
    finalAmount: 800,
    finalTransactionDate: "2026-07-11",
    finalCategory: "食費",
    finalRawText: "コンビニで昼食",
  });

  assert.equal(result.classificationSource, "AI");
  assert.deepEqual((result.aiResult as { modifiedFields: string[] }).modifiedFields, []);
  const serialized = JSON.stringify(result.aiResult);
  assert.equal(serialized.includes("昨日コンビニで昼食を800円買った"), false);
  assert.equal(serialized.includes("response_id"), false);
});

test("changed AI category becomes MANUAL while retaining minimal AI audit data", () => {
  const token = createSuggestionToken({
    userId: 10,
    secret: "session-secret",
    source: "AI",
    model: "gpt-5.4-nano",
    suggestion: aiSuggestion,
    now: 1_000,
  });
  const payload = verifySuggestionToken({ token, userId: 10, secret: "session-secret", now: 2_000 });
  assert.ok(payload);

  const result = resolvePersonalTransactionClassification({
    payload,
    selectedCategory: "交通費",
    finalKind: "expense",
    finalAmount: 900,
    finalTransactionDate: "2026-07-11",
    finalCategory: "交通費",
    finalRawText: "駅までタクシー",
  });

  assert.equal(result.classificationSource, "MANUAL");
  const audit = result.aiResult as { categoryModified: boolean; modifiedFields: string[] };
  assert.equal(audit.categoryModified, true);
  assert.deepEqual(audit.modifiedFields.sort(), ["amount", "category", "summary"].sort());
});

test("keyword suggestion and empty category resolve to KEYWORD without aiResult", () => {
  const keywordToken = createSuggestionToken({
    userId: 10,
    secret: "session-secret",
    source: "KEYWORD",
    model: null,
    suggestion: aiSuggestion,
    now: 1_000,
  });
  const payload = verifySuggestionToken({ token: keywordToken, userId: 10, secret: "session-secret", now: 2_000 });

  const unchanged = resolvePersonalTransactionClassification({
    payload,
    selectedCategory: "食費",
    finalKind: "expense",
    finalAmount: 800,
    finalTransactionDate: "2026-07-11",
    finalCategory: "食費",
    finalRawText: "コンビニで昼食",
  });
  assert.equal(unchanged.classificationSource, "KEYWORD");
  assert.equal(unchanged.aiResult, null);

  const automatic = resolvePersonalTransactionClassification({
    payload: null,
    selectedCategory: "",
    finalKind: "expense",
    finalAmount: 800,
    finalTransactionDate: "2026-07-11",
    finalCategory: "食費",
    finalRawText: "コンビニで昼食",
  });
  assert.equal(automatic.classificationSource, "KEYWORD");
});

test("classification schema can be converted to strict Responses API format", async () => {
  const calls: Array<Record<string, unknown>> = [];
  const parser = {
    async parse(body: Record<string, unknown>) {
      calls.push(body);
      return { output_parsed: aiSuggestion };
    },
  };
  const { AiFoundation } = await import("../src/ai/client.js");
  const { loadAiConfig } = await import("../src/ai/config.js");
  const foundation = new AiFoundation(
    loadAiConfig({
      OPENAI_API_KEY: "test-key",
      AI_SAFETY_SALT: "test-safety-salt",
    }),
    { parser },
  );

  await classifyPersonalTransactionWithAi({
    foundation,
    userId: 1,
    rawText: "昨日コンビニで昼食を800円買った",
    referenceDate: "2026-07-12",
  });

  const text = calls[0].text as { format?: { type?: string; strict?: boolean } };
  assert.equal(text.format?.type, "json_schema");
  assert.equal(text.format?.strict, true);
  assert.equal(calls[0].store, false);
});
