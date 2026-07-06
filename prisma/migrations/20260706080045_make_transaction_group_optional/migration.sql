-- DropForeignKey
ALTER TABLE "transactions" DROP CONSTRAINT "transactions_group_id_fkey";

-- AlterTable
ALTER TABLE "transactions" ALTER COLUMN "group_id" DROP NOT NULL;

-- AddForeignKey
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_group_id_fkey" FOREIGN KEY ("group_id") REFERENCES "groups"("id") ON DELETE SET NULL ON UPDATE CASCADE;
