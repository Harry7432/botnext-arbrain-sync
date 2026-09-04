-- CreateEnum
CREATE TYPE "BotnextConversationIntent" AS ENUM ('FAZER_PEDIDO', 'NAO_DESEJA_PEDIDO', 'DUVIDA', 'ATENDIMENTO_HUMANO', 'ALTERACAO_CADASTRAL', 'RECLAMACAO', 'FORA_DE_CONTEXTO');

-- AlterTable
ALTER TABLE "botnext_conversation_messages" ADD COLUMN     "classification_model" TEXT,
ADD COLUMN     "classification_version" TEXT,
ADD COLUMN     "classified_at" TIMESTAMP(3),
ADD COLUMN     "detected_intent" "BotnextConversationIntent",
ADD COLUMN     "intent_confidence" DOUBLE PRECISION,
ADD COLUMN     "intent_reason" TEXT,
ADD COLUMN     "requires_human_handoff" BOOLEAN;

-- AlterTable
ALTER TABLE "botnext_conversations" ADD COLUMN     "intent" "BotnextConversationIntent",
ADD COLUMN     "intent_confidence" DOUBLE PRECISION,
ADD COLUMN     "intent_updated_at" TIMESTAMP(3),
ADD COLUMN     "requires_human_handoff" BOOLEAN NOT NULL DEFAULT false;

-- CreateIndex
CREATE INDEX "botnext_conversation_messages_detected_intent_classified_at_idx" ON "botnext_conversation_messages"("detected_intent", "classified_at");

-- CreateIndex
CREATE INDEX "botnext_conversations_tenant_id_intent_idx" ON "botnext_conversations"("tenant_id", "intent");
