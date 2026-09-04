import { createHash } from "node:crypto";

import { prisma } from "../database/prisma.js";

import { buscarClientePorId } from "../integrations/arbrain/arbrain-clientes.js";

import { mapearClienteCompleto } from "./mappers/cliente-mapper.js";

import type {
  ArbrainClienteCompleto,
} from "../integrations/arbrain/arbrain-types.js";

const TAMANHO_DA_AMOSTRA = 5;

function gerarPayloadHash(
  cliente: ArbrainClienteCompleto,
): string {
  return createHash("sha256")
    .update(JSON.stringify(cliente))
    .digest("hex");
}

async function reconciliarAmostra(): Promise<void> {
  console.log(
    "Iniciando reconciliação de clientes por hash...",
  );

  const tenant = await prisma.tenant.findUnique({
    where: {
      slug: "lrc",
    },
  });

  if (!tenant) {
    throw new Error("Tenant LRC não encontrado.");
  }

  const clientesLocais = await prisma.cliente.findMany({
    where: {
      tenantId: tenant.id,
    },
    orderBy: {
      sku: "asc",
    },
    take: TAMANHO_DA_AMOSTRA,
    select: {
      arbrainId: true,
      payloadHash: true,
    },
  });

  let clientesAlterados = 0;
  let clientesSemAlteracao = 0;

  for (const clienteLocal of clientesLocais) {
    const clienteArbrain = await buscarClientePorId(
      clienteLocal.arbrainId,
    );

    const novoHash = gerarPayloadHash(clienteArbrain);
    const agora = new Date();

    if (clienteLocal.payloadHash === novoHash) {
      await prisma.cliente.update({
        where: {
          tenantId_arbrainId: {
            tenantId: tenant.id,
            arbrainId: clienteLocal.arbrainId,
          },
        },
        data: {
          lastSeenAt: agora,
        },
      });

      clientesSemAlteracao += 1;
      continue;
    }

    const dadosMapeados = mapearClienteCompleto(
      clienteArbrain,
    );

    await prisma.cliente.update({
      where: {
        tenantId_arbrainId: {
          tenantId: tenant.id,
          arbrainId: clienteLocal.arbrainId,
        },
      },
      data: {
        ...dadosMapeados,
        payloadHash: novoHash,
        syncedAt: agora,
        lastSeenAt: agora,
      },
    });

    clientesAlterados += 1;
  }

  console.log(`Clientes analisados: ${clientesLocais.length}`);

  console.log(
    `Clientes alterados: ${clientesAlterados}`,
  );

  console.log(
    `Clientes sem alteração: ${clientesSemAlteracao}`,
  );

  console.log(
    "Reconciliação da amostra concluída com sucesso.",
  );

  console.log(
    "Nenhuma escrita foi enviada ao ArBrain.",
  );
}

reconciliarAmostra()
  .catch((error: unknown) => {
    const mensagem =
      error instanceof Error ? error.message : "Erro desconhecido";

    console.error(`Falha na reconciliação: ${mensagem}`);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });