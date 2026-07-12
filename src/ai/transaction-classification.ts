import { z } from "zod";
import type { AiFoundation, AiStructuredResult } from "./client.js";
import {
  PERSONAL_EXPENSE_CATEGORIES,
  PERSONAL_INCOME_CATEGORIES,
  type PersonalTransactionKind,
  isAllowedPersonalCategory,
} from "../transactions/personal-categories.js";

export const FIELD_STATUS_VALUES = [
  "EXPLICIT",
  "INFERRED",
  "DEFAULTED",
  "MISSING",
] as const;

const allCategories = [
  ...PERSONAL_INCOME_CATEGORIES,
  ...PERSONAL_EXPENSE_CATEGORIES,
] as const;

const datePattern = /^\d{4}-\d{2}-\d{2}$/;

export const personalTransactionClassificationSchema = z
  .object({
    transactionType: z.enum(["INCOME", "EXPENSE", "UNKNOWN"]),
    amount: z.number().int().positive().nullable(),
    transactionDate: z.string().regex(datePattern).nullable(),
    category: z.enum(allCategories).nullable(),
    summary: z.string().trim().min(1).max(100),
    fieldStatus: z
      .object({
        transactionType: z.enum(FIELD_STATUS_VALUES),
        amount: z.enum(FIELD_STATUS_VALUES),
        transactionDate: z.enum(FIELD_STATUS_VALUES),
        category: z.enum(FIELD_STATUS_VALUES),
      })
      .strict(),
    missingFields: z
      .array(z.enum(["transactionType", "amount", "transactionDate", "category"]))
      .max(4),
    warnings: z.array(z.string().trim().min(1).max(120)).max(5),
  })
  .strict()
  .superRefine((classification, context) => {
    if (classification.transactionType === "INCOME" && classification.category) {
      if (!isAllowedPersonalCategory("income", classification.category)) {
        context.addIssue({
          code: "custom",
          path: ["category"],
          message: "Category does not match the income transaction type.",
        });
      }
    }
    if (classification.transactionType === "EXPENSE" && classification.category) {
      if (!isAllowedPersonalCategory("expense", classification.category)) {
        context.addIssue({
          code: "custom",
          path: ["category"],
          message: "Category does not match the expense transaction type.",
        });
      }
    }
    if (classification.transactionType === "UNKNOWN" && classification.category !== null) {
      context.addIssue({
        code: "custom",
        path: ["category"],
        message: "UNKNOWN transaction type cannot include a category.",
      });
    }
    if (classification.transactionDate && !isRealDateString(classification.transactionDate)) {
      context.addIssue({
        code: "custom",
        path: ["transactionDate"],
        message: "Transaction date must be a real calendar date.",
      });
    }
  });

export type PersonalTransactionClassification = z.infer<
  typeof personalTransactionClassificationSchema
>;

export type PersonalTransactionClassificationResult = AiStructuredResult<PersonalTransactionClassification>;

export function buildPersonalTransactionClassificationInstructions(
  referenceDate: string,
): string {
  return [
    "You classify one Japanese personal bookkeeping transaction from the user's natural-language text.",
    "Return only the requested structured output.",
    `The application reference date is ${referenceDate} in Asia/Tokyo. Resolve relative dates such as 今日 and 昨日 from this date.`,
    "If no amount is written or reliably derivable, return amount as null and mark it MISSING.",
    "If no date expression is written, return transactionDate as null and mark it MISSING. Do not silently use the reference date.",
    "transactionType must be INCOME, EXPENSE, or UNKNOWN.",
    `Income categories: ${PERSONAL_INCOME_CATEGORIES.join("、")}.`,
    `Expense categories: ${PERSONAL_EXPENSE_CATEGORIES.join("、")}.`,
    "Choose category only from the listed categories. If the transaction type is UNKNOWN or a category cannot be selected, return category as null.",
    "summary must be a concise Japanese transaction description of at most 100 characters and must not add facts absent from the input.",
    "fieldStatus meanings: EXPLICIT = directly written, INFERRED = reasonably inferred, DEFAULTED = supplied by an explicit application rule, MISSING = unavailable.",
    "Do not infer personality, financial condition, family circumstances, or any unrelated personal attribute.",
  ].join("\n");
}

export async function classifyPersonalTransactionWithAi(input: {
  foundation: AiFoundation;
  userId: number;
  rawText: string;
  referenceDate: string;
}): Promise<PersonalTransactionClassificationResult> {
  const result = await input.foundation.executeStructured({
    feature: "classification",
    userId: input.userId,
    schema: personalTransactionClassificationSchema,
    schemaName: "personal_transaction_classification",
    instructions: buildPersonalTransactionClassificationInstructions(input.referenceDate),
    input: input.rawText,
  });

  return result;
}

export function transactionTypeToFormKind(
  transactionType: PersonalTransactionClassification["transactionType"],
  fallbackKind: PersonalTransactionKind,
): PersonalTransactionKind {
  if (transactionType === "INCOME") return "income";
  if (transactionType === "EXPENSE") return "expense";
  return fallbackKind;
}

function isRealDateString(value: string): boolean {
  const date = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}
