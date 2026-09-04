-- AlterTable
ALTER TABLE "botnext_webhook_events" ADD COLUMN     "botnext_account_id" UUID;

-- CreateTable
CREATE TABLE "botnext_accounts" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "channel_phone" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "botnext_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "botnext_accounts_company_id_key" ON "botnext_accounts"("company_id");

-- CreateIndex
CREATE INDEX "botnext_accounts_tenant_id_active_idx" ON "botnext_accounts"("tenant_id", "active");

-- CreateIndex
CREATE INDEX "botnext_webhook_events_botnext_account_id_idx" ON "botnext_webhook_events"("botnext_account_id");

-- AddForeignKey
ALTER TABLE "botnext_accounts" ADD CONSTRAINT "botnext_accounts_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "botnext_webhook_events" ADD CONSTRAINT "botnext_webhook_events_botnext_account_id_fkey" FOREIGN KEY ("botnext_account_id") REFERENCES "botnext_accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;
