/*
  Customized V2 migration.

  Goals:
  - Preserve users.name by renaming it to display_name.
  - Backfill required columns before adding NOT NULL constraints.
  - Convert legacy transaction kinds without dropping existing values.
  - Create initial funds and ledger pages for existing records.
  - Keep legacy users unable to authenticate until a real password is assigned.

  Legacy kind mapping:
  - income                         -> PERSONAL_INCOME
  - expense + group_id IS NULL     -> PERSONAL_EXPENSE
  - expense + group_id IS NOT NULL -> GROUP_PAYMENT
*/

CREATE TYPE "UserRole" AS ENUM ('USER', 'SYSTEM_ADMIN');
CREATE TYPE "GroupMemberRole" AS ENUM ('MEMBER', 'ADMIN');
CREATE TYPE "TransactionKind" AS ENUM (
  'PERSONAL_INCOME',
  'PERSONAL_EXPENSE',
  'GROUP_PAYMENT',
  'FUND_CONTRIBUTION',
  'FUND_INCOME',
  'FUND_EXPENSE',
  'FUND_REFUND'
);
CREATE TYPE "LedgerPageType" AS ENUM ('PERSONAL', 'GROUP_FUND', 'GROUP_PAYMENT');
CREATE TYPE "CalculationMethod" AS ENUM (
  'EQUAL',
  'HISTORY_ALL',
  'HISTORY_SAME_PARTICIPANTS',
  'BALANCE_ADJUSTMENT'
);
CREATE TYPE "ClassificationSource" AS ENUM ('MANUAL', 'KEYWORD', 'AI');

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "transactions"
    WHERE lower("kind") NOT IN ('income', 'expense')
  ) THEN
    RAISE EXCEPTION
      'Unknown legacy transactions.kind value found. Inspect the data before applying v2_core_schema.';
  END IF;
END
$$;

ALTER TABLE "transactions"
DROP CONSTRAINT "transactions_group_id_fkey";

ALTER TABLE "group_members"
ADD COLUMN "is_active" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN "joined_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN "left_at" TIMESTAMP(3),
ADD COLUMN "role" "GroupMemberRole" NOT NULL DEFAULT 'MEMBER';

ALTER TABLE "group_members"
DROP COLUMN "weight";

ALTER TABLE "groups"
ADD COLUMN "is_active" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN "updated_at" TIMESTAMP(3);

UPDATE "groups"
SET "updated_at" = "created_at"
WHERE "updated_at" IS NULL;

ALTER TABLE "groups"
ALTER COLUMN "updated_at" SET NOT NULL;

ALTER TABLE "users"
RENAME COLUMN "name" TO "display_name";

ALTER TABLE "users"
ADD COLUMN "is_active" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN "login_id" TEXT,
ADD COLUMN "password_hash" TEXT,
ADD COLUMN "role" "UserRole" NOT NULL DEFAULT 'USER',
ADD COLUMN "updated_at" TIMESTAMP(3),
ADD COLUMN "withdrawn_at" TIMESTAMP(3);

UPDATE "users"
SET
  "login_id" = 'legacy_' || "id"::text,
  "password_hash" = '$2b$12$V5f1PW8h5a7Q.oWR5XH0q.ZHdk/wgXCX7FKQyC35WLkOijPHe85Gm',
  "updated_at" = "created_at"
WHERE
  "login_id" IS NULL
  OR "password_hash" IS NULL
  OR "updated_at" IS NULL;

ALTER TABLE "users"
ALTER COLUMN "login_id" SET NOT NULL,
ALTER COLUMN "password_hash" SET NOT NULL,
ALTER COLUMN "updated_at" SET NOT NULL;

ALTER TABLE "transactions"
ADD COLUMN "ai_result" JSONB,
ADD COLUMN "calculation_method" "CalculationMethod",
ADD COLUMN "classification_source" "ClassificationSource" NOT NULL DEFAULT 'MANUAL',
ADD COLUMN "group_fund_id" INTEGER,
ADD COLUMN "payment_batch_id" UUID,
ADD COLUMN "transaction_date" DATE,
ADD COLUMN "updated_at" TIMESTAMP(3);

UPDATE "transactions"
SET
  "transaction_date" = "created_at"::date,
  "updated_at" = "created_at"
WHERE
  "transaction_date" IS NULL
  OR "updated_at" IS NULL;

ALTER TABLE "transactions"
ALTER COLUMN "transaction_date" SET NOT NULL,
ALTER COLUMN "updated_at" SET NOT NULL,
ALTER COLUMN "user_id" DROP NOT NULL;

ALTER TABLE "transactions"
ALTER COLUMN "kind" DROP DEFAULT;

ALTER TABLE "transactions"
ALTER COLUMN "kind" TYPE "TransactionKind"
USING (
  CASE
    WHEN lower("kind") = 'income'
      THEN 'PERSONAL_INCOME'::"TransactionKind"
    WHEN lower("kind") = 'expense' AND "group_id" IS NOT NULL
      THEN 'GROUP_PAYMENT'::"TransactionKind"
    WHEN lower("kind") = 'expense'
      THEN 'PERSONAL_EXPENSE'::"TransactionKind"
  END
);

CREATE TABLE "group_funds" (
  "id" SERIAL NOT NULL,
  "group_id" INTEGER NOT NULL,
  "name" TEXT NOT NULL,
  "is_active" BOOLEAN NOT NULL DEFAULT true,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "group_funds_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ledger_pages" (
  "id" SERIAL NOT NULL,
  "page_type" "LedgerPageType" NOT NULL,
  "user_id" INTEGER,
  "group_id" INTEGER,
  "name" TEXT NOT NULL,
  "start_date" DATE,
  "end_date" DATE,
  "is_initial" BOOLEAN NOT NULL DEFAULT false,
  "sort_order" INTEGER NOT NULL DEFAULT 0,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ledger_pages_pkey" PRIMARY KEY ("id")
);

INSERT INTO "group_funds" (
  "group_id", "name", "is_active", "created_at", "updated_at"
)
SELECT
  "id", "name" || '基金', "is_active", "created_at", "updated_at"
FROM "groups";

INSERT INTO "ledger_pages" (
  "page_type", "user_id", "group_id", "name", "start_date", "end_date",
  "is_initial", "sort_order", "created_at", "updated_at"
)
SELECT
  'PERSONAL'::"LedgerPageType", "id", NULL, '全期間', NULL, NULL,
  true, 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM "users";

INSERT INTO "ledger_pages" (
  "page_type", "user_id", "group_id", "name", "start_date", "end_date",
  "is_initial", "sort_order", "created_at", "updated_at"
)
SELECT
  'GROUP_FUND'::"LedgerPageType", NULL, "id", '全期間', NULL, NULL,
  true, 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM "groups";

INSERT INTO "ledger_pages" (
  "page_type", "user_id", "group_id", "name", "start_date", "end_date",
  "is_initial", "sort_order", "created_at", "updated_at"
)
SELECT
  'GROUP_PAYMENT'::"LedgerPageType", NULL, "id", '全期間', NULL, NULL,
  true, 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM "groups";

CREATE UNIQUE INDEX "group_funds_group_id_key" ON "group_funds"("group_id");
CREATE INDEX "ledger_pages_user_id_page_type_sort_order_idx" ON "ledger_pages"("user_id", "page_type", "sort_order");
CREATE INDEX "ledger_pages_group_id_page_type_sort_order_idx" ON "ledger_pages"("group_id", "page_type", "sort_order");
CREATE INDEX "group_members_group_id_is_active_idx" ON "group_members"("group_id", "is_active");
CREATE INDEX "transactions_user_id_transaction_date_idx" ON "transactions"("user_id", "transaction_date");
CREATE INDEX "transactions_group_id_transaction_date_idx" ON "transactions"("group_id", "transaction_date");
CREATE INDEX "transactions_group_fund_id_transaction_date_idx" ON "transactions"("group_fund_id", "transaction_date");
CREATE INDEX "transactions_group_id_payment_batch_id_idx" ON "transactions"("group_id", "payment_batch_id");
CREATE INDEX "transactions_payment_batch_id_idx" ON "transactions"("payment_batch_id");
CREATE UNIQUE INDEX "users_login_id_key" ON "users"("login_id");

ALTER TABLE "group_funds"
ADD CONSTRAINT "group_funds_group_id_fkey"
FOREIGN KEY ("group_id") REFERENCES "groups"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "transactions"
ADD CONSTRAINT "transactions_group_id_fkey"
FOREIGN KEY ("group_id") REFERENCES "groups"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "transactions"
ADD CONSTRAINT "transactions_group_fund_id_fkey"
FOREIGN KEY ("group_fund_id") REFERENCES "group_funds"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "ledger_pages"
ADD CONSTRAINT "ledger_pages_user_id_fkey"
FOREIGN KEY ("user_id") REFERENCES "users"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "ledger_pages"
ADD CONSTRAINT "ledger_pages_group_id_fkey"
FOREIGN KEY ("group_id") REFERENCES "groups"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;
