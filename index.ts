import "dotenv/config";
import express from "express";
import { Pool } from "pg";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "./generated/prisma/client";

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter, log: ["query"] });

const app = express();
const PORT = process.env.PORT || 8888;

app.set("view engine", "ejs");
app.set("views", "./views");
app.use(express.urlencoded({ extended: true }));

function classify(rawText: string): string {
  if (
    rawText.includes("ご飯") ||
    rawText.includes("コンビニ") ||
    rawText.includes("ランチ") ||
    rawText.includes("カフェ")
  ) {
    return "食費";
  }

  if (
    rawText.includes("電車") ||
    rawText.includes("バス") ||
    rawText.includes("タクシー")
  ) {
    return "交通費";
  }

  if (
    rawText.includes("本") ||
    rawText.includes("文具") ||
    rawText.includes("参考書")
  ) {
    return "学習・文具";
  }

  return "その他";
}

function extractAmount(rawText: string): number {
  const match = rawText.match(/[0-9,]+/);
  return match ? Number(match[0].replaceAll(",", "")) : 0;
}

app.get("/", async (req, res) => {
  const users = await prisma.user.findMany({
    orderBy: { id: "asc" },
  });

  const groups = await prisma.expenseGroup.findMany({
    orderBy: { id: "asc" },
  });

  res.render("index", { users, groups });
});

app.post("/users", async (req, res) => {
  const name = String(req.body.name || "").trim();

  if (name) {
    await prisma.user.create({
      data: { name },
    });
  }

  res.redirect("/");
});

app.get("/users/:userId", async (req, res) => {
  const userId = Number(req.params.userId);

  const user = await prisma.user.findUnique({
    where: { id: userId },
  });

  if (!user) {
    res.status(404).send("ユーザーが見つかりません");
    return;
  }

  const transactions = await prisma.transaction.findMany({
    where: { userId },
    include: { group: true },
    orderBy: { createdAt: "desc" },
  });

  const personalTotal = transactions
    .filter((tx) => tx.groupId === null)
    .reduce((sum, tx) => sum + tx.amount, 0);

  const groupTotal = transactions
    .filter((tx) => tx.groupId !== null)
    .reduce((sum, tx) => sum + tx.amount, 0);

  const total = personalTotal + groupTotal;

  res.render("user", {
    user,
    transactions,
    personalTotal,
    groupTotal,
    total,
  });
});

app.post("/users/:userId/transactions", async (req, res) => {
  const userId = Number(req.params.userId);
  const rawText = String(req.body.rawText || "").trim();

  const amount = extractAmount(rawText);
  const category = classify(rawText);

  if (userId && rawText && amount > 0) {
    await prisma.transaction.create({
      data: {
        userId,
        groupId: null,
        rawText,
        amount,
        category,
      },
    });
  }

  res.redirect(`/users/${userId}`);
});

app.post("/groups", async (req, res) => {
  const name = String(req.body.name || "").trim();

  if (name) {
    await prisma.expenseGroup.create({
      data: { name },
    });
  }

  res.redirect("/");
});

app.get("/groups/:groupId", async (req, res) => {
  const groupId = Number(req.params.groupId);

  const group = await prisma.expenseGroup.findUnique({
    where: { id: groupId },
    include: {
      members: {
        include: { user: true },
        orderBy: { userId: "asc" },
      },
      transactions: {
        include: { user: true },
        orderBy: { createdAt: "desc" },
      },
    },
  });

  const users = await prisma.user.findMany({
    orderBy: { id: "asc" },
  });

  if (!group) {
    res.status(404).send("グループが見つかりません");
    return;
  }

  const total = group.transactions.reduce((sum, tx) => {
    return sum + tx.amount;
  }, 0);

  const totalWeight = group.members.reduce((sum, member) => {
    return sum + member.weight;
  }, 0);

  const settlement = group.members.map((member) => {
    const paid = group.transactions
      .filter((tx) => tx.userId === member.userId)
      .reduce((sum, tx) => sum + tx.amount, 0);

    const expected =
      totalWeight > 0 ? Math.round((total * member.weight) / totalWeight) : 0;

    return {
      name: member.user.name,
      weight: member.weight,
      paid,
      expected,
      balance: paid - expected,
    };
  });

  res.render("group", {
    group,
    users,
    total,
    settlement,
  });
});

app.post("/groups/:groupId/members", async (req, res) => {
  const groupId = Number(req.params.groupId);
  const userId = Number(req.body.userId);
  const weight = Number(req.body.weight || 1);

  if (groupId && userId) {
    await prisma.groupMember.upsert({
      where: {
        userId_groupId: {
          userId,
          groupId,
        },
      },
      update: {
        weight,
      },
      create: {
        userId,
        groupId,
        weight,
      },
    });
  }

  res.redirect(`/groups/${groupId}`);
});

app.post("/groups/:groupId/transactions", async (req, res) => {
  const groupId = Number(req.params.groupId);
  const userId = Number(req.body.userId);
  const rawText = String(req.body.rawText || "").trim();

  const amount = extractAmount(rawText);
  const category = classify(rawText);

  const member = await prisma.groupMember.findUnique({
    where: {
      userId_groupId: {
        userId,
        groupId,
      },
    },
  });

  if (groupId && userId && member && rawText && amount > 0) {
    await prisma.transaction.create({
      data: {
        userId,
        groupId,
        rawText,
        amount,
        category,
      },
    });
  }

  res.redirect(`/groups/${groupId}`);
});

app.listen(PORT, () => {
  console.log(`Server is running on http://localhost:${PORT}`);
});
