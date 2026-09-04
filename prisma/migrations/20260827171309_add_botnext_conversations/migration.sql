-- CreateEnum
CREATE TYPE "BotnextConversationStatus" AS ENUM ('ACTIVE', 'WAITING_CUSTOMER', 'WAITING_CONFIRMATION', 'HUMAN_HANDOFF', 'COMPLETED', 'CANCELLED', 'FAILED');

-- CreateEnum
CREATE TYPE "BotnextConversationMessageRole" AS ENUM ('CUSTOMER', 'ASSISTANT', 'SYSTEM', 'HUMAN');

-- CreateTable
CREATE TABLE "botnext_conversations" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "cliente_id" UUID,
    "botnext_account_id" UUID NOT NULL,
    "session_id" TEXT NOT NULL,
    "status" "BotnextConversationStatus" NOT NULL DEFAULT 'ACTIVE',
    "last_message_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "closed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "botnext_conversations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "botnext_conversation_messages" (
    "id" UUID NOT NULL,
    "conversation_id" UUID NOT NULL,
    "webhook_event_id" UUID,
    "external_message_id" TEXT,
    "role" "BotnextConversationMessageRole" NOT NULL,
    "message_type" TEXT,
    "text" TEXT,
    "event_date" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "botnext_conversation_messages_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "botnext_conversations_tenant_id_status_idx" ON "botnext_conversations"("tenant_id", "status");

-- CreateIndex
CREATE INDEX "botnext_conversations_tenant_id_cliente_id_idx" ON "botnext_conversations"("tenant_id", "cliente_id");

-- CreateIndex
CREATE INDEX "botnext_conversations_last_message_at_idx" ON "botnext_conversations"("last_message_at");

-- CreateIndex
CREATE UNIQUE INDEX "botnext_conversations_botnext_account_id_session_id_key" ON "botnext_conversations"("botnext_account_id", "session_id");

-- CreateIndex
CREATE UNIQUE INDEX "botnext_conversation_messages_webhook_event_id_key" ON "botnext_conversation_messages"("webhook_event_id");

-- CreateIndex
CREATE INDEX "botnext_conversation_messages_conversation_id_created_at_idx" ON "botnext_conversation_messages"("conversation_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "botnext_conversation_messages_conversation_id_external_mess_key" ON "botnext_conversation_messages"("conversation_id", "external_message_id");

-- AddForeignKey
ALTER TABLE "botnext_conversations" ADD CONSTRAINT "botnext_conversations_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "botnext_conversations" ADD CONSTRAINT "botnext_conversations_cliente_id_fkey" FOREIGN KEY ("cliente_id") REFERENCES "clientes"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "botnext_conversations" ADD CONSTRAINT "botnext_conversations_botnext_account_id_fkey" FOREIGN KEY ("botnext_account_id") REFERENCES "botnext_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "botnext_conversation_messages" ADD CONSTRAINT "botnext_conversation_messages_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "botnext_conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "botnext_conversation_messages" ADD CONSTRAINT "botnext_conversation_messages_webhook_event_id_fkey" FOREIGN KEY ("webhook_event_id") REFERENCES "botnext_webhook_events"("id") ON DELETE SET NULL ON UPDATE CASCADE;
