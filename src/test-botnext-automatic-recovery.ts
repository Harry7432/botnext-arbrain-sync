import {
  randomUUID,
} from "node:crypto";

import {
  BotnextWebhookStatus,
} from "@prisma/client";

import {
  prisma,
} from "./database/prisma.js";

const TEMPO_LIMITE_MS = 60_000;
const INTERVALO_CONSULTA_MS = 500;

function aguardar(
  tempoMs: number,
): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, tempoMs);
  });
}

async function executarTeste():
  Promise<void> {
  console.log(
    "Testando recuperação automática sem reentrega do webhook...",
  );

  const eventoReferencia =
    await prisma.botnextWebhookEvent.findFirst({
      where: {
        status:
          BotnextWebhookStatus.PROCESSED,

        clienteId: {
          not: null,
        },

        senderPhone: {
          not: null,
        },

        botnextAccountId: {
          not: null,
        },
      },
      orderBy: {
        createdAt: "desc",
      },
      select: {
        tenantId: true,
        botnextAccountId: true,
        companyId: true,
        senderPhone: true,
        recipientPhone: true,
        clienteId: true,
      },
    });

  if (
    !eventoReferencia ||
    !eventoReferencia.botnextAccountId ||
    !eventoReferencia.senderPhone ||
    !eventoReferencia.clienteId
  ) {
    throw new Error(
      "Nenhum evento processado adequado foi encontrado para o teste.",
    );
  }

  const eventoId = randomUUID();
  const externalMessageId = randomUUID();

  await prisma.botnextWebhookEvent.create({
    data: {
      id: eventoId,
      tenantId:
        eventoReferencia.tenantId,

      botnextAccountId:
        eventoReferencia.botnextAccountId,

      eventType:
        "MESSAGE_RECEIVED",

      externalMessageId,
      companyId:
        eventoReferencia.companyId,

      sessionId: randomUUID(),
      messageType: "TEXT",
      direction: "FROM_HUB",

      senderPhone:
        eventoReferencia.senderPhone,

      recipientPhone:
        eventoReferencia.recipientPhone,

      messageText:
        "TESTE_RECUPERACAO_AUTOMATICA",

      eventDate: new Date(),

      payload: {
        teste:
          "RECUPERACAO_AUTOMATICA",

        externalMessageId,
      },

      status:
        BotnextWebhookStatus.RECEIVED,
    },
  });

  console.log(
    "OK: evento salvo diretamente como RECEIVED.",
  );

  console.log(
    "Nenhum trabalho foi adicionado manualmente à fila.",
  );

  const prazoFinal =
    Date.now() + TEMPO_LIMITE_MS;

  while (Date.now() < prazoFinal) {
    const eventoAtual =
      await prisma.botnextWebhookEvent.findUnique({
        where: {
          id: eventoId,
        },
        select: {
          status: true,
          clienteId: true,
          errorMessage: true,
        },
      });

    if (!eventoAtual) {
      throw new Error(
        "O evento de teste desapareceu do PostgreSQL.",
      );
    }

    if (
      eventoAtual.status ===
      BotnextWebhookStatus.PROCESSED
    ) {
      if (
        eventoAtual.clienteId !==
        eventoReferencia.clienteId
      ) {
        throw new Error(
          "O evento foi associado ao cliente incorreto.",
        );
      }

      console.log(
        "OK: recuperação periódica encontrou e reenfileirou o evento.",
      );

      console.log(
        "OK: worker processou e associou o cliente correto.",
      );

      console.log(
        "Teste concluído sem reentrega do webhook, IA, envio BotNext ou escrita no ArBrain.",
      );

      return;
    }

    if (
      eventoAtual.status ===
        BotnextWebhookStatus.IGNORED ||
      eventoAtual.status ===
        BotnextWebhookStatus.FAILED
    ) {
      throw new Error(
        `Evento finalizado como ${eventoAtual.status}: ${
          eventoAtual.errorMessage ??
          "motivo não informado"
        }.`,
      );
    }

    await aguardar(
      INTERVALO_CONSULTA_MS,
    );
  }

  throw new Error(
    "O evento não foi recuperado automaticamente dentro de 60 segundos.",
  );
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