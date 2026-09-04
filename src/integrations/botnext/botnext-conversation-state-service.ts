import {
  BotnextConversationStatus,
} from "@prisma/client";

import {
  prisma,
} from "../../database/prisma.js";

export type AlterarEstadoConversaParams = {
  conversaId: string;
  novoStatus: BotnextConversationStatus;
};

export type ResultadoAlteracaoEstado = {
  conversaId: string;
  statusAnterior: BotnextConversationStatus;
  statusAtual: BotnextConversationStatus;
  alterado: boolean;
};

const transicoesPermitidas:
  Record<
    BotnextConversationStatus,
    ReadonlySet<BotnextConversationStatus>
  > = {
    ACTIVE: new Set([
      BotnextConversationStatus.WAITING_CUSTOMER,
      BotnextConversationStatus.WAITING_CONFIRMATION,
      BotnextConversationStatus.HUMAN_HANDOFF,
      BotnextConversationStatus.COMPLETED,
      BotnextConversationStatus.CANCELLED,
      BotnextConversationStatus.FAILED,
    ]),

    WAITING_CUSTOMER: new Set([
      BotnextConversationStatus.ACTIVE,
      BotnextConversationStatus.WAITING_CONFIRMATION,
      BotnextConversationStatus.HUMAN_HANDOFF,
      BotnextConversationStatus.COMPLETED,
      BotnextConversationStatus.CANCELLED,
      BotnextConversationStatus.FAILED,
    ]),

    WAITING_CONFIRMATION: new Set([
      BotnextConversationStatus.ACTIVE,
      BotnextConversationStatus.WAITING_CUSTOMER,
      BotnextConversationStatus.HUMAN_HANDOFF,
      BotnextConversationStatus.COMPLETED,
      BotnextConversationStatus.CANCELLED,
      BotnextConversationStatus.FAILED,
    ]),

    HUMAN_HANDOFF: new Set([
      BotnextConversationStatus.ACTIVE,
      BotnextConversationStatus.COMPLETED,
      BotnextConversationStatus.CANCELLED,
      BotnextConversationStatus.FAILED,
    ]),

    COMPLETED: new Set([
      BotnextConversationStatus.ACTIVE,
    ]),

    CANCELLED: new Set([
      BotnextConversationStatus.ACTIVE,
    ]),

    FAILED: new Set([
      BotnextConversationStatus.ACTIVE,
      BotnextConversationStatus.HUMAN_HANDOFF,
      BotnextConversationStatus.CANCELLED,
    ]),
  };

export function transicaoEstadoConversaPermitida(
  statusAtual: BotnextConversationStatus,
  novoStatus: BotnextConversationStatus,
): boolean {
  if (
    statusAtual ===
    novoStatus
  ) {
    return true;
  }

  return transicoesPermitidas[
    statusAtual
  ].has(
    novoStatus,
  );
}

export function statusEncerraConversa(
  status: BotnextConversationStatus,
): boolean {
  return (
    status ===
      BotnextConversationStatus.COMPLETED ||
    status ===
      BotnextConversationStatus.CANCELLED
  );
}

export async function alterarEstadoConversa(
  params: AlterarEstadoConversaParams,
): Promise<ResultadoAlteracaoEstado> {
  const conversa =
    await prisma.botnextConversation.findUnique({
      where: {
        id:
          params.conversaId,
      },

      select: {
        id:
          true,

        status:
          true,
      },
    });

  if (!conversa) {
    throw new Error(
      "Conversa BotNext não encontrada.",
    );
  }

  if (
    conversa.status ===
    params.novoStatus
  ) {
    return {
      conversaId:
        conversa.id,

      statusAnterior:
        conversa.status,

      statusAtual:
        conversa.status,

      alterado:
        false,
    };
  }

  if (
    !transicaoEstadoConversaPermitida(
      conversa.status,
      params.novoStatus,
    )
  ) {
    throw new Error(
      `Transição de ${conversa.status} para ${params.novoStatus} não permitida.`,
    );
  }

  const resultado =
    await prisma.botnextConversation.updateMany({
      where: {
        id:
          conversa.id,

        status:
          conversa.status,
      },

      data: {
        status:
          params.novoStatus,

        closedAt:
          statusEncerraConversa(
            params.novoStatus,
          )
            ? new Date()
            : null,
      },
    });

  if (
    resultado.count !== 1
  ) {
    throw new Error(
      "A conversa foi alterada por outro processamento. Tente novamente.",
    );
  }

  return {
    conversaId:
      conversa.id,

    statusAnterior:
      conversa.status,

    statusAtual:
      params.novoStatus,

    alterado:
      true,
  };
}