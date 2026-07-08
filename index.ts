import "dotenv/config";
import express, { type NextFunction, type Request, type Response } from "express";
import session from "express-session";
import bcrypt from "bcryptjs";
import { Pool } from "pg";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "./generated/prisma/client";

declare module "express-session" {
  interface SessionData {
    userId?: number;
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

function classifyTransaction(rawText: string, kind: "income" | "expense"): string {
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

function formatDateInputValue(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
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


type GroupMembershipClient = Pick<typeof prisma, "groupMember">;
type ActivatableGroupRole = "MEMBER" | "ADMIN";

class ActiveGroupMembershipError extends Error {
  constructor() {
    super("そのユーザーはすでにグループへ所属しています。");
    this.name = "ActiveGroupMembershipError";
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
          group: true,
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

    const transactionDateFilter = {
      ...(selectedPage.startDate ? { gte: selectedPage.startDate } : {}),
      ...(selectedPage.endDate ? { lte: selectedPage.endDate } : {}),
    };

    const [transactions, carryoverTransactions] = await Promise.all([
      prisma.transaction.findMany({
        where: {
          userId,
          kind: { in: ["PERSONAL_INCOME", "PERSONAL_EXPENSE"] },
          ...(Object.keys(transactionDateFilter).length > 0
            ? { transactionDate: transactionDateFilter }
            : {}),
        },
        orderBy: [{ transactionDate: "desc" }, { createdAt: "desc" }],
      }),
      selectedPage.startDate
        ? prisma.transaction.findMany({
            where: {
              userId,
              kind: { in: ["PERSONAL_INCOME", "PERSONAL_EXPENSE"] },
              transactionDate: { lt: selectedPage.startDate },
            },
            select: { kind: true, amount: true },
          })
        : Promise.resolve([]),
    ]);

    const incomeTotal = transactions
      .filter((transaction) => transaction.kind === "PERSONAL_INCOME")
      .reduce((sum, transaction) => sum + transaction.amount, 0);

    const expenseTotal = transactions
      .filter((transaction) => transaction.kind === "PERSONAL_EXPENSE")
      .reduce((sum, transaction) => sum + transaction.amount, 0);

    const carryover = carryoverTransactions.reduce((sum, transaction) => {
      return transaction.kind === "PERSONAL_INCOME"
        ? sum + transaction.amount
        : sum - transaction.amount;
    }, 0);

    const balance = carryover + incomeTotal - expenseTotal;
    const error = typeof req.query.error === "string" ? req.query.error : null;
    const success = typeof req.query.success === "string" ? req.query.success : null;

    res.render("dashboard", {
      user,
      groupMemberships: activeGroupMemberships,
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
      today: formatDateInputValue(new Date()),
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

    const [fund, ledgerPages] = await Promise.all([
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
        orderBy: [{ pageType: "asc" }, { isInitial: "desc" }, { sortOrder: "asc" }, { id: "asc" }],
      }),
    ]);

    const error = typeof req.query.error === "string" ? req.query.error : null;
    const success = typeof req.query.success === "string" ? req.query.success : null;

    res.render("group", {
      group: membership.group,
      membership,
      fund,
      ledgerPages,
      error,
      success,
    });
  } catch (error) {
    next(error);
  }
});

app.post("/app/transactions", requireAuthentication, async (req, res, next) => {
  const userId = req.session.userId;
  if (!userId) {
    res.redirect("/?error=ログインしてください。");
    return;
  }

  const kindInput = String(req.body.kind ?? "").trim();
  const rawText = String(req.body.rawText ?? "").trim();
  const selectedCategory = String(req.body.category ?? "").trim();
  const amount = parsePositiveInteger(req.body.amount);
  const transactionDate = parseDateOnly(req.body.transactionDate);
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

    const category = selectedCategory || classifyTransaction(rawText, inputKind);
    const classificationSource = selectedCategory ? "MANUAL" : "KEYWORD";

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
