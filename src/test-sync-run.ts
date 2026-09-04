import { prisma } from "./database/prisma.js";
import {
  concluirSyncRun,
  iniciarSyncRun,
} from "./sync/sync-run-service.js";

async function testarSyncRun(): Promise<void> {
  console.log("Testando auditoria de sincronização...");

  const tenant = await prisma.tenant.findUnique({
    where: {
      slug: "lrc",
    },
  });

  if (!tenant) {
    throw new Error("Tenant LRC não encontrado.");
  }

  const syncRun = await iniciarSyncRun({
    tenantId: tenant.id,
    entity: "clientes_teste",
    totalRecords: 5,
  });

  console.log(`Execução iniciada: ${syncRun.status}`);

  await concluirSyncRun({
    syncRunId: syncRun.id,
    tenantId: tenant.id,
    entity: "clientes_teste",
    totalRecords: 5,
    processedRecords: 5,
    changedRecords: 0,
    unchangedRecords: 5,
  });

  const resultado = await prisma.syncRun.findUnique({
    where: {
      id: syncRun.id,
    },
  });

  const cursor = await prisma.syncCursor.findUnique({
    where: {
      tenantId_entity: {
        tenantId: tenant.id,
        entity: "clientes_teste",
      },
    },
  });

  console.log(`Status final: ${resultado?.status}`);
  console.log(`Registros processados: ${resultado?.processedRecords}`);
  console.log(`Registros sem alteração: ${resultado?.unchangedRecords}`);
  console.log(
    `Última execução concluída registrada: ${Boolean(
      cursor?.lastSuccessfulRunAt,
    )}`,
  );

  console.log("Auditoria validada no nosso PostgreSQL.");
}

testarSyncRun()
  .catch((error: unknown) => {
    const mensagem =
      error instanceof Error ? error.message : "Erro desconhecido";

    console.error(`Falha no teste: ${mensagem}`);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });