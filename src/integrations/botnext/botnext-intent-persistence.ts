import {
  BotnextConversationIntent,
  BotnextConversationMessageRole,
  Prisma,
} from "@prisma/client";

import {
  prisma,
} from "../../database/prisma.js";

import type {
  ResultadoClassificacaoIntencao,
} from "../../ai/botnext-intent-classifier.js";

export type SalvarClassificacaoBotnextParams = {
  tenantId: string;
  eventoId: string;
  classificacao: ResultadoClassificacaoIntencao;
  modelo: string;
  versao: string;
};

export type ResultadoPersistenciaClassificacao = {
  mensagemId: string;
  conversaId: string;
  classificacaoSalva: boolean;
  conversaAtualizada: boolean;
};

function validarParametros(
  params: SalvarClassificacaoBotnextParams,
): void {
  if (
    !params.tenantId.trim() ||
    !params.eventoId.trim()
  ) {
    throw new Error(
      "Tenant e evento são obrigatórios.",
    );
  }

  if (
    !params.modelo.trim() ||
    !params.versao.trim()
  ) {
    throw new Error(
      "Modelo e versão da classificação são obrigatórios.",
    );
  }

  const {
    intencao,
    confianca,
    justificativa,
    requerAtendimentoHumano,
  } = params.classificacao;

  if (
    !Object.values(
      BotnextConversationIntent,
    ).includes(intencao)
  ) {
    throw new Error(
      "Intenção inválida para persistência.",
    );
  }

  if (
    !Number.isFinite(confianca) ||
    confianca < 0 ||
    confianca > 1
  ) {
    throw new Error(
      "A confiança deve estar entre 0 e 1.",
    );
  }

  if (!justificativa.trim()) {
    throw new Error(
      "A justificativa da classificação é obrigatória.",
    );
  }

  if (
    typeof requerAtendimentoHumano !==
    "boolean"
  ) {
    throw new Error(
      "A indicação de atendimento humano deve ser booleana.",
    );
  }
}

export async function salvarClassificacaoBotnext(
  params: SalvarClassificacaoBotnextParams,
): Promise<ResultadoPersistenciaClassificacao> {
  validarParametros(params);

  return prisma.$transaction(
    async (transaction) => {
      const mensagem =
        await transaction.botnextConversationMessage.findFirst({
          where: {
            webhookEventId:
              params.eventoId,

            conversation: {
              tenantId:
                params.tenantId,
            },
          },
          select: {
            id: true,
            conversationId: true,
            role: true,
            text: true,
            eventDate: true,
            createdAt: true,
          },
        });

      if (!mensagem) {
        throw new Error(
          "Mensagem do evento não encontrada no tenant informado.",
        );
      }

      if (
        mensagem.role !==
        BotnextConversationMessageRole.CUSTOMER
      ) {
        throw new Error(
          "Somente mensagens do cliente podem receber esta classificação.",
        );
      }

      if (!mensagem.text?.trim()) {
        throw new Error(
          "A mensagem não possui texto para classificação.",
        );
      }

      const classificacao =
        params.classificacao;

      const classificadaEm =
        new Date();

      const dataMensagem =
        mensagem.eventDate ??
        mensagem.createdAt;

      // A condição classifiedAt: null é verificada
      // pelo banco na própria atualização.
      // Uma classificação já salva não é sobrescrita.
      const gravacao =
        await transaction.botnextConversationMessage.updateMany({
          where: {
            id:
              mensagem.id,

            conversationId:
              mensagem.conversationId,

            conversation: {
              tenantId:
                params.tenantId,
            },

            classifiedAt:
              null,
          },
          data: {
            detectedIntent:
              classificacao.intencao,

            intentConfidence:
              classificacao.confianca,

            intentReason:
              classificacao.justificativa.trim(),

            requiresHumanHandoff:
              classificacao.requerAtendimentoHumano,

            classificationModel:
              params.modelo.trim(),

            classificationVersion:
              params.versao.trim(),

            classifiedAt:
              classificadaEm,
          },
        });

      if (gravacao.count === 0) {
        return {
          mensagemId:
            mensagem.id,

          conversaId:
            mensagem.conversationId,

          classificacaoSalva:
            false,

          conversaAtualizada:
            false,
        };
      }

      // Aqui intentUpdatedAt guarda a data da mensagem
      // que originou a intenção atual da conversa.
      //
      // O horário de execução da classificação fica
      // em classifiedAt, na própria mensagem.
      //
      // Mensagens antigas não substituem uma intenção
      // originada por uma mensagem mais recente.
      // Em datas iguais, preservamos a intenção já salva.
      const atualizacaoConversa =
        await transaction.botnextConversation.updateMany({
          where: {
            id:
              mensagem.conversationId,

            tenantId:
              params.tenantId,

            OR: [
              {
                intentUpdatedAt:
                  null,
              },
              {
                intentUpdatedAt: {
                  lt:
                    dataMensagem,
                },
              },
            ],
          },
          data: {
            intent:
              classificacao.intencao,

            intentConfidence:
              classificacao.confianca,

            intentUpdatedAt:
              dataMensagem,

            requiresHumanHandoff:
              classificacao.requerAtendimentoHumano,
          },
        });

      // Não alteramos status ou closedAt.
      // O indicador requiresHumanHandoff registra
      // a recomendação da classificação; ele não
      // executa uma transferência de atendimento.
      return {
        mensagemId:
          mensagem.id,

        conversaId:
          mensagem.conversationId,

        classificacaoSalva:
          true,

        conversaAtualizada:
          atualizacaoConversa.count === 1,
      };
    },
    {
      isolationLevel:
        Prisma.TransactionIsolationLevel.ReadCommitted,
    },
  );
}