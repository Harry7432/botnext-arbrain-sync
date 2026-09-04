import { env } from "./config/env.js";
import { prisma } from "./database/prisma.js";

async function configurarTenant(): Promise<void> {
  console.log("Configurando tenant LRC no banco próprio...");

  const tenant = await prisma.tenant.upsert({
    where: {
      slug: "lrc",
    },
    update: {
      name: "LRC",
      arbrainDataId: env.ARBRAIN_DATA_ID,
      active: true,
    },
    create: {
      name: "LRC",
      slug: "lrc",
      arbrainDataId: env.ARBRAIN_DATA_ID,
      active: true,
    },
  });

  console.log(`Tenant configurado: ${tenant.name}`);
  console.log(`dataID configurado: ${tenant.arbrainDataId}`);
  console.log("Tenant salvo somente no nosso PostgreSQL.");
}

configurarTenant()
  .catch((error: unknown) => {
    const mensagem =
      error instanceof Error ? error.message : "Erro desconhecido";

    console.error(`Falha ao configurar tenant: ${mensagem}`);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });