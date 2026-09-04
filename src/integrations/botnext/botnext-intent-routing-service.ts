import {
  BotnextConversationMessageRole,
  BotnextConversationStatus,
  BotnextRoutingAction,
  Prisma,
} from "@prisma/client";

import {
  prisma,
} from "../../database/prisma.js";

import {
  rotearIntencaoBotnext,
} from "./botnext-intent-router.js";

import {
  statusEncerraConversa,
  transicaoEstadoConversaPermitida,
} from "./botnext-conversation-state-service.js";

import type {
  DecisaoRoteamentoBotnext,
} from "./botnext-intent-router.js";

export const VERSAO_ROTEADOR_BOTNEXT =
  "botnext-routing-v1";

export type RotearEventoBotnextParams = {
  tenantId: string;
  eventoId: string;
};

export type ResultadoRoteamentoEventoBotnext = {
  situacao:
    | "ROTEADA"
    | "JA_ROTEADA";

  mensagemId:
    string;

  conversaId:
    string;

  decisao:
    DecisaoRoteamentoBotnext;

  versao:
    string;

  roteadaEm:
    Date;

  statusAnterior:
    BotnextConversationStatus;

  statusAtual:
    BotnextConversationStatus;

  conversaAtualizada:
    boolean;
};

type CamposRoteamentoSalvo = {
  routingAction:
    BotnextRoutingAction | null;

  routingReason:
    string | null;

  routingStatus:
    BotnextConversationStatus | null;

  routingVersion:
    string | null;

  routedAt:
    Date | null;
};

type RoteamentoSalvo = {
  decisao:
    DecisaoRoteamentoBotnext;

  versao:
    string;

  roteadaEm:
    Date;
};

function validarParametros(
  params: RotearEventoBotnextParams,
): void {
  if (
    !params.tenantId.trim() ||
    !params.eventoId.trim()
  ) {
    throw new Error(
      "Tenant e evento são obrigatórios para o roteamento.",
    );
  }
}

function lerRoteamentoSalvo(
  campos: CamposRoteamentoSalvo,
): RoteamentoSalvo | null {
  const valores = [
    campos.routingAction,
    campos.routingReason,
    campos.routingStatus,
    campos.routingVersion,
    campos.routedAt,
  ];

  const algumCampoPreenchido =
    valores.some(
      (valor) =>
        valor !== null,
    );

  if (!algumCampoPreenchido) {
    return null;
  }

  const todosCamposPreenchidos =
    valores.every(
      (valor) =>
        valor !== null,
    );

  if (
    !todosCamposPreenchidos ||
    !campos.routingAction ||
    !campos.routingReason ||
    !campos.routingStatus ||
    !campos.routingVersion ||
    !campos.routedAt
  ) {
    throw new Error(
      "Decisão de roteamento persistida está incompleta ou inválida.",
    );
  }

  if (
    !campos.routingReason.trim() ||
    !campos.routingVersion.trim()
  ) {
    throw new Error(
      "Motivo e versão do roteamento persistido são obrigatórios.",
    );
  }

  const requerAtendimentoHumano =
    campos.routingAction ===
    BotnextRoutingAction
      .ENCAMINHAR_ATENDIMENTO_HUMANO;

  return {
    decisao: {
      acao:
        campos.routingAction,

      statusSugerido:
        campos.routingStatus,

      requerAtendimentoHumano,

      motivo:
        campos.routingReason,
    },

    versao:
      campos.routingVersion,

    roteadaEm:
      campos.routedAt,
  };
}

export async function rotearEventoBotnext(
  params: RotearEventoBotnextParams,
): Promise<ResultadoRoteamentoEventoBotnext> {
  validarParametros(params);

  return prisma.$transaction(
    async (transaction) => {
      const mensagem =
        await transaction
          .botnextConversationMessage
          .findFirst({
            where: {
              webhookEventId:
                params.eventoId,

              conversation: {
                tenantId:
                  params.tenantId,
              },
            },

            select: {
              id:
                true,

              conversationId:
                true,

              role:
                true,

              text:
                true,

              eventDate:
                true,

              createdAt:
                true,

              detectedIntent:
                true,

              intentConfidence:
                true,

              intentReason:
                true,

              requiresHumanHandoff:
                true,

              classifiedAt:
                true,

              routingAction:
                true,

              routingReason:
                true,

              routingStatus:
                true,

              routingVersion:
                true,

              routedAt:
                true,

              conversation: {
                select: {
                  status:
                    true,

                  intent:
                    true,

                  intentUpdatedAt:
                    true,
                },
              },
            },
          });

      if (!mensagem) {
        throw new Error(
          "Mensagem do evento não encontrada no tenant informado.",
        );
      }

      const roteamentoExistente =
        lerRoteamentoSalvo(
          mensagem,
        );

      if (roteamentoExistente) {
        return {
          situacao:
            "JA_ROTEADA",

          mensagemId:
            mensagem.id,

          conversaId:
            mensagem.conversationId,

          decisao:
            roteamentoExistente.decisao,

          versao:
            roteamentoExistente.versao,

          roteadaEm:
            roteamentoExistente.roteadaEm,

          statusAnterior:
            mensagem
              .conversation
              .status,

          statusAtual:
            mensagem
              .conversation
              .status,

          conversaAtualizada:
            false,
        };
      }

      if (
        mensagem.role !==
        BotnextConversationMessageRole.CUSTOMER
      ) {
        throw new Error(
          "Somente mensagens do cliente podem ser roteadas.",
        );
      }

      if (
        !mensagem.text?.trim()
      ) {
        throw new Error(
          "A mensagem não possui texto para roteamento.",
        );
      }

      if (
        !mensagem.detectedIntent ||
        mensagem.intentConfidence ===
          null ||
        !mensagem.intentReason?.trim() ||
        mensagem
          .requiresHumanHandoff ===
          null ||
        !mensagem.classifiedAt
      ) {
        throw new Error(
          "A mensagem ainda não possui uma classificação completa.",
        );
      }

      const decisao =
        rotearIntencaoBotnext({
          intencao:
            mensagem.detectedIntent,

          confianca:
            mensagem.intentConfidence,

          requerAtendimentoHumano:
            mensagem
              .requiresHumanHandoff,
        });

      const roteadaEm =
        new Date();

      const gravacao =
        await transaction
          .botnextConversationMessage
          .updateMany({
            where: {
              id:
                mensagem.id,

              conversationId:
                mensagem.conversationId,

              conversation: {
                tenantId:
                  params.tenantId,
              },

              routedAt:
                null,
            },

            data: {
              routingAction:
                decisao.acao,

              routingReason:
                decisao.motivo,

              routingStatus:
                decisao.statusSugerido,

              routingVersion:
                VERSAO_ROTEADOR_BOTNEXT,

              routedAt:
                roteadaEm,
            },
          });

      if (
        gravacao.count === 0
      ) {
        const mensagemAtual =
          await transaction
            .botnextConversationMessage
            .findUniqueOrThrow({
              where: {
                id:
                  mensagem.id,
              },

              select: {
                routingAction:
                  true,

                routingReason:
                  true,

                routingStatus:
                  true,

                routingVersion:
                  true,

                routedAt:
                  true,

                conversation: {
                  select: {
                    status:
                      true,
                  },
                },
              },
            });

        const roteamentoConcorrente =
          lerRoteamentoSalvo(
            mensagemAtual,
          );

        if (
          !roteamentoConcorrente
        ) {
          throw new Error(
            "Não foi possível confirmar a persistência do roteamento.",
          );
        }

        return {
          situacao:
            "JA_ROTEADA",

          mensagemId:
            mensagem.id,

          conversaId:
            mensagem.conversationId,

          decisao:
            roteamentoConcorrente.decisao,

          versao:
            roteamentoConcorrente.versao,

          roteadaEm:
            roteamentoConcorrente.roteadaEm,

          statusAnterior:
            mensagemAtual
              .conversation
              .status,

          statusAtual:
            mensagemAtual
              .conversation
              .status,

          conversaAtualizada:
            false,
        };
      }

      const statusAnterior =
        mensagem
          .conversation
          .status;

      const dataMensagem =
        mensagem.eventDate ??
        mensagem.createdAt;

      const dataIntencaoAtual =
        mensagem
          .conversation
          .intentUpdatedAt;

      const mensagemPodeAtualizarEstado =
        dataIntencaoAtual ===
          null ||
        (
          dataIntencaoAtual
            .getTime() ===
          dataMensagem.getTime() &&
          mensagem
            .conversation
            .intent ===
          mensagem.detectedIntent
        );

      if (
        !mensagemPodeAtualizarEstado
      ) {
        return {
          situacao:
            "ROTEADA",

          mensagemId:
            mensagem.id,

          conversaId:
            mensagem.conversationId,

          decisao,

          versao:
            VERSAO_ROTEADOR_BOTNEXT,

          roteadaEm,

          statusAnterior,

          statusAtual:
            statusAnterior,

          conversaAtualizada:
            false,
        };
      }

      if (
        !transicaoEstadoConversaPermitida(
          statusAnterior,
          decisao.statusSugerido,
        )
      ) {
        throw new Error(
          `Roteamento exige transição de ${statusAnterior} para ${decisao.statusSugerido}, mas ela não é permitida.`,
        );
      }

      const atualizacaoConversa =
        await transaction
          .botnextConversation
          .updateMany({
            where: {
              id:
                mensagem.conversationId,

              tenantId:
                params.tenantId,

              status:
                statusAnterior,

              OR: [
                {
                  intentUpdatedAt:
                    null,
                },
                {
                  intent:
                    mensagem
                      .detectedIntent,

                  intentUpdatedAt:
                    dataMensagem,
                },
              ],
            },

            data: {
              status:
                decisao
                  .statusSugerido,

              closedAt:
                statusEncerraConversa(
                  decisao
                    .statusSugerido,
                )
                  ? new Date()
                  : null,
            },
          });

      if (
        atualizacaoConversa.count !==
        1
      ) {
        throw new Error(
          "A conversa foi alterada por outro processamento durante o roteamento.",
        );
      }

      return {
        situacao:
          "ROTEADA",

        mensagemId:
          mensagem.id,

        conversaId:
          mensagem.conversationId,

        decisao,

        versao:
          VERSAO_ROTEADOR_BOTNEXT,

        roteadaEm,

        statusAnterior,

        statusAtual:
          decisao.statusSugerido,

        conversaAtualizada:
          statusAnterior !==
          decisao.statusSugerido,
      };
    },
    {
      isolationLevel:
        Prisma
          .TransactionIsolationLevel
          .ReadCommitted,
    },
  );
}