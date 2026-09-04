import {
  BotnextConversationMessageRole,
} from "@prisma/client";

import type {
  BotnextConversationMessage,
} from "@prisma/client";

import {
  prisma,
} from "../../database/prisma.js";

import type {
  ResultadoClassificacaoIntencao,
} from "../../ai/botnext-intent-classifier.js";

import {
  salvarClassificacaoBotnext,
} from "./botnext-intent-persistence.js";

export type ProvedorClassificacaoBotnext = {
  modelo: string;
  versao: string;

  classificar: (
    texto: string,
  ) => Promise<ResultadoClassificacaoIntencao>;
};

export type ClassificarMensagemBotnextParams = {
  tenantId: string;
  eventoId: string;
};

type IdentificacaoMensagem = {
  eventoId: string;
  mensagemId: string;
  conversaId: string;
};

export type ResultadoClassificacaoMensagem =
  IdentificacaoMensagem & (
    | {
        situacao:
          | "CLASSIFICADA"
          | "JA_CLASSIFICADA";

        classificacao:
          ResultadoClassificacaoIntencao;

        modelo: string;
        versao: string;
        classificadaEm: Date;
      }
    | {
        situacao: "IGNORADA";

        motivo:
          | "MENSAGEM_NAO_CLIENTE"
          | "MENSAGEM_SEM_TEXTO";
      }
  );

export type ServicoClassificacaoMensagem = (
  params: ClassificarMensagemBotnextParams,
) => Promise<ResultadoClassificacaoMensagem>;

async function buscarMensagem(
  params: ClassificarMensagemBotnextParams,
): Promise<BotnextConversationMessage> {
  const mensagem =
    await prisma.botnextConversationMessage.findFirst({
      where: {
        webhookEventId:
          params.eventoId,

        conversation: {
          tenantId:
            params.tenantId,
        },
      },
    });

  if (!mensagem) {
    throw new Error(
      "Mensagem do evento não encontrada no tenant informado.",
    );
  }

  return mensagem;
}

function montarResultadoPersistido(
  eventoId: string,
  mensagem: BotnextConversationMessage,
  situacao: "CLASSIFICADA" | "JA_CLASSIFICADA",
): ResultadoClassificacaoMensagem {
  const {
    detectedIntent,
    intentConfidence,
    intentReason,
    requiresHumanHandoff,
    classificationModel,
    classificationVersion,
    classifiedAt,
  } = mensagem;

  if (
    detectedIntent === null ||
    intentConfidence === null ||
    !Number.isFinite(intentConfidence) ||
    intentConfidence < 0 ||
    intentConfidence > 1 ||
    !intentReason?.trim() ||
    requiresHumanHandoff === null ||
    !classificationModel?.trim() ||
    !classificationVersion?.trim() ||
    classifiedAt === null
  ) {
    // Não chama novamente a IA para tentar corrigir
    // silenciosamente um registro inconsistente.
    throw new Error(
      "A mensagem possui uma classificação persistida incompleta ou inválida.",
    );
  }

  return {
    eventoId,
    mensagemId:
      mensagem.id,

    conversaId:
      mensagem.conversationId,

    situacao,

    classificacao: {
      intencao:
        detectedIntent,

      confianca:
        intentConfidence,

      justificativa:
        intentReason,

      requerAtendimentoHumano:
        requiresHumanHandoff,
    },

    modelo:
      classificationModel,

    versao:
      classificationVersion,

    classificadaEm:
      classifiedAt,
  };
}

export function criarServicoClassificacaoBotnext(
  provedor: ProvedorClassificacaoBotnext,
): ServicoClassificacaoMensagem {
  const modelo = provedor.modelo.trim();
  const versao = provedor.versao.trim();
  const classificar = provedor.classificar;

  if (!modelo || !versao) {
    throw new Error(
      "Modelo e versão do classificador são obrigatórios.",
    );
  }

  // A proteção vale para chamadas que compartilham
  // esta mesma instância do serviço.
  //
  // Por isso, crie o serviço uma única vez no módulo
  // que fará a integração, e não uma vez por mensagem.
  const emAndamento =
    new Map<
      string,
      Promise<ResultadoClassificacaoMensagem>
    >();

  async function executar(
    params: ClassificarMensagemBotnextParams,
  ): Promise<ResultadoClassificacaoMensagem> {
    const mensagem = await buscarMensagem(params);

    const identificacao: IdentificacaoMensagem = {
      eventoId:
        params.eventoId,

      mensagemId:
        mensagem.id,

      conversaId:
        mensagem.conversationId,
    };

    // A consulta ao banco ocorre antes de qualquer
    // chamada ao classificador.
    if (mensagem.classifiedAt !== null) {
      return montarResultadoPersistido(
        params.eventoId,
        mensagem,
        "JA_CLASSIFICADA",
      );
    }

    if (
      mensagem.role !==
      BotnextConversationMessageRole.CUSTOMER
    ) {
      return {
        ...identificacao,

        situacao:
          "IGNORADA",

        motivo:
          "MENSAGEM_NAO_CLIENTE",
      };
    }

    const texto = mensagem.text?.trim();

    if (!texto) {
      return {
        ...identificacao,

        situacao:
          "IGNORADA",

        motivo:
          "MENSAGEM_SEM_TEXTO",
      };
    }

    // O provedor pode ser real ou simulado.
    // Nenhuma transação de banco fica aberta
    // enquanto aguardamos a classificação.
    const classificacao =
      await classificar(texto);

    const persistencia =
      await salvarClassificacaoBotnext({
        tenantId:
          params.tenantId,

        eventoId:
          params.eventoId,

        classificacao,
        modelo,
        versao,
      });

    // Retorna o resultado efetivamente salvo.
    // Se outra instância tiver gravado primeiro,
    // não retorna a classificação que perdeu a disputa.
    const mensagemAtualizada =
      await buscarMensagem(params);

    return montarResultadoPersistido(
      params.eventoId,
      mensagemAtualizada,
      persistencia.classificacaoSalva
        ? "CLASSIFICADA"
        : "JA_CLASSIFICADA",
    );
  }

  return async (
    params: ClassificarMensagemBotnextParams,
  ): Promise<ResultadoClassificacaoMensagem> => {
    const tenantId = params.tenantId.trim();
    const eventoId = params.eventoId.trim();

    if (!tenantId || !eventoId) {
      throw new Error(
        "Tenant e evento são obrigatórios.",
      );
    }

    const chave = JSON.stringify([
      tenantId,
      eventoId,
    ]);

    const processamentoExistente =
      emAndamento.get(chave);

    if (processamentoExistente) {
      return processamentoExistente;
    }

    const processamento = executar({
      tenantId,
      eventoId,
    });

    emAndamento.set(
      chave,
      processamento,
    );

    try {
      return await processamento;
    } finally {
      // Libera a entrada tanto em caso de sucesso
      // quanto em caso de erro, permitindo nova tentativa.
      if (
        emAndamento.get(chave) ===
        processamento
      ) {
        emAndamento.delete(chave);
      }
    }
  };
}