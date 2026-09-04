import { prisma } from "./database/prisma.js";

async function verificarUltimaSincronizacao(): Promise<void> {
  console.log(
    "Consultando a última auditoria de clientes...",
  );

  const tenant = await prisma.tenant.findUnique({
    where: {
      slug: "lrc",
    },
  });

  if (!tenant) {
    throw new Error("Tenant LRC não encontrado.");
  }

  const ultimaExecucao =
    await prisma.syncRun.findFirst({
      where: {
        tenantId: tenant.id,
        entity: "clientes",
      },
      orderBy: {
        startedAt: "desc",
      },
    });

  if (!ultimaExecucao) {
    throw new Error(
      "Nenhuma auditoria de clientes foi encontrada.",
    );
  }

  const cursor = await prisma.syncCursor.findUnique({
    where: {
      tenantId_entity: {
        tenantId: tenant.id,
        entity: "clientes",
      },
    },
  });

  console.log(`Status: ${ultimaExecucao.status}`);

  console.log(
    `Total previsto: ${ultimaExecucao.totalRecords}`,
  );

  console.log(
    `Total processado: ${ultimaExecucao.processedRecords}`,
  );

  console.log(
    `Alterados: ${ultimaExecucao.changedRecords}`,
  );

  console.log(
    `Sem alteração: ${ultimaExecucao.unchangedRecords}`,
  );

  console.log(
    `Quantidade de erros: ${ultimaExecucao.errorCount}`,
  );

  console.log(
    `Finalizada em: ${ultimaExecucao.finishedAt?.toISOString()}`,
  );

  console.log(
    `Cursor atualizado: ${Boolean(
      cursor?.lastSuccessfulRunAt,
    )}`,
  );

  console.log(
    "Auditoria da execução real validada.",
  );
}

verificarUltimaSincronizacao()
  .catch((error: unknown) => {
    const mensagem =
      error instanceof Error
        ? error.message
        : "Erro desconhecido";

    console.error(`Falha no teste: ${mensagem}`);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });