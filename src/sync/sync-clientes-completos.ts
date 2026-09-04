import { createHash } from "node:crypto";

import { prisma } from "../database/prisma.js";

import { buscarClientePorId } from "../integrations/arbrain/arbrain-clientes.js";

import { mapearClienteCompleto } from "./mappers/cliente-mapper.js";

import type {
  ArbrainClienteCompleto,
} from "../integrations/arbrain/arbrain-types.js";

const LIMITE_POR_EXECUCAO = 500;
const QUANTIDADE_SIMULTANEA = 5;

function gerarPayloadHash(
  cliente: ArbrainClienteCompleto,
): string {
  return createHash("sha256")
    .update(JSON.stringify(cliente))
    .digest("hex");
}

async function sincronizarCliente(
  tenantId: string,
  arbrainId: string,
): Promise<void> {
  const clienteCompleto = await buscarClientePorId(arbrainId);

  const dadosMapeados = mapearClienteCompleto(
    clienteCompleto,
  );

  const dataDaSincronizacao = new Date();

  await prisma.cliente.update({
    where: {
      tenantId_arbrainId: {
        tenantId,
        arbrainId,
      },
    },
    data: {
      ...dadosMapeados,
      payloadHash: gerarPayloadHash(clienteCompleto),
      syncedAt: dataDaSincronizacao,
      lastSeenAt: dataDaSincronizacao,
    },
  });
}

async function sincronizarClientesCompletos(): Promise<void> {
  console.log(
    "Buscando clientes que ainda possuem somente dados resumidos...",
  );

  const tenant = await prisma.tenant.findUnique({
    where: {
      slug: "lrc",
    },
  });

  if (!tenant) {
    throw new Error("Tenant LRC não encontrado.");
  }

  const clientesPendentes = await prisma.cliente.findMany({
    where: {
      tenantId: tenant.id,
      tipo: null,
    },
    orderBy: {
      sku: "asc",
    },
    take: LIMITE_POR_EXECUCAO,
    select: {
      arbrainId: true,
    },
  });

  if (clientesPendentes.length === 0) {
    console.log("Nenhum cliente pendente encontrado.");
    return;
  }

  console.log(
    `Clientes selecionados nesta execução: ${clientesPendentes.length}`,
  );

  let totalProcessado = 0;

  for (
    let inicio = 0;
    inicio < clientesPendentes.length;
    inicio += QUANTIDADE_SIMULTANEA
  ) {
    const lote = clientesPendentes.slice(
      inicio,
      inicio + QUANTIDADE_SIMULTANEA,
    );

    await Promise.all(
      lote.map((cliente) =>
        sincronizarCliente(
          tenant.id,
          cliente.arbrainId,
        ),
      ),
    );

    totalProcessado += lote.length;

    console.log(
      `Progresso: ${totalProcessado}/${clientesPendentes.length}`,
    );
  }

  console.log(
    `${totalProcessado} clientes completos sincronizados nesta execução.`,
  );

  console.log(
    "Dados gravados exclusivamente no nosso PostgreSQL.",
  );
}

sincronizarClientesCompletos()
  .catch((error: unknown) => {
    const mensagem =
      error instanceof Error ? error.message : "Erro desconhecido";

    console.error(`Falha na sincronização: ${mensagem}`);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });