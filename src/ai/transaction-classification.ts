import { z } from "zod";
import type { AiFoundation, AiStructuredResult } from "./client.js";
import {
  PERSONAL_EXPENSE_CATEGORIES,
  PERSONAL_INCOME_CATEGORIES,
  type PersonalTransactionKind,
  isAllowedPersonalCategory,
} from "../transactions/personal-categories.js";
import { GROUP_PAYMENT_CATEGORIES } from "../transactions/group-payment-categories.js";
import { FUND_EXPENSE_CATEGORIES, FUND_INCOME_CATEGORIES } from "../transactions/fund-categories.js";

export const FIELD_STATUS_VALUES = ["EXPLICIT", "INFERRED", "DEFAULTED", "MISSING"] as const;
export const CLASSIFICATION_TARGET_VALUES = [
  "PERSONAL",
  "GROUP_PAYMENT",
  "FUND_INCOME",
  "FUND_EXPENSE",
] as const;

export type ClassificationTarget = (typeof CLASSIFICATION_TARGET_VALUES)[number];
export type TransactionTypeValue = "INCOME" | "EXPENSE" | "UNKNOWN";

const allCategories = [
  ...PERSONAL_INCOME_CATEGORIES,
  ...PERSONAL_EXPENSE_CATEGORIES,
  ...GROUP_PAYMENT_CATEGORIES,
  ...FUND_INCOME_CATEGORIES,
  ...FUND_EXPENSE_CATEGORIES,
] as const;
const datePattern = /^\d{4}-\d{2}-\d{2}$/;

function createBaseSchema(categorySchema: z.ZodTypeAny, transactionTypeSchema: z.ZodTypeAny) {
  return z
    .object({
      transactionType: transactionTypeSchema,
      amount: z.number().int().positive().nullable(),
      transactionDate: z.string().regex(datePattern).nullable(),
      category: categorySchema.nullable(),
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
      if (classification.transactionDate && !isRealDateString(classification.transactionDate)) {
        context.addIssue({
          code: "custom",
          path: ["transactionDate"],
          message: "Transaction date must be a real calendar date.",
        });
      }
    });
}

export const transactionClassificationTokenSchema = createBaseSchema(
  z.enum(allCategories),
  z.enum(["INCOME", "EXPENSE", "UNKNOWN"]),
);

export const personalTransactionClassificationSchema = createBaseSchema(
  z.enum([...PERSONAL_INCOME_CATEGORIES, ...PERSONAL_EXPENSE_CATEGORIES]),
  z.enum(["INCOME", "EXPENSE", "UNKNOWN"]),
).superRefine((classification, context) => {
  if (classification.transactionType === "INCOME" && classification.category) {
    if (!isAllowedPersonalCategory("income", String(classification.category))) {
      context.addIssue({ code: "custom", path: ["category"], message: "Category does not match income." });
    }
  }
  if (classification.transactionType === "EXPENSE" && classification.category) {
    if (!isAllowedPersonalCategory("expense", String(classification.category))) {
      context.addIssue({ code: "custom", path: ["category"], message: "Category does not match expense." });
    }
  }
  if (classification.transactionType === "UNKNOWN" && classification.category !== null) {
    context.addIssue({ code: "custom", path: ["category"], message: "UNKNOWN cannot include a category." });
  }
});

export type TransactionClassification = z.infer<typeof transactionClassificationTokenSchema>;
export type PersonalTransactionClassification = z.infer<typeof personalTransactionClassificationSchema>;
export type PersonalTransactionClassificationResult = AiStructuredResult<PersonalTransactionClassification>;
export type TransactionClassificationResult = AiStructuredResult<TransactionClassification>;

export function getTargetDefinition(target: ClassificationTarget, personalKind: PersonalTransactionKind = "expense") {
  if (target === "GROUP_PAYMENT") {
    return { transactionType: "EXPENSE" as const, categories: GROUP_PAYMENT_CATEGORIES, label: "group payment" };
  }
  if (target === "FUND_INCOME") {
    return { transactionType: "INCOME" as const, categories: FUND_INCOME_CATEGORIES, label: "group fund income" };
  }
  if (target === "FUND_EXPENSE") {
    return { transactionType: "EXPENSE" as const, categories: FUND_EXPENSE_CATEGORIES, label: "group fund expense" };
  }
  return {
    transactionType: personalKind === "income" ? ("INCOME" as const) : ("EXPENSE" as const),
    categories: personalKind === "income" ? PERSONAL_INCOME_CATEGORIES : PERSONAL_EXPENSE_CATEGORIES,
    label: "personal bookkeeping transaction",
  };
}

export function createTargetClassificationSchema(target: ClassificationTarget, personalKind: PersonalTransactionKind = "expense") {
  if (target === "PERSONAL") return personalTransactionClassificationSchema;
  const definition = getTargetDefinition(target, personalKind);
  return createBaseSchema(z.enum(definition.categories), z.literal(definition.transactionType));
}

export function buildTransactionClassificationInstructions(input: {
  target: ClassificationTarget;
  referenceDate: string;
  personalKind?: PersonalTransactionKind;
}): string {
  const definition = getTargetDefinition(input.target, input.personalKind);
  return [
    `You classify one Japanese ${definition.label} from the user's natural-language text.`,
    "Return only the requested structured output.",
    `The application reference date is ${input.referenceDate} in Asia/Tokyo. Resolve relative dates such as 今日 and 昨日 from this date.`,
    "If no amount is written or reliably derivable, return amount as null and mark it MISSING.",
    "If no date expression is written, return transactionDate as null and mark it MISSING. Do not silently use the reference date.",
    `transactionType must be ${definition.transactionType}. If it is not explicit in the text, mark transactionType as DEFAULTED.`,
    `Allowed categories: ${definition.categories.join("、")}.`,
    "Choose category only from the listed categories. If a category cannot be selected, return category as null.",
    "summary must be a concise Japanese transaction description of at most 100 characters and must not add facts absent from the input.",
    "fieldStatus meanings: EXPLICIT = directly written, INFERRED = reasonably inferred, DEFAULTED = supplied by an explicit application rule, MISSING = unavailable.",
    "Do not infer any person, group name, member identity, relationship, personality, financial condition, or unrelated attribute.",
  ].join("\n");
}

export function buildPersonalTransactionClassificationInstructions(referenceDate: string): string {
  return buildTransactionClassificationInstructions({ target: "PERSONAL", referenceDate, personalKind: "expense" })
    .replace("Allowed categories: 食費、交通費、学習費、維持費、その他支出。", `Income categories: ${PERSONAL_INCOME_CATEGORIES.join("、")}。\nExpense categories: ${PERSONAL_EXPENSE_CATEGORIES.join("、")}。`)
    .replace("transactionType must be EXPENSE. If it is not explicit in the text, mark transactionType as DEFAULTED.", "transactionType must be INCOME, EXPENSE, or UNKNOWN.");
}

export async function classifyTransactionWithAi(input: {
  foundation: AiFoundation;
  userId: number;
  rawText: string;
  referenceDate: string;
  target: ClassificationTarget;
  personalKind?: PersonalTransactionKind;
}): Promise<TransactionClassificationResult> {
  const schema = createTargetClassificationSchema(input.target, input.personalKind);
  const result = await input.foundation.executeStructured({
    feature: "classification",
    userId: input.userId,
    schema,
    schemaName: `${input.target.toLowerCase()}_transaction_classification`,
    instructions: input.target === "PERSONAL"
      ? buildPersonalTransactionClassificationInstructions(input.referenceDate)
      : buildTransactionClassificationInstructions(input),
    input: input.rawText,
  });
  return result as TransactionClassificationResult;
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
