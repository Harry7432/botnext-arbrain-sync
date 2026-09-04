-- DropIndex
DROP INDEX "pagamentos_tenant_id_sku_key";

-- CreateIndex
CREATE INDEX "pagamentos_tenant_id_sku_idx" ON "pagamentos"("tenant_id", "sku");
