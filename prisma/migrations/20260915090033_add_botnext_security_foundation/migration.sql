-- CreateEnum
CREATE TYPE "BotnextOutboundStatus" AS ENUM ('PENDING', 'SENDING', 'SENT', 'FAILED', 'UNCERTAIN');

-- CreateEnum
CREATE TYPE "BotnextOutboundKind" AS ENUM ('TEXT', 'TEMPLATE');

-- CreateSequence
-- O default é associado somente depois da coluna nullable ser criada, para
-- não preencher nem reordenar eventos históricos.
CREATE SEQUENCE "botnext_webhook_ingress_sequence_seq";

-- AlterTable
ALTER TABLE "botnext_conversations" ADD COLUMN     "identity_version" TEXT,
ADD COLUMN     "recipient_phone_normalized" TEXT,
ADD COLUMN     "sender_phone_normalized" TEXT;

-- AlterTable
ALTER TABLE "botnext_webhook_events" ADD COLUMN     "identity_version" TEXT,
ADD COLUMN     "ingress_sequence" BIGINT,
ADD COLUMN     "queue_generation" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "recipient_phone_normalized" TEXT,
ADD COLUMN     "sender_phone_normalized" TEXT;

ALTER TABLE "botnext_webhook_events"
ALTER COLUMN "ingress_sequence"
SET DEFAULT nextval('botnext_webhook_ingress_sequence_seq'::regclass);

ALTER SEQUENCE "botnext_webhook_ingress_sequence_seq"
OWNED BY "botnext_webhook_events"."ingress_sequence";

-- CreateTable
CREATE TABLE "botnext_outbound_messages" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "botnext_account_id" UUID NOT NULL,
    "conversation_id" UUID,
    "cliente_id" UUID,
    "source_webhook_event_id" UUID,
    "pedido_rascunho_id" UUID,
    "kind" "BotnextOutboundKind" NOT NULL,
    "purpose" TEXT NOT NULL,
    "idempotency_key" TEXT NOT NULL,
    "request_hash" TEXT NOT NULL,
    "from_phone_normalized" TEXT NOT NULL,
    "to_phone_normalized" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "status" "BotnextOutboundStatus" NOT NULL DEFAULT 'PENDING',
    "fencing_token" BIGINT NOT NULL DEFAULT 0,
    "claim_token" UUID,
    "claim_worker" TEXT,
    "lease_until" TIMESTAMP(3),
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "next_attempt_at" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP,
    "last_attempt_at" TIMESTAMP(3),
    "started_at" TIMESTAMP(3),
    "sent_at" TIMESTAMP(3),
    "failed_at" TIMESTAMP(3),
    "uncertain_at" TIMESTAMP(3),
    "last_http_status" INTEGER,
    "provider_message_id" TEXT,
    "provider_status" TEXT,
    "error_code" TEXT,
    "error_message" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "botnext_outbound_messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "botnext_pedido_confirmado_snapshots" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "rascunho_id" UUID NOT NULL,
    "confirmation_event_id" UUID NOT NULL,
    "botnext_account_id" UUID NOT NULL,
    "conversation_id" UUID NOT NULL,
    "extracao_id" UUID NOT NULL,
    "cliente_id" UUID NOT NULL,
    "sender_phone_normalized" TEXT NOT NULL,
    "cliente_arbrain_id" TEXT NOT NULL,
    "contract_version" TEXT NOT NULL,
    "key_version" TEXT NOT NULL,
    "dispatch_key" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "payload_sha256" TEXT NOT NULL,
    "confirmed_revision" INTEGER NOT NULL,
    "confirmed_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "botnext_pedido_confirmado_snapshots_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "botnext_outbound_messages_status_next_attempt_at_created_at_idx" ON "botnext_outbound_messages"("status", "next_attempt_at", "created_at");

-- CreateIndex
CREATE INDEX "botnext_outbound_messages_status_lease_until_idx" ON "botnext_outbound_messages"("status", "lease_until");

-- CreateIndex
CREATE INDEX "botnext_outbound_messages_tenant_id_status_created_at_idx" ON "botnext_outbound_messages"("tenant_id", "status", "created_at");

-- CreateIndex
CREATE INDEX "botnext_outbound_messages_tenant_id_conversation_id_created_idx" ON "botnext_outbound_messages"("tenant_id", "conversation_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "botnext_outbound_messages_tenant_id_idempotency_key_key" ON "botnext_outbound_messages"("tenant_id", "idempotency_key");

-- CreateIndex
CREATE UNIQUE INDEX "botnext_outbound_messages_tenant_id_source_webhook_event_id_key" ON "botnext_outbound_messages"("tenant_id", "source_webhook_event_id", "purpose");

-- CreateIndex
CREATE INDEX "botnext_pedido_confirmado_snapshots_tenant_id_confirmed_at_idx" ON "botnext_pedido_confirmado_snapshots"("tenant_id", "confirmed_at");

-- CreateIndex
CREATE UNIQUE INDEX "botnext_pedido_confirmado_snapshots_tenant_id_rascunho_id_key" ON "botnext_pedido_confirmado_snapshots"("tenant_id", "rascunho_id");

-- CreateIndex
CREATE UNIQUE INDEX "botnext_pedido_confirmado_snapshots_tenant_id_dispatch_key_key" ON "botnext_pedido_confirmado_snapshots"("tenant_id", "dispatch_key");

-- CreateIndex
CREATE UNIQUE INDEX "botnext_pedido_confirmado_snapshots_tenant_id_confirmation__key" ON "botnext_pedido_confirmado_snapshots"("tenant_id", "confirmation_event_id");

-- CreateIndex
CREATE UNIQUE INDEX "botnext_accounts_tenant_id_id_key" ON "botnext_accounts"("tenant_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "botnext_pedido_rascunho_tenant_id_id_key" ON "botnext_pedido_rascunho"("tenant_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "botnext_webhook_events_ingress_sequence_key" ON "botnext_webhook_events"("ingress_sequence");

-- CreateIndex
CREATE INDEX "botnext_webhook_events_botnext_account_id_session_id_status_idx" ON "botnext_webhook_events"("botnext_account_id", "session_id", "status", "ingress_sequence");

-- CreateIndex
CREATE UNIQUE INDEX "botnext_webhook_events_tenant_id_id_key" ON "botnext_webhook_events"("tenant_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "clientes_tenant_id_id_key" ON "clientes"("tenant_id", "id");

-- AddForeignKey
ALTER TABLE "botnext_outbound_messages" ADD CONSTRAINT "botnext_outbound_messages_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "botnext_outbound_messages" ADD CONSTRAINT "botnext_outbound_messages_tenant_id_botnext_account_id_fkey" FOREIGN KEY ("tenant_id", "botnext_account_id") REFERENCES "botnext_accounts"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "botnext_outbound_messages" ADD CONSTRAINT "botnext_outbound_messages_tenant_id_conversation_id_fkey" FOREIGN KEY ("tenant_id", "conversation_id") REFERENCES "botnext_conversations"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "botnext_outbound_messages" ADD CONSTRAINT "botnext_outbound_messages_tenant_id_cliente_id_fkey" FOREIGN KEY ("tenant_id", "cliente_id") REFERENCES "clientes"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "botnext_outbound_messages" ADD CONSTRAINT "botnext_outbound_messages_tenant_id_source_webhook_event_i_fkey" FOREIGN KEY ("tenant_id", "source_webhook_event_id") REFERENCES "botnext_webhook_events"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "botnext_outbound_messages" ADD CONSTRAINT "botnext_outbound_messages_tenant_id_pedido_rascunho_id_fkey" FOREIGN KEY ("tenant_id", "pedido_rascunho_id") REFERENCES "botnext_pedido_rascunho"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "botnext_pedido_confirmado_snapshots" ADD CONSTRAINT "botnext_pedido_confirmado_snapshots_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "botnext_pedido_confirmado_snapshots" ADD CONSTRAINT "botnext_pedido_confirmado_snapshots_tenant_id_rascunho_id_fkey" FOREIGN KEY ("tenant_id", "rascunho_id") REFERENCES "botnext_pedido_rascunho"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "botnext_pedido_confirmado_snapshots" ADD CONSTRAINT "botnext_pedido_confirmado_snapshots_tenant_id_confirmation_fkey" FOREIGN KEY ("tenant_id", "confirmation_event_id") REFERENCES "botnext_webhook_events"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "botnext_pedido_confirmado_snapshots" ADD CONSTRAINT "botnext_pedido_confirmado_snapshots_tenant_id_botnext_acco_fkey" FOREIGN KEY ("tenant_id", "botnext_account_id") REFERENCES "botnext_accounts"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "botnext_pedido_confirmado_snapshots" ADD CONSTRAINT "botnext_pedido_confirmado_snapshots_tenant_id_conversation_fkey" FOREIGN KEY ("tenant_id", "conversation_id") REFERENCES "botnext_conversations"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "botnext_pedido_confirmado_snapshots" ADD CONSTRAINT "botnext_pedido_confirmado_snapshots_tenant_id_extracao_id_fkey" FOREIGN KEY ("tenant_id", "extracao_id") REFERENCES "botnext_pedido_extracao"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "botnext_pedido_confirmado_snapshots" ADD CONSTRAINT "botnext_pedido_confirmado_snapshots_tenant_id_cliente_id_fkey" FOREIGN KEY ("tenant_id", "cliente_id") REFERENCES "clientes"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddCheckConstraint
ALTER TABLE "botnext_webhook_events"
ADD CONSTRAINT "botnext_webhook_events_queue_generation_nonnegative_check"
CHECK ("queue_generation" >= 0);

ALTER TABLE "botnext_webhook_events"
ADD CONSTRAINT "botnext_webhook_events_identity_versioned_check"
CHECK (
  "identity_version" IS NULL
  OR (
    "identity_version" = 'botnext-identity-v1'
    AND "botnext_account_id" IS NOT NULL
    AND "cliente_id" IS NOT NULL
    AND NULLIF(BTRIM("session_id"), '') IS NOT NULL
    AND "sender_phone_normalized" IS NOT NULL
    AND "recipient_phone_normalized" IS NOT NULL
    AND "sender_phone_normalized" ~ '^[0-9]{10,15}$'
    AND "recipient_phone_normalized" ~ '^[0-9]{10,15}$'
    AND "ingress_sequence" IS NOT NULL
  )
);

ALTER TABLE "botnext_conversations"
ADD CONSTRAINT "botnext_conversations_identity_versioned_check"
CHECK (
  "identity_version" IS NULL
  OR (
    "identity_version" = 'botnext-identity-v1'
    AND "cliente_id" IS NOT NULL
    AND NULLIF(BTRIM("session_id"), '') IS NOT NULL
    AND "sender_phone_normalized" IS NOT NULL
    AND "recipient_phone_normalized" IS NOT NULL
    AND "sender_phone_normalized" ~ '^[0-9]{10,15}$'
    AND "recipient_phone_normalized" ~ '^[0-9]{10,15}$'
  )
);

ALTER TABLE "botnext_outbound_messages"
ADD CONSTRAINT "botnext_outbound_messages_attempts_nonnegative_check"
CHECK ("attempts" >= 0);

ALTER TABLE "botnext_outbound_messages"
ADD CONSTRAINT "botnext_outbound_messages_fencing_nonnegative_check"
CHECK ("fencing_token" >= 0);

ALTER TABLE "botnext_outbound_messages"
ADD CONSTRAINT "botnext_outbound_messages_request_check"
CHECK (
  NULLIF(BTRIM("purpose"), '') IS NOT NULL
  AND "idempotency_key" ~ '^[0-9a-f]{64}$'
  AND "request_hash" ~ '^[0-9a-f]{64}$'
  AND "from_phone_normalized" ~ '^[0-9]{10,15}$'
  AND "to_phone_normalized" ~ '^[0-9]{10,15}$'
  AND jsonb_typeof("payload") = 'object'
);

ALTER TABLE "botnext_outbound_messages"
ADD CONSTRAINT "botnext_outbound_messages_lease_check"
CHECK (
  (
    "status" = 'SENDING'
    AND "claim_token" IS NOT NULL
    AND NULLIF(BTRIM("claim_worker"), '') IS NOT NULL
    AND "lease_until" IS NOT NULL
  )
  OR (
    "status" <> 'SENDING'
    AND "claim_token" IS NULL
    AND "claim_worker" IS NULL
    AND "lease_until" IS NULL
  )
);

ALTER TABLE "botnext_outbound_messages"
ADD CONSTRAINT "botnext_outbound_messages_state_timestamps_check"
CHECK (
  (
    "status" = 'PENDING'
    AND "next_attempt_at" IS NOT NULL
    AND "sent_at" IS NULL
    AND "failed_at" IS NULL
    AND "uncertain_at" IS NULL
  )
  OR (
    "status" = 'SENDING'
    AND "next_attempt_at" IS NULL
    AND "sent_at" IS NULL
    AND "failed_at" IS NULL
    AND "uncertain_at" IS NULL
  )
  OR (
    "status" = 'SENT'
    AND "next_attempt_at" IS NULL
    AND "sent_at" IS NOT NULL
    AND "failed_at" IS NULL
    AND "uncertain_at" IS NULL
  )
  OR (
    "status" = 'FAILED'
    AND "next_attempt_at" IS NULL
    AND "sent_at" IS NULL
    AND "failed_at" IS NOT NULL
    AND "uncertain_at" IS NULL
  )
  OR (
    "status" = 'UNCERTAIN'
    AND "next_attempt_at" IS NULL
    AND "sent_at" IS NULL
    AND "failed_at" IS NULL
    AND "uncertain_at" IS NOT NULL
  )
);

ALTER TABLE "botnext_pedido_confirmado_snapshots"
ADD CONSTRAINT "botnext_pedido_confirmado_snapshots_content_check"
CHECK (
  "confirmed_revision" > 0
  AND NULLIF(BTRIM("contract_version"), '') IS NOT NULL
  AND NULLIF(BTRIM("key_version"), '') IS NOT NULL
  AND "dispatch_key" ~ '^[0-9a-f]{64}$'
  AND "payload_sha256" ~ '^[0-9a-f]{64}$'
  AND "sender_phone_normalized" ~ '^[0-9]{10,15}$'
  AND NULLIF(BTRIM("cliente_arbrain_id"), '') IS NOT NULL
  AND jsonb_typeof("payload") = 'object'
  AND "payload" ? 'dispatchKey'
  AND "payload"->>'dispatchKey' = "dispatch_key"
);

-- AddImmutabilityTriggers
CREATE FUNCTION "botnext_protect_versioned_event_identity"()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF OLD."identity_version" IS NOT NULL AND (
    NEW."tenant_id" IS DISTINCT FROM OLD."tenant_id"
    OR NEW."botnext_account_id" IS DISTINCT FROM OLD."botnext_account_id"
    OR NEW."company_id" IS DISTINCT FROM OLD."company_id"
    OR NEW."session_id" IS DISTINCT FROM OLD."session_id"
    OR NEW."cliente_id" IS DISTINCT FROM OLD."cliente_id"
    OR NEW."sender_phone" IS DISTINCT FROM OLD."sender_phone"
    OR NEW."recipient_phone" IS DISTINCT FROM OLD."recipient_phone"
    OR NEW."sender_phone_normalized" IS DISTINCT FROM OLD."sender_phone_normalized"
    OR NEW."recipient_phone_normalized" IS DISTINCT FROM OLD."recipient_phone_normalized"
    OR NEW."identity_version" IS DISTINCT FROM OLD."identity_version"
    OR NEW."ingress_sequence" IS DISTINCT FROM OLD."ingress_sequence"
  ) THEN
    RAISE EXCEPTION 'Identidade versionada do evento BotNext é imutável.';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER "botnext_webhook_events_identity_immutable"
BEFORE UPDATE ON "botnext_webhook_events"
FOR EACH ROW
EXECUTE FUNCTION "botnext_protect_versioned_event_identity"();

CREATE FUNCTION "botnext_protect_versioned_conversation_identity"()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF OLD."identity_version" IS NOT NULL AND (
    NEW."tenant_id" IS DISTINCT FROM OLD."tenant_id"
    OR NEW."botnext_account_id" IS DISTINCT FROM OLD."botnext_account_id"
    OR NEW."session_id" IS DISTINCT FROM OLD."session_id"
    OR NEW."cliente_id" IS DISTINCT FROM OLD."cliente_id"
    OR NEW."sender_phone_normalized" IS DISTINCT FROM OLD."sender_phone_normalized"
    OR NEW."recipient_phone_normalized" IS DISTINCT FROM OLD."recipient_phone_normalized"
    OR NEW."identity_version" IS DISTINCT FROM OLD."identity_version"
  ) THEN
    RAISE EXCEPTION 'Identidade versionada da conversa BotNext é imutável.';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER "botnext_conversations_identity_immutable"
BEFORE UPDATE ON "botnext_conversations"
FOR EACH ROW
EXECUTE FUNCTION "botnext_protect_versioned_conversation_identity"();

CREATE FUNCTION "botnext_protect_outbound_request"()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF
    NEW."tenant_id" IS DISTINCT FROM OLD."tenant_id"
    OR NEW."botnext_account_id" IS DISTINCT FROM OLD."botnext_account_id"
    OR NEW."conversation_id" IS DISTINCT FROM OLD."conversation_id"
    OR NEW."cliente_id" IS DISTINCT FROM OLD."cliente_id"
    OR NEW."source_webhook_event_id" IS DISTINCT FROM OLD."source_webhook_event_id"
    OR NEW."pedido_rascunho_id" IS DISTINCT FROM OLD."pedido_rascunho_id"
    OR NEW."kind" IS DISTINCT FROM OLD."kind"
    OR NEW."purpose" IS DISTINCT FROM OLD."purpose"
    OR NEW."idempotency_key" IS DISTINCT FROM OLD."idempotency_key"
    OR NEW."request_hash" IS DISTINCT FROM OLD."request_hash"
    OR NEW."from_phone_normalized" IS DISTINCT FROM OLD."from_phone_normalized"
    OR NEW."to_phone_normalized" IS DISTINCT FROM OLD."to_phone_normalized"
    OR NEW."payload" IS DISTINCT FROM OLD."payload"
  THEN
    RAISE EXCEPTION 'Requisição outbound BotNext é imutável.';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER "botnext_outbound_messages_request_immutable"
BEFORE UPDATE ON "botnext_outbound_messages"
FOR EACH ROW
EXECUTE FUNCTION "botnext_protect_outbound_request"();

CREATE FUNCTION "botnext_prevent_snapshot_mutation"()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'Snapshot confirmado BotNext é append-only.';
  RETURN NULL;
END;
$$;

CREATE TRIGGER "botnext_pedido_confirmado_snapshots_immutable"
BEFORE UPDATE OR DELETE ON "botnext_pedido_confirmado_snapshots"
FOR EACH ROW
EXECUTE FUNCTION "botnext_prevent_snapshot_mutation"();
