import {
  BotnextWebhookStatus,
} from "@prisma/client";

import {
  prisma,
} from "../database/prisma.js";

import {
  BOTNEXT_PROCESSING_MAX_ATTEMPTS,
  BOTNEXT_PROCESSING_RECOVERY_MARGIN_MS,
  BOTNEXT_RECOVERY_BATCH_SIZE,
} from "./botnext-processing-config.js";

export type ResultadoRecuperacaoProcessamentoBotnext =
  | "RECEIVED"
  | "FAILED"
  | "NAO_RECUPERADO";

type LinhaStatus = {
  status: BotnextWebhookStatus;
};

function validarInteiroNaoNegativo(
  valor: number,
  nome: string,
): void {
  if (!Number.isInteger(valor) || valor < 0) {
    throw new Error(`${nome} deve ser um inteiro não negativo.`);
  }
}

function validarInteiroPositivo(
  valor: number,
  nome: string,
): void {
  if (!Number.isInteger(valor) || valor <= 0) {
    throw new Error(`${nome} deve ser um inteiro positivo.`);
  }
}

export async function recuperarEventoBotnextAbandonado(
  params: {
    eventoId: string;
    maximoTentativas: number;
    margemExpiracaoMs?: number;
  },
): Promise<ResultadoRecuperacaoProcessamentoBotnext> {
  validarInteiroPositivo(params.maximoTentativas, "maximoTentativas");

  const margemExpiracaoMs = params.margemExpiracaoMs ?? 0;

  validarInteiroNaoNegativo(margemExpiracaoMs, "margemExpiracaoMs");

  // O UPDATE invalida a posse antiga e decide o destino em uma única operação.
  const linhas = await prisma.$queryRaw<LinhaStatus[]>`
    UPDATE "botnext_webhook_events"
    SET
      "status" = CASE
        WHEN "processing_attempts" < ${params.maximoTentativas}
          THEN 'RECEIVED'::"BotnextWebhookStatus"
        ELSE 'FAILED'::"BotnextWebhookStatus"
      END,
      "processed_at" = CASE
        WHEN "processing_attempts" < ${params.maximoTentativas}
          THEN NULL
        ELSE NOW()
      END,
      "error_message" = CASE
        WHEN "processing_attempts" < ${params.maximoTentativas}
          THEN NULL
        ELSE 'Limite de tentativas excedido após lease expirada.'
      END,
      "processing_token" = NULL,
      "processing_worker" = NULL,
      "processing_lease_until" = NULL,
      "enqueue_token" = NULL,
      "enqueue_lease_until" = NULL
    WHERE
      "id" = ${params.eventoId}::uuid
      AND "status" = 'PROCESSING'::"BotnextWebhookStatus"
      AND (
        "processing_token" IS NULL
        OR "processing_lease_until" IS NULL
        OR "processing_lease_until" < NOW() - ${margemExpiracaoMs} * INTERVAL '1 millisecond'
      )
    RETURNING "status"
  `;

  const status = linhas[0]?.status;

  if (status === BotnextWebhookStatus.RECEIVED) {
    return "RECEIVED";
  }

  if (status === BotnextWebhookStatus.FAILED) {
    return "FAILED";
  }

  return "NAO_RECUPERADO";
}

export async function falharEventoBotnextRecebidoNoLimite(
  params: {
    eventoId: string;
    maximoTentativas: number;
  },
): Promise<"FAILED" | "NAO_ALTERADO"> {
  validarInteiroPositivo(params.maximoTentativas, "maximoTentativas");

  const linhas = await prisma.$queryRaw<Array<{ id: string }>>`
    UPDATE "botnext_webhook_events"
    SET
      "status" = 'FAILED'::"BotnextWebhookStatus",
      "processed_at" = NOW(),
      "error_message" = 'Limite de tentativas excedido antes de nova reivindicação.',
      "processing_token" = NULL,
      "processing_worker" = NULL,
      "processing_lease_until" = NULL,
      "enqueue_token" = NULL,
      "enqueue_lease_until" = NULL
    WHERE
      "id" = ${params.eventoId}::uuid
      AND "status" = 'RECEIVED'::"BotnextWebhookStatus"
      AND "processing_attempts" >= ${params.maximoTentativas}
    RETURNING "id"
  `;

  return linhas.length === 1
    ? "FAILED"
    : "NAO_ALTERADO";
}

export async function recuperarProcessamentosBotnextAbandonados(
  params: {
    maximoTentativas?: number;
    margemExpiracaoMs?: number;
    limite?: number;
  } = {},
): Promise<{
  encontrados: number;
  recebidos: number;
  falhados: number;
}> {
  const maximoTentativas =
    params.maximoTentativas ?? BOTNEXT_PROCESSING_MAX_ATTEMPTS;
  const margemExpiracaoMs =
    params.margemExpiracaoMs ?? BOTNEXT_PROCESSING_RECOVERY_MARGIN_MS;
  const limite = params.limite ?? BOTNEXT_RECOVERY_BATCH_SIZE;

  validarInteiroPositivo(maximoTentativas, "maximoTentativas");
  validarInteiroNaoNegativo(margemExpiracaoMs, "margemExpiracaoMs");
  validarInteiroPositivo(limite, "limite");

  const candidatos = await prisma.$queryRaw<Array<{ id: string }>>`
    SELECT "id"
    FROM "botnext_webhook_events"
    WHERE
      "status" = 'PROCESSING'::"BotnextWebhookStatus"
      AND (
        "processing_token" IS NULL
        OR "processing_lease_until" IS NULL
        OR "processing_lease_until" < NOW() - ${margemExpiracaoMs} * INTERVAL '1 millisecond'
      )
    ORDER BY "created_at" ASC
    LIMIT ${limite}
  `;

  let recebidos = 0;
  let falhados = 0;

  for (const candidato of candidatos) {
    const resultado = await recuperarEventoBotnextAbandonado({
      eventoId: candidato.id,
      maximoTentativas,
      margemExpiracaoMs,
    });

    if (resultado === "RECEIVED") {
      recebidos += 1;
    } else if (resultado === "FAILED") {
      falhados += 1;
    }
  }

  return {
    encontrados: candidatos.length,
    recebidos,
    falhados,
  };
}
