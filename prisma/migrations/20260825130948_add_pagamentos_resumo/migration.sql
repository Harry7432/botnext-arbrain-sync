-- CreateTable
CREATE TABLE "pagamentos" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "arbrain_id" TEXT NOT NULL,
    "sku" INTEGER NOT NULL,
    "nome" TEXT NOT NULL,
    "possui_vinculo_bancario" BOOLEAN NOT NULL,
    "synced_at" TIMESTAMP(3) NOT NULL,
    "last_seen_at" TIMESTAMP(3) NOT NULL,
    "payload_hash" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "pagamentos_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "pagamentos_tenant_id_nome_idx" ON "pagamentos"("tenant_id", "nome");

-- CreateIndex
CREATE INDEX "pagamentos_tenant_id_possui_vinculo_bancario_idx" ON "pagamentos"("tenant_id", "possui_vinculo_bancario");

-- CreateIndex
CREATE UNIQUE INDEX "pagamentos_tenant_id_arbrain_id_key" ON "pagamentos"("tenant_id", "arbrain_id");

-- CreateIndex
CREATE UNIQUE INDEX "pagamentos_tenant_id_sku_key" ON "pagamentos"("tenant_id", "sku");

-- AddForeignKey
ALTER TABLE "pagamentos" ADD CONSTRAINT "pagamentos_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
