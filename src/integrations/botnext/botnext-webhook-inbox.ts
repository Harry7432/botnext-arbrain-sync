import { randomUUID } from "node:crypto";

import type {
  Prisma,
} from "@prisma/client";

import {
  prisma,
} from "../../database/prisma.js";

type SalvarEventoBotnextParams = {
  eventType: string;
  externalMessageId: string;
  companyId: string;
  sessionId: string | null;
  messageType: string | null;
  direction: string | null;
  senderPhone: string | null;
  recipientPhone: string | null;
  messageText: string | null;
  eventDate: Date | null;
  payload: Prisma.InputJsonValue;
};

export type ResultadoPersistenciaWebhook = {
  persistido: boolean;
  duplicado: boolean;
  eventoId: string | null;
};

export class ContaBotnextNaoAutorizadaError
  extends Error {
  constructor() {
    super(
      "Conta BotNext não autorizada.",
    );

    this.name =
      "ContaBotnextNaoAutorizadaError";
  }
}

export async function salvarEventoBotnext(
  params: SalvarEventoBotnextParams,
): Promise<ResultadoPersistenciaWebhook> {
  const conta =
    await prisma.botnextAccount.findUnique({
      where: {
        companyId: params.companyId,
      },
      select: {
        id: true,
        tenantId: true,
        active: true,
        tenant: {
          select: {
            active: true,
          },
        },
      },
    });

  if (
    !conta ||
    !conta.active ||
    !conta.tenant.active
  ) {
    throw new ContaBotnextNaoAutorizadaError();
  }

  const eventoId = randomUUID();

  const resultado =
    await prisma.botnextWebhookEvent.createMany({
      data: {
        id: eventoId,
        tenantId: conta.tenantId,
        botnextAccountId: conta.id,
        eventType: params.eventType,
        externalMessageId:
          params.externalMessageId,
        companyId: params.companyId,
        sessionId: params.sessionId,
        messageType: params.messageType,
        direction: params.direction,
        senderPhone: params.senderPhone,
        recipientPhone:
          params.recipientPhone,
        messageText: params.messageText,
        eventDate: params.eventDate,
        payload: params.payload,
      },
      skipDuplicates: true,
    });

    if (resultado.count === 0) {
    const eventoExistente =
      await prisma.botnextWebhookEvent.findUnique({
        where: {
          tenantId_companyId_eventType_externalMessageId: {
            tenantId: conta.tenantId,
            companyId: params.companyId,
            eventType: params.eventType,
            externalMessageId:
              params.externalMessageId,
          },
        },
        select: {
          id: true,
        },
      });

    if (!eventoExistente) {
      throw new Error(
        "Evento duplicado não foi localizado no PostgreSQL.",
      );
    }

    return {
      persistido: false,
      duplicado: true,
      eventoId: eventoExistente.id,
    };
  }

  return {
    persistido: true,
    duplicado: false,
    eventoId,
  };
}