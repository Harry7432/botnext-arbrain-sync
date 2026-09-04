import {
  BotnextConversationStatus,
} from "@prisma/client";

import {
  prisma,
} from "../../database/prisma.js";

export type RegistrarMensagemRecebidaParams = {
  eventoId: string;
  clienteId: string;
};

export type ResultadoRegistroConversa = {
  conversaId: string;
  status: BotnextConversationStatus;
  mensagemCriada: boolean;
};

export async function registrarMensagemRecebidaNaConversa(
  params: RegistrarMensagemRecebidaParams,
): Promise<ResultadoRegistroConversa> {
  const evento =
    await prisma.botnextWebhookEvent.findUnique({
      where: {
        id: params.eventoId,
      },
      select: {
        id: true,
        tenantId: true,
        botnextAccountId: true,
        sessionId: true,
        externalMessageId: true,
        messageType: true,
        messageText: true,
        eventDate: true,
        createdAt: true,
      },
    });

  if (!evento) {
    throw new Error(
      "Evento BotNext não encontrado para registrar a conversa.",
    );
  }

  if (!evento.botnextAccountId) {
    throw new Error(
      "Evento BotNext sem conta vinculada.",
    );
  }

  const sessionId =
    evento.sessionId?.trim();

  if (!sessionId) {
    throw new Error(
      "Evento BotNext sem sessionId.",
    );
  }

  const dataMensagem =
    evento.eventDate ??
    evento.createdAt;

  return prisma.$transaction(
    async (transaction) => {
      const conversa =
        await transaction.botnextConversation.upsert({
          where: {
            botnextAccountId_sessionId: {
              botnextAccountId:
                evento.botnextAccountId!,
              sessionId,
            },
          },
          create: {
            tenantId:
              evento.tenantId,

            clienteId:
              params.clienteId,

            botnextAccountId:
              evento.botnextAccountId!,

            sessionId,

            status:
              BotnextConversationStatus.ACTIVE,

            lastMessageAt:
              dataMensagem,
          },
          update: {
            clienteId:
              params.clienteId,

            lastMessageAt:
              dataMensagem,
          },
          select: {
            id: true,
            status: true,
          },
        });

      const mensagem =
        await transaction
          .botnextConversationMessage
          .createMany({
            data: {
              conversationId:
                conversa.id,

              webhookEventId:
                evento.id,

              externalMessageId:
                evento.externalMessageId,

              role: "CUSTOMER",

              messageType:
                evento.messageType,

              text:
                evento.messageText,

              eventDate:
                dataMensagem,
            },
            skipDuplicates: true,
          });

      return {
        conversaId:
          conversa.id,

        status:
          conversa.status,

        mensagemCriada:
          mensagem.count === 1,
      };
    },
  );
}