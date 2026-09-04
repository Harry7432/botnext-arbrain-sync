import "./config/env.js";

import { prisma } from "./database/prisma.js";
import { env } from "./config/env.js";

async function cadastrarContaBotnext(): Promise<void> {
  const tenant = await prisma.tenant.findUnique({
    where: {
      slug: "lrc",
    },
    select: {
      id: true,
      active: true,
    },
  });

  if (!tenant) {
    throw new Error(
      "Tenant LRC não encontrado.",
    );
  }

  if (!tenant.active) {
    throw new Error(
      "Tenant LRC está inativo.",
    );
  }

  const conta =
    await prisma.botnextAccount.upsert({
      where: {
        companyId:
          env.BOTNEXT_COMPANY_ID,
      },
      create: {
        tenantId: tenant.id,
        companyId:
          env.BOTNEXT_COMPANY_ID,
        name: "LRC - BotNext",
        channelPhone:
          env.BOTNEXT_FROM,
        active: true,
      },
      update: {
        tenantId: tenant.id,
        name: "LRC - BotNext",
        channelPhone:
          env.BOTNEXT_FROM,
        active: true,
      },
      select: {
        id: true,
        active: true,
      },
    });

  console.log(
    "Conta BotNext vinculada ao tenant LRC.",
  );

  console.log(
    `Status: ${
      conta.active
        ? "ativa"
        : "inativa"
    }.`,
  );

  console.log(
    "Nenhum dado foi enviado ao BotNext ou ArBrain.",
  );
}

cadastrarContaBotnext()
  .catch((error: unknown) => {
    const mensagem =
      error instanceof Error
        ? error.message
        : "Erro desconhecido";

    console.error(
      `Falha ao cadastrar conta: ${mensagem}`,
    );

    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });