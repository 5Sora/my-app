import { createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import {
  CLASSIFICATION_TARGET_VALUES,
  transactionClassificationTokenSchema,
  type ClassificationTarget,
} from "./transaction-classification.js";

const TOKEN_VERSION = 2;
export const AI_SUGGESTION_LIFETIME_MS = 30 * 60 * 1000;

const suggestionTokenPayloadSchema = z
  .object({
    version: z.literal(TOKEN_VERSION),
    target: z.enum(CLASSIFICATION_TARGET_VALUES),
    groupId: z.number().int().positive().nullable(),
    source: z.enum(["AI", "KEYWORD"]),
    issuedAt: z.number().int().nonnegative(),
    expiresAt: z.number().int().positive(),
    model: z.string().trim().min(1).max(100).nullable(),
    suggestion: transactionClassificationTokenSchema,
  })
  .strict();

export type SuggestionTokenPayload = z.infer<typeof suggestionTokenPayloadSchema>;

export function createSuggestionToken(input: {
  userId: number;
  secret: string;
  target?: ClassificationTarget;
  groupId?: number | null;
  source: "AI" | "KEYWORD";
  model: string | null;
  suggestion: SuggestionTokenPayload["suggestion"];
  now?: number;
}): string {
  const issuedAt = input.now ?? Date.now();
  const payload: SuggestionTokenPayload = {
    version: TOKEN_VERSION,
    target: input.target ?? "PERSONAL",
    groupId: input.groupId ?? null,
    source: input.source,
    issuedAt,
    expiresAt: issuedAt + AI_SUGGESTION_LIFETIME_MS,
    model: input.model,
    suggestion: input.suggestion,
  };
  const encodedPayload = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  const signature = signToken(encodedPayload, input.userId, input.secret);
  return `${encodedPayload}.${signature}`;
}

export function verifySuggestionToken(input: {
  token: string;
  userId: number;
  secret: string;
  now?: number;
}): SuggestionTokenPayload | null {
  const [encodedPayload, providedSignature, extra] = input.token.split(".");
  if (!encodedPayload || !providedSignature || extra !== undefined) return null;
  const expectedSignature = signToken(encodedPayload, input.userId, input.secret);
  const expectedBuffer = Buffer.from(expectedSignature, "utf8");
  const providedBuffer = Buffer.from(providedSignature, "utf8");
  if (expectedBuffer.length !== providedBuffer.length || !timingSafeEqual(expectedBuffer, providedBuffer)) return null;
  try {
    const decoded = JSON.parse(Buffer.from(encodedPayload, "base64url").toString("utf8"));
    const parsed = suggestionTokenPayloadSchema.safeParse(decoded);
    if (!parsed.success) return null;
    const now = input.now ?? Date.now();
    if (parsed.data.expiresAt < now || parsed.data.issuedAt > now + 60_000) return null;
    return parsed.data;
  } catch {
    return null;
  }
}

function signToken(payload: string, userId: number, secret: string): string {
  return createHmac("sha256", secret).update(`${userId}.${payload}`).digest("base64url");
}

export function resolveTransactionClassification(input: {
  payload: SuggestionTokenPayload | null;
  expectedTarget: ClassificationTarget;
  expectedGroupId: number | null;
  selectedCategory: string;
  allowAutomaticKeyword?: boolean;
  finalKind: "income" | "expense";
  finalAmount: number;
  finalTransactionDate: string;
  finalCategory: string;
  finalRawText: string;
}) {
  const payload = input.payload && input.payload.target === input.expectedTarget && input.payload.groupId === input.expectedGroupId
    ? input.payload
    : null;
  let classificationSource: "MANUAL" | "KEYWORD" | "AI";
  if (input.allowAutomaticKeyword && !input.selectedCategory) {
    classificationSource = "KEYWORD";
  } else if (payload?.source === "AI" && payload.suggestion.category === input.finalCategory) {
    classificationSource = "AI";
  } else if (payload?.source === "KEYWORD" && payload.suggestion.category === input.finalCategory) {
    classificationSource = "KEYWORD";
  } else {
    classificationSource = "MANUAL";
  }

  if (payload?.source !== "AI") return { classificationSource, aiResult: null };

  const suggested = payload.suggestion;
  const finalTransactionType = input.finalKind === "income" ? "INCOME" : "EXPENSE";
  const modifiedFields: string[] = [];
  if (suggested.transactionType !== finalTransactionType) modifiedFields.push("transactionType");
  if (suggested.amount !== input.finalAmount) modifiedFields.push("amount");
  if (suggested.transactionDate !== input.finalTransactionDate) modifiedFields.push("transactionDate");
  if (suggested.category !== input.finalCategory) modifiedFields.push("category");
  if (suggested.summary !== input.finalRawText) modifiedFields.push("summary");

  return {
    classificationSource,
    aiResult: {
      schemaVersion: 1,
      provider: "OPENAI",
      model: payload.model,
      feature: "TRANSACTION_CLASSIFICATION",
      suggested: {
        transactionType: suggested.transactionType,
        amount: suggested.amount,
        transactionDate: suggested.transactionDate,
        category: suggested.category,
        summary: suggested.summary,
      },
      fieldStatus: suggested.fieldStatus,
      modifiedFields,
      acceptedCategory: input.finalCategory,
      categoryModified: suggested.category !== input.finalCategory,
    },
  };
}

export function resolvePersonalTransactionClassification(input: {
  payload: SuggestionTokenPayload | null;
  selectedCategory: string;
  finalKind: "income" | "expense";
  finalAmount: number;
  finalTransactionDate: string;
  finalCategory: string;
  finalRawText: string;
}) {
  return resolveTransactionClassification({
    ...input,
    expectedTarget: "PERSONAL",
    expectedGroupId: null,
    allowAutomaticKeyword: true,
  });
}
