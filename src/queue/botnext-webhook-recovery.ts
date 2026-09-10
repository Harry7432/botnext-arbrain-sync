import { randomUUID } from "node:crypto";

import {
  prisma,
} from "../database/prisma.js";

import {
  enfileirarEventoBotnext,
} from "./botnext-webhook-queue.js";

import {
  BOTNEXT_ENQUEUE_LEASE_MS,
  BOTNEXT_PROCESSING_MAX_ATTEMPTS,
  BOTNEXT_RECOVERY_BATCH_SIZE,
} from "./botnext-processing-config.js";

import {
  falharEventoBotnextRecebidoNoLimite,
} from "./botnext-processing-recovery.js";

type EventoPendente = {
  id: string;
};

function validarInteiroPositivo(valor: number, nome: string): void {
  if (!Number.isInteger(valor) || valor <= 0) {
    throw new Error(`${nome} deve ser um inteiro positivo.`);
  }
}

export type ResultadoRecuperacaoBotnext = {
  encontrados: number;
  enfileirados: number;
  falhas: number;
  falhadosPorLimite: number;
};

export async function recuperarEventosBotnextPendentes(
  params: {
    maximoTentativas?: number;
    duracaoEnqueueLeaseMs?: number;
    limite?: number;
  } = {},
):
  Promise<ResultadoRecuperacaoBotnext> {
  const maximoTentativas =
    params.maximoTentativas ?? BOTNEXT_PROCESSING_MAX_ATTEMPTS;
  const duracaoEnqueueLeaseMs =
    params.duracaoEnqueueLeaseMs ?? BOTNEXT_ENQUEUE_LEASE_MS;
  const limite = params.limite ?? BOTNEXT_RECOVERY_BATCH_SIZE;

  validarInteiroPositivo(maximoTentativas, "maximoTentativas");
  validarInteiroPositivo(
    duracaoEnqueueLeaseMs,
    "duracaoEnqueueLeaseMs",
  );
  validarInteiroPositivo(limite, "limite");

  const eventosNoLimite = await prisma.$queryRaw<EventoPendente[]>`
    SELECT "id"
    FROM "botnext_webhook_events"
    WHERE
      "status" = 'RECEIVED'::"BotnextWebhookStatus"
      AND "processing_attempts" >= ${maximoTentativas}
    ORDER BY "created_at" ASC
    LIMIT ${limite}
  `;

  let falhadosPorLimite = 0;

  for (const evento of eventosNoLimite) {
    const resultado = await falharEventoBotnextRecebidoNoLimite({
      eventoId: evento.id,
      maximoTentativas,
    });

    if (resultado === "FAILED") {
      falhadosPorLimite += 1;
    }
  }

  const eventosPendentes = await prisma.$queryRaw<EventoPendente[]>`
    SELECT "id"
    FROM "botnext_webhook_events"
    WHERE
      "status" = 'RECEIVED'::"BotnextWebhookStatus"
      AND "processing_attempts" < ${maximoTentativas}
      AND (
        "enqueue_lease_until" IS NULL
        OR "enqueue_lease_until" < NOW()
      )
    ORDER BY "created_at" ASC
    LIMIT ${limite}
  `;

  let enfileirados = 0;
  let falhas = 0;

  for (
    const evento of
    eventosPendentes
  ) {
    const enqueueToken = randomUUID();

    try {
      const reserva = await prisma.$queryRaw<EventoPendente[]>`
        UPDATE "botnext_webhook_events"
        SET
          "enqueue_token" = ${enqueueToken}::uuid,
          "enqueue_lease_until" = NOW() + ${duracaoEnqueueLeaseMs} * INTERVAL '1 millisecond'
        WHERE
          "id" = ${evento.id}::uuid
          AND "status" = 'RECEIVED'::"BotnextWebhookStatus"
          AND "processing_attempts" < ${maximoTentativas}
          AND (
            "enqueue_lease_until" IS NULL
            OR "enqueue_lease_until" < NOW()
          )
        RETURNING "id"
      `;

      if (reserva.length !== 1) {
        continue;
      }

      await enfileirarEventoBotnext(
        evento.id,
        enqueueToken,
      );

      await prisma.$queryRaw<Array<{ id: string }>>`
        UPDATE "botnext_webhook_events"
        SET "enqueued_at" = NOW()
        WHERE
          "id" = ${evento.id}::uuid
          AND "status" = 'RECEIVED'::"BotnextWebhookStatus"
          AND "enqueue_token" = ${enqueueToken}::uuid
        RETURNING "id"
      `;

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
    falhadosPorLimite,
  };
}
