import "dotenv/config";
import { createHmac, randomUUID } from "node:crypto";
import express, { type NextFunction, type Request, type Response } from "express";
import session from "express-session";
import bcrypt from "bcryptjs";
import { Pool } from "pg";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "./generated/prisma/client";
import {
  AiError,
  AiFoundation,
  analyzeGroupPaymentsWithAi,
  analyzePersonalLedgerWithAi,
  buildGroupPaymentAutomaticSummary,
  buildPersonalLedgerAutomaticSummary,
  classifyPersonalTransactionWithAi,
  classifyTransactionWithAi,
  createSuggestionToken,
  loadAiConfig,
  normalizeFinancialAnalysis,
  resolvePersonalTransactionClassification,
  resolveTransactionClassification,
  toPublicAiError,
  verifySuggestionToken,
  type ClassificationTarget,
  type PersonalTransactionClassification,
  type TransactionClassification,
} from "./src/ai/index.js";
import {
  PERSONAL_EXPENSE_CATEGORIES,
  PERSONAL_INCOME_CATEGORIES,
  classifyPersonalTransactionKeyword,
  isAllowedPersonalCategory,
  type PersonalTransactionKind,
} from "./src/transactions/personal-categories.js";
import {
  GROUP_PAYMENT_CATEGORIES,
  classifyGroupPaymentKeyword,
  isGroupPaymentCategory,
} from "./src/transactions/group-payment-categories.js";
import {
  FUND_EXPENSE_CATEGORIES,
  FUND_INCOME_CATEGORIES,
  classifyFundExpenseKeyword,
  classifyFundIncomeKeyword,
  isFundExpenseCategory,
  isFundIncomeCategory,
} from "./src/transactions/fund-categories.js";
import {
  PERSONAL_LEDGER_TRANSACTION_KINDS,
  buildPersonalLedgerAnalysisAggregate,
  type PersonalLedgerTransactionKind,
} from "./src/transactions/personal-ledger-summary.js";
import {
  buildGroupPaymentAnalysisAggregate,
} from "./src/transactions/group-payment-summary.js";

type CalculationMethodValue =
  | "EQUAL"
  | "HISTORY_ALL"
  | "HISTORY_SAME_PARTICIPANTS"
  | "BALANCE_ADJUSTMENT";

type PaymentConfirmationAllocation = {
  userId: number;
  displayName: string;
  ratioPercent: number;
  exactAmount: number;
  amount: number;
};

type PaymentConfirmationSession = {
  groupId: number;
  operatorUserId: number;
  pageId: number;
  contextState: "open" | "closed";
  createdAt: number;
  transactionDate: string;
  rawText: string;
  category: string;
  totalAmount: number;
  selectedMethod: CalculationMethodValue;
  usedMethod: CalculationMethodValue;
  fallbackReason: string | null;
  allocations: PaymentConfirmationAllocation[];
};

declare module "express-session" {
  interface SessionData {
    userId?: number;
    paymentConfirmations?: Record<string, PaymentConfirmationSession>;
  }
}

const databaseUrl = process.env.DATABASE_URL;
const sessionSecret = process.env.SESSION_SECRET;

if (!databaseUrl) throw new Error("DATABASE_URL is not defined.");
if (!sessionSecret) throw new Error("SESSION_SECRET is not defined.");

const pool = new Pool({
  connectionString: databaseUrl,
  ssl: { rejectUnauthorized: false },
});

const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

const app = express();
const port = Number(process.env.PORT || 8888);
const isProduction = process.env.NODE_ENV === "production";
const sessionCookieName = "my_app_sid";
const paymentConfirmationLifetimeMs = 30 * 60 * 1000;
const maxPendingPaymentConfirmations = 10;
const consumedPaymentConfirmationTokens = new Map<string, number>();
let aiFoundation: AiFoundation | null = null;

try {
  aiFoundation = new AiFoundation(loadAiConfig());
} catch {
  console.error("[AI] AI configuration is invalid. Existing non-AI features remain available.");
}

if (isProduction) app.set("trust proxy", 1);

app.set("view engine", "ejs");
app.set("views", "./views");
app.use(express.urlencoded({ extended: false }));
app.use(express.static("public"));
app.use(
  session({
    name: sessionCookieName,
    secret: sessionSecret,
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      sameSite: "lax",
      secure: isProduction,
    },
  }),
);

function normalizeLoginId(value: unknown): string {
  return String(value ?? "").trim();
}

function normalizeDisplayName(value: unknown): string {
  return String(value ?? "").trim();
}

function readPassword(value: unknown): string {
  return String(value ?? "");
}

function validateRegistration(input: {
  loginId: string;
  displayName: string;
  password: string;
}): string | null {
  if (!input.loginId || !input.displayName || !input.password) {
    return "すべての項目を入力してください。";
  }
  if (input.loginId.length > 50) {
    return "ログインIDは50文字以内で入力してください。";
  }
  if (input.displayName.length > 100) {
    return "表示名は100文字以内で入力してください。";
  }
  if (input.password.length < 8) {
    return "Passwordは8文字以上で入力してください。";
  }
  return null;
}

function regenerateSession(req: Request): Promise<void> {
  return new Promise((resolve, reject) => {
    req.session.regenerate((error) => (error ? reject(error) : resolve()));
  });
}

function saveSession(req: Request): Promise<void> {
  return new Promise((resolve, reject) => {
    req.session.save((error) => (error ? reject(error) : resolve()));
  });
}

function buildSplitPreviewSignature(input: {
  groupId: number;
  transactionDate: string;
  rawText: string;
  category: string;
  totalAmount: number;
  participantIds: number[];
  preview: SplitPreviewResult;
}): string {
  const payload = JSON.stringify({
    groupId: input.groupId,
    transactionDate: input.transactionDate,
    rawText: input.rawText,
    category: input.category,
    totalAmount: input.totalAmount,
    participantIds: [...input.participantIds].sort((left, right) => left - right),
    selectedMethod: input.preview.selectedMethod,
    usedMethod: input.preview.usedMethod,
    fallbackReason: input.preview.fallbackReason,
    allocations: [...input.preview.allocations]
      .map((allocation) => ({ userId: allocation.userId, amount: allocation.amount }))
      .sort((left, right) => left.userId - right.userId),
  });
  return createHmac("sha256", sessionSecret).update(payload).digest("hex");
}

function prunePaymentConfirmationState(req: Request): void {
  const now = Date.now();
  const pending = req.session.paymentConfirmations ?? {};

  for (const [token, confirmation] of Object.entries(pending)) {
    if (now - confirmation.createdAt > paymentConfirmationLifetimeMs) {
      delete pending[token];
    }
  }

  const ordered = Object.entries(pending).sort(
    ([, left], [, right]) => right.createdAt - left.createdAt,
  );
  for (const [token] of ordered.slice(maxPendingPaymentConfirmations)) {
    delete pending[token];
  }
  req.session.paymentConfirmations = pending;

  for (const [token, consumedAt] of consumedPaymentConfirmationTokens) {
    if (now - consumedAt > paymentConfirmationLifetimeMs) {
      consumedPaymentConfirmationTokens.delete(token);
    }
  }
}

function destroySession(req: Request): Promise<void> {
  return new Promise((resolve, reject) => {
    req.session.destroy((error) => (error ? reject(error) : resolve()));
  });
}

function requireAuthentication(req: Request, res: Response, next: NextFunction): void {
  if (!req.session.userId) {
    res.redirect("/?error=ログインしてください。");
    return;
  }
  next();
}

function parsePositiveInteger(value: unknown): number | null {
  const text = String(value ?? "").trim();
  if (!/^\d+$/.test(text)) return null;

  const amount = Number(text);
  if (!Number.isSafeInteger(amount) || amount <= 0) return null;

  return amount;
}

function parseDateOnly(value: unknown): Date | null {
  const text = String(value ?? "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return null;

  const date = new Date(`${text}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime())) return null;

  return date.toISOString().slice(0, 10) === text ? date : null;
}

function formatDateInputValue(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function getTokyoDateInputValue(date = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function isSameOriginAiRequest(req: Request): boolean {
  const fetchSite = req.get("sec-fetch-site");
  if (fetchSite && fetchSite !== "same-origin" && fetchSite !== "same-site" && fetchSite !== "none") {
    return false;
  }

  const origin = req.get("origin");
  if (!origin) return true;
  try {
    const originUrl = new URL(origin);
    return originUrl.host === req.get("host");
  } catch {
    return false;
  }
}

function buildKeywordFallbackSuggestion(
  rawText: string,
  fallbackKind: PersonalTransactionKind,
): PersonalTransactionClassification {
  return {
    transactionType: fallbackKind === "income" ? "INCOME" : "EXPENSE",
    amount: null,
    transactionDate: null,
    category: classifyPersonalTransactionKeyword(rawText, fallbackKind),
    summary: rawText.slice(0, 100),
    fieldStatus: {
      transactionType: "EXPLICIT",
      amount: "MISSING",
      transactionDate: "MISSING",
      category: "INFERRED",
    },
    missingFields: ["amount", "transactionDate"],
    warnings: ["AIを利用できないため、キーワード分類による候補を表示しています。"],
  };
}

function buildTargetKeywordFallbackSuggestion(input: {
  target: ClassificationTarget;
  rawText: string;
  fallbackKind: PersonalTransactionKind;
}): TransactionClassification {
  if (input.target === "PERSONAL") return buildKeywordFallbackSuggestion(input.rawText, input.fallbackKind);
  const category = input.target === "GROUP_PAYMENT"
    ? classifyGroupPaymentKeyword(input.rawText)
    : input.target === "FUND_INCOME"
      ? classifyFundIncomeKeyword(input.rawText)
      : classifyFundExpenseKeyword(input.rawText);
  const transactionType = input.target === "FUND_INCOME" ? "INCOME" : "EXPENSE";
  return {
    transactionType,
    amount: null,
    transactionDate: null,
    category,
    summary: input.rawText.slice(0, 100),
    fieldStatus: {
      transactionType: "DEFAULTED",
      amount: "MISSING",
      transactionDate: "MISSING",
      category: "INFERRED",
    },
    missingFields: ["amount", "transactionDate"],
    warnings: ["AIを利用できないため、キーワード分類による候補を表示しています。"],
  };
}

type OptionalDateResult = {
  value: Date | null;
  isValid: boolean;
};

function parseOptionalDateOnly(value: unknown): OptionalDateResult {
  const text = String(value ?? "").trim();

  if (!text) {
    return { value: null, isValid: true };
  }

  const date = parseDateOnly(text);
  return { value: date, isValid: date !== null };
}

function buildTransactionDateFilter(startDate: Date | null, endDate: Date | null) {
  return {
    ...(startDate ? { gte: startDate } : {}),
    ...(endDate ? { lte: endDate } : {}),
  };
}

function buildAppUrl(options: {
  pageId?: number | null;
  error?: string;
  success?: string;
} = {}): string {
  const query = new URLSearchParams();

  if (options.pageId && Number.isSafeInteger(options.pageId)) {
    query.set("pageId", String(options.pageId));
  }

  if (options.error) {
    query.set("error", options.error);
  }

  if (options.success) {
    query.set("success", options.success);
  }

  const queryString = query.toString();
  return queryString ? `/app?${queryString}` : "/app";
}

function validateLedgerPageInput(input: {
  name: string;
  startDate: OptionalDateResult;
  endDate: OptionalDateResult;
}): string | null {
  if (!input.name) {
    return "ページ名を入力してください。";
  }

  if (input.name.length > 100) {
    return "ページ名は100文字以内で入力してください。";
  }

  if (!input.startDate.isValid || !input.endDate.isValid) {
    return "開始日と終了日を正しい日付で入力してください。";
  }

  if (
    input.startDate.value &&
    input.endDate.value &&
    input.startDate.value > input.endDate.value
  ) {
    return "開始日は終了日以前の日付にしてください。";
  }

  return null;
}


const groupPaymentCategories = GROUP_PAYMENT_CATEGORIES;
const fundIncomeCategories = FUND_INCOME_CATEGORIES;
const fundExpenseCategories = FUND_EXPENSE_CATEGORIES;

function isFutureTransactionDate(date: Date): boolean {
  const today = parseDateOnly(getTokyoDateInputValue());
  return today ? date > today : false;
}

function validateGroupPaymentInput(input: {
  transactionDate: Date | null;
  amount: number | null;
  rawText: string;
  category: string;
}): string | null {
  if (!input.transactionDate) return "取引日を正しい日付で入力してください。";
  if (isFutureTransactionDate(input.transactionDate)) return "取引日は本日以前の日付を入力してください。";
  if (!input.amount) return "金額は1円以上の整数で入力してください。";
  if (!input.rawText) return "内容を入力してください。";
  if (input.rawText.length > 500) return "内容は500文字以内で入力してください。";
  if (!isGroupPaymentCategory(input.category)) return "グループ関連支出のカテゴリを選択してください。";
  return null;
}

function validateFundIncomeInput(input: {
  transactionDate: Date | null;
  amount: number | null;
  rawText: string;
  category: string;
  relatedUserIdText: string;
  relatedUserId: number | null;
}): string | null {
  if (!input.transactionDate) return "取引日を正しい日付で入力してください。";
  if (isFutureTransactionDate(input.transactionDate)) return "取引日は本日以前の日付を入力してください。";
  if (!input.amount) return "金額は1円以上の整数で入力してください。";
  if (!input.rawText) return "内容を入力してください。";
  if (input.rawText.length > 500) return "内容は500文字以内で入力してください。";
  if (!isFundIncomeCategory(input.category)) return "基金収入のカテゴリを選択してください。";
  if (input.relatedUserIdText && !input.relatedUserId) return "関係者が正しくありません。";
  return null;
}

function validateFundExpenseInput(input: {
  transactionDate: Date | null;
  amount: number | null;
  rawText: string;
  category: string;
  relatedUserIdText: string;
  relatedUserId: number | null;
}): string | null {
  if (!input.transactionDate) return "取引日を正しい日付で入力してください。";
  if (isFutureTransactionDate(input.transactionDate)) return "取引日は本日以前の日付を入力してください。";
  if (!input.amount) return "金額は1円以上の整数で入力してください。";
  if (!input.rawText) return "内容を入力してください。";
  if (input.rawText.length > 500) return "内容は500文字以内で入力してください。";
  if (!isFundExpenseCategory(input.category)) return "基金支出のカテゴリを選択してください。";
  if (input.relatedUserIdText && !input.relatedUserId) return "関係者が正しくありません。";
  return null;
}

const fundContributionCategory = "基金拠出";

function validateFundContributionInput(input: {
  transactionDate: Date | null;
  amount: number | null;
  rawText: string;
}): string | null {
  if (!input.transactionDate) {
    return "取引日を正しい日付で入力してください。";
  }

  if (!input.amount) {
    return "金額は1円以上の整数で入力してください。";
  }

  if (!input.rawText) {
    return "内容を入力してください。";
  }

  if (input.rawText.length > 500) {
    return "内容は500文字以内で入力してください。";
  }

  return null;
}

const fundRefundCategory = "基金返金";

function validateFundRefundInput(input: {
  transactionDate: Date | null;
  amount: number | null;
  rawText: string;
  recipientUserIdText: string;
  recipientUserId: number | null;
}): string | null {
  if (!input.transactionDate) {
    return "取引日を正しい日付で入力してください。";
  }

  if (!input.amount) {
    return "金額は1円以上の整数で入力してください。";
  }

  if (!input.rawText) {
    return "内容を入力してください。";
  }

  if (input.rawText.length > 500) {
    return "内容は500文字以内で入力してください。";
  }

  if (input.recipientUserIdText && !input.recipientUserId) {
    return "返金先が正しくありません。";
  }

  return null;
}

type FundContributionCreationResult =
  | { status: "created"; transactionId: number }
  | { status: "membership-not-found" }
  | { status: "fund-unavailable" };

async function createFundContributionTransaction(input: {
  userId: number;
  groupId: number;
  transactionDate: Date;
  amount: number;
  rawText: string;
}): Promise<FundContributionCreationResult> {
  const membership = await findActiveGroupMembership(input.userId, input.groupId);

  if (!membership) {
    return { status: "membership-not-found" };
  }

  const fund = await prisma.groupFund.findUnique({
    where: { groupId: input.groupId },
    select: { id: true, isActive: true },
  });

  if (!fund?.isActive) {
    return { status: "fund-unavailable" };
  }

  const transaction = await prisma.transaction.create({
    data: {
      userId: input.userId,
      groupId: input.groupId,
      groupFundId: fund.id,
      kind: "FUND_CONTRIBUTION",
      amount: input.amount,
      category: fundContributionCategory,
      rawText: input.rawText,
      transactionDate: input.transactionDate,
      paymentBatchId: null,
      calculationMethod: null,
      classificationSource: "MANUAL",
      aiResult: null,
    },
    select: { id: true },
  });

  return { status: "created", transactionId: transaction.id };
}

type GroupMembershipClient = Pick<typeof prisma, "groupMember">;
type ActivatableGroupRole = "MEMBER" | "ADMIN";

class ActiveGroupMembershipError extends Error {
  constructor() {
    super("そのユーザーはすでにグループへ所属しています。");
    this.name = "ActiveGroupMembershipError";
  }
}

class GroupMemberOperationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GroupMemberOperationError";
  }
}

class GroupAuthorizationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GroupAuthorizationError";
  }
}

async function activateGroupMembership(
  client: GroupMembershipClient,
  input: {
    groupId: number;
    userId: number;
    role: ActivatableGroupRole;
  },
) {
  const existingMembership = await client.groupMember.findUnique({
    where: {
      userId_groupId: {
        userId: input.userId,
        groupId: input.groupId,
      },
    },
  });

  if (existingMembership?.isActive) {
    throw new ActiveGroupMembershipError();
  }

  const joinedAt = new Date();

  if (existingMembership) {
    return client.groupMember.update({
      where: {
        userId_groupId: {
          userId: input.userId,
          groupId: input.groupId,
        },
      },
      data: {
        role: input.role,
        isActive: true,
        joinedAt,
        leftAt: null,
      },
    });
  }

  return client.groupMember.create({
    data: {
      userId: input.userId,
      groupId: input.groupId,
      role: input.role,
      isActive: true,
      joinedAt,
      leftAt: null,
    },
  });
}

function validateGroupName(name: string): string | null {
  if (!name) {
    return "グループ名を入力してください。";
  }

  if (name.length > 100) {
    return "グループ名は100文字以内で入力してください。";
  }

  return null;
}

function buildGroupUrl(
  groupId: number,
  options: {
    error?: string;
    success?: string;
  } = {},
): string {
  const query = new URLSearchParams();

  if (options.error) query.set("error", options.error);
  if (options.success) query.set("success", options.success);

  const queryString = query.toString();
  return queryString ? `/groups/${groupId}?${queryString}` : `/groups/${groupId}`;
}

type FundContextState = "open" | "closed";

function parseFundContextState(value: unknown): FundContextState {
  return value === "open" ? "open" : "closed";
}

function buildGroupFundUrl(
  groupId: number,
  options: {
    pageId?: number | null;
    error?: string;
    success?: string;
    contextState?: FundContextState;
  } = {},
): string {
  const query = new URLSearchParams();

  if (options.pageId && Number.isSafeInteger(options.pageId)) {
    query.set("pageId", String(options.pageId));
  }
  if (options.error) query.set("error", options.error);
  if (options.success) query.set("success", options.success);
  if (options.contextState === "open") query.set("context", "open");

  const queryString = query.toString();
  return queryString
    ? `/groups/${groupId}/fund?${queryString}`
    : `/groups/${groupId}/fund`;
}

type PaymentContextState = "open" | "closed";

function parsePaymentContextState(value: unknown): PaymentContextState | null {
  if (value === "open" || value === "closed") return value;
  return null;
}

function buildGroupPaymentsUrl(
  groupId: number,
  options: {
    pageId?: number | null;
    error?: string;
    success?: string;
    contextState?: PaymentContextState | null;
  } = {},
): string {
  const query = new URLSearchParams();

  if (options.pageId && Number.isSafeInteger(options.pageId)) {
    query.set("pageId", String(options.pageId));
  }
  if (options.error) query.set("error", options.error);
  if (options.success) query.set("success", options.success);
  if (options.contextState) query.set("context", options.contextState);

  const queryString = query.toString();
  const baseUrl = `/groups/${groupId}/payments`;
  return queryString ? `${baseUrl}?${queryString}` : baseUrl;
}

const calculationMethodOptions = [
  {
    value: "EQUAL",
    label: "均等",
    description: "総額を選択参加者で均等に配分します。",
  },
  {
    value: "HISTORY_ALL",
    label: "過去の負担比率・全履歴",
    description: "過去の確定済み支払い比率を今回へ適用します。",
  },
  {
    value: "HISTORY_SAME_PARTICIPANTS",
    label: "過去の負担比率・同じ参加者",
    description: "同じ参加者構成の過去batch比率を利用します。",
  },
  {
    value: "BALANCE_ADJUSTMENT",
    label: "累計負担調整",
    description: "累計支払額の差が小さくなるよう今回の負担を調整します。",
  },
] as const;

function getCalculationMethodLabel(value: string | null): string {
  return (
    calculationMethodOptions.find((method) => method.value === value)?.label ??
    "未設定"
  );
}


type SplitPreviewDraft = {
  totalAmount: string;
  transactionDate: string;
  rawText: string;
  category: string;
  participantIds: number[];
  calculationMethod: CalculationMethodValue | "";
};

type SplitPreviewAllocation = PaymentConfirmationAllocation;

type SplitPreviewResult = {
  selectedMethod: CalculationMethodValue;
  selectedMethodLabel: string;
  usedMethod: CalculationMethodValue;
  usedMethodLabel: string;
  fallbackReason: string | null;
  totalAmount: number;
  allocations: SplitPreviewAllocation[];
};

function isCalculationMethod(value: string): value is CalculationMethodValue {
  return calculationMethodOptions.some((method) => method.value === value);
}

function parseParticipantIds(value: unknown): { values: number[]; isValid: boolean } {
  const source = Array.isArray(value) ? value : value === undefined ? [] : [value];
  const parsed = source.map(parsePositiveInteger);
  return {
    values: [...new Set(parsed.filter((id): id is number => id !== null))].sort(
      (left, right) => left - right,
    ),
    isValid: parsed.every((id) => id !== null),
  };
}

function validateSplitPreviewInput(input: {
  transactionDate: Date | null;
  totalAmount: number | null;
  rawText: string;
  category: string;
  participantIds: number[];
  participantIdsValid: boolean;
  calculationMethod: string;
  activeMemberIds: Set<number>;
}): string | null {
  const paymentError = validateGroupPaymentInput({
    transactionDate: input.transactionDate,
    amount: input.totalAmount,
    rawText: input.rawText,
    category: input.category,
  });
  if (paymentError) return paymentError;

  if (!input.participantIdsValid) {
    return "参加者の指定が正しくありません。";
  }

  if (input.participantIds.length === 0) {
    return "今回の参加者を1人以上選択してください。";
  }

  if (input.participantIds.some((userId) => !input.activeMemberIds.has(userId))) {
    return "選択した参加者に、現在有効ではないメンバーが含まれています。";
  }

  if (!isCalculationMethod(input.calculationMethod)) {
    return "算出方法を1つ選択してください。";
  }

  return null;
}

function allocateByLargestRemainder(
  totalAmount: number,
  participants: Array<{ userId: number; displayName: string; weight: number }>,
): SplitPreviewAllocation[] {
  const weightTotal = participants.reduce((sum, participant) => sum + participant.weight, 0);
  if (weightTotal <= 0) {
    throw new Error("Allocation weight total must be positive.");
  }

  const rows = participants.map((participant) => {
    const exactAmount = (totalAmount * participant.weight) / weightTotal;
    const floorAmount = Math.floor(exactAmount);
    return {
      ...participant,
      exactAmount,
      floorAmount,
      fraction: exactAmount - floorAmount,
      amount: floorAmount,
    };
  });

  let remainder = totalAmount - rows.reduce((sum, row) => sum + row.floorAmount, 0);
  const remainderOrder = [...rows].sort(
    (left, right) => right.fraction - left.fraction || left.userId - right.userId,
  );

  for (let index = 0; index < remainder; index += 1) {
    remainderOrder[index % remainderOrder.length].amount += 1;
  }

  return rows
    .sort((left, right) => left.userId - right.userId)
    .map((row) => ({
      userId: row.userId,
      displayName: row.displayName,
      ratioPercent: totalAmount > 0 ? (row.exactAmount / totalAmount) * 100 : 0,
      exactAmount: row.exactAmount,
      amount: row.amount,
    }));
}

function calculateBalanceAdjustmentWeights(
  totalAmount: number,
  participants: Array<{ userId: number; displayName: string; historicalAmount: number }>,
): Array<{ userId: number; displayName: string; weight: number }> {
  const sorted = [...participants].sort(
    (left, right) => left.historicalAmount - right.historicalAmount || left.userId - right.userId,
  );
  const allocations = new Map<number, number>(sorted.map((participant) => [participant.userId, 0]));
  let remaining = totalAmount;
  let groupEnd = 1;

  while (remaining > 0 && groupEnd < sorted.length) {
    const currentLevel = sorted[groupEnd - 1].historicalAmount;
    const nextLevel = sorted[groupEnd].historicalAmount;
    const levelDifference = nextLevel - currentLevel;

    if (levelDifference <= 0) {
      groupEnd += 1;
      continue;
    }

    const required = levelDifference * groupEnd;
    if (remaining >= required) {
      for (let index = 0; index < groupEnd; index += 1) {
        const userId = sorted[index].userId;
        allocations.set(userId, (allocations.get(userId) ?? 0) + levelDifference);
      }
      remaining -= required;
      groupEnd += 1;
      continue;
    }

    const share = remaining / groupEnd;
    for (let index = 0; index < groupEnd; index += 1) {
      const userId = sorted[index].userId;
      allocations.set(userId, (allocations.get(userId) ?? 0) + share);
    }
    remaining = 0;
  }

  if (remaining > 0) {
    const share = remaining / sorted.length;
    for (const participant of sorted) {
      allocations.set(participant.userId, (allocations.get(participant.userId) ?? 0) + share);
    }
  }

  return participants.map((participant) => ({
    userId: participant.userId,
    displayName: participant.displayName,
    weight: allocations.get(participant.userId) ?? 0,
  }));
}

async function calculateGroupPaymentPreview(input: {
  groupId: number;
  totalAmount: number;
  participantIds: number[];
  calculationMethod: CalculationMethodValue;
  activeMembers: Array<{ userId: number; user: { displayName: string } }>;
}): Promise<SplitPreviewResult> {
  const selectedParticipants = input.participantIds.map((userId) => {
    const member = input.activeMembers.find((candidate) => candidate.userId === userId);
    if (!member) throw new Error("Preview participant is not active.");
    return { userId, displayName: member.user.displayName };
  });

  const historyTransactions = await prisma.transaction.findMany({
    where: {
      groupId: input.groupId,
      kind: "GROUP_PAYMENT",
    },
    select: {
      userId: true,
      amount: true,
      paymentBatchId: true,
    },
  });

  const historyTotals = new Map<number, number>(input.participantIds.map((userId) => [userId, 0]));
  for (const transaction of historyTransactions) {
    if (transaction.userId && historyTotals.has(transaction.userId)) {
      historyTotals.set(
        transaction.userId,
        (historyTotals.get(transaction.userId) ?? 0) + transaction.amount,
      );
    }
  }

  let usedMethod: CalculationMethodValue = input.calculationMethod;
  let fallbackReason: string | null = null;
  let weights: Array<{ userId: number; displayName: string; weight: number }>;

  if (input.calculationMethod === "EQUAL") {
    weights = selectedParticipants.map((participant) => ({ ...participant, weight: 1 }));
  } else if (input.calculationMethod === "HISTORY_ALL") {
    weights = selectedParticipants.map((participant) => ({
      ...participant,
      weight: historyTotals.get(participant.userId) ?? 0,
    }));
    if (weights.reduce((sum, participant) => sum + participant.weight, 0) === 0) {
      usedMethod = "EQUAL";
      fallbackReason = "選択参加者の確定済み支払い履歴がないため、均等割を使用しました。";
      weights = selectedParticipants.map((participant) => ({ ...participant, weight: 1 }));
    }
  } else if (input.calculationMethod === "HISTORY_SAME_PARTICIPANTS") {
    const batches = new Map<string, Array<{ userId: number; amount: number }>>();
    for (const transaction of historyTransactions) {
      if (!transaction.paymentBatchId || !transaction.userId) continue;
      const rows = batches.get(transaction.paymentBatchId) ?? [];
      rows.push({ userId: transaction.userId, amount: transaction.amount });
      batches.set(transaction.paymentBatchId, rows);
    }

    const selectedKey = [...input.participantIds].sort((left, right) => left - right).join(",");
    const matchingTotals = new Map<number, number>(input.participantIds.map((userId) => [userId, 0]));
    let matchingBatchCount = 0;

    for (const rows of batches.values()) {
      const batchParticipantIds = [...new Set(rows.map((row) => row.userId))].sort(
        (left, right) => left - right,
      );
      if (batchParticipantIds.join(",") !== selectedKey) continue;
      matchingBatchCount += 1;
      for (const row of rows) {
        matchingTotals.set(row.userId, (matchingTotals.get(row.userId) ?? 0) + row.amount);
      }
    }

    weights = selectedParticipants.map((participant) => ({
      ...participant,
      weight: matchingTotals.get(participant.userId) ?? 0,
    }));
    const weightTotal = weights.reduce((sum, participant) => sum + participant.weight, 0);
    if (matchingBatchCount === 0 || weightTotal === 0) {
      usedMethod = "EQUAL";
      fallbackReason =
        matchingBatchCount === 0
          ? "同じ参加者構成の確定済みbatchがないため、均等割を使用しました。"
          : "同じ参加者構成の過去負担額合計が0円のため、均等割を使用しました。";
      weights = selectedParticipants.map((participant) => ({ ...participant, weight: 1 }));
    }
  } else {
    weights = calculateBalanceAdjustmentWeights(
      input.totalAmount,
      selectedParticipants.map((participant) => ({
        ...participant,
        historicalAmount: historyTotals.get(participant.userId) ?? 0,
      })),
    );
  }

  const allocations = allocateByLargestRemainder(input.totalAmount, weights);
  return {
    selectedMethod: input.calculationMethod,
    selectedMethodLabel: getCalculationMethodLabel(input.calculationMethod),
    usedMethod,
    usedMethodLabel: getCalculationMethodLabel(usedMethod),
    fallbackReason,
    totalAmount: input.totalAmount,
    allocations,
  };
}

async function findActiveGroupMembership(userId: number, groupId: number) {
  const membership = await prisma.groupMember.findUnique({
    where: {
      userId_groupId: {
        userId,
        groupId,
      },
    },
    include: {
      group: true,
    },
  });

  if (!membership?.isActive || !membership.group.isActive) {
    return null;
  }

  return membership;
}

async function findActiveGroupAdminMembership(userId: number, groupId: number) {
  const membership = await findActiveGroupMembership(userId, groupId);

  if (!membership || membership.role !== "ADMIN") {
    return null;
  }

  return membership;
}

app.get("/", (req, res) => {
  if (req.session.userId) {
    res.redirect("/app");
    return;
  }
  const mode = req.query.mode === "register" ? "register" : "login";
  const error = typeof req.query.error === "string" ? req.query.error : null;
  res.render("index", {
    mode,
    error,
    values: { loginId: "", displayName: "" },
  });
});

app.post("/register", async (req, res, next) => {
  const loginId = normalizeLoginId(req.body.loginId);
  const displayName = normalizeDisplayName(req.body.displayName);
  const password = readPassword(req.body.password);
  const validationError = validateRegistration({ loginId, displayName, password });

  if (validationError) {
    res.status(400).render("index", {
      mode: "register",
      error: validationError,
      values: { loginId, displayName },
    });
    return;
  }

  try {
    const existingUser = await prisma.user.findUnique({
      where: { loginId },
      select: { id: true },
    });

    if (existingUser) {
      res.status(409).render("index", {
        mode: "register",
        error: "そのログインIDはすでに使用されています。",
        values: { loginId, displayName },
      });
      return;
    }

    const passwordHash = await bcrypt.hash(password, 12);
    const user = await prisma.$transaction(async (tx) => {
      const createdUser = await tx.user.create({
        data: { loginId, displayName, passwordHash },
      });
      await tx.ledgerPage.create({
        data: {
          pageType: "PERSONAL",
          userId: createdUser.id,
          name: "全期間",
          isInitial: true,
          sortOrder: 0,
        },
      });
      return createdUser;
    });

    await regenerateSession(req);
    req.session.userId = user.id;
    await saveSession(req);
    res.redirect("/app");
  } catch (error) {
    if (
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      error.code === "P2002"
    ) {
      res.status(409).render("index", {
        mode: "register",
        error: "そのログインIDはすでに使用されています。",
        values: { loginId, displayName },
      });
      return;
    }
    next(error);
  }
});

app.post("/login", async (req, res, next) => {
  const loginId = normalizeLoginId(req.body.loginId);
  const password = readPassword(req.body.password);

  if (!loginId || !password) {
    res.status(400).render("index", {
      mode: "login",
      error: "ログインIDとPasswordを入力してください。",
      values: { loginId, displayName: "" },
    });
    return;
  }

  try {
    const user = await prisma.user.findUnique({ where: { loginId } });
    const passwordMatches =
      user !== null && (await bcrypt.compare(password, user.passwordHash));

    if (!user || !user.isActive || !passwordMatches) {
      res.status(401).render("index", {
        mode: "login",
        error: "ログインIDまたはPasswordが正しくありません。",
        values: { loginId, displayName: "" },
      });
      return;
    }

    await regenerateSession(req);
    req.session.userId = user.id;
    await saveSession(req);
    res.redirect("/app");
  } catch (error) {
    next(error);
  }
});

app.get("/app", requireAuthentication, async (req, res, next) => {
  const userId = req.session.userId;
  if (!userId) {
    res.redirect("/?error=ログインしてください。");
    return;
  }

  try {
    const requestedPageId = Number(req.query.pageId);
    const [pages, groupMemberships, user] = await Promise.all([
      prisma.ledgerPage.findMany({
        where: {
          userId,
          pageType: "PERSONAL",
        },
        orderBy: [{ isInitial: "desc" }, { sortOrder: "asc" }, { id: "asc" }],
      }),
      prisma.groupMember.findMany({
        where: {
          userId,
          isActive: true,
        },
        include: {
          group: {
            include: {
              fund: {
                select: { id: true, name: true, isActive: true },
              },
            },
          },
        },
        orderBy: [{ joinedAt: "asc" }, { groupId: "asc" }],
      }),
      prisma.user.findUnique({
        where: { id: userId },
      }),
    ]);

    if (!user || !user.isActive) {
      await destroySession(req);
      res.clearCookie(sessionCookieName);
      res.redirect("/?error=このアカウントは利用できません。");
      return;
    }

    const selectedPage =
      pages.find((page) => Number.isInteger(requestedPageId) && page.id === requestedPageId) ??
      pages[0] ??
      null;

    if (!selectedPage) {
      res.status(500).send("個人家計簿ページが見つかりません。");
      return;
    }

    const activeGroupMemberships = groupMemberships.filter(
      (membership) => membership.group.isActive,
    );
    const contributionGroups = activeGroupMemberships.filter(
      (membership) => membership.group.fund?.isActive,
    );

    const transactionDateFilter = buildTransactionDateFilter(
      selectedPage.startDate,
      selectedPage.endDate,
    );

    const [transactions, carryoverTransactions] = await Promise.all([
      prisma.transaction.findMany({
        where: {
          userId,
          kind: { in: ["PERSONAL_INCOME", "PERSONAL_EXPENSE", "GROUP_PAYMENT", "FUND_CONTRIBUTION", "FUND_REFUND"] },
          ...(Object.keys(transactionDateFilter).length > 0
            ? { transactionDate: transactionDateFilter }
            : {}),
        },
        include: {
          group: {
            select: { id: true, name: true },
          },
        },
        orderBy: [{ transactionDate: "desc" }, { createdAt: "desc" }, { id: "desc" }],
      }),
      selectedPage.startDate
        ? prisma.transaction.findMany({
            where: {
              userId,
              kind: { in: ["PERSONAL_INCOME", "PERSONAL_EXPENSE", "GROUP_PAYMENT", "FUND_CONTRIBUTION", "FUND_REFUND"] },
              transactionDate: { lt: selectedPage.startDate },
            },
            select: { kind: true, amount: true },
          })
        : Promise.resolve([]),
    ]);

    const incomeTotal = transactions
      .filter(
        (transaction) =>
          transaction.kind === "PERSONAL_INCOME" || transaction.kind === "FUND_REFUND",
      )
      .reduce((sum, transaction) => sum + transaction.amount, 0);

    const expenseTotal = transactions
      .filter(
        (transaction) =>
          transaction.kind === "PERSONAL_EXPENSE" ||
          transaction.kind === "GROUP_PAYMENT" ||
          transaction.kind === "FUND_CONTRIBUTION",
      )
      .reduce((sum, transaction) => sum + transaction.amount, 0);

    const carryover = carryoverTransactions.reduce((sum, transaction) => {
      return transaction.kind === "PERSONAL_INCOME" || transaction.kind === "FUND_REFUND"
        ? sum + transaction.amount
        : sum - transaction.amount;
    }, 0);

    const balance = carryover + incomeTotal - expenseTotal;
    const error = typeof req.query.error === "string" ? req.query.error : null;
    const success = typeof req.query.success === "string" ? req.query.success : null;

    res.render("dashboard", {
      user,
      groupMemberships: activeGroupMemberships,
      contributionGroups,
      pages,
      selectedPage,
      transactions,
      summary: {
        carryover,
        incomeTotal,
        expenseTotal,
        balance,
      },
      error,
      success,
      today: getTokyoDateInputValue(),
      personalCategories: {
        income: PERSONAL_INCOME_CATEGORIES,
        expense: PERSONAL_EXPENSE_CATEGORIES,
      },
      selectedPageForm: {
        startDate: selectedPage.startDate
          ? selectedPage.startDate.toISOString().slice(0, 10)
          : "",
        endDate: selectedPage.endDate
          ? selectedPage.endDate.toISOString().slice(0, 10)
          : "",
      },
    });
  } catch (error) {
    next(error);
  }
});


app.post("/app/pages", requireAuthentication, async (req, res, next) => {
  const userId = req.session.userId;

  if (!userId) {
    res.redirect("/?error=ログインしてください。");
    return;
  }

  const currentPageId = parsePositiveInteger(req.body.currentPageId);
  const name = String(req.body.name ?? "").trim();
  const startDate = parseOptionalDateOnly(req.body.startDate);
  const endDate = parseOptionalDateOnly(req.body.endDate);
  const validationError = validateLedgerPageInput({ name, startDate, endDate });

  if (validationError) {
    res.redirect(buildAppUrl({ pageId: currentPageId, error: validationError }));
    return;
  }

  try {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { isActive: true },
    });

    if (!user?.isActive) {
      await destroySession(req);
      res.clearCookie(sessionCookieName);
      res.redirect("/?error=このアカウントは利用できません。");
      return;
    }

    const pageOrder = await prisma.ledgerPage.aggregate({
      where: {
        userId,
        pageType: "PERSONAL",
      },
      _max: {
        sortOrder: true,
      },
    });

    const page = await prisma.ledgerPage.create({
      data: {
        pageType: "PERSONAL",
        userId,
        groupId: null,
        name,
        startDate: startDate.value,
        endDate: endDate.value,
        isInitial: false,
        sortOrder: (pageOrder._max.sortOrder ?? -1) + 1,
      },
    });

    res.redirect(
      buildAppUrl({
        pageId: page.id,
        success: "表示ページを追加しました。",
      }),
    );
  } catch (error) {
    next(error);
  }
});

app.post("/app/pages/:pageId", requireAuthentication, async (req, res, next) => {
  const userId = req.session.userId;
  const pageId = parsePositiveInteger(req.params.pageId);

  if (!userId) {
    res.redirect("/?error=ログインしてください。");
    return;
  }

  if (!pageId) {
    res.redirect(buildAppUrl({ error: "編集対象のページが正しくありません。" }));
    return;
  }

  const name = String(req.body.name ?? "").trim();
  const startDate = parseOptionalDateOnly(req.body.startDate);
  const endDate = parseOptionalDateOnly(req.body.endDate);
  const validationError = validateLedgerPageInput({ name, startDate, endDate });

  if (validationError) {
    res.redirect(buildAppUrl({ pageId, error: validationError }));
    return;
  }

  try {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { isActive: true },
    });

    if (!user?.isActive) {
      await destroySession(req);
      res.clearCookie(sessionCookieName);
      res.redirect("/?error=このアカウントは利用できません。");
      return;
    }

    const page = await prisma.ledgerPage.findFirst({
      where: {
        id: pageId,
        userId,
        pageType: "PERSONAL",
      },
      select: { id: true },
    });

    if (!page) {
      res.redirect(buildAppUrl({ error: "編集対象のページが見つかりません。" }));
      return;
    }

    await prisma.ledgerPage.update({
      where: { id: pageId },
      data: {
        name,
        startDate: startDate.value,
        endDate: endDate.value,
      },
    });

    res.redirect(
      buildAppUrl({
        pageId,
        success: "表示ページを更新しました。",
      }),
    );
  } catch (error) {
    next(error);
  }
});

app.post(
  "/app/pages/:pageId/delete",
  requireAuthentication,
  async (req, res, next) => {
    const userId = req.session.userId;
    const pageId = parsePositiveInteger(req.params.pageId);

    if (!userId) {
      res.redirect("/?error=ログインしてください。");
      return;
    }

    if (!pageId) {
      res.redirect(buildAppUrl({ error: "削除対象のページが正しくありません。" }));
      return;
    }

    try {
      const user = await prisma.user.findUnique({
        where: { id: userId },
        select: { isActive: true },
      });

      if (!user?.isActive) {
        await destroySession(req);
        res.clearCookie(sessionCookieName);
        res.redirect("/?error=このアカウントは利用できません。");
        return;
      }

      const page = await prisma.ledgerPage.findFirst({
        where: {
          id: pageId,
          userId,
          pageType: "PERSONAL",
        },
        select: {
          id: true,
          isInitial: true,
        },
      });

      if (!page) {
        res.redirect(buildAppUrl({ error: "削除対象のページが見つかりません。" }));
        return;
      }

      if (page.isInitial) {
        res.redirect(
          buildAppUrl({
            pageId,
            error: "初期ページは削除できません。",
          }),
        );
        return;
      }

      await prisma.ledgerPage.delete({
        where: { id: pageId },
      });

      const fallbackPage = await prisma.ledgerPage.findFirst({
        where: {
          userId,
          pageType: "PERSONAL",
        },
        orderBy: [{ isInitial: "desc" }, { sortOrder: "asc" }, { id: "asc" }],
        select: { id: true },
      });

      res.redirect(
        buildAppUrl({
          pageId: fallbackPage?.id,
          success: "表示ページを削除しました。",
        }),
      );
    } catch (error) {
      next(error);
    }
  },
);


app.post("/groups", requireAuthentication, async (req, res, next) => {
  const userId = req.session.userId;

  if (!userId) {
    res.redirect("/?error=ログインしてください。");
    return;
  }

  const name = String(req.body.name ?? "").trim();
  const validationError = validateGroupName(name);

  if (validationError) {
    res.redirect(buildAppUrl({ error: validationError }));
    return;
  }

  try {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { isActive: true },
    });

    if (!user?.isActive) {
      await destroySession(req);
      res.clearCookie(sessionCookieName);
      res.redirect("/?error=このアカウントは利用できません。");
      return;
    }

    const group = await prisma.$transaction(async (tx) => {
      const createdGroup = await tx.expenseGroup.create({
        data: {
          name,
          isActive: true,
        },
      });

      await activateGroupMembership(tx, {
        groupId: createdGroup.id,
        userId,
        role: "ADMIN",
      });

      await tx.groupFund.create({
        data: {
          groupId: createdGroup.id,
          name: `${name}基金`,
          isActive: true,
        },
      });

      await tx.ledgerPage.createMany({
        data: [
          {
            pageType: "GROUP_FUND",
            userId: null,
            groupId: createdGroup.id,
            name: "全期間",
            startDate: null,
            endDate: null,
            isInitial: true,
            sortOrder: 0,
          },
          {
            pageType: "GROUP_PAYMENT",
            userId: null,
            groupId: createdGroup.id,
            name: "全期間",
            startDate: null,
            endDate: null,
            isInitial: true,
            sortOrder: 0,
          },
        ],
      });

      return createdGroup;
    });

    res.redirect(
      buildGroupUrl(group.id, {
        success: "グループを作成しました。",
      }),
    );
  } catch (error) {
    next(error);
  }
});

app.get("/groups/:groupId", requireAuthentication, async (req, res, next) => {
  const userId = req.session.userId;
  const groupId = parsePositiveInteger(req.params.groupId);

  if (!userId) {
    res.redirect("/?error=ログインしてください。");
    return;
  }

  if (!groupId) {
    res.redirect(buildAppUrl({ error: "グループが正しくありません。" }));
    return;
  }

  try {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { isActive: true },
    });

    if (!user?.isActive) {
      await destroySession(req);
      res.clearCookie(sessionCookieName);
      res.redirect("/?error=このアカウントは利用できません。");
      return;
    }

    const membership = await findActiveGroupMembership(userId, groupId);

    if (!membership) {
      res.status(403).send("このグループを表示する権限がありません。");
      return;
    }

    const [fund, ledgerPages, activeMembers] = await Promise.all([
      prisma.groupFund.findUnique({
        where: { groupId },
      }),
      prisma.ledgerPage.findMany({
        where: {
          groupId,
          pageType: {
            in: ["GROUP_FUND", "GROUP_PAYMENT"],
          },
        },
        orderBy: [
          { pageType: "asc" },
          { isInitial: "desc" },
          { sortOrder: "asc" },
          { id: "asc" },
        ],
      }),
      prisma.groupMember.findMany({
        where: {
          groupId,
          isActive: true,
          user: {
            isActive: true,
          },
        },
        include: {
          user: {
            select: {
              id: true,
              loginId: true,
              displayName: true,
              isActive: true,
            },
          },
        },
        orderBy: [{ role: "desc" }, { joinedAt: "asc" }, { userId: "asc" }],
      }),
    ]);

    const activeMemberCount = activeMembers.length;
    const activeAdminCount = activeMembers.filter(
      (member) => member.role === "ADMIN",
    ).length;
    const error = typeof req.query.error === "string" ? req.query.error : null;
    const success = typeof req.query.success === "string" ? req.query.success : null;

    res.render("group", {
      currentUserId: userId,
      group: membership.group,
      membership,
      isAdmin: membership.role === "ADMIN",
      fund,
      ledgerPages,
      activeMembers,
      activeMemberCount,
      activeAdminCount,
      error,
      success,
    });
  } catch (error) {
    next(error);
  }
});


async function loadGroupPaymentsPageData(groupId: number, requestedPageId: number | null) {
  const [pages, activeMembers] = await Promise.all([
    prisma.ledgerPage.findMany({
      where: {
        groupId,
        pageType: "GROUP_PAYMENT",
        userId: null,
      },
      orderBy: [{ isInitial: "desc" }, { sortOrder: "asc" }, { id: "asc" }],
    }),
    prisma.groupMember.findMany({
      where: {
        groupId,
        isActive: true,
        user: { isActive: true },
      },
      include: {
        user: {
          select: {
            id: true,
            displayName: true,
          },
        },
      },
      orderBy: [{ role: "desc" }, { joinedAt: "asc" }, { userId: "asc" }],
    }),
  ]);

  const selectedPage = pages.find((page) => page.id === requestedPageId) ?? pages[0] ?? null;
  if (!selectedPage) return null;

  const transactionDateFilter = buildTransactionDateFilter(
    selectedPage.startDate,
    selectedPage.endDate,
  );

  const [transactions, latestBatchTransaction] = await Promise.all([
    prisma.transaction.findMany({
      where: {
        groupId,
        kind: "GROUP_PAYMENT",
        ...(Object.keys(transactionDateFilter).length > 0
          ? { transactionDate: transactionDateFilter }
          : {}),
      },
      include: {
        user: {
          select: {
            id: true,
            displayName: true,
          },
        },
      },
      orderBy: [
        { transactionDate: "desc" },
        { createdAt: "desc" },
        { id: "desc" },
      ],
    }),
    prisma.transaction.findFirst({
      where: {
        groupId,
        kind: "GROUP_PAYMENT",
        paymentBatchId: { not: null },
      },
      select: { paymentBatchId: true },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    }),
  ]);

  const latestBatchTransactions = latestBatchTransaction?.paymentBatchId
    ? await prisma.transaction.findMany({
        where: {
          groupId,
          kind: "GROUP_PAYMENT",
          paymentBatchId: latestBatchTransaction.paymentBatchId,
        },
        include: {
          user: {
            select: {
              id: true,
              displayName: true,
            },
          },
        },
        orderBy: [{ userId: "asc" }, { id: "asc" }],
      })
    : [];

  const perPersonMap = new Map<
    number,
    { userId: number; displayName: string; totalAmount: number; paymentCount: number }
  >();

  for (const transaction of transactions) {
    if (!transaction.userId) continue;
    const current = perPersonMap.get(transaction.userId) ?? {
      userId: transaction.userId,
      displayName: transaction.user?.displayName ?? "不明なユーザー",
      totalAmount: 0,
      paymentCount: 0,
    };
    current.totalAmount += transaction.amount;
    current.paymentCount += 1;
    perPersonMap.set(transaction.userId, current);
  }

  const perPersonRows = [...perPersonMap.values()].sort(
    (left, right) =>
      right.totalAmount - left.totalAmount ||
      left.displayName.localeCompare(right.displayName, "ja") ||
      left.userId - right.userId,
  );
  const historyTotal = transactions.reduce((sum, transaction) => sum + transaction.amount, 0);

  const latestBatch = latestBatchTransactions.length
    ? {
        paymentBatchId: latestBatchTransactions[0].paymentBatchId,
        transactionDate: latestBatchTransactions[0].transactionDate,
        rawText: latestBatchTransactions[0].rawText,
        category: latestBatchTransactions[0].category,
        calculationMethod: latestBatchTransactions[0].calculationMethod,
        calculationMethodLabel: getCalculationMethodLabel(
          latestBatchTransactions[0].calculationMethod,
        ),
        totalAmount: latestBatchTransactions.reduce(
          (sum, transaction) => sum + transaction.amount,
          0,
        ),
        allocations: latestBatchTransactions.map((transaction) => ({
          transactionId: transaction.id,
          userId: transaction.userId,
          displayName: transaction.user?.displayName ?? "不明なユーザー",
          amount: transaction.amount,
        })),
      }
    : null;

  return {
    pages,
    selectedPage,
    activeMembers,
    transactions,
    perPersonRows,
    historyTotal,
    latestBatch,
  };
}

app.get("/groups/:groupId/payments", requireAuthentication, async (req, res, next) => {
  const userId = req.session.userId;
  const groupId = parsePositiveInteger(req.params.groupId);

  if (!userId) {
    res.redirect("/?error=ログインしてください。");
    return;
  }
  if (!groupId) {
    res.redirect(buildAppUrl({ error: "グループが正しくありません。" }));
    return;
  }

  try {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { isActive: true, displayName: true },
    });
    if (!user?.isActive) {
      await destroySession(req);
      res.clearCookie(sessionCookieName);
      res.redirect("/?error=このアカウントは利用できません。");
      return;
    }

    const membership = await findActiveGroupMembership(userId, groupId);
    if (!membership) {
      res.status(403).send("このグループの関連支払いを表示する権限がありません。");
      return;
    }

    const pageData = await loadGroupPaymentsPageData(
      groupId,
      parsePositiveInteger(req.query.pageId),
    );
    if (!pageData) {
      res.status(500).send("関連支払いの表示ページが見つかりません。");
      return;
    }

    const contextState = parsePaymentContextState(req.query.context);
    res.render("payments", {
      currentUserId: userId,
      group: membership.group,
      membership,
      isAdmin: membership.role === "ADMIN",
      ...pageData,
      calculationMethodOptions,
      groupPaymentCategories,
      currentUserDisplayName: user.displayName,
      today: getTokyoDateInputValue(),
      contextState,
      isContextOpen: contextState !== "closed",
      selectedPageForm: {
        startDate: pageData.selectedPage.startDate
          ? pageData.selectedPage.startDate.toISOString().slice(0, 10)
          : "",
        endDate: pageData.selectedPage.endDate
          ? pageData.selectedPage.endDate.toISOString().slice(0, 10)
          : "",
      },
      isCalculationMode: false,
      splitDraft: {
        totalAmount: "",
        transactionDate: getTokyoDateInputValue(),
        rawText: "",
        category: "",
        participantIds: pageData.activeMembers.map((member) => member.userId),
        calculationMethod: "",
      } satisfies SplitPreviewDraft,
      preview: null,
      previewSignature: null,
      error: typeof req.query.error === "string" ? req.query.error : null,
      success: typeof req.query.success === "string" ? req.query.success : null,
      buildGroupPaymentsUrl,
    });
  } catch (error) {
    next(error);
  }
});

app.post(
  "/groups/:groupId/payments/preview",
  requireAuthentication,
  async (req, res, next) => {
    const userId = req.session.userId;
    const groupId = parsePositiveInteger(req.params.groupId);
    const currentPageId = parsePositiveInteger(req.body.currentPageId);

    if (!userId) {
      res.redirect("/?error=ログインしてください。");
      return;
    }
    if (!groupId) {
      res.redirect(buildAppUrl({ error: "グループが正しくありません。" }));
      return;
    }

    try {
      const user = await prisma.user.findUnique({
        where: { id: userId },
        select: { isActive: true, displayName: true },
      });
      if (!user?.isActive) {
        await destroySession(req);
        res.clearCookie(sessionCookieName);
        res.redirect("/?error=このアカウントは利用できません。");
        return;
      }

      const membership = await findActiveGroupMembership(userId, groupId);
      if (!membership) {
        res.status(403).send("このグループで割り勘を算出する権限がありません。");
        return;
      }

      const pageData = await loadGroupPaymentsPageData(groupId, currentPageId);
      if (!pageData) {
        res.status(500).send("関連支払いの表示ページが見つかりません。");
        return;
      }

      const totalAmountText = String(req.body.totalAmount ?? "").trim();
      const transactionDateText = String(req.body.transactionDate ?? "").trim();
      const rawText = String(req.body.rawText ?? "").trim();
      const category = String(req.body.category ?? "").trim();
      const participantIdResult = parseParticipantIds(req.body.participantIds);
      const participantIds = participantIdResult.values;
      const calculationMethodText = String(req.body.calculationMethod ?? "").trim();
      const splitDraft: SplitPreviewDraft = {
        totalAmount: totalAmountText,
        transactionDate: transactionDateText,
        rawText,
        category,
        participantIds,
        calculationMethod: isCalculationMethod(calculationMethodText)
          ? calculationMethodText
          : "",
      };

      const transactionDate = parseDateOnly(transactionDateText);
      const totalAmount = parsePositiveInteger(totalAmountText);
      const activeMemberIds = new Set(pageData.activeMembers.map((member) => member.userId));
      const validationError = validateSplitPreviewInput({
        transactionDate,
        totalAmount,
        rawText,
        category,
        participantIds,
        participantIdsValid: participantIdResult.isValid,
        calculationMethod: calculationMethodText,
        activeMemberIds,
      });

      const preview = validationError
        ? null
        : await calculateGroupPaymentPreview({
            groupId,
            totalAmount: totalAmount!,
            participantIds,
            calculationMethod: calculationMethodText as CalculationMethodValue,
            activeMembers: pageData.activeMembers,
          });
      const previewSignature = preview
        ? buildSplitPreviewSignature({
            groupId,
            transactionDate: transactionDateText,
            rawText,
            category,
            totalAmount: totalAmount!,
            participantIds,
            preview,
          })
        : null;

      res.status(validationError ? 400 : 200).render("payments", {
        currentUserId: userId,
        group: membership.group,
        membership,
        isAdmin: membership.role === "ADMIN",
        ...pageData,
        calculationMethodOptions,
        groupPaymentCategories,
        currentUserDisplayName: user.displayName,
        today: getTokyoDateInputValue(),
        contextState: "open" as PaymentContextState,
        isContextOpen: true,
        selectedPageForm: {
          startDate: pageData.selectedPage.startDate
            ? pageData.selectedPage.startDate.toISOString().slice(0, 10)
            : "",
          endDate: pageData.selectedPage.endDate
            ? pageData.selectedPage.endDate.toISOString().slice(0, 10)
            : "",
        },
        isCalculationMode: true,
        splitDraft,
        preview,
        previewSignature,
        error: validationError,
        success: null,
        buildGroupPaymentsUrl,
      });
    } catch (error) {
      next(error);
    }
  },
);



app.post(
  "/groups/:groupId/payments/confirm",
  requireAuthentication,
  async (req, res, next) => {
    const operatorUserId = req.session.userId;
    const groupId = parsePositiveInteger(req.params.groupId);
    const currentPageId = parsePositiveInteger(req.body.currentPageId);

    if (!operatorUserId) {
      res.redirect("/?error=ログインしてください。");
      return;
    }
    if (!groupId) {
      res.redirect(buildAppUrl({ error: "グループが正しくありません。" }));
      return;
    }

    try {
      const operator = await prisma.user.findUnique({
        where: { id: operatorUserId },
        select: { isActive: true, displayName: true },
      });
      if (!operator?.isActive) {
        await destroySession(req);
        res.clearCookie(sessionCookieName);
        res.redirect("/?error=このアカウントは利用できません。");
        return;
      }

      const membership = await findActiveGroupMembership(operatorUserId, groupId);
      if (!membership) {
        res.status(403).send("このグループの割り勘確認画面を表示する権限がありません。");
        return;
      }

      const pageData = await loadGroupPaymentsPageData(groupId, currentPageId);
      if (!pageData) {
        res.status(500).send("関連支払いの表示ページが見つかりません。");
        return;
      }

      const totalAmountText = String(req.body.totalAmount ?? "").trim();
      const transactionDateText = String(req.body.transactionDate ?? "").trim();
      const rawText = String(req.body.rawText ?? "").trim();
      const category = String(req.body.category ?? "").trim();
      const participantIdResult = parseParticipantIds(req.body.participantIds);
      const participantIds = participantIdResult.values;
      const calculationMethodText = String(req.body.calculationMethod ?? "").trim();
      const submittedPreviewSignature = String(req.body.previewSignature ?? "").trim();
      const splitDraft: SplitPreviewDraft = {
        totalAmount: totalAmountText,
        transactionDate: transactionDateText,
        rawText,
        category,
        participantIds,
        calculationMethod: isCalculationMethod(calculationMethodText)
          ? calculationMethodText
          : "",
      };

      const transactionDate = parseDateOnly(transactionDateText);
      const totalAmount = parsePositiveInteger(totalAmountText);
      const activeMemberIds = new Set(pageData.activeMembers.map((member) => member.userId));
      const validationError = validateSplitPreviewInput({
        transactionDate,
        totalAmount,
        rawText,
        category,
        participantIds,
        participantIdsValid: participantIdResult.isValid,
        calculationMethod: calculationMethodText,
        activeMemberIds,
      });

      if (validationError) {
        res.status(400).render("payments", {
          currentUserId: operatorUserId,
          group: membership.group,
          membership,
          isAdmin: membership.role === "ADMIN",
          ...pageData,
          calculationMethodOptions,
          groupPaymentCategories,
          currentUserDisplayName: operator.displayName,
          today: getTokyoDateInputValue(),
          contextState: "open" as PaymentContextState,
          isContextOpen: true,
          selectedPageForm: {
            startDate: pageData.selectedPage.startDate
              ? pageData.selectedPage.startDate.toISOString().slice(0, 10)
              : "",
            endDate: pageData.selectedPage.endDate
              ? pageData.selectedPage.endDate.toISOString().slice(0, 10)
              : "",
          },
          isCalculationMode: true,
          splitDraft,
          preview: null,
          previewSignature: null,
          error: validationError,
          success: null,
          buildGroupPaymentsUrl,
        });
        return;
      }

      const preview = await calculateGroupPaymentPreview({
        groupId,
        totalAmount: totalAmount!,
        participantIds,
        calculationMethod: calculationMethodText as CalculationMethodValue,
        activeMembers: pageData.activeMembers,
      });
      const expectedPreviewSignature = buildSplitPreviewSignature({
        groupId,
        transactionDate: transactionDateText,
        rawText,
        category,
        totalAmount: totalAmount!,
        participantIds,
        preview,
      });

      if (!submittedPreviewSignature || submittedPreviewSignature !== expectedPreviewSignature) {
        res.status(409).render("payments", {
          currentUserId: operatorUserId,
          group: membership.group,
          membership,
          isAdmin: membership.role === "ADMIN",
          ...pageData,
          calculationMethodOptions,
          groupPaymentCategories,
          currentUserDisplayName: operator.displayName,
          today: getTokyoDateInputValue(),
          contextState: "open" as PaymentContextState,
          isContextOpen: true,
          selectedPageForm: {
            startDate: pageData.selectedPage.startDate
              ? pageData.selectedPage.startDate.toISOString().slice(0, 10)
              : "",
            endDate: pageData.selectedPage.endDate
              ? pageData.selectedPage.endDate.toISOString().slice(0, 10)
              : "",
          },
          isCalculationMode: true,
          splitDraft,
          preview,
          previewSignature: expectedPreviewSignature,
          error: "試算後に条件または履歴が変化しました。表示中の試算結果を確認してから、もう一度『確認へ進む』を押してください。",
          success: null,
          buildGroupPaymentsUrl,
        });
        return;
      }

      prunePaymentConfirmationState(req);
      const token = randomUUID();
      const confirmation: PaymentConfirmationSession = {
        groupId,
        operatorUserId,
        pageId: pageData.selectedPage.id,
        contextState: "open",
        createdAt: Date.now(),
        transactionDate: transactionDateText,
        rawText,
        category,
        totalAmount: totalAmount!,
        selectedMethod: preview.selectedMethod,
        usedMethod: preview.usedMethod,
        fallbackReason: preview.fallbackReason,
        allocations: preview.allocations,
      };
      req.session.paymentConfirmations = {
        ...(req.session.paymentConfirmations ?? {}),
        [token]: confirmation,
      };
      prunePaymentConfirmationState(req);
      await saveSession(req);

      res.render("payment-confirm", {
        group: membership.group,
        membership,
        selectedPage: pageData.selectedPage,
        confirmation,
        token,
        selectedMethodLabel: getCalculationMethodLabel(confirmation.selectedMethod),
        usedMethodLabel: getCalculationMethodLabel(confirmation.usedMethod),
        buildGroupPaymentsUrl,
      });
    } catch (error) {
      next(error);
    }
  },
);

app.post(
  "/groups/:groupId/payments/confirm/commit",
  requireAuthentication,
  async (req, res, next) => {
    const operatorUserId = req.session.userId;
    const groupId = parsePositiveInteger(req.params.groupId);
    const token = String(req.body.token ?? "").trim();

    if (!operatorUserId) {
      res.redirect("/?error=ログインしてください。");
      return;
    }
    if (!groupId) {
      res.redirect(buildAppUrl({ error: "グループが正しくありません。" }));
      return;
    }
    if (!token) {
      res.status(409).send("一括確定tokenがありません。もう一度試算からやり直してください。");
      return;
    }

    try {
      prunePaymentConfirmationState(req);
      if (consumedPaymentConfirmationTokens.has(token)) {
        res.status(409).send("この確認内容は既に確定処理済みです。重複登録は行われませんでした。");
        return;
      }

      const confirmation = req.session.paymentConfirmations?.[token];
      if (!confirmation) {
        res.status(409).send("確認内容が見つからないか、有効期限が切れています。もう一度試算してください。");
        return;
      }
      if (
        confirmation.groupId !== groupId ||
        confirmation.operatorUserId !== operatorUserId
      ) {
        res.status(403).send("この割り勘確認内容を確定する権限がありません。");
        return;
      }
      if (Date.now() - confirmation.createdAt > paymentConfirmationLifetimeMs) {
        delete req.session.paymentConfirmations?.[token];
        await saveSession(req);
        res.status(409).send("確認内容の有効期限が切れています。もう一度試算してください。");
        return;
      }

      const operator = await prisma.user.findUnique({
        where: { id: operatorUserId },
        select: { isActive: true },
      });
      if (!operator?.isActive) {
        await destroySession(req);
        res.clearCookie(sessionCookieName);
        res.redirect("/?error=このアカウントは利用できません。");
        return;
      }

      const membership = await findActiveGroupMembership(operatorUserId, groupId);
      if (!membership) {
        res.status(403).send("このグループの割り勘を確定する権限がありません。");
        return;
      }

      const participantIds = confirmation.allocations.map((allocation) => allocation.userId);
      const uniqueParticipantIds = [...new Set(participantIds)];
      const activeParticipants = await prisma.groupMember.findMany({
        where: {
          groupId,
          userId: { in: uniqueParticipantIds },
          isActive: true,
          user: { isActive: true },
        },
        select: { userId: true },
      });
      const activeParticipantIds = new Set(activeParticipants.map((participant) => participant.userId));

      const transactionDate = parseDateOnly(confirmation.transactionDate);
      const allocationTotal = confirmation.allocations.reduce(
        (sum, allocation) => sum + allocation.amount,
        0,
      );
      const confirmationIsValid =
        transactionDate !== null &&
        !isFutureTransactionDate(transactionDate) &&
        Number.isSafeInteger(confirmation.totalAmount) &&
        confirmation.totalAmount >= 1 &&
        confirmation.rawText.trim().length >= 1 &&
        confirmation.rawText.length <= 500 &&
        isGroupPaymentCategory(confirmation.category) &&
        isCalculationMethod(confirmation.selectedMethod) &&
        isCalculationMethod(confirmation.usedMethod) &&
        confirmation.allocations.length >= 1 &&
        uniqueParticipantIds.length === confirmation.allocations.length &&
        uniqueParticipantIds.every((participantId) => activeParticipantIds.has(participantId)) &&
        confirmation.allocations.every(
          (allocation) =>
            Number.isSafeInteger(allocation.userId) &&
            allocation.userId > 0 &&
            Number.isSafeInteger(allocation.amount) &&
            allocation.amount >= 0,
        ) &&
        allocationTotal === confirmation.totalAmount;

      if (!confirmationIsValid) {
        delete req.session.paymentConfirmations?.[token];
        await saveSession(req);
        res.status(409).send(
          "確認後に参加者または入力条件が変わったため確定できません。もう一度試算してください。",
        );
        return;
      }

      // 認可・参加者再確認中に同じtokenの別リクエストが先行していないか、
      // DB処理の直前でもう一度同期的に確認する。
      if (consumedPaymentConfirmationTokens.has(token)) {
        res.status(409).send("この確認内容は既に確定処理済みです。重複登録は行われませんでした。");
        return;
      }
      consumedPaymentConfirmationTokens.set(token, Date.now());
      delete req.session.paymentConfirmations?.[token];
      await saveSession(req);

      const paymentBatchId = randomUUID();
      await prisma.$transaction(async (transactionClient) => {
        await transactionClient.transaction.createMany({
          data: confirmation.allocations.map((allocation) => ({
            userId: allocation.userId,
            groupId,
            groupFundId: null,
            kind: "GROUP_PAYMENT" as const,
            amount: allocation.amount,
            category: confirmation.category,
            rawText: confirmation.rawText,
            transactionDate: transactionDate!,
            paymentBatchId,
            calculationMethod: confirmation.usedMethod,
            classificationSource: "MANUAL" as const,
            aiResult: null,
          })),
        });
      });

      res.redirect(
        buildGroupPaymentsUrl(groupId, {
          pageId: confirmation.pageId,
          contextState: confirmation.contextState,
          success: `割り勘を一括確定しました。${confirmation.allocations.length}人分を個人家計簿とグループ履歴へ反映しました。`,
        }),
      );
    } catch (error) {
      next(error);
    }
  },
);


app.post(
  "/groups/:groupId/payments/pages",
  requireAuthentication,
  async (req, res, next) => {
    const operatorUserId = req.session.userId;
    const groupId = parsePositiveInteger(req.params.groupId);
    const currentPageId = parsePositiveInteger(req.body.currentPageId);
    const contextState = parsePaymentContextState(req.body.contextState);

    if (!operatorUserId) {
      res.redirect("/?error=ログインしてください。");
      return;
    }

    if (!groupId) {
      res.redirect(buildAppUrl({ error: "グループが正しくありません。" }));
      return;
    }

    const name = String(req.body.name ?? "").trim();
    const startDate = parseOptionalDateOnly(req.body.startDate);
    const endDate = parseOptionalDateOnly(req.body.endDate);
    const validationError = validateLedgerPageInput({ name, startDate, endDate });

    try {
      const operator = await prisma.user.findUnique({
        where: { id: operatorUserId },
        select: { isActive: true },
      });

      if (!operator?.isActive) {
        await destroySession(req);
        res.clearCookie(sessionCookieName);
        res.redirect("/?error=このアカウントは利用できません。");
        return;
      }

      const adminMembership = await findActiveGroupAdminMembership(
        operatorUserId,
        groupId,
      );

      if (!adminMembership) {
        res.status(403).send("関連支払いの表示ページを追加する権限がありません。");
        return;
      }

      if (validationError) {
        res.redirect(
          buildGroupPaymentsUrl(groupId, {
            pageId: currentPageId,
            error: validationError,
            contextState,
          }),
        );
        return;
      }

      const pageOrder = await prisma.ledgerPage.aggregate({
        where: {
          groupId,
          userId: null,
          pageType: "GROUP_PAYMENT",
        },
        _max: { sortOrder: true },
      });

      const page = await prisma.ledgerPage.create({
        data: {
          pageType: "GROUP_PAYMENT",
          userId: null,
          groupId,
          name,
          startDate: startDate.value,
          endDate: endDate.value,
          isInitial: false,
          sortOrder: (pageOrder._max.sortOrder ?? -1) + 1,
        },
      });

      res.redirect(
        buildGroupPaymentsUrl(groupId, {
          pageId: page.id,
          success: "関連支払いの表示ページを追加しました。",
          contextState,
        }),
      );
    } catch (error) {
      next(error);
    }
  },
);

app.post(
  "/groups/:groupId/payments/pages/:pageId",
  requireAuthentication,
  async (req, res, next) => {
    const operatorUserId = req.session.userId;
    const groupId = parsePositiveInteger(req.params.groupId);
    const pageId = parsePositiveInteger(req.params.pageId);
    const contextState = parsePaymentContextState(req.body.contextState);

    if (!operatorUserId) {
      res.redirect("/?error=ログインしてください。");
      return;
    }

    if (!groupId) {
      res.redirect(buildAppUrl({ error: "グループが正しくありません。" }));
      return;
    }

    if (!pageId) {
      res.redirect(
        buildGroupPaymentsUrl(groupId, {
          error: "編集対象のページが正しくありません。",
          contextState,
        }),
      );
      return;
    }

    const name = String(req.body.name ?? "").trim();
    const startDate = parseOptionalDateOnly(req.body.startDate);
    const endDate = parseOptionalDateOnly(req.body.endDate);
    const validationError = validateLedgerPageInput({ name, startDate, endDate });

    try {
      const operator = await prisma.user.findUnique({
        where: { id: operatorUserId },
        select: { isActive: true },
      });

      if (!operator?.isActive) {
        await destroySession(req);
        res.clearCookie(sessionCookieName);
        res.redirect("/?error=このアカウントは利用できません。");
        return;
      }

      const adminMembership = await findActiveGroupAdminMembership(
        operatorUserId,
        groupId,
      );

      if (!adminMembership) {
        res.status(403).send("関連支払いの表示ページを編集する権限がありません。");
        return;
      }

      const page = await prisma.ledgerPage.findFirst({
        where: {
          id: pageId,
          groupId,
          userId: null,
          pageType: "GROUP_PAYMENT",
        },
        select: { id: true },
      });

      if (!page) {
        res.redirect(
          buildGroupPaymentsUrl(groupId, {
            error: "編集対象のページが見つかりません。",
            contextState,
          }),
        );
        return;
      }

      if (validationError) {
        res.redirect(
          buildGroupPaymentsUrl(groupId, {
            pageId,
            error: validationError,
            contextState,
          }),
        );
        return;
      }

      await prisma.ledgerPage.update({
        where: { id: pageId },
        data: {
          name,
          startDate: startDate.value,
          endDate: endDate.value,
        },
      });

      res.redirect(
        buildGroupPaymentsUrl(groupId, {
          pageId,
          success: "関連支払いの表示ページを更新しました。",
          contextState,
        }),
      );
    } catch (error) {
      next(error);
    }
  },
);

app.post(
  "/groups/:groupId/payments/pages/:pageId/delete",
  requireAuthentication,
  async (req, res, next) => {
    const operatorUserId = req.session.userId;
    const groupId = parsePositiveInteger(req.params.groupId);
    const pageId = parsePositiveInteger(req.params.pageId);
    const contextState = parsePaymentContextState(req.body.contextState);

    if (!operatorUserId) {
      res.redirect("/?error=ログインしてください。");
      return;
    }

    if (!groupId) {
      res.redirect(buildAppUrl({ error: "グループが正しくありません。" }));
      return;
    }

    if (!pageId) {
      res.redirect(
        buildGroupPaymentsUrl(groupId, {
          error: "削除対象のページが正しくありません。",
          contextState,
        }),
      );
      return;
    }

    try {
      const operator = await prisma.user.findUnique({
        where: { id: operatorUserId },
        select: { isActive: true },
      });

      if (!operator?.isActive) {
        await destroySession(req);
        res.clearCookie(sessionCookieName);
        res.redirect("/?error=このアカウントは利用できません。");
        return;
      }

      const adminMembership = await findActiveGroupAdminMembership(
        operatorUserId,
        groupId,
      );

      if (!adminMembership) {
        res.status(403).send("関連支払いの表示ページを削除する権限がありません。");
        return;
      }

      const page = await prisma.ledgerPage.findFirst({
        where: {
          id: pageId,
          groupId,
          userId: null,
          pageType: "GROUP_PAYMENT",
        },
        select: {
          id: true,
          isInitial: true,
        },
      });

      if (!page) {
        res.redirect(
          buildGroupPaymentsUrl(groupId, {
            error: "削除対象のページが見つかりません。",
            contextState,
          }),
        );
        return;
      }

      if (page.isInitial) {
        res.redirect(
          buildGroupPaymentsUrl(groupId, {
            pageId,
            error: "初期ページは削除できません。",
            contextState,
          }),
        );
        return;
      }

      await prisma.ledgerPage.delete({
        where: { id: pageId },
      });

      const fallbackPage = await prisma.ledgerPage.findFirst({
        where: {
          groupId,
          userId: null,
          pageType: "GROUP_PAYMENT",
        },
        orderBy: [{ isInitial: "desc" }, { sortOrder: "asc" }, { id: "asc" }],
        select: { id: true },
      });

      res.redirect(
        buildGroupPaymentsUrl(groupId, {
          pageId: fallbackPage?.id,
          success: "関連支払いの表示ページを削除しました。Transactionは削除されていません。",
          contextState,
        }),
      );
    } catch (error) {
      next(error);
    }
  },
);


app.post(
  "/groups/:groupId/payments/transactions",
  requireAuthentication,
  async (req, res, next) => {
    const operatorUserId = req.session.userId;
    const groupId = parsePositiveInteger(req.params.groupId);
    const currentPageId = parsePositiveInteger(req.body.currentPageId);
    const contextState = parsePaymentContextState(req.body.contextState);

    if (!operatorUserId) {
      res.redirect("/?error=ログインしてください。");
      return;
    }

    if (!groupId) {
      res.redirect(buildAppUrl({ error: "グループが正しくありません。" }));
      return;
    }

    const transactionDate = parseDateOnly(req.body.transactionDate);
    const amount = parsePositiveInteger(req.body.amount);
    const rawText = String(req.body.rawText ?? "").trim();
    const category = String(req.body.category ?? "").trim();
    const suggestionToken = String(req.body.suggestionToken ?? "").trim();
    const requestedUserIdText = String(req.body.userId ?? "").trim();
    const requestedUserId = requestedUserIdText
      ? parsePositiveInteger(requestedUserIdText)
      : operatorUserId;
    const validationError = validateGroupPaymentInput({
      transactionDate,
      amount,
      rawText,
      category,
    });

    try {
      const operator = await prisma.user.findUnique({
        where: { id: operatorUserId },
        select: { isActive: true },
      });

      if (!operator?.isActive) {
        await destroySession(req);
        res.clearCookie(sessionCookieName);
        res.redirect("/?error=このアカウントは利用できません。");
        return;
      }

      const membership = await findActiveGroupMembership(operatorUserId, groupId);

      if (!membership) {
        res.status(403).send("このグループへ関連支払いを登録する権限がありません。");
        return;
      }

      if (requestedUserId !== operatorUserId) {
        res.status(403).send("他人名義の関連支払いは登録できません。");
        return;
      }

      if (validationError) {
        res.redirect(
          buildGroupPaymentsUrl(groupId, {
            pageId: currentPageId,
            error: validationError,
            contextState,
          }),
        );
        return;
      }

      const verifiedSuggestion = suggestionToken
        ? verifySuggestionToken({ token: suggestionToken, userId: operatorUserId, secret: sessionSecret })
        : null;
      const { classificationSource, aiResult } = resolveTransactionClassification({
        payload: verifiedSuggestion,
        expectedTarget: "GROUP_PAYMENT",
        expectedGroupId: groupId,
        selectedCategory: category,
        finalKind: "expense",
        finalAmount: amount!,
        finalTransactionDate: String(req.body.transactionDate ?? "").trim(),
        finalCategory: category,
        finalRawText: rawText,
      });

      await prisma.transaction.create({
        data: {
          userId: operatorUserId,
          groupId,
          groupFundId: null,
          kind: "GROUP_PAYMENT",
          amount: amount!,
          category,
          rawText,
          transactionDate: transactionDate!,
          paymentBatchId: null,
          calculationMethod: null,
          classificationSource,
          aiResult,
        },
      });

      res.redirect(
        buildGroupPaymentsUrl(groupId, {
          pageId: currentPageId,
          success: "個別の関連支払いを登録しました。個人家計簿にも反映されています。",
          contextState,
        }),
      );
    } catch (error) {
      next(error);
    }
  },
);


app.get("/groups/:groupId/fund", requireAuthentication, async (req, res, next) => {
  const userId = req.session.userId;
  const groupId = parsePositiveInteger(req.params.groupId);

  if (!userId) {
    res.redirect("/?error=ログインしてください。");
    return;
  }

  if (!groupId) {
    res.redirect(buildAppUrl({ error: "グループが正しくありません。" }));
    return;
  }

  try {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { isActive: true },
    });

    if (!user?.isActive) {
      await destroySession(req);
      res.clearCookie(sessionCookieName);
      res.redirect("/?error=このアカウントは利用できません。");
      return;
    }

    const membership = await findActiveGroupMembership(userId, groupId);

    if (!membership) {
      res.status(403).send("このグループの基金を表示する権限がありません。");
      return;
    }

    const [fund, pages, activeMembers, refundRecipients] = await Promise.all([
      prisma.groupFund.findUnique({
        where: { groupId },
      }),
      prisma.ledgerPage.findMany({
        where: {
          groupId,
          pageType: "GROUP_FUND",
          userId: null,
        },
        orderBy: [{ isInitial: "desc" }, { sortOrder: "asc" }, { id: "asc" }],
      }),
      prisma.groupMember.findMany({
        where: {
          groupId,
          isActive: true,
          user: {
            isActive: true,
          },
        },
        include: {
          user: {
            select: {
              id: true,
              displayName: true,
            },
          },
        },
        orderBy: [{ role: "desc" }, { joinedAt: "asc" }, { userId: "asc" }],
      }),
      prisma.groupMember.findMany({
        where: {
          groupId,
          user: {
            isActive: true,
          },
        },
        include: {
          user: {
            select: {
              id: true,
              displayName: true,
            },
          },
        },
        orderBy: [{ isActive: "desc" }, { joinedAt: "asc" }, { userId: "asc" }],
      }),
    ]);

    if (!fund) {
      res.status(500).send("このグループの基金が見つかりません。");
      return;
    }

    const requestedPageId = parsePositiveInteger(req.query.pageId);
    const selectedPage =
      pages.find((page) => page.id === requestedPageId) ?? pages[0] ?? null;

    if (!selectedPage) {
      res.status(500).send("グループ基金の表示ページが見つかりません。");
      return;
    }

    const fundKinds = [
      "FUND_CONTRIBUTION",
      "FUND_INCOME",
      "FUND_EXPENSE",
      "FUND_REFUND",
    ] as const;
    const transactionDateFilter = buildTransactionDateFilter(
      selectedPage.startDate,
      selectedPage.endDate,
    );

    const [transactions, carryoverTransactions] = await Promise.all([
      prisma.transaction.findMany({
        where: {
          groupFundId: fund.id,
          kind: { in: [...fundKinds] },
          ...(Object.keys(transactionDateFilter).length > 0
            ? { transactionDate: transactionDateFilter }
            : {}),
        },
        include: {
          user: {
            select: {
              id: true,
              displayName: true,
            },
          },
        },
        orderBy: [
          { transactionDate: "desc" },
          { createdAt: "desc" },
          { id: "desc" },
        ],
      }),
      selectedPage.startDate
        ? prisma.transaction.findMany({
            where: {
              groupFundId: fund.id,
              kind: { in: [...fundKinds] },
              transactionDate: { lt: selectedPage.startDate },
            },
            select: { kind: true, amount: true },
          })
        : Promise.resolve([]),
    ]);

    const isFundIncome = (kind: string) =>
      kind === "FUND_CONTRIBUTION" || kind === "FUND_INCOME";

    const incomeTotal = transactions.reduce(
      (sum, transaction) =>
        isFundIncome(transaction.kind) ? sum + transaction.amount : sum,
      0,
    );
    const expenseTotal = transactions.reduce(
      (sum, transaction) =>
        isFundIncome(transaction.kind) ? sum : sum + transaction.amount,
      0,
    );
    const carryover = carryoverTransactions.reduce(
      (sum, transaction) =>
        isFundIncome(transaction.kind) ? sum + transaction.amount : sum - transaction.amount,
      0,
    );
    const balance = carryover + incomeTotal - expenseTotal;
    const error = typeof req.query.error === "string" ? req.query.error : null;
    const success = typeof req.query.success === "string" ? req.query.success : null;
    const contextState = parseFundContextState(req.query.context);

    res.render("fund", {
      currentUserId: userId,
      group: membership.group,
      membership,
      fund,
      pages,
      selectedPage,
      activeMembers,
      refundRecipients,
      transactions,
      summary: {
        carryover,
        incomeTotal,
        expenseTotal,
        balance,
      },
      error,
      success,
      isAdmin: membership.role === "ADMIN",
      canCreateFundTransaction: fund.isActive,
      fundIncomeCategories,
      fundExpenseCategories,
      today: getTokyoDateInputValue(),
      contextState,
      isContextOpen: contextState === "open",
      selectedPageForm: {
        startDate: selectedPage.startDate
          ? selectedPage.startDate.toISOString().slice(0, 10)
          : "",
        endDate: selectedPage.endDate
          ? selectedPage.endDate.toISOString().slice(0, 10)
          : "",
      },
      buildGroupFundUrl,
    });
  } catch (error) {
    next(error);
  }
});


app.post(
  "/groups/:groupId/fund/pages",
  requireAuthentication,
  async (req, res, next) => {
    const operatorUserId = req.session.userId;
    const groupId = parsePositiveInteger(req.params.groupId);
    const currentPageId = parsePositiveInteger(req.body.currentPageId);
    const contextState = parseFundContextState(req.body.contextState);

    if (!operatorUserId) {
      res.redirect("/?error=ログインしてください。");
      return;
    }

    if (!groupId) {
      res.redirect(buildAppUrl({ error: "グループが正しくありません。" }));
      return;
    }

    const name = String(req.body.name ?? "").trim();
    const startDate = parseOptionalDateOnly(req.body.startDate);
    const endDate = parseOptionalDateOnly(req.body.endDate);
    const validationError = validateLedgerPageInput({ name, startDate, endDate });

    try {
      const operator = await prisma.user.findUnique({
        where: { id: operatorUserId },
        select: { isActive: true },
      });

      if (!operator?.isActive) {
        await destroySession(req);
        res.clearCookie(sessionCookieName);
        res.redirect("/?error=このアカウントは利用できません。");
        return;
      }

      const adminMembership = await findActiveGroupAdminMembership(
        operatorUserId,
        groupId,
      );

      if (!adminMembership) {
        res.status(403).send("基金の表示ページを追加する権限がありません。");
        return;
      }

      const fund = await prisma.groupFund.findUnique({
        where: { groupId },
        select: { id: true },
      });

      if (!fund) {
        res.redirect(
          buildGroupFundUrl(groupId, {
            error: "グループ基金が見つからないため、表示ページを追加できません。",
            contextState,
          }),
        );
        return;
      }

      if (validationError) {
        res.redirect(
          buildGroupFundUrl(groupId, {
            pageId: currentPageId,
            error: validationError,
            contextState,
          }),
        );
        return;
      }

      const pageOrder = await prisma.ledgerPage.aggregate({
        where: {
          groupId,
          userId: null,
          pageType: "GROUP_FUND",
        },
        _max: { sortOrder: true },
      });

      const page = await prisma.ledgerPage.create({
        data: {
          pageType: "GROUP_FUND",
          userId: null,
          groupId,
          name,
          startDate: startDate.value,
          endDate: endDate.value,
          isInitial: false,
          sortOrder: (pageOrder._max.sortOrder ?? -1) + 1,
        },
      });

      res.redirect(
        buildGroupFundUrl(groupId, {
          pageId: page.id,
          success: "基金の表示ページを追加しました。",
          contextState,
        }),
      );
    } catch (error) {
      next(error);
    }
  },
);

app.post(
  "/groups/:groupId/fund/pages/:pageId",
  requireAuthentication,
  async (req, res, next) => {
    const operatorUserId = req.session.userId;
    const groupId = parsePositiveInteger(req.params.groupId);
    const pageId = parsePositiveInteger(req.params.pageId);
    const contextState = parseFundContextState(req.body.contextState);

    if (!operatorUserId) {
      res.redirect("/?error=ログインしてください。");
      return;
    }

    if (!groupId) {
      res.redirect(buildAppUrl({ error: "グループが正しくありません。" }));
      return;
    }

    if (!pageId) {
      res.redirect(
        buildGroupFundUrl(groupId, {
          error: "編集対象のページが正しくありません。",
          contextState,
        }),
      );
      return;
    }

    const name = String(req.body.name ?? "").trim();
    const startDate = parseOptionalDateOnly(req.body.startDate);
    const endDate = parseOptionalDateOnly(req.body.endDate);
    const validationError = validateLedgerPageInput({ name, startDate, endDate });

    try {
      const operator = await prisma.user.findUnique({
        where: { id: operatorUserId },
        select: { isActive: true },
      });

      if (!operator?.isActive) {
        await destroySession(req);
        res.clearCookie(sessionCookieName);
        res.redirect("/?error=このアカウントは利用できません。");
        return;
      }

      const adminMembership = await findActiveGroupAdminMembership(
        operatorUserId,
        groupId,
      );

      if (!adminMembership) {
        res.status(403).send("基金の表示ページを編集する権限がありません。");
        return;
      }

      const fund = await prisma.groupFund.findUnique({
        where: { groupId },
        select: { id: true },
      });

      if (!fund) {
        res.redirect(
          buildGroupFundUrl(groupId, {
            error: "グループ基金が見つからないため、表示ページを編集できません。",
            contextState,
          }),
        );
        return;
      }

      const page = await prisma.ledgerPage.findFirst({
        where: {
          id: pageId,
          groupId,
          userId: null,
          pageType: "GROUP_FUND",
        },
        select: { id: true },
      });

      if (!page) {
        res.redirect(
          buildGroupFundUrl(groupId, {
            error: "編集対象のページが見つかりません。",
            contextState,
          }),
        );
        return;
      }

      if (validationError) {
        res.redirect(
          buildGroupFundUrl(groupId, {
            pageId,
            error: validationError,
            contextState,
          }),
        );
        return;
      }

      await prisma.ledgerPage.update({
        where: { id: pageId },
        data: {
          name,
          startDate: startDate.value,
          endDate: endDate.value,
        },
      });

      res.redirect(
        buildGroupFundUrl(groupId, {
          pageId,
          success: "基金の表示ページを更新しました。",
          contextState,
        }),
      );
    } catch (error) {
      next(error);
    }
  },
);

app.post(
  "/groups/:groupId/fund/pages/:pageId/delete",
  requireAuthentication,
  async (req, res, next) => {
    const operatorUserId = req.session.userId;
    const groupId = parsePositiveInteger(req.params.groupId);
    const pageId = parsePositiveInteger(req.params.pageId);
    const contextState = parseFundContextState(req.body.contextState);

    if (!operatorUserId) {
      res.redirect("/?error=ログインしてください。");
      return;
    }

    if (!groupId) {
      res.redirect(buildAppUrl({ error: "グループが正しくありません。" }));
      return;
    }

    if (!pageId) {
      res.redirect(
        buildGroupFundUrl(groupId, {
          error: "削除対象のページが正しくありません。",
          contextState,
        }),
      );
      return;
    }

    try {
      const operator = await prisma.user.findUnique({
        where: { id: operatorUserId },
        select: { isActive: true },
      });

      if (!operator?.isActive) {
        await destroySession(req);
        res.clearCookie(sessionCookieName);
        res.redirect("/?error=このアカウントは利用できません。");
        return;
      }

      const adminMembership = await findActiveGroupAdminMembership(
        operatorUserId,
        groupId,
      );

      if (!adminMembership) {
        res.status(403).send("基金の表示ページを削除する権限がありません。");
        return;
      }

      const fund = await prisma.groupFund.findUnique({
        where: { groupId },
        select: { id: true },
      });

      if (!fund) {
        res.redirect(
          buildGroupFundUrl(groupId, {
            error: "グループ基金が見つからないため、表示ページを削除できません。",
            contextState,
          }),
        );
        return;
      }

      const page = await prisma.ledgerPage.findFirst({
        where: {
          id: pageId,
          groupId,
          userId: null,
          pageType: "GROUP_FUND",
        },
        select: {
          id: true,
          isInitial: true,
        },
      });

      if (!page) {
        res.redirect(
          buildGroupFundUrl(groupId, {
            error: "削除対象のページが見つかりません。",
            contextState,
          }),
        );
        return;
      }

      if (page.isInitial) {
        res.redirect(
          buildGroupFundUrl(groupId, {
            pageId,
            error: "初期ページは削除できません。",
            contextState,
          }),
        );
        return;
      }

      await prisma.ledgerPage.delete({
        where: { id: pageId },
      });

      const fallbackPage = await prisma.ledgerPage.findFirst({
        where: {
          groupId,
          userId: null,
          pageType: "GROUP_FUND",
        },
        orderBy: [{ isInitial: "desc" }, { sortOrder: "asc" }, { id: "asc" }],
        select: { id: true },
      });

      res.redirect(
        buildGroupFundUrl(groupId, {
          pageId: fallbackPage?.id,
          success: "基金の表示ページを削除しました。",
          contextState,
        }),
      );
    } catch (error) {
      next(error);
    }
  },
);


app.post(
  "/groups/:groupId/fund/transactions/contribution",
  requireAuthentication,
  async (req, res, next) => {
    const userId = req.session.userId;
    const groupId = parsePositiveInteger(req.params.groupId);
    const currentPageId = parsePositiveInteger(req.body.currentPageId);
    const contextState = parseFundContextState(req.body.contextState);

    if (!userId) {
      res.redirect("/?error=ログインしてください。");
      return;
    }

    if (!groupId) {
      res.redirect(buildAppUrl({ error: "グループが正しくありません。" }));
      return;
    }

    const transactionDate = parseDateOnly(req.body.transactionDate);
    const amount = parsePositiveInteger(req.body.amount);
    const rawText = String(req.body.rawText ?? "").trim();
    const validationError = validateFundContributionInput({
      transactionDate,
      amount,
      rawText,
    });

    try {
      const user = await prisma.user.findUnique({
        where: { id: userId },
        select: { isActive: true },
      });

      if (!user?.isActive) {
        await destroySession(req);
        res.clearCookie(sessionCookieName);
        res.redirect("/?error=このアカウントは利用できません。");
        return;
      }

      if (validationError) {
        res.redirect(
          buildGroupFundUrl(groupId, {
            pageId: currentPageId,
            error: validationError,
            contextState,
          }),
        );
        return;
      }

      const result = await createFundContributionTransaction({
        userId,
        groupId,
        transactionDate: transactionDate!,
        amount: amount!,
        rawText,
      });

      if (result.status === "membership-not-found") {
        res.status(403).send("このグループへ基金拠出する権限がありません。");
        return;
      }

      if (result.status === "fund-unavailable") {
        res.redirect(
          buildGroupFundUrl(groupId, {
            pageId: currentPageId,
            error: "有効なグループ基金が見つからないため、基金拠出を登録できません。",
            contextState,
          }),
        );
        return;
      }

      res.redirect(
        buildGroupFundUrl(groupId, {
          pageId: currentPageId,
          success: "基金へ拠出しました。",
          contextState,
        }),
      );
    } catch (error) {
      next(error);
    }
  },
);


app.post(
  "/groups/:groupId/fund/transactions/income",
  requireAuthentication,
  async (req, res, next) => {
    const operatorUserId = req.session.userId;
    const groupId = parsePositiveInteger(req.params.groupId);
    const currentPageId = parsePositiveInteger(req.body.currentPageId);
    const contextState = parseFundContextState(req.body.contextState);

    if (!operatorUserId) {
      res.redirect("/?error=ログインしてください。");
      return;
    }

    if (!groupId) {
      res.redirect(buildAppUrl({ error: "グループが正しくありません。" }));
      return;
    }

    const transactionDate = parseDateOnly(req.body.transactionDate);
    const amount = parsePositiveInteger(req.body.amount);
    const rawText = String(req.body.rawText ?? "").trim();
    const category = String(req.body.category ?? "").trim();
    const suggestionToken = String(req.body.suggestionToken ?? "").trim();
    const relatedUserIdText = String(req.body.relatedUserId ?? "").trim();
    const relatedUserId = relatedUserIdText
      ? parsePositiveInteger(relatedUserIdText)
      : null;
    const validationError = validateFundIncomeInput({
      transactionDate,
      amount,
      rawText,
      category,
      relatedUserIdText,
      relatedUserId,
    });

    try {
      const operator = await prisma.user.findUnique({
        where: { id: operatorUserId },
        select: { isActive: true },
      });

      if (!operator?.isActive) {
        await destroySession(req);
        res.clearCookie(sessionCookieName);
        res.redirect("/?error=このアカウントは利用できません。");
        return;
      }

      const membership = await findActiveGroupMembership(operatorUserId, groupId);

      if (!membership) {
        res.status(403).send("基金収入を登録する権限がありません。");
        return;
      }

      const fund = await prisma.groupFund.findUnique({
        where: { groupId },
        select: { id: true, isActive: true },
      });

      if (!fund?.isActive) {
        res.redirect(
          buildGroupFundUrl(groupId, {
            pageId: currentPageId,
            error: "有効なグループ基金が見つからないため、基金収入を登録できません。",
            contextState,
          }),
        );
        return;
      }

      if (validationError) {
        res.redirect(
          buildGroupFundUrl(groupId, {
            pageId: currentPageId,
            error: validationError,
            contextState,
          }),
        );
        return;
      }

      if (relatedUserId) {
        const relatedMembership = await prisma.groupMember.findFirst({
          where: {
            groupId,
            userId: relatedUserId,
            isActive: true,
            user: { isActive: true },
          },
          select: { userId: true },
        });

        if (!relatedMembership) {
          res.redirect(
            buildGroupFundUrl(groupId, {
              pageId: currentPageId,
              error: "関係者には対象グループの有効メンバーを選択してください。",
              contextState,
            }),
          );
          return;
        }
      }

      const verifiedSuggestion = suggestionToken
        ? verifySuggestionToken({ token: suggestionToken, userId: operatorUserId, secret: sessionSecret })
        : null;
      const { classificationSource, aiResult } = resolveTransactionClassification({
        payload: verifiedSuggestion,
        expectedTarget: "FUND_INCOME",
        expectedGroupId: groupId,
        selectedCategory: category,
        finalKind: "income",
        finalAmount: amount!,
        finalTransactionDate: String(req.body.transactionDate ?? "").trim(),
        finalCategory: category,
        finalRawText: rawText,
      });

      await prisma.transaction.create({
        data: {
          userId: relatedUserId,
          groupId,
          groupFundId: fund.id,
          kind: "FUND_INCOME",
          amount: amount!,
          category,
          rawText,
          transactionDate: transactionDate!,
          paymentBatchId: null,
          calculationMethod: null,
          classificationSource,
          aiResult,
        },
      });

      res.redirect(
        buildGroupFundUrl(groupId, {
          pageId: currentPageId,
          success: "基金収入を登録しました。",
          contextState,
        }),
      );
    } catch (error) {
      next(error);
    }
  },
);


app.post(
  "/groups/:groupId/fund/transactions/expense",
  requireAuthentication,
  async (req, res, next) => {
    const operatorUserId = req.session.userId;
    const groupId = parsePositiveInteger(req.params.groupId);
    const currentPageId = parsePositiveInteger(req.body.currentPageId);
    const contextState = parseFundContextState(req.body.contextState);

    if (!operatorUserId) {
      res.redirect("/?error=ログインしてください。");
      return;
    }

    if (!groupId) {
      res.redirect(buildAppUrl({ error: "グループが正しくありません。" }));
      return;
    }

    const transactionDate = parseDateOnly(req.body.transactionDate);
    const amount = parsePositiveInteger(req.body.amount);
    const rawText = String(req.body.rawText ?? "").trim();
    const category = String(req.body.category ?? "").trim();
    const suggestionToken = String(req.body.suggestionToken ?? "").trim();
    const relatedUserIdText = String(req.body.relatedUserId ?? "").trim();
    const relatedUserId = relatedUserIdText
      ? parsePositiveInteger(relatedUserIdText)
      : null;
    const validationError = validateFundExpenseInput({
      transactionDate,
      amount,
      rawText,
      category,
      relatedUserIdText,
      relatedUserId,
    });

    try {
      const operator = await prisma.user.findUnique({
        where: { id: operatorUserId },
        select: { isActive: true },
      });

      if (!operator?.isActive) {
        await destroySession(req);
        res.clearCookie(sessionCookieName);
        res.redirect("/?error=このアカウントは利用できません。");
        return;
      }

      const membership = await findActiveGroupMembership(operatorUserId, groupId);

      if (!membership) {
        res.status(403).send("基金支出を登録する権限がありません。");
        return;
      }

      const fund = await prisma.groupFund.findUnique({
        where: { groupId },
        select: { id: true, isActive: true },
      });

      if (!fund?.isActive) {
        res.redirect(
          buildGroupFundUrl(groupId, {
            pageId: currentPageId,
            error: "有効なグループ基金が見つからないため、基金支出を登録できません。",
            contextState,
          }),
        );
        return;
      }

      if (validationError) {
        res.redirect(
          buildGroupFundUrl(groupId, {
            pageId: currentPageId,
            error: validationError,
            contextState,
          }),
        );
        return;
      }

      if (relatedUserId) {
        const relatedMembership = await prisma.groupMember.findFirst({
          where: {
            groupId,
            userId: relatedUserId,
            isActive: true,
            user: { isActive: true },
          },
          select: { userId: true },
        });

        if (!relatedMembership) {
          res.redirect(
            buildGroupFundUrl(groupId, {
              pageId: currentPageId,
              error: "関係者には対象グループの有効メンバーを選択してください。",
              contextState,
            }),
          );
          return;
        }
      }

      const verifiedSuggestion = suggestionToken
        ? verifySuggestionToken({ token: suggestionToken, userId: operatorUserId, secret: sessionSecret })
        : null;
      const { classificationSource, aiResult } = resolveTransactionClassification({
        payload: verifiedSuggestion,
        expectedTarget: "FUND_EXPENSE",
        expectedGroupId: groupId,
        selectedCategory: category,
        finalKind: "expense",
        finalAmount: amount!,
        finalTransactionDate: String(req.body.transactionDate ?? "").trim(),
        finalCategory: category,
        finalRawText: rawText,
      });

      await prisma.transaction.create({
        data: {
          userId: relatedUserId,
          groupId,
          groupFundId: fund.id,
          kind: "FUND_EXPENSE",
          amount: amount!,
          category,
          rawText,
          transactionDate: transactionDate!,
          paymentBatchId: null,
          calculationMethod: null,
          classificationSource,
          aiResult,
        },
      });

      res.redirect(
        buildGroupFundUrl(groupId, {
          pageId: currentPageId,
          success: "基金支出を登録しました。",
          contextState,
        }),
      );
    } catch (error) {
      next(error);
    }
  },
);


app.post(
  "/groups/:groupId/fund/transactions/refund",
  requireAuthentication,
  async (req, res, next) => {
    const operatorUserId = req.session.userId;
    const groupId = parsePositiveInteger(req.params.groupId);
    const currentPageId = parsePositiveInteger(req.body.currentPageId);
    const contextState = parseFundContextState(req.body.contextState);

    if (!operatorUserId) {
      res.redirect("/?error=ログインしてください。");
      return;
    }

    if (!groupId) {
      res.redirect(buildAppUrl({ error: "グループが正しくありません。" }));
      return;
    }

    const transactionDate = parseDateOnly(req.body.transactionDate);
    const amount = parsePositiveInteger(req.body.amount);
    const rawText = String(req.body.rawText ?? "").trim();
    const recipientUserIdText = String(req.body.recipientUserId ?? "").trim();
    const recipientUserId = recipientUserIdText
      ? parsePositiveInteger(recipientUserIdText)
      : null;
    const validationError = validateFundRefundInput({
      transactionDate,
      amount,
      rawText,
      recipientUserIdText,
      recipientUserId,
    });

    try {
      const operator = await prisma.user.findUnique({
        where: { id: operatorUserId },
        select: { isActive: true },
      });

      if (!operator?.isActive) {
        await destroySession(req);
        res.clearCookie(sessionCookieName);
        res.redirect("/?error=このアカウントは利用できません。");
        return;
      }

      const membership = await findActiveGroupMembership(operatorUserId, groupId);

      if (!membership) {
        res.status(403).send("基金返金を登録する権限がありません。");
        return;
      }

      const fund = await prisma.groupFund.findUnique({
        where: { groupId },
        select: { id: true, isActive: true },
      });

      if (!fund?.isActive) {
        res.redirect(
          buildGroupFundUrl(groupId, {
            pageId: currentPageId,
            error: "有効なグループ基金が見つからないため、基金返金を登録できません。",
            contextState,
          }),
        );
        return;
      }

      if (validationError) {
        res.redirect(
          buildGroupFundUrl(groupId, {
            pageId: currentPageId,
            error: validationError,
            contextState,
          }),
        );
        return;
      }

      if (recipientUserId) {
        const recipientMembership = await prisma.groupMember.findFirst({
          where: {
            groupId,
            userId: recipientUserId,
            user: { isActive: true },
          },
          select: { userId: true },
        });

        if (!recipientMembership) {
          res.redirect(
            buildGroupFundUrl(groupId, {
              pageId: currentPageId,
              error: "返金先には、このグループの有効メンバーまたは脱退済みメンバーを選択してください。",
              contextState,
            }),
          );
          return;
        }
      }

      await prisma.transaction.create({
        data: {
          userId: recipientUserId,
          groupId,
          groupFundId: fund.id,
          kind: "FUND_REFUND",
          amount: amount!,
          category: fundRefundCategory,
          rawText,
          transactionDate: transactionDate!,
          paymentBatchId: null,
          calculationMethod: null,
          classificationSource: "MANUAL",
          aiResult: null,
        },
      });

      res.redirect(
        buildGroupFundUrl(groupId, {
          pageId: currentPageId,
          success: recipientUserId
            ? "ユーザーへの基金返金を登録しました。"
            : "外部への基金返金を登録しました。",
          contextState,
        }),
      );
    } catch (error) {
      next(error);
    }
  },
);


app.post(
  "/groups/:groupId/name",
  requireAuthentication,
  async (req, res, next) => {
    const operatorUserId = req.session.userId;
    const groupId = parsePositiveInteger(req.params.groupId);
    const name = String(req.body.name ?? "").trim();
    const validationError = validateGroupName(name);

    if (!operatorUserId) {
      res.redirect("/?error=ログインしてください。");
      return;
    }

    if (!groupId) {
      res.redirect(buildAppUrl({ error: "グループが正しくありません。" }));
      return;
    }

    try {
      const operator = await prisma.user.findUnique({
        where: { id: operatorUserId },
        select: { isActive: true },
      });

      if (!operator?.isActive) {
        await destroySession(req);
        res.clearCookie(sessionCookieName);
        res.redirect("/?error=このアカウントは利用できません。");
        return;
      }

      const adminMembership = await findActiveGroupAdminMembership(
        operatorUserId,
        groupId,
      );

      if (!adminMembership) {
        res.status(403).send("グループ名を変更する権限がありません。");
        return;
      }

      if (validationError) {
        res.redirect(buildGroupUrl(groupId, { error: validationError }));
        return;
      }

      const result = await prisma.$transaction(
        async (tx) => {
          const membership = await tx.groupMember.findUnique({
            where: {
              userId_groupId: {
                userId: operatorUserId,
                groupId,
              },
            },
            include: {
              group: true,
            },
          });

          if (
            !membership?.isActive ||
            membership.role !== "ADMIN" ||
            !membership.group.isActive
          ) {
            throw new GroupAuthorizationError(
              "グループ名を変更する権限がありません。",
            );
          }

          const currentGroup = await tx.expenseGroup.findUnique({
            where: { id: groupId },
          });

          if (!currentGroup?.isActive) {
            throw new GroupMemberOperationError(
              "対象の有効なグループが見つかりません。",
            );
          }

          const currentFund = await tx.groupFund.findUnique({
            where: { groupId },
          });

          if (!currentFund) {
            throw new GroupMemberOperationError(
              "グループ基金が見つからないため、グループ名を変更できません。",
            );
          }

          const shouldRenameFund =
            currentFund.name === `${currentGroup.name}基金`;

          await tx.expenseGroup.update({
            where: { id: groupId },
            data: { name },
          });

          if (shouldRenameFund) {
            await tx.groupFund.update({
              where: { groupId },
              data: { name: `${name}基金` },
            });
          }

          return { fundNameChanged: shouldRenameFund };
        },
        { isolationLevel: "Serializable" },
      );

      res.redirect(
        buildGroupUrl(groupId, {
          success: result.fundNameChanged
            ? "グループ名と基金名を変更しました。"
            : "グループ名を変更しました。",
        }),
      );
    } catch (error) {
      if (error instanceof GroupAuthorizationError) {
        res.status(403).send(error.message);
        return;
      }

      if (error instanceof GroupMemberOperationError) {
        res.redirect(buildGroupUrl(groupId, { error: error.message }));
        return;
      }

      if (
        typeof error === "object" &&
        error !== null &&
        "code" in error &&
        error.code === "P2034"
      ) {
        res.redirect(
          buildGroupUrl(groupId, {
            error:
              "同時にグループ情報が更新されました。画面を確認して再度操作してください。",
          }),
        );
        return;
      }

      next(error);
    }
  },
);


app.post(
  "/groups/:groupId/members",
  requireAuthentication,
  async (req, res, next) => {
    const operatorUserId = req.session.userId;
    const groupId = parsePositiveInteger(req.params.groupId);
    const targetLoginId = normalizeLoginId(req.body.loginId);

    if (!operatorUserId) {
      res.redirect("/?error=ログインしてください。");
      return;
    }

    if (!groupId) {
      res.redirect(buildAppUrl({ error: "グループが正しくありません。" }));
      return;
    }

    if (!targetLoginId) {
      res.redirect(
        buildGroupUrl(groupId, {
          error: "追加するユーザーID（ログインID）を入力してください。",
        }),
      );
      return;
    }

    if (targetLoginId.length > 50) {
      res.redirect(
        buildGroupUrl(groupId, {
          error: "ユーザーID（ログインID）は50文字以内で入力してください。",
        }),
      );
      return;
    }

    try {
      const operator = await prisma.user.findUnique({
        where: { id: operatorUserId },
        select: { isActive: true },
      });

      if (!operator?.isActive) {
        await destroySession(req);
        res.clearCookie(sessionCookieName);
        res.redirect("/?error=このアカウントは利用できません。");
        return;
      }

      const adminMembership = await findActiveGroupAdminMembership(
        operatorUserId,
        groupId,
      );

      if (!adminMembership) {
        res.status(403).send("メンバーを追加する権限がありません。");
        return;
      }

      const targetUser = await prisma.user.findUnique({
        where: { loginId: targetLoginId },
        select: {
          id: true,
          displayName: true,
          isActive: true,
        },
      });

      if (!targetUser?.isActive) {
        res.redirect(
          buildGroupUrl(groupId, {
            error: "利用可能なユーザーが見つかりません。",
          }),
        );
        return;
      }

      if (targetUser.id === operatorUserId) {
        res.redirect(
          buildGroupUrl(groupId, {
            error: "自分自身はすでにこのグループへ所属しています。",
          }),
        );
        return;
      }

      await activateGroupMembership(prisma, {
        groupId,
        userId: targetUser.id,
        role: "MEMBER",
      });

      res.redirect(
        buildGroupUrl(groupId, {
          success: `${targetUser.displayName}さんをメンバーとして追加しました。`,
        }),
      );
    } catch (error) {
      if (
        error instanceof ActiveGroupMembershipError ||
        (typeof error === "object" &&
          error !== null &&
          "code" in error &&
          error.code === "P2002")
      ) {
        res.redirect(
          buildGroupUrl(groupId, {
            error: "そのユーザーはすでにグループへ所属しています。",
          }),
        );
        return;
      }

      next(error);
    }
  },
);


app.post(
  "/groups/:groupId/members/:memberUserId/role",
  requireAuthentication,
  async (req, res, next) => {
    const operatorUserId = req.session.userId;
    const groupId = parsePositiveInteger(req.params.groupId);
    const memberUserId = parsePositiveInteger(req.params.memberUserId);
    const roleInput = String(req.body.role ?? "").trim();
    const role =
      roleInput === "MEMBER" || roleInput === "ADMIN" ? roleInput : null;

    if (!operatorUserId) {
      res.redirect("/?error=ログインしてください。");
      return;
    }

    if (!groupId) {
      res.redirect(buildAppUrl({ error: "グループが正しくありません。" }));
      return;
    }

    if (!memberUserId || !role) {
      res.redirect(
        buildGroupUrl(groupId, {
          error: "変更するメンバーまたは権限の指定が正しくありません。",
        }),
      );
      return;
    }

    try {
      const operator = await prisma.user.findUnique({
        where: { id: operatorUserId },
        select: { isActive: true },
      });

      if (!operator?.isActive) {
        await destroySession(req);
        res.clearCookie(sessionCookieName);
        res.redirect("/?error=このアカウントは利用できません。");
        return;
      }

      const adminMembership = await findActiveGroupAdminMembership(
        operatorUserId,
        groupId,
      );

      if (!adminMembership) {
        res.status(403).send("メンバー権限を変更する権限がありません。");
        return;
      }

      const result = await prisma.$transaction(
        async (tx) => {
          const targetMembership = await tx.groupMember.findUnique({
            where: {
              userId_groupId: {
                userId: memberUserId,
                groupId,
              },
            },
            include: {
              user: {
                select: {
                  displayName: true,
                  isActive: true,
                },
              },
            },
          });

          if (!targetMembership?.isActive || !targetMembership.user.isActive) {
            throw new GroupMemberOperationError(
              "対象の有効なメンバーが見つかりません。",
            );
          }

          if (targetMembership.role === role) {
            return {
              changed: false,
              displayName: targetMembership.user.displayName,
            };
          }

          if (targetMembership.role === "ADMIN" && role === "MEMBER") {
            const activeAdminCount = await tx.groupMember.count({
              where: {
                groupId,
                role: "ADMIN",
                isActive: true,
                user: {
                  isActive: true,
                },
              },
            });

            if (activeAdminCount <= 1) {
              throw new GroupMemberOperationError(
                "唯一の有効なグループ管理者はメンバーへ変更できません。",
              );
            }
          }

          await tx.groupMember.update({
            where: {
              userId_groupId: {
                userId: memberUserId,
                groupId,
              },
            },
            data: { role },
          });

          return {
            changed: true,
            displayName: targetMembership.user.displayName,
          };
        },
        { isolationLevel: "Serializable" },
      );

      res.redirect(
        buildGroupUrl(groupId, {
          success: result.changed
            ? `${result.displayName}さんの権限を変更しました。`
            : `${result.displayName}さんの権限は変更されていません。`,
        }),
      );
    } catch (error) {
      if (error instanceof GroupMemberOperationError) {
        res.redirect(buildGroupUrl(groupId, { error: error.message }));
        return;
      }

      if (
        typeof error === "object" &&
        error !== null &&
        "code" in error &&
        error.code === "P2034"
      ) {
        res.redirect(
          buildGroupUrl(groupId, {
            error: "同時にメンバー情報が更新されました。画面を確認して再度操作してください。",
          }),
        );
        return;
      }

      next(error);
    }
  },
);

app.post(
  "/groups/:groupId/members/:memberUserId/remove",
  requireAuthentication,
  async (req, res, next) => {
    const operatorUserId = req.session.userId;
    const groupId = parsePositiveInteger(req.params.groupId);
    const memberUserId = parsePositiveInteger(req.params.memberUserId);

    if (!operatorUserId) {
      res.redirect("/?error=ログインしてください。");
      return;
    }

    if (!groupId) {
      res.redirect(buildAppUrl({ error: "グループが正しくありません。" }));
      return;
    }

    if (!memberUserId) {
      res.redirect(
        buildGroupUrl(groupId, {
          error: "脱退処理するメンバーの指定が正しくありません。",
        }),
      );
      return;
    }

    if (memberUserId === operatorUserId) {
      res.redirect(
        buildGroupUrl(groupId, {
          error: "本人による自主脱退は現在実装していません。",
        }),
      );
      return;
    }

    try {
      const operator = await prisma.user.findUnique({
        where: { id: operatorUserId },
        select: { isActive: true },
      });

      if (!operator?.isActive) {
        await destroySession(req);
        res.clearCookie(sessionCookieName);
        res.redirect("/?error=このアカウントは利用できません。");
        return;
      }

      const adminMembership = await findActiveGroupAdminMembership(
        operatorUserId,
        groupId,
      );

      if (!adminMembership) {
        res.status(403).send("メンバーを脱退処理する権限がありません。");
        return;
      }

      const removedMember = await prisma.$transaction(
        async (tx) => {
          const targetMembership = await tx.groupMember.findUnique({
            where: {
              userId_groupId: {
                userId: memberUserId,
                groupId,
              },
            },
            include: {
              user: {
                select: {
                  displayName: true,
                  isActive: true,
                },
              },
            },
          });

          if (!targetMembership?.isActive || !targetMembership.user.isActive) {
            throw new GroupMemberOperationError(
              "対象の有効なメンバーが見つかりません。",
            );
          }

          if (targetMembership.role === "ADMIN") {
            const activeAdminCount = await tx.groupMember.count({
              where: {
                groupId,
                role: "ADMIN",
                isActive: true,
                user: {
                  isActive: true,
                },
              },
            });

            if (activeAdminCount <= 1) {
              throw new GroupMemberOperationError(
                "唯一の有効なグループ管理者は脱退処理できません。",
              );
            }
          }

          await tx.groupMember.update({
            where: {
              userId_groupId: {
                userId: memberUserId,
                groupId,
              },
            },
            data: {
              isActive: false,
              leftAt: new Date(),
            },
          });

          return targetMembership.user.displayName;
        },
        { isolationLevel: "Serializable" },
      );

      res.redirect(
        buildGroupUrl(groupId, {
          success: `${removedMember}さんを脱退済みにしました。`,
        }),
      );
    } catch (error) {
      if (error instanceof GroupMemberOperationError) {
        res.redirect(buildGroupUrl(groupId, { error: error.message }));
        return;
      }

      if (
        typeof error === "object" &&
        error !== null &&
        "code" in error &&
        error.code === "P2034"
      ) {
        res.redirect(
          buildGroupUrl(groupId, {
            error: "同時にメンバー情報が更新されました。画面を確認して再度操作してください。",
          }),
        );
        return;
      }

      next(error);
    }
  },
);

app.post("/app/fund-contributions", requireAuthentication, async (req, res, next) => {
  const userId = req.session.userId;
  const pageId = parsePositiveInteger(req.body.pageId);
  const groupId = parsePositiveInteger(req.body.groupId);
  const transactionDate = parseDateOnly(req.body.transactionDate);
  const amount = parsePositiveInteger(req.body.amount);
  const rawText = String(req.body.rawText ?? "").trim();

  if (!userId) {
    res.redirect("/?error=ログインしてください。");
    return;
  }

  if (!groupId) {
    res.redirect(
      buildAppUrl({
        pageId,
        error: "拠出先のグループを選択してください。",
      }),
    );
    return;
  }

  const validationError = validateFundContributionInput({
    transactionDate,
    amount,
    rawText,
  });

  if (validationError) {
    res.redirect(buildAppUrl({ pageId, error: validationError }));
    return;
  }

  try {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { isActive: true },
    });

    if (!user?.isActive) {
      await destroySession(req);
      res.clearCookie(sessionCookieName);
      res.redirect("/?error=このアカウントは利用できません。");
      return;
    }

    const result = await createFundContributionTransaction({
      userId,
      groupId,
      transactionDate: transactionDate!,
      amount: amount!,
      rawText,
    });

    if (result.status === "membership-not-found") {
      res.redirect(
        buildAppUrl({
          pageId,
          error: "現在所属している有効なグループを選択してください。",
        }),
      );
      return;
    }

    if (result.status === "fund-unavailable") {
      res.redirect(
        buildAppUrl({
          pageId,
          error: "有効なグループ基金が見つからないため、基金拠出を登録できません。",
        }),
      );
      return;
    }

    res.redirect(
      buildAppUrl({
        pageId,
        success: "基金へ拠出しました。",
      }),
    );
  } catch (error) {
    next(error);
  }
});


app.post(
  "/api/ai/analyze-personal-ledger",
  requireAuthentication,
  express.json({ limit: "2kb" }),
  async (req, res) => {
    const userId = req.session.userId;
    if (!userId) {
      res.status(401).json({ ok: false, message: "ログインしてください。" });
      return;
    }
    if (!isSameOriginAiRequest(req)) {
      res.status(403).json({ ok: false, message: "この操作は許可されていません。" });
      return;
    }

    const pageId = parsePositiveInteger(req.body?.pageId);
    if (!pageId) {
      res.status(400).json({ ok: false, message: "分析対象ページを正しく指定してください。" });
      return;
    }

    try {
      const [user, page] = await Promise.all([
        prisma.user.findUnique({
          where: { id: userId },
          select: { isActive: true },
        }),
        prisma.ledgerPage.findFirst({
          where: { id: pageId, userId, pageType: "PERSONAL" },
          select: { id: true, name: true, startDate: true, endDate: true },
        }),
      ]);

      if (!user?.isActive) {
        res.status(401).json({ ok: false, message: "このアカウントは利用できません。" });
        return;
      }
      if (!page) {
        res.status(404).json({ ok: false, message: "分析対象の個人家計簿ページが見つかりません。" });
        return;
      }

      const transactions = await prisma.transaction.findMany({
        where: {
          userId,
          kind: { in: [...PERSONAL_LEDGER_TRANSACTION_KINDS] },
        },
        select: {
          kind: true,
          amount: true,
          category: true,
          transactionDate: true,
        },
      });

      const aggregate = buildPersonalLedgerAnalysisAggregate({
        transactions: transactions.map((transaction) => ({
          ...transaction,
          kind: transaction.kind as PersonalLedgerTransactionKind,
        })),
        period: { startDate: page.startDate, endDate: page.endDate },
      });
      const automaticSummary = buildPersonalLedgerAutomaticSummary(aggregate);

      try {
        if (!aiFoundation) throw new AiError("CONFIGURATION_ERROR");
        const result = await analyzePersonalLedgerWithAi({
          foundation: aiFoundation,
          userId,
          aggregate,
        });
        res.json({
          ok: true,
          source: "AI",
          pageName: page.name,
          period: aggregate.period,
          analysis: normalizeFinancialAnalysis(result.data, aggregate),
          message: "AI分析を表示しました。集計値に基づく参考情報として確認してください。",
        });
      } catch (error) {
        const publicError = toPublicAiError(error);
        res.status(publicError.status).json({
          ok: false,
          source: "AUTOMATIC_SUMMARY",
          pageName: page.name,
          period: aggregate.period,
          analysis: automaticSummary,
          message: `${publicError.message} AI分析の代わりに自動集計を表示しました。`,
        });
      }
    } catch (error) {
      console.error("[AI] Personal ledger aggregate could not be calculated.");
      res.status(500).json({
        ok: false,
        message: "収支集計を作成できませんでした。時間をおいてお試しください。",
      });
    }
  },
);

app.post(
  "/api/ai/analyze-group-payments",
  requireAuthentication,
  express.json({ limit: "2kb" }),
  async (req, res) => {
    const userId = req.session.userId;
    if (!userId) {
      res.status(401).json({ ok: false, message: "ログインしてください。" });
      return;
    }
    if (!isSameOriginAiRequest(req)) {
      res.status(403).json({ ok: false, message: "この操作は許可されていません。" });
      return;
    }

    const groupId = parsePositiveInteger(req.body?.groupId);
    const pageId = parsePositiveInteger(req.body?.pageId);
    if (!groupId || !pageId) {
      res.status(400).json({ ok: false, message: "分析対象を正しく指定してください。" });
      return;
    }

    try {
      const [user, membership, page] = await Promise.all([
        prisma.user.findUnique({
          where: { id: userId },
          select: { isActive: true },
        }),
        findActiveGroupMembership(userId, groupId),
        prisma.ledgerPage.findFirst({
          where: { id: pageId, groupId, pageType: "GROUP_PAYMENT" },
          select: { id: true, name: true, startDate: true, endDate: true },
        }),
      ]);

      if (!user?.isActive) {
        res.status(401).json({ ok: false, message: "このアカウントは利用できません。" });
        return;
      }
      if (!membership) {
        res.status(403).json({ ok: false, message: "このグループの関連支払いを分析する権限がありません。" });
        return;
      }
      if (!page) {
        res.status(404).json({ ok: false, message: "分析対象の関連支払いページが見つかりません。" });
        return;
      }

      const transactions = await prisma.transaction.findMany({
        where: { groupId, kind: "GROUP_PAYMENT" },
        select: {
          amount: true,
          category: true,
          transactionDate: true,
          paymentBatchId: true,
        },
      });

      const aggregate = buildGroupPaymentAnalysisAggregate({
        transactions,
        period: { startDate: page.startDate, endDate: page.endDate },
      });
      const automaticSummary = buildGroupPaymentAutomaticSummary(aggregate);

      try {
        if (!aiFoundation) throw new AiError("CONFIGURATION_ERROR");
        const result = await analyzeGroupPaymentsWithAi({
          foundation: aiFoundation,
          userId,
          aggregate,
        });
        res.json({
          ok: true,
          source: "AI",
          pageName: page.name,
          period: aggregate.period,
          analysis: normalizeFinancialAnalysis(result.data, aggregate),
          message: "AI分析を表示しました。個人別情報を含まない集計値に基づく参考情報です。",
        });
      } catch (error) {
        const publicError = toPublicAiError(error);
        res.status(publicError.status).json({
          ok: false,
          source: "AUTOMATIC_SUMMARY",
          pageName: page.name,
          period: aggregate.period,
          analysis: automaticSummary,
          message: `${publicError.message} AI分析の代わりに自動集計を表示しました。`,
        });
      }
    } catch (error) {
      console.error("[AI] Group payment aggregate could not be calculated.");
      res.status(500).json({
        ok: false,
        message: "関連支払い集計を作成できませんでした。時間をおいてお試しください。",
      });
    }
  },
);

app.post(
  "/api/ai/classify-transaction",
  requireAuthentication,
  express.json({ limit: "4kb" }),
  async (req, res) => {
    const userId = req.session.userId;
    if (!userId) {
      res.status(401).json({ ok: false, message: "ログインしてください。" });
      return;
    }
    if (!isSameOriginAiRequest(req)) {
      res.status(403).json({ ok: false, message: "この操作は許可されていません。" });
      return;
    }

    const rawText = String(req.body?.rawText ?? "").trim();
    const targetInput = String(req.body?.target ?? "PERSONAL").trim();
    const target: ClassificationTarget | null = ["PERSONAL", "GROUP_PAYMENT", "FUND_INCOME", "FUND_EXPENSE"].includes(targetInput)
      ? targetInput as ClassificationTarget
      : null;
    const groupId = target && target !== "PERSONAL" ? parsePositiveInteger(req.body?.groupId) : null;
    const fallbackKindInput = String(req.body?.fallbackKind ?? "").trim();
    const personalKindIsValid = fallbackKindInput === "income" || fallbackKindInput === "expense";
    const fallbackKind: PersonalTransactionKind = target === "FUND_INCOME" || fallbackKindInput === "income" ? "income" : "expense";

    if (!rawText || rawText.length > 500 || !target || (target === "PERSONAL" && !personalKindIsValid) || (target !== "PERSONAL" && !groupId)) {
      res.status(400).json({ ok: false, message: "分類対象と内容を正しく入力してください。" });
      return;
    }

    const fallbackSuggestion = buildTargetKeywordFallbackSuggestion({ target, rawText, fallbackKind });
    const referenceDate = getTokyoDateInputValue();

    try {
      const user = await prisma.user.findUnique({ where: { id: userId }, select: { isActive: true } });
      if (!user?.isActive) {
        res.status(401).json({ ok: false, message: "このアカウントは利用できません。" });
        return;
      }
      if (target !== "PERSONAL") {
        const membership = await findActiveGroupMembership(userId, groupId!);
        if (!membership) {
          res.status(403).json({ ok: false, message: "このグループでAI分類を利用する権限がありません。" });
          return;
        }
        if (target === "FUND_INCOME" || target === "FUND_EXPENSE") {
          const fund = await prisma.groupFund.findUnique({ where: { groupId: groupId! }, select: { isActive: true } });
          if (!fund?.isActive) {
            res.status(409).json({ ok: false, message: "有効なグループ基金がありません。" });
            return;
          }
        }
      }
      if (!aiFoundation) throw new AiError("CONFIGURATION_ERROR");

      const result = target === "PERSONAL"
        ? await classifyPersonalTransactionWithAi({ foundation: aiFoundation, userId, rawText, referenceDate })
        : await classifyTransactionWithAi({ foundation: aiFoundation, userId, rawText, referenceDate, target, personalKind: fallbackKind });
      const suggestionToken = createSuggestionToken({
        userId, secret: sessionSecret, target, groupId, source: "AI", model: result.model, suggestion: result.data,
      });
      res.json({
        ok: true, source: "AI", suggestion: result.data, suggestionToken, referenceDate,
        message: "AIによる候補を表示しました。内容を確認してから登録してください。",
      });
    } catch (error) {
      const publicError = toPublicAiError(error);
      const suggestionToken = createSuggestionToken({
        userId, secret: sessionSecret, target, groupId, source: "KEYWORD", model: null, suggestion: fallbackSuggestion,
      });
      res.status(publicError.status).json({
        ok: false, source: "KEYWORD", suggestion: fallbackSuggestion, suggestionToken, referenceDate,
        message: `${publicError.message} キーワード分類による候補を表示しました。`,
      });
    }
  },
);

app.post("/app/transactions", requireAuthentication, async (req, res, next) => {
  const userId = req.session.userId;
  if (!userId) {
    res.redirect("/?error=ログインしてください。");
    return;
  }

  const kindInput = String(req.body.kind ?? "").trim();
  const rawText = String(req.body.rawText ?? "").trim();
  const selectedCategory = String(req.body.category ?? "").trim();
  const suggestionToken = String(req.body.suggestionToken ?? "").trim();
  const amount = parsePositiveInteger(req.body.amount);
  const transactionDateInput = String(req.body.transactionDate ?? "").trim();
  const transactionDate = parseDateOnly(transactionDateInput);
  const pageId = parsePositiveInteger(req.body.pageId);

  const inputKind = kindInput === "income" || kindInput === "expense" ? kindInput : null;

  if (!inputKind || !rawText || !amount || !transactionDate) {
    res.redirect(
      buildAppUrl({
        pageId,
        error: "取引日・種類・金額・内容を正しく入力してください。",
      }),
    );
    return;
  }

  if (rawText.length > 500) {
    res.redirect(
      buildAppUrl({
        pageId,
        error: "内容は500文字以内で入力してください。",
      }),
    );
    return;
  }

  if (isFutureTransactionDate(transactionDate)) {
    res.redirect(
      buildAppUrl({
        pageId,
        error: "未来日の取引は登録できません。",
      }),
    );
    return;
  }

  if (selectedCategory && !isAllowedPersonalCategory(inputKind, selectedCategory)) {
    res.redirect(
      buildAppUrl({
        pageId,
        error: "選択した種類に対応するカテゴリを選んでください。",
      }),
    );
    return;
  }

  try {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { isActive: true },
    });

    if (!user?.isActive) {
      await destroySession(req);
      res.clearCookie(sessionCookieName);
      res.redirect("/?error=このアカウントは利用できません。");
      return;
    }

    const category = selectedCategory || classifyPersonalTransactionKeyword(rawText, inputKind);
    const verifiedSuggestion = suggestionToken
      ? verifySuggestionToken({
          token: suggestionToken,
          userId,
          secret: sessionSecret,
        })
      : null;

    const { classificationSource, aiResult } = resolvePersonalTransactionClassification({
      payload: verifiedSuggestion,
      selectedCategory,
      finalKind: inputKind,
      finalAmount: amount,
      finalTransactionDate: transactionDateInput,
      finalCategory: category,
      finalRawText: rawText,
    });

    await prisma.transaction.create({
      data: {
        userId,
        groupId: null,
        groupFundId: null,
        kind: inputKind === "income" ? "PERSONAL_INCOME" : "PERSONAL_EXPENSE",
        amount,
        category,
        rawText,
        transactionDate,
        classificationSource,
        aiResult,
      },
    });

    res.redirect(
      buildAppUrl({
        pageId,
        success: "取引を登録しました。",
      }),
    );
  } catch (error) {
    next(error);
  }
});

app.post("/logout", async (req, res, next) => {
  try {
    await destroySession(req);
    res.clearCookie(sessionCookieName);
    res.redirect("/");
  } catch (error) {
    next(error);
  }
});

app.use((error: unknown, _req: Request, res: Response, _next: NextFunction) => {
  console.error(error);
  res.status(500).send("サーバー内部でエラーが発生しました。");
});

const server = app.listen(port, () => {
  console.log(`Server is running on http://localhost:${port}`);
});

async function shutdown(signal: string): Promise<void> {
  console.log(`${signal} received. Shutting down.`);
  server.close(async () => {
    await prisma.$disconnect();
    await pool.end();
    process.exit(0);
  });
}

process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));
