import {
  BotnextConversationStatus,
} from "@prisma/client";

import type {
  IntencaoBotnext,
} from "../../ai/botnext-intent-classifier.js";

export const ACOES_ROTEAMENTO_BOTNEXT = [
  "INICIAR_PEDIDO",
  "ENCERRAR_SEM_PEDIDO",
  "RESPONDER_DUVIDA",
  "ENCAMINHAR_ATENDIMENTO_HUMANO",
  "SOLICITAR_MAIS_CONTEXTO",
] as const;

export type AcaoRoteamentoBotnext =
  typeof ACOES_ROTEAMENTO_BOTNEXT[number];

export type ClassificacaoParaRoteamento = {
  intencao: IntencaoBotnext;
  confianca: number;
  requerAtendimentoHumano: boolean;
};

export type DecisaoRoteamentoBotnext = {
  acao: AcaoRoteamentoBotnext;
  statusSugerido: BotnextConversationStatus;
  requerAtendimentoHumano: boolean;
  motivo: string;
};

const INTENCOES_COM_HANDOFF =
  new Set<IntencaoBotnext>([
    "ATENDIMENTO_HUMANO",
    "ALTERACAO_CADASTRAL",
    "RECLAMACAO",
  ]);

function criarDecisaoHandoff(
  classificacao: ClassificacaoParaRoteamento,
): DecisaoRoteamentoBotnext {
  const solicitacaoExplicita =
    classificacao.intencao ===
    "ATENDIMENTO_HUMANO";

  const motivo =
    solicitacaoExplicita
      ? "CLIENTE_SOLICITOU_ATENDIMENTO_HUMANO"
      : INTENCOES_COM_HANDOFF.has(
            classificacao.intencao,
          )
        ? "INTENCAO_EXIGE_ATENDIMENTO_HUMANO"
        : "CLASSIFICACAO_EXIGE_ATENDIMENTO_HUMANO";

  return {
    acao:
      "ENCAMINHAR_ATENDIMENTO_HUMANO",

    statusSugerido:
      BotnextConversationStatus.HUMAN_HANDOFF,

    requerAtendimentoHumano:
      true,

    motivo,
  };
}

function verificarConfianca(
  confianca: number,
): void {
  if (
    !Number.isFinite(confianca) ||
    confianca < 0 ||
    confianca > 1
  ) {
    throw new Error(
      "A confiança da classificação deve estar entre 0 e 1.",
    );
  }
}

function intencaoNaoMapeada(
  intencao: never,
): never {
  throw new Error(
    `Intenção BotNext não mapeada: ${String(intencao)}.`,
  );
}

export function rotearIntencaoBotnext(
  classificacao: ClassificacaoParaRoteamento,
): DecisaoRoteamentoBotnext {
  verificarConfianca(
    classificacao.confianca,
  );

  if (
    classificacao
      .requerAtendimentoHumano ||
    INTENCOES_COM_HANDOFF.has(
      classificacao.intencao,
    )
  ) {
    return criarDecisaoHandoff(
      classificacao,
    );
  }

  switch (
    classificacao.intencao
  ) {
    case "FAZER_PEDIDO":
      return {
        acao:
          "INICIAR_PEDIDO",

        statusSugerido:
          BotnextConversationStatus.ACTIVE,

        requerAtendimentoHumano:
          false,

        motivo:
          "CLIENTE_DESEJA_INICIAR_OU_CONTINUAR_PEDIDO",
      };

    case "NAO_DESEJA_PEDIDO":
      return {
        acao:
          "ENCERRAR_SEM_PEDIDO",

        statusSugerido:
          BotnextConversationStatus.COMPLETED,

        requerAtendimentoHumano:
          false,

        motivo:
          "CLIENTE_NAO_DESEJA_REALIZAR_PEDIDO",
      };

    case "DUVIDA":
      return {
        acao:
          "RESPONDER_DUVIDA",

        statusSugerido:
          BotnextConversationStatus.WAITING_CUSTOMER,

        requerAtendimentoHumano:
          false,

        motivo:
          "CLIENTE_APRESENTOU_UMA_DUVIDA",
      };

    case "FORA_DE_CONTEXTO":
      return {
        acao:
          "SOLICITAR_MAIS_CONTEXTO",

        statusSugerido:
          BotnextConversationStatus.WAITING_CUSTOMER,

        requerAtendimentoHumano:
          false,

        motivo:
          "MENSAGEM_INSUFICIENTE_OU_FORA_DE_CONTEXTO",
      };

    case "ATENDIMENTO_HUMANO":
    case "ALTERACAO_CADASTRAL":
    case "RECLAMACAO":
      return criarDecisaoHandoff(
        classificacao,
      );

    default:
      return intencaoNaoMapeada(
        classificacao.intencao,
      );
  }
}