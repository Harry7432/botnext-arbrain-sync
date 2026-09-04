import { createHash } from "node:crypto";

import { prisma } from "../database/prisma.js";
import { listarClientes } from "../integrations/arbrain/arbrain-clientes.js";

import type {
  ArbrainClienteResumo,
} from "../integrations/arbrain/arbrain-types.js";

const TAMANHO_DO_LOTE = 100;

function gerarPayloadHash(
  cliente: ArbrainClienteResumo,
): string {
  const payloadNormalizado = JSON.stringify({
    id: cliente.id.trim(),
    nome: cliente.nome.trim(),
    sku: cliente.sku,
  });

  return createHash("sha256")
    .update(payloadNormalizado)
    .digest("hex");
}

async function sincronizarClientesResumidos(): Promise<void> {
  console.log("Iniciando sincronização de clientes resumidos...");

  const tenant = await prisma.tenant.findUnique({
    where: {
      slug: "lrc",
    },
  });

  if (!tenant) {
    throw new Error("Tenant LRC não encontrado.");
  }

  const clientes = await listarClientes();

  console.log(`Clientes recebidos do ArBrain: ${clientes.length}`);

  const dataDaSincronizacao = new Date();
  let totalProcessado = 0;

  for (
    let inicio = 0;
    inicio < clientes.length;
    inicio += TAMANHO_DO_LOTE
  ) {
    const lote = clientes.slice(
      inicio,
      inicio + TAMANHO_DO_LOTE,
    );

    const operacoes = lote.map((cliente) => {
      const arbrainId = cliente.id.trim();
      const nome = cliente.nome.trim();
      const payloadHash = gerarPayloadHash(cliente);

      return prisma.cliente.upsert({
        where: {
          tenantId_arbrainId: {
            tenantId: tenant.id,
            arbrainId,
          },
        },
        update: {
          sku: cliente.sku,
          nomeFantasia: nome,
          payloadHash,
          syncedAt: dataDaSincronizacao,
          lastSeenAt: dataDaSincronizacao,
        },
        create: {
          tenantId: tenant.id,
          arbrainId,
          sku: cliente.sku,
          nomeFantasia: nome,
          payloadHash,
          syncedAt: dataDaSincronizacao,
          lastSeenAt: dataDaSincronizacao,
        },
      });
    });

    await prisma.$transaction(operacoes);

    totalProcessado += lote.length;

    console.log(
      `Progresso: ${totalProcessado}/${clientes.length}`,
    );
  }

  console.log(
    `Sincronização concluída: ${totalProcessado} clientes processados.`,
  );

  console.log(
    "Dados gravados exclusivamente no nosso PostgreSQL.",
  );
}

sincronizarClientesResumidos()
  .catch((error: unknown) => {
    const mensagem =
      error instanceof Error ? error.message : "Erro desconhecido";

    console.error(`Falha na sincronização: ${mensagem}`);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });