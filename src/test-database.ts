import { prisma } from "./database/prisma.js";

async function testarBanco(): Promise<void> {
  console.log("Testando conexão com o banco pelo Prisma Client...");

  const [totalTenants, totalClientes] = await Promise.all([
    prisma.tenant.count(),
    prisma.cliente.count(),
  ]);

  console.log(`Tenants cadastrados: ${totalTenants}`);
  console.log(`Clientes cadastrados: ${totalClientes}`);
  console.log("Banco consultado com sucesso.");
}

testarBanco()
  .catch((error: unknown) => {
    const mensagem =
      error instanceof Error ? error.message : "Erro desconhecido";

    console.error(`Falha no teste do banco: ${mensagem}`);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });