import { randomUUID } from "node:crypto";

import {
  BotnextConversationStatus,
} from "@prisma/client";

import { prisma } from "./database/prisma.js";

import {
  alterarEstadoConversa,
} from "./integrations/botnext/botnext-conversation-state-service.js";

async function executarTeste(): Promise<void> {
  console.log(
    "Testando estados da conversa BotNext...",
  );

  const conta =
    await prisma.botnextAccount.findFirst({
      where: {
        active: true,
        tenant: {
          active: true,
        },
      },
      select: {
        id: true,
        tenantId: true,
      },
    });

  if (!conta) {
    throw new Error(
      "Nenhuma conta BotNext ativa foi encontrada.",
    );
  }

  const conversa =
    await prisma.botnextConversation.create({
      data: {
        tenantId: conta.tenantId,
        botnextAccountId: conta.id,
        sessionId: randomUUID(),
        status:
          BotnextConversationStatus.ACTIVE,
      },
      select: {
        id: true,
      },
    });

  try {
    await alterarEstadoConversa({
      conversaId: conversa.id,
      novoStatus:
        BotnextConversationStatus
          .WAITING_CONFIRMATION,
    });

    console.log(
      "OK: ACTIVE → WAITING_CONFIRMATION.",
    );

    await alterarEstadoConversa({
      conversaId: conversa.id,
      novoStatus:
        BotnextConversationStatus.COMPLETED,
    });

    const concluida =
      await prisma.botnextConversation.findUnique({
        where: {
          id: conversa.id,
        },
        select: {
          status: true,
          closedAt: true,
        },
      });

    if (
      concluida?.status !==
        BotnextConversationStatus.COMPLETED ||
      !concluida.closedAt
    ) {
      throw new Error(
        "A conversa não foi encerrada corretamente.",
      );
    }

    console.log(
      "OK: conversa concluída com closedAt.",
    );

    let bloqueada = false;

    try {
      await alterarEstadoConversa({
        conversaId: conversa.id,
        novoStatus:
          BotnextConversationStatus
            .WAITING_CUSTOMER,
      });
    } catch {
      bloqueada = true;
    }

    if (!bloqueada) {
      throw new Error(
        "Uma transição proibida foi aceita.",
      );
    }

    console.log(
      "OK: transição proibida foi bloqueada.",
    );

    await alterarEstadoConversa({
      conversaId: conversa.id,
      novoStatus:
        BotnextConversationStatus.ACTIVE,
    });

    const reaberta =
      await prisma.botnextConversation.findUnique({
        where: {
          id: conversa.id,
        },
        select: {
          status: true,
          closedAt: true,
        },
      });

    if (
      reaberta?.status !==
        BotnextConversationStatus.ACTIVE ||
      reaberta.closedAt !== null
    ) {
      throw new Error(
        "A conversa não foi reaberta corretamente.",
      );
    }

    console.log(
      "OK: conversa reaberta e closedAt removido.",
    );

    console.log(
      "Teste concluído sem IA, envio BotNext ou escrita no ArBrain.",
    );
  } finally {
    await prisma.botnextConversation.delete({
      where: {
        id: conversa.id,
      },
    });
  }
}

executarTeste()
  .catch((error: unknown) => {
    const mensagem =
      error instanceof Error
        ? error.message
        : "Erro desconhecido";

    console.error(
      `Falha no teste: ${mensagem}`,
    );

    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });