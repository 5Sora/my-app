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
  try {
    const user = await prisma.user.findUnique({
      where: { id: req.session.userId },
      include: {
        ledgerPages: {
          where: { pageType: "PERSONAL" },
          orderBy: [{ isInitial: "desc" }, { sortOrder: "asc" }],
        },
      },
    });

    if (!user || !user.isActive) {
      await destroySession(req);
      res.clearCookie(sessionCookieName);
      res.redirect("/?error=このアカウントは利用できません。");
      return;
    }

    res.render("dashboard", {
      user,
      initialPage: user.ledgerPages[0] ?? null,
    });
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
