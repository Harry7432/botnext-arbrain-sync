-- CreateTable
CREATE TABLE "tenants" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "arbrain_data_id" INTEGER NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tenants_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "clientes" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "arbrain_id" TEXT NOT NULL,
    "sku" INTEGER NOT NULL,
    "tipo" TEXT,
    "identificador" TEXT,
    "numero_documento" TEXT,
    "razao_social" TEXT,
    "nome_fantasia" TEXT,
    "cliente_consumidor_final" BOOLEAN NOT NULL DEFAULT false,
    "inscricao_estadual" TEXT,
    "modalidade" TEXT,
    "uf" TEXT,
    "cep" TEXT,
    "cidade" TEXT,
    "bairro" TEXT,
    "logradouro" TEXT,
    "numero" TEXT,
    "complemento" TEXT,
    "telefone" TEXT,
    "celular" TEXT,
    "email" TEXT,
    "nome_responsavel" TEXT,
    "dia_visita_primario" TEXT,
    "dia_visita_secundario" TEXT,
    "periodicidade_da_visita" TEXT,
    "ordenacao_da_visita" TEXT,
    "index_sequenciamento_visita" INTEGER,
    "informacoes_complementares" TEXT,
    "data_nascimento" TEXT,
    "desconto_padrao" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "limite_de_credito" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "segmentacao" TEXT,
    "id_grupo_cliente" TEXT,
    "id_tabela_preco_primaria" TEXT,
    "id_tabela_preco_secundaria" TEXT,
    "id_condicao_pagamento_padrao" TEXT,
    "id_vendedor" TEXT,
    "cliente_ativo" BOOLEAN NOT NULL DEFAULT false,
    "cliente_bloqueado" BOOLEAN NOT NULL DEFAULT false,
    "pre_cadastro" BOOLEAN NOT NULL DEFAULT false,
    "synced_at" TIMESTAMP(3) NOT NULL,
    "last_seen_at" TIMESTAMP(3) NOT NULL,
    "payload_hash" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "clientes_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "tenants_slug_key" ON "tenants"("slug");

-- CreateIndex
CREATE INDEX "clientes_tenant_id_cliente_ativo_idx" ON "clientes"("tenant_id", "cliente_ativo");

-- CreateIndex
CREATE INDEX "clientes_tenant_id_cliente_bloqueado_idx" ON "clientes"("tenant_id", "cliente_bloqueado");

-- CreateIndex
CREATE INDEX "clientes_tenant_id_dia_visita_primario_idx" ON "clientes"("tenant_id", "dia_visita_primario");

-- CreateIndex
CREATE INDEX "clientes_tenant_id_dia_visita_secundario_idx" ON "clientes"("tenant_id", "dia_visita_secundario");

-- CreateIndex
CREATE UNIQUE INDEX "clientes_tenant_id_arbrain_id_key" ON "clientes"("tenant_id", "arbrain_id");

-- CreateIndex
CREATE UNIQUE INDEX "clientes_tenant_id_sku_key" ON "clientes"("tenant_id", "sku");

-- AddForeignKey
ALTER TABLE "clientes" ADD CONSTRAINT "clientes_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
