import { randomUUID } from "node:crypto";

import {
  BotnextWebhookStatus,
} from "@prisma/client";

import {
  prisma,
} from "../database/prisma.js";

type LinhaClaim = {
  id: string;
  processingAttempts: number;
};

type LinhaStatus = {
  status: BotnextWebhookStatus;
};

export type ResultadoClaimBotnext =
  | {
      situacao: "ADQUIRIDO";
      processingToken: string;
      processingAttempts: number;
    }
  | {
      situacao: "NAO_ADQUIRIDO";
    };

export type ResultadoLeaseBotnext =
  | "CONCLUIDO"
  | "LEASE_LOST";

export type ResultadoFalhaBotnext =
  | "RECEIVED"
  | "FAILED"
  | "LEASE_LOST";

type ParametrosComPosse = {
  eventoId: string;
  processingToken: string;
};

function validarInteiroPositivo(
  valor: number,
  nome: string,
): void {
  if (!Number.isInteger(valor) || valor <= 0) {
    throw new Error(`${nome} deve ser um inteiro positivo.`);
  }
}

function limitarMensagem(
  mensagem: string,
  fallback: string,
): string {
  const normalizada = mensagem.trim() || fallback;

  return normalizada.slice(0, 2_000);
}

function redigirMensagem(
  mensagem: string,
  fallback: string,
): string {
  return limitarMensagem(
    mensagem
      .replace(
        /\b(payload|request body|response body|body|details)\s*[:=]\s*(\{.*|\[.*)/gi,
        "$1: [REDACTED]",
      )
      .replace(
        /\b(api[-_ ]?key|authorization|token|password|senha|secret|credential|credencial)\s*[:=]\s*(?:"[^"]*"|'[^']*'|[^\s,;]+)/gi,
        "$1=[REDACTED]",
      )
      .replace(
        /\bBearer\s+[^\s,;]+/gi,
        "Bearer [REDACTED]",
      )
      .replace(
        /(https?:\/\/[^:\s/]+:)[^@\s/]+@/gi,
        "$1[REDACTED]@",
      ),
    fallback,
  );
}

function obterMensagemSegura(error: unknown): string {
  return error instanceof Error
    ? redigirMensagem(
        error.message,
        "Falha desconhecida no processamento.",
      )
    : "Falha desconhecida no processamento.";
}

export async function reivindicarEventoBotnext(
  params: {
    eventoId: string;
    processingWorker: string;
    duracaoLeaseMs: number;
    maximoTentativas: number;
    processingToken?: string;
  },
): Promise<ResultadoClaimBotnext> {
  validarInteiroPositivo(params.duracaoLeaseMs, "duracaoLeaseMs");
  validarInteiroPositivo(params.maximoTentativas, "maximoTentativas");

  const processingToken =
    params.processingToken ?? randomUUID();
  const processingWorker =
    params.processingWorker.trim();

  if (!processingWorker) {
    throw new Error("processingWorker é obrigatório.");
  }

  const linhas = await prisma.$queryRaw<LinhaClaim[]>`
    UPDATE "botnext_webhook_events"
    SET
      "status" = 'PROCESSING'::"BotnextWebhookStatus",
      "processing_token" = ${processingToken}::uuid,
      "processing_worker" = ${processingWorker},
      "processing_lease_until" = NOW() + ${params.duracaoLeaseMs} * INTERVAL '1 millisecond',
      "processing_attempts" = "processing_attempts" + 1,
      "enqueue_token" = NULL,
      "enqueue_lease_until" = NULL,
      "processed_at" = NULL,
      "error_message" = NULL
    WHERE
      "id" = ${params.eventoId}::uuid
      AND "status" = 'RECEIVED'::"BotnextWebhookStatus"
      AND "processing_attempts" < ${params.maximoTentativas}
    RETURNING
      "id",
      "processing_attempts" AS "processingAttempts"
  `;

  const linha = linhas[0];

  if (!linha) {
    return {
      situacao: "NAO_ADQUIRIDO",
    };
  }

  return {
    situacao: "ADQUIRIDO",
    processingToken,
    processingAttempts: linha.processingAttempts,
  };
}

export async function renovarLeaseEventoBotnext(
  params: ParametrosComPosse & {
    duracaoLeaseMs: number;
  },
): Promise<"RENOVADA" | "LEASE_LOST"> {
  validarInteiroPositivo(params.duracaoLeaseMs, "duracaoLeaseMs");

  const linhas = await prisma.$queryRaw<Array<{ id: string }>>`
    UPDATE "botnext_webhook_events"
    SET
      "processing_lease_until" = NOW() + ${params.duracaoLeaseMs} * INTERVAL '1 millisecond'
    WHERE
      "id" = ${params.eventoId}::uuid
      AND "status" = 'PROCESSING'::"BotnextWebhookStatus"
      AND "processing_token" = ${params.processingToken}::uuid
      AND "processing_lease_until" >= NOW()
    RETURNING "id"
  `;

  return linhas.length === 1
    ? "RENOVADA"
    : "LEASE_LOST";
}

export async function finalizarEventoBotnextProcessado(
  params: ParametrosComPosse & {
    clienteId: string;
  },
): Promise<ResultadoLeaseBotnext> {
  const linhas = await prisma.$queryRaw<Array<{ id: string }>>`
    UPDATE "botnext_webhook_events"
    SET
      "status" = 'PROCESSED'::"BotnextWebhookStatus",
      "cliente_id" = ${params.clienteId}::uuid,
      "processed_at" = NOW(),
      "error_message" = NULL,
      "processing_token" = NULL,
      "processing_worker" = NULL,
      "processing_lease_until" = NULL,
      "enqueue_token" = NULL,
      "enqueue_lease_until" = NULL
    WHERE
      "id" = ${params.eventoId}::uuid
      AND "status" = 'PROCESSING'::"BotnextWebhookStatus"
      AND "processing_token" = ${params.processingToken}::uuid
      AND "processing_lease_until" >= NOW()
    RETURNING "id"
  `;

  return linhas.length === 1
    ? "CONCLUIDO"
    : "LEASE_LOST";
}

export async function finalizarEventoBotnextIgnorado(
  params: ParametrosComPosse & {
    motivo: string;
  },
): Promise<ResultadoLeaseBotnext> {
  const motivo = redigirMensagem(
    params.motivo,
    "Evento ignorado.",
  );

  const linhas = await prisma.$queryRaw<Array<{ id: string }>>`
    UPDATE "botnext_webhook_events"
    SET
      "status" = 'IGNORED'::"BotnextWebhookStatus",
      "cliente_id" = NULL,
      "processed_at" = NOW(),
      "error_message" = ${motivo},
      "processing_token" = NULL,
      "processing_worker" = NULL,
      "processing_lease_until" = NULL,
      "enqueue_token" = NULL,
      "enqueue_lease_until" = NULL
    WHERE
      "id" = ${params.eventoId}::uuid
      AND "status" = 'PROCESSING'::"BotnextWebhookStatus"
      AND "processing_token" = ${params.processingToken}::uuid
      AND "processing_lease_until" >= NOW()
    RETURNING "id"
  `;

  return linhas.length === 1
    ? "CONCLUIDO"
    : "LEASE_LOST";
}

export async function registrarFalhaEventoBotnextComPosse(
  params: ParametrosComPosse & {
    error: unknown;
    maximoTentativas: number;
  },
): Promise<ResultadoFalhaBotnext> {
  validarInteiroPositivo(params.maximoTentativas, "maximoTentativas");

  const mensagem = obterMensagemSegura(params.error);
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
      "error_message" = ${mensagem},
      "processing_token" = NULL,
      "processing_worker" = NULL,
      "processing_lease_until" = NULL,
      "enqueue_token" = NULL,
      "enqueue_lease_until" = NULL
    WHERE
      "id" = ${params.eventoId}::uuid
      AND "status" = 'PROCESSING'::"BotnextWebhookStatus"
      AND "processing_token" = ${params.processingToken}::uuid
      AND "processing_lease_until" >= NOW()
    RETURNING "status"
  `;

  const status = linhas[0]?.status;

  if (status === BotnextWebhookStatus.RECEIVED) {
    return "RECEIVED";
  }

  if (status === BotnextWebhookStatus.FAILED) {
    return "FAILED";
  }

  return "LEASE_LOST";
}
