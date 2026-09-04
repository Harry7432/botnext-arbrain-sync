import { createHash } from "node:crypto";

import { prisma } from "../database/prisma.js";

import {
  buscarClientePorId,
  listarClientes,
} from "../integrations/arbrain/arbrain-clientes.js";

import { mapearClienteCompleto } from "./mappers/cliente-mapper.js";

import type {
  ArbrainClienteCompleto,
} from "../integrations/arbrain/arbrain-types.js";

const TAMANHO_DA_AMOSTRA = 5;

function gerarPayloadHash(
  cliente: ArbrainClienteCompleto,
): string {
  const payload = JSON.stringify(cliente);

  return createHash("sha256")
    .update(payload)
    .digest("hex");
}

async function sincronizarAmostra(): Promise<void> {
  console.log(
    "Iniciando sincronização da amostra de clientes completos...",
  );

  const tenant = await prisma.tenant.findUnique({
    where: {
      slug: "lrc",
    },
  });

  if (!tenant) {
    throw new Error("Tenant LRC não encontrado.");
  }

  const clientesResumidos = await listarClientes();

  const amostra = clientesResumidos.slice(
    0,
    TAMANHO_DA_AMOSTRA,
  );

  if (amostra.length === 0) {
    throw new Error("Nenhum cliente foi retornado pelo ArBrain.");
  }

  let totalProcessado = 0;

  for (const clienteResumido of amostra) {
    const clienteCompleto = await buscarClientePorId(
      clienteResumido.id,
    );

    const dadosMapeados = mapearClienteCompleto(
      clienteCompleto,
    );

    const dataDaSincronizacao = new Date();

    await prisma.cliente.update({
      where: {
        tenantId_arbrainId: {
          tenantId: tenant.id,
          arbrainId: clienteResumido.id,
        },
      },
      data: {
        ...dadosMapeados,
        payloadHash: gerarPayloadHash(clienteCompleto),
        syncedAt: dataDaSincronizacao,
        lastSeenAt: dataDaSincronizacao,
      },
    });

    totalProcessado += 1;

    console.log(
      `Progresso da amostra: ${totalProcessado}/${amostra.length}`,
    );
  }

  console.log(
    `${totalProcessado} clientes completos sincronizados com sucesso.`,
  );

  console.log(
    "Dados gravados exclusivamente no nosso PostgreSQL.",
  );
}

sincronizarAmostra()
  .catch((error: unknown) => {
    const mensagem =
      error instanceof Error ? error.message : "Erro desconhecido";

    console.error(
      `Falha na sincronização da amostra: ${mensagem}`,
    );

    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });