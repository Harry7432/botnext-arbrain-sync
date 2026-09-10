-- CreateEnum
CREATE TYPE "BotnextPedidoExtracaoStatus" AS ENUM ('PENDENTE', 'PROCESSANDO', 'EXTRAIDO', 'FALHOU');

-- CreateEnum
CREATE TYPE "BotnextPedidoRascunhoStatus" AS ENUM ('RASCUNHO', 'PRONTO', 'CONFIRMADO', 'DESPACHADO', 'CANCELADO', 'FALHOU');

-- CreateTable
CREATE TABLE "botnext_pedido_extracao" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "conversation_id" UUID NOT NULL,
    "source_message_id" UUID NOT NULL,
    "status" "BotnextPedidoExtracaoStatus" NOT NULL DEFAULT 'PENDENTE',
    "source_hash" TEXT NOT NULL,
    "input_text" TEXT,
    "itens_extraidos" JSONB,
    "observacoes" TEXT,
    "extractor_model" TEXT,
    "extractor_version" TEXT,
    "prompt_version" TEXT,
    "confianca" DOUBLE PRECISION,
    "extracted_at" TIMESTAMP(3),
    "revision" INTEGER NOT NULL DEFAULT 0,
    "processing_token" UUID,
    "processing_worker" TEXT,
    "processing_lease_until" TIMESTAMP(3),
    "processing_attempts" INTEGER NOT NULL DEFAULT 0,
    "error_message" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "botnext_pedido_extracao_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "botnext_pedido_rascunho" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "extracao_id" UUID NOT NULL,
    "status" "BotnextPedidoRascunhoStatus" NOT NULL DEFAULT 'RASCUNHO',
    "itens" JSONB,
    "total_itens" INTEGER NOT NULL DEFAULT 0,
    "itens_resolvidos" INTEGER NOT NULL DEFAULT 0,
    "itens_nao_resolvidos" INTEGER NOT NULL DEFAULT 0,
    "observacoes" TEXT,
    "revision" INTEGER NOT NULL DEFAULT 0,
    "dispatch_key" TEXT,
    "dispatch_token" UUID,
    "dispatch_worker" TEXT,
    "dispatch_lease_until" TIMESTAMP(3),
    "dispatch_attempts" INTEGER NOT NULL DEFAULT 0,
    "dispatched_at" TIMESTAMP(3),
    "error_message" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "botnext_pedido_rascunho_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "produto_aliases" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "produto_id" UUID NOT NULL,
    "alias" TEXT NOT NULL,
    "alias_normalizado" TEXT NOT NULL,
    "ativo" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "produto_aliases_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
-- Alvo da FK composta (tenant_id, produto_id) de produto_aliases.
CREATE UNIQUE INDEX "produtos_tenant_id_id_key" ON "produtos"("tenant_id", "id");

-- CreateIndex
-- Alvo da FK composta (tenant_id, conversation_id) de botnext_pedido_extracao.
CREATE UNIQUE INDEX "botnext_conversations_tenant_id_id_key" ON "botnext_conversations"("tenant_id", "id");

-- CreateIndex
-- Alvo da FK composta (conversation_id, source_message_id) de botnext_pedido_extracao.
CREATE UNIQUE INDEX "botnext_conversation_messages_conversation_id_id_key" ON "botnext_conversation_messages"("conversation_id", "id");

-- CreateIndex
CREATE INDEX "botnext_pedido_extracao_tenant_id_status_idx" ON "botnext_pedido_extracao"("tenant_id", "status");

-- CreateIndex
CREATE INDEX "botnext_pedido_extracao_status_processing_lease_until_idx" ON "botnext_pedido_extracao"("status", "processing_lease_until");

-- CreateIndex
-- Idempotencia (1 extracao por mensagem) + alvo unique da relacao 1:1
-- sourceMessage + suporte ao CASCADE da FK (tenant_id, conversation_id).
CREATE UNIQUE INDEX "botnext_pedido_extracao_conversation_id_source_message_id_key" ON "botnext_pedido_extracao"("conversation_id", "source_message_id");

-- CreateIndex
-- Alvo da FK composta (tenant_id, extracao_id) de botnext_pedido_rascunho.
CREATE UNIQUE INDEX "botnext_pedido_extracao_tenant_id_id_key" ON "botnext_pedido_extracao"("tenant_id", "id");

-- CreateIndex
CREATE INDEX "botnext_pedido_rascunho_tenant_id_status_idx" ON "botnext_pedido_rascunho"("tenant_id", "status");

-- CreateIndex
CREATE INDEX "botnext_pedido_rascunho_status_dispatch_lease_until_idx" ON "botnext_pedido_rascunho"("status", "dispatch_lease_until");

-- CreateIndex
-- Idempotencia (1 rascunho por extracao) + alvo unique da relacao 1:1 extracao
-- + suporte ao CASCADE da FK a partir de botnext_pedido_extracao.
CREATE UNIQUE INDEX "botnext_pedido_rascunho_tenant_id_extracao_id_key" ON "botnext_pedido_rascunho"("tenant_id", "extracao_id");

-- CreateIndex
-- Idempotencia do envio ao n8n (dispatch_key nulo nao conflita no Postgres).
CREATE UNIQUE INDEX "botnext_pedido_rascunho_tenant_id_dispatch_key_key" ON "botnext_pedido_rascunho"("tenant_id", "dispatch_key");

-- CreateIndex
CREATE INDEX "produto_aliases_tenant_id_produto_id_idx" ON "produto_aliases"("tenant_id", "produto_id");

-- CreateIndex
CREATE UNIQUE INDEX "produto_aliases_tenant_id_alias_normalizado_key" ON "produto_aliases"("tenant_id", "alias_normalizado");

-- AddForeignKey
ALTER TABLE "botnext_pedido_extracao" ADD CONSTRAINT "botnext_pedido_extracao_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "botnext_pedido_extracao" ADD CONSTRAINT "botnext_pedido_extracao_tenant_id_conversation_id_fkey" FOREIGN KEY ("tenant_id", "conversation_id") REFERENCES "botnext_conversations"("tenant_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "botnext_pedido_extracao" ADD CONSTRAINT "botnext_pedido_extracao_conversation_id_source_message_id_fkey" FOREIGN KEY ("conversation_id", "source_message_id") REFERENCES "botnext_conversation_messages"("conversation_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "botnext_pedido_rascunho" ADD CONSTRAINT "botnext_pedido_rascunho_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "botnext_pedido_rascunho" ADD CONSTRAINT "botnext_pedido_rascunho_tenant_id_extracao_id_fkey" FOREIGN KEY ("tenant_id", "extracao_id") REFERENCES "botnext_pedido_extracao"("tenant_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "produto_aliases" ADD CONSTRAINT "produto_aliases_tenant_id_produto_id_fkey" FOREIGN KEY ("tenant_id", "produto_id") REFERENCES "produtos"("tenant_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "produto_aliases" ADD CONSTRAINT "produto_aliases_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
