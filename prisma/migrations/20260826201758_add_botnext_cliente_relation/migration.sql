-- AlterTable
ALTER TABLE "botnext_webhook_events" ADD COLUMN     "cliente_id" UUID;

-- CreateIndex
CREATE INDEX "botnext_webhook_events_tenant_id_cliente_id_idx" ON "botnext_webhook_events"("tenant_id", "cliente_id");

-- AddForeignKey
ALTER TABLE "botnext_webhook_events" ADD CONSTRAINT "botnext_webhook_events_cliente_id_fkey" FOREIGN KEY ("cliente_id") REFERENCES "clientes"("id") ON DELETE SET NULL ON UPDATE CASCADE;
