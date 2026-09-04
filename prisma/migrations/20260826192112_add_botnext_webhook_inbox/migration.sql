-- CreateEnum
CREATE TYPE "BotnextWebhookStatus" AS ENUM ('RECEIVED', 'PROCESSING', 'PROCESSED', 'IGNORED', 'FAILED');

-- CreateTable
CREATE TABLE "botnext_webhook_events" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "event_type" TEXT NOT NULL,
    "external_message_id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "session_id" TEXT,
    "message_type" TEXT,
    "direction" TEXT,
    "sender_phone" TEXT,
    "recipient_phone" TEXT,
    "message_text" TEXT,
    "event_date" TIMESTAMP(3),
    "payload" JSONB NOT NULL,
    "status" "BotnextWebhookStatus" NOT NULL DEFAULT 'RECEIVED',
    "processed_at" TIMESTAMP(3),
    "error_message" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "botnext_webhook_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "botnext_webhook_events_tenant_id_status_idx" ON "botnext_webhook_events"("tenant_id", "status");

-- CreateIndex
CREATE INDEX "botnext_webhook_events_tenant_id_session_id_idx" ON "botnext_webhook_events"("tenant_id", "session_id");

-- CreateIndex
CREATE INDEX "botnext_webhook_events_sender_phone_idx" ON "botnext_webhook_events"("sender_phone");

-- CreateIndex
CREATE INDEX "botnext_webhook_events_created_at_idx" ON "botnext_webhook_events"("created_at");

-- CreateIndex
CREATE UNIQUE INDEX "botnext_webhook_events_tenant_id_company_id_event_type_exte_key" ON "botnext_webhook_events"("tenant_id", "company_id", "event_type", "external_message_id");

-- AddForeignKey
ALTER TABLE "botnext_webhook_events" ADD CONSTRAINT "botnext_webhook_events_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
