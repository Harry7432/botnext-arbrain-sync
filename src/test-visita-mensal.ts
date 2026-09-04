import { prisma } from "./database/prisma.js";

async function analisarVisitaMensal(): Promise<void> {
  console.log(
    "Analisando configuração de visitas mensais no nosso PostgreSQL...",
  );

  const tenant = await prisma.tenant.findUnique({
    where: {
      slug: "lrc",
    },
  });

  if (!tenant) {
    throw new Error("Tenant LRC não encontrado.");
  }

  const clientesMensais = await prisma.cliente.findMany({
    where: {
      tenantId: tenant.id,
      periodicidadeDaVisita: "MENSAL",
    },
    select: {
      diaVisitaPrimario: true,
      diaVisitaSecundario: true,
      periodicidadeDaVisita: true,
      ordenacaoDaVisita: true,
      indexSequenciamentoVisita: true,
    },
  });

  console.log(
    `Clientes com periodicidade mensal: ${clientesMensais.length}`,
  );

  console.table(clientesMensais);

  console.log(
    "Consulta realizada somente no nosso PostgreSQL.",
  );

  console.log(
    "Nenhuma chamada ou escrita foi enviada ao ArBrain.",
  );
}

analisarVisitaMensal()
  .catch((error: unknown) => {
    const mensagem =
      error instanceof Error
        ? error.message
        : "Erro desconhecido";

    console.error(`Falha na análise: ${mensagem}`);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });