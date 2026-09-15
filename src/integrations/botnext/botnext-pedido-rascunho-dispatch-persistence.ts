// Persistência do dispatch de pedido confirmado (Etapa 3.1).
//
// Todos os efeitos no banco são CAS com fencing: claim exclusivo por
// dispatchToken/lease e finalização apenas com token correto + lease válida.
// Usa exclusivamente updateMany (testável e idempotente); nenhum SQL raw.

import {
  BotnextPedidoRascunhoStatus,
  Prisma,
} from "@prisma/client";

import { prisma } from "../../database/prisma.js";

export type LinhaDispatchSelecionada = {
  id: string;
  tenantId: string;
  extracaoId: string;
  status: BotnextPedidoRascunhoStatus;
  revision: number;
  itens: Prisma.JsonValue | null;
  dispatchKey: string | null;
  dispatchToken: string | null;
  dispatchLeaseUntil: Date | null;
  dispatchAttempts: number;
  dispatchedAt: Date | null;
  extracao: {
    conversationId: string;
    sourceMessage: {
      webhookEvent: {
        senderPhone: string | null;
      } | null;
    };
    conversation: {
      clienteId: string | null;
    };
  };
};

export type ResultadoMutationDispatch =
  | "CONCLUIDO"
  | "LEASE_LOST";

export async function lerRascunhoParaDispatch(params: {
  tenantId: string;
  rascunhoId: string;
}): Promise<LinhaDispatchSelecionada | null> {
  return prisma.botnextPedidoRascunho.findFirst({
    where: {
      id: params.rascunhoId,
      tenantId: params.tenantId,
    },
    select: {
      id: true,
      tenantId: true,
      extracaoId: true,
      status: true,
      revision: true,
      itens: true,
      dispatchKey: true,
      dispatchToken: true,
      dispatchLeaseUntil: true,
      dispatchAttempts: true,
      dispatchedAt: true,
      extracao: {
        select: {
          conversationId: true,
          sourceMessage: {
            select: {
              webhookEvent: { select: { senderPhone: true } },
            },
          },
          conversation: {
            select: { clienteId: true },
          },
        },
      },
    },
  });
}

export async function adquirirLeaseDispatch(params: {
  tenantId: string;
  rascunhoId: string;
  dispatchToken: string;
  dispatchWorker: string;
  duracaoLeaseMs: number;
  maxTentativas: number;
}): Promise<boolean> {
  const agora = new Date();
  const atualizado = await prisma.botnextPedidoRascunho.updateMany({
    where: {
      id: params.rascunhoId,
      tenantId: params.tenantId,
      status: BotnextPedidoRascunhoStatus.CONFIRMADO,
      dispatchAttempts: { lt: params.maxTentativas },
      OR: [
        { dispatchToken: null },
        { dispatchLeaseUntil: { lt: agora } },
      ],
    },
    data: {
      dispatchToken: params.dispatchToken,
      dispatchWorker: params.dispatchWorker,
      dispatchLeaseUntil: new Date(
        agora.getTime() + params.duracaoLeaseMs,
      ),
      dispatchAttempts: { increment: 1 },
    },
  });

  return atualizado.count === 1;
}

function permitirFencing(params: {
  tenantId: string;
  rascunhoId: string;
  dispatchToken: string;
}): {
  id: string;
  tenantId: string;
  status: BotnextPedidoRascunhoStatus;
  dispatchToken: string;
  dispatchLeaseUntil: { gte: Date };
} {
  return {
    id: params.rascunhoId,
    tenantId: params.tenantId,
    status: BotnextPedidoRascunhoStatus.CONFIRMADO,
    dispatchToken: params.dispatchToken,
    dispatchLeaseUntil: { gte: new Date() },
  };
}

// ---------------------------------------------------------------------------
// Manipulação segura de mensagens de erro (auditoria/logs) — nunca expõe
// corpos/body/credenciais que possam vazar no errorMessage.
// ---------------------------------------------------------------------------

function limitarMensagem(
  mensagem: string,
  fallback: string,
): string {
  const normalizada = mensagem.trim() || fallback;
  return normalizada.slice(0, 2_000);
}

function extrairMensagem(erro: unknown): string {
  if (erro instanceof Error) {
    return erro.message;
  }
  if (typeof erro === "string") {
    return erro;
  }
  if (erro !== null && typeof erro === "object") {
    const mensagem = (erro as { message?: unknown }).message;
    if (typeof mensagem === "string") {
      return mensagem;
    }
  }
  return "";
}

export function mensagemErroSegura(
  erro: unknown,
  fallback: string,
): string {
  const mensagem = extrairMensagem(erro);

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
      ),
    fallback,
  );
}

// ---------------------------------------------------------------------------
// Finalizações com fencing (token correto + lease válida)
// ---------------------------------------------------------------------------

export async function finalizarDispatchEnviado(params: {
  tenantId: string;
  rascunhoId: string;
  dispatchToken: string;
  dispatchedAt: Date;
}): Promise<ResultadoMutationDispatch> {
  const atualizado = await prisma.botnextPedidoRascunho.updateMany({
    where: permitirFencing(params),
    data: {
      status: BotnextPedidoRascunhoStatus.DESPACHADO,
      dispatchedAt: params.dispatchedAt,
      errorMessage: null,
      dispatchToken: null,
      dispatchWorker: null,
      dispatchLeaseUntil: null,
    },
  });

  return atualizado.count === 1 ? "CONCLUIDO" : "LEASE_LOST";
}

export async function registrarFalhaTransitoriaDispatch(params: {
  tenantId: string;
  rascunhoId: string;
  dispatchToken: string;
  mensagem: string;
}): Promise<ResultadoMutationDispatch> {
  const atualizado = await prisma.botnextPedidoRascunho.updateMany({
    where: permitirFencing(params),
    data: {
      errorMessage: params.mensagem,
      dispatchToken: null,
      dispatchWorker: null,
      dispatchLeaseUntil: null,
    },
  });

  return atualizado.count === 1 ? "CONCLUIDO" : "LEASE_LOST";
}

export async function registrarFalhaPermanenteDispatch(params: {
  tenantId: string;
  rascunhoId: string;
  dispatchToken: string;
  mensagem: string;
}): Promise<ResultadoMutationDispatch> {
  const atualizado = await prisma.botnextPedidoRascunho.updateMany({
    where: permitirFencing(params),
    data: {
      status: BotnextPedidoRascunhoStatus.FALHOU,
      errorMessage: params.mensagem,
      dispatchToken: null,
      dispatchWorker: null,
      dispatchLeaseUntil: null,
    },
  });

  return atualizado.count === 1 ? "CONCLUIDO" : "LEASE_LOST";
}

export async function registrarEnvioIncerto(params: {
  tenantId: string;
  rascunhoId: string;
  dispatchToken: string;
  mensagem: string;
}): Promise<ResultadoMutationDispatch> {
  // Mantém token/lease (vão expirar naturalmente → INCERTO reconhecível).
  const atualizado = await prisma.botnextPedidoRascunho.updateMany({
    where: permitirFencing(params),
    data: {
      errorMessage: params.mensagem,
    },
  });

  return atualizado.count === 1 ? "CONCLUIDO" : "LEASE_LOST";
}
