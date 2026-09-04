import { prisma } from "./database/prisma.js";

async function testarClientesCompletos(): Promise<void> {
  console.log(
    "Verificando clientes completos no PostgreSQL...",
  );

  const totalClientes = await prisma.cliente.count({
    where: {
      tenant: {
        slug: "lrc",
      },
    },
  });

  const clientesComDadosCompletos =
    await prisma.cliente.count({
      where: {
        tenant: {
          slug: "lrc",
        },
        tipo: {
          not: null,
        },
      },
    });

  const clientesAindaResumidos =
    totalClientes - clientesComDadosCompletos;

  console.log(`Total de clientes: ${totalClientes}`);

  console.log(
    `Clientes com dados completos: ${clientesComDadosCompletos}`,
  );

  console.log(
    `Clientes ainda resumidos: ${clientesAindaResumidos}`,
  );

  if (clientesComDadosCompletos === 0) {
    throw new Error(
      "Nenhum cliente completo foi encontrado.",
    );
  }

  if (
    clientesComDadosCompletos +
      clientesAindaResumidos !==
    totalClientes
  ) {
    throw new Error(
      "A contagem dos clientes está inconsistente.",
    );
  }

  console.log("Contagem validada com sucesso.");
}

testarClientesCompletos()
  .catch((error: unknown) => {
    const mensagem =
      error instanceof Error ? error.message : "Erro desconhecido";

    console.error(`Falha na validação: ${mensagem}`);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });