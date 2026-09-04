-- CreateEnum
CREATE TYPE "BotnextRoutingAction" AS ENUM ('INICIAR_PEDIDO', 'ENCERRAR_SEM_PEDIDO', 'RESPONDER_DUVIDA', 'ENCAMINHAR_ATENDIMENTO_HUMANO', 'SOLICITAR_MAIS_CONTEXTO');

-- AlterTable
ALTER TABLE "botnext_conversation_messages" ADD COLUMN     "routed_at" TIMESTAMP(3),
ADD COLUMN     "routing_action" "BotnextRoutingAction",
ADD COLUMN     "routing_reason" TEXT,
ADD COLUMN     "routing_status" "BotnextConversationStatus",
ADD COLUMN     "routing_version" TEXT;

-- CreateIndex
CREATE INDEX "botnext_conversation_messages_routing_action_routed_at_idx" ON "botnext_conversation_messages"("routing_action", "routed_at");
