import {
  BotnextWebhookStatus,
} from "@prisma/client";

import {
  prisma,
} from "../database/prisma.js";

import {
  enfileirarEventoBotnext,
} from "./botnext-webhook-queue.js";

const LIMITE_EVENTOS_POR_CICLO = 100;

export type ResultadoRecuperacaoBotnext = {
  encontrados: number;
  enfileirados: number;
  falhas: number;
};

export async function recuperarEventosBotnextPendentes():
  Promise<ResultadoRecuperacaoBotnext> {
  const eventosPendentes =
    await prisma.botnextWebhookEvent.findMany({
      where: {
        status:
          BotnextWebhookStatus.RECEIVED,
      },
      orderBy: {
        createdAt: "asc",
      },
      take: LIMITE_EVENTOS_POR_CICLO,
      select: {
        id: true,
      },
    });

  let enfileirados = 0;
  let falhas = 0;

  for (
    const evento of
    eventosPendentes
  ) {
    try {
      await enfileirarEventoBotnext(
        evento.id,
      );

      enfileirados += 1;
    } catch {
      falhas += 1;

      // Se o Redis continuar indisponível,
      // os próximos eventos permanecem seguros
      // como RECEIVED no PostgreSQL.
      break;
    }
  }

  return {
    encontrados:
      eventosPendentes.length,
    enfileirados,
    falhas,
  };
}