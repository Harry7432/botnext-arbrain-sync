import { createHash } from "node:crypto";
import { pathToFileURL } from "node:url";

import { prisma } from "../database/prisma.js";

import { buscarClientePorId } from "../integrations/arbrain/arbrain-clientes.js";

import { mapearClienteCompleto } from "./mappers/cliente-mapper.js";

import {
  concluirSyncRun,
  falharSyncRun,
  iniciarSyncRun,
} from "./sync-run-service.js";

import type {
  ArbrainClienteCompleto,
} from "../integrations/arbrain/arbrain-types.js";

const QUANTIDADE_SIMULTANEA = 5;
const ENTIDADE_SINCRONIZADA = "clientes";

type ResultadoReconciliacao =
  | "alterado"
  | "sem_alteracao";

function gerarPayloadHash(
  cliente: ArbrainClienteCompleto,
): string {
  return createHash("sha256")
    .update(JSON.stringify(cliente))
    .digest("hex");
}

async function reconciliarCliente(
  tenantId: string,
  arbrainId: string,
  payloadHashAtual: string | null,
): Promise<ResultadoReconciliacao> {
  const clienteArbrain =
    await buscarClientePorId(arbrainId);

  const novoHash = gerarPayloadHash(clienteArbrain);
  const agora = new Date();

  if (payloadHashAtual === novoHash) {
    await prisma.cliente.update({
      where: {
        tenantId_arbrainId: {
          tenantId,
          arbrainId,
        },
      },
      data: {
        lastSeenAt: agora,
      },
    });

    return "sem_alteracao";
  }

  const dadosMapeados =
    mapearClienteCompleto(clienteArbrain);

  await prisma.cliente.update({
    where: {
      tenantId_arbrainId: {
        tenantId,
        arbrainId,
      },
    },
    data: {
      ...dadosMapeados,
      payloadHash: novoHash,
      syncedAt: agora,
      lastSeenAt: agora,
    },
  });

  return "alterado";
}

export async function reconciliarTodosOsClientes(): Promise<void> {
  console.log(
    "Iniciando reconciliação completa dos clientes...",
  );

  const tenant = await prisma.tenant.findUnique({
    where: {
      slug: "lrc",
    },
  });

  if (!tenant) {
    throw new Error("Tenant LRC não encontrado.");
  }

  const clientesLocais =
    await prisma.cliente.findMany({
      where: {
        tenantId: tenant.id,
      },
      orderBy: {
        sku: "asc",
      },
      select: {
        arbrainId: true,
        payloadHash: true,
      },
    });

  console.log(
    `Clientes selecionados: ${clientesLocais.length}`,
  );

  const syncRun = await iniciarSyncRun({
    tenantId: tenant.id,
    entity: ENTIDADE_SINCRONIZADA,
    totalRecords: clientesLocais.length,
  });

  console.log(
    `Auditoria iniciada: ${syncRun.status}`,
  );

  let totalProcessado = 0;
  let clientesAlterados = 0;
  let clientesSemAlteracao = 0;

  try {
    for (
      let inicio = 0;
      inicio < clientesLocais.length;
      inicio += QUANTIDADE_SIMULTANEA
    ) {
      const lote = clientesLocais.slice(
        inicio,
        inicio + QUANTIDADE_SIMULTANEA,
      );

      const resultados = await Promise.all(
        lote.map((cliente) =>
          reconciliarCliente(
            tenant.id,
            cliente.arbrainId,
            cliente.payloadHash,
          ),
        ),
      );

      for (const resultado of resultados) {
        if (resultado === "alterado") {
          clientesAlterados += 1;
        } else {
          clientesSemAlteracao += 1;
        }
      }

      totalProcessado += lote.length;

      console.log(
        `Progresso: ${totalProcessado}/${clientesLocais.length}`,
      );
    }

    await concluirSyncRun({
      syncRunId: syncRun.id,
      tenantId: tenant.id,
      entity: ENTIDADE_SINCRONIZADA,
      totalRecords: clientesLocais.length,
      processedRecords: totalProcessado,
      changedRecords: clientesAlterados,
      unchangedRecords: clientesSemAlteracao,
    });

    console.log("Reconciliação completa concluída.");

    console.log(
      `Clientes processados: ${totalProcessado}`,
    );

    console.log(
      `Clientes alterados: ${clientesAlterados}`,
    );

    console.log(
      `Clientes sem alteração: ${clientesSemAlteracao}`,
    );

    console.log("Auditoria finalizada com SUCCESS.");

    console.log(
      "Nenhuma escrita foi enviada ao ArBrain.",
    );
  } catch (error: unknown) {
    try {
      await falharSyncRun({
        syncRunId: syncRun.id,
        processedRecords: totalProcessado,
        error,
      });

      console.error(
        "Auditoria finalizada com FAILED.",
      );
    } catch (auditError: unknown) {
      const mensagemAuditoria =
        auditError instanceof Error
          ? auditError.message
          : "Erro desconhecido";

      console.error(
        `Falha ao registrar auditoria: ${mensagemAuditoria}`,
      );
    }

    throw error;
  }
}

async function executarPeloTerminal(): Promise<void> {
  try {
    await reconciliarTodosOsClientes();
  } catch (error: unknown) {
    const mensagem =
      error instanceof Error
        ? error.message
        : "Erro desconhecido";

    console.error(
      `Falha na reconciliação: ${mensagem}`,
    );

    process.exitCode = 1;
  } finally {
    await prisma.$disconnect();
  }
}

const caminhoExecutado = process.argv[1];

const arquivoExecutadoDiretamente =
  caminhoExecutado !== undefined &&
  import.meta.url ===
    pathToFileURL(caminhoExecutado).href;

if (arquivoExecutadoDiretamente) {
  void executarPeloTerminal();
}