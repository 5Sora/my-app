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
    const pages = await prisma.ledgerPage.findMany({
      where: {
        userId,
        pageType: "PERSONAL",
      },
      orderBy: [{ isInitial: "desc" }, { sortOrder: "asc" }, { id: "asc" }],
    });

    const selectedPage =
      pages.find((page) => Number.isInteger(requestedPageId) && page.id === requestedPageId) ??
      pages[0] ??
      null;

    const user = await prisma.user.findUnique({
      where: { id: userId },
    });

    if (!user || !user.isActive) {
      await destroySession(req);
      res.clearCookie(sessionCookieName);
      res.redirect("/?error=このアカウントは利用できません。");
      return;
    }

    if (!selectedPage) {
      res.status(500).send("個人家計簿ページが見つかりません。");
      return;
    }

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

  const inputKind = kindInput === "income" || kindInput === "expense" ? kindInput : null;

  if (!inputKind || !rawText || !amount || !transactionDate) {
    res.redirect(
      `/app?error=${encodeURIComponent("取引日・種類・金額・内容を正しく入力してください。")}`,
    );
    return;
  }

  if (rawText.length > 500) {
    res.redirect(`/app?error=${encodeURIComponent("内容は500文字以内で入力してください。")}`);
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

    res.redirect(`/app?success=${encodeURIComponent("取引を登録しました。")}`);
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
