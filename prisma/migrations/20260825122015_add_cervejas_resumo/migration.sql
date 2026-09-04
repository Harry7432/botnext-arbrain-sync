-- CreateTable
CREATE TABLE "cervejas" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "arbrain_id" TEXT NOT NULL,
    "sku" INTEGER NOT NULL,
    "nome" TEXT NOT NULL,
    "synced_at" TIMESTAMP(3) NOT NULL,
    "last_seen_at" TIMESTAMP(3) NOT NULL,
    "payload_hash" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "cervejas_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "cervejas_tenant_id_nome_idx" ON "cervejas"("tenant_id", "nome");

-- CreateIndex
CREATE UNIQUE INDEX "cervejas_tenant_id_arbrain_id_key" ON "cervejas"("tenant_id", "arbrain_id");

-- CreateIndex
CREATE UNIQUE INDEX "cervejas_tenant_id_sku_key" ON "cervejas"("tenant_id", "sku");

-- AddForeignKey
ALTER TABLE "cervejas" ADD CONSTRAINT "cervejas_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
