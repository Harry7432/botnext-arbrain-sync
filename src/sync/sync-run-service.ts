import { prisma } from "../database/prisma.js";

interface IniciarSyncRunParams {
  tenantId: string;
  entity: string;
  totalRecords: number;
}

interface ConcluirSyncRunParams {
  syncRunId: string;
  tenantId: string;
  entity: string;
  totalRecords: number;
  processedRecords: number;
  changedRecords: number;
  unchangedRecords: number;
}

interface FalharSyncRunParams {
  syncRunId: string;
  processedRecords: number;
  error: unknown;
}

function obterMensagemDoErro(error: unknown): string {
  const mensagem =
    error instanceof Error
      ? error.message
      : "Erro desconhecido";

  return mensagem.slice(0, 4000);
}

export async function iniciarSyncRun(
  params: IniciarSyncRunParams,
) {
  return prisma.syncRun.create({
    data: {
      tenantId: params.tenantId,
      entity: params.entity,
      status: "RUNNING",
      totalRecords: params.totalRecords,
    },
  });
}

export async function concluirSyncRun(
  params: ConcluirSyncRunParams,
): Promise<void> {
  const agora = new Date();

  await prisma.$transaction([
    prisma.syncRun.update({
      where: {
        id: params.syncRunId,
      },
      data: {
        status: "SUCCESS",
        finishedAt: agora,
        totalRecords: params.totalRecords,
        processedRecords: params.processedRecords,
        changedRecords: params.changedRecords,
        unchangedRecords: params.unchangedRecords,
        errorCount: 0,
        errorMessage: null,
      },
    }),

    prisma.syncCursor.upsert({
      where: {
        tenantId_entity: {
          tenantId: params.tenantId,
          entity: params.entity,
        },
      },
      update: {
        cursor: null,
        lastSuccessfulRunAt: agora,
      },
      create: {
        tenantId: params.tenantId,
        entity: params.entity,
        cursor: null,
        lastSuccessfulRunAt: agora,
      },
    }),
  ]);
}

export async function falharSyncRun(
  params: FalharSyncRunParams,
): Promise<void> {
  await prisma.syncRun.update({
    where: {
      id: params.syncRunId,
    },
    data: {
      status: "FAILED",
      finishedAt: new Date(),
      processedRecords: params.processedRecords,
      errorCount: {
        increment: 1,
      },
      errorMessage: obterMensagemDoErro(params.error),
    },
  });
}