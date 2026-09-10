import { createHash } from "node:crypto";

import {
  BotnextConversationIntent,
  BotnextConversationMessageRole,
  BotnextPedidoExtracaoStatus,
} from "@prisma/client";

import type { BotnextConversationMessage } from "@prisma/client";

import { prisma } from "../../database/prisma.js";

import {
  ExtracaoIaError,
  classificarErroExtracao,
} from "../../pedidos/extracao/erros.js";
import {
  normalizarExtracao,
  resultadoFalhaExtracao,
  type OpcoesNormalizacao,
} from "../../pedidos/extracao/normalizar-extracao.js";
import type {
  ProvedorExtracaoPedido,
  ResultadoExtracao,
} from "../../pedidos/extracao/tipos.js";

import {
  lerResultadoPersistido,
  salvarExtracaoPedido,
} from "./botnext-pedido-extracao-persistence.js";

export type ExtrairPedidoBotnextParams = {
  tenantId: string;
  eventoId: string;
  /**
   * Multi-turn (Etapa 3.2): quando a conversa já está em fluxo de pedido, a
   * mensagem relevante pode ter sido classificada com outra intenção (ex.:
   * DUVIDA) — extrair mesmo assim. O padrão permanece exigir FAZER_PEDIDO.
   */
  permitirSemIntencaoDePedido?: boolean;
};

type IdentificacaoMensagem = {
  eventoId: string;
  mensagemId: string;
  conversaId: string;
};

export type ResultadoExtracaoMensagem =
  | (IdentificacaoMensagem & {
      situacao: "EXTRAIDA" | "JA_EXTRAIDA" | "FALHA_DEFINITIVA";
      extracaoId: string;
      resultado: ResultadoExtracao;
    })
  | (IdentificacaoMensagem & {
      situacao: "IGNORADA";
      motivo:
        | "MENSAGEM_NAO_CLIENTE"
        | "MENSAGEM_SEM_TEXTO"
        | "INTENCAO_NAO_E_PEDIDO";
    });

export type ServicoExtracaoPedido = (
  params: ExtrairPedidoBotnextParams,
) => Promise<ResultadoExtracaoMensagem>;

const STATUS_TERMINAIS = new Set<BotnextPedidoExtracaoStatus>([
  BotnextPedidoExtracaoStatus.EXTRAIDO,
  BotnextPedidoExtracaoStatus.FALHOU,
]);

function obterConfiancaMinima(): number {
  const valor = Number(process.env.AI_MIN_CONFIDENCE ?? "0.80");
  if (!Number.isFinite(valor) || valor < 0 || valor > 1) {
    throw new Error("AI_MIN_CONFIDENCE deve estar entre 0 e 1.");
  }
  return valor;
}

async function buscarMensagem(
  params: ExtrairPedidoBotnextParams,
): Promise<BotnextConversationMessage> {
  const mensagem = await prisma.botnextConversationMessage.findFirst({
    where: {
      webhookEventId: params.eventoId,
      conversation: { tenantId: params.tenantId },
    },
  });

  if (!mensagem) {
    throw new Error(
      "Mensagem do evento não encontrada no tenant informado.",
    );
  }

  return mensagem;
}

export function criarServicoExtracaoPedido(
  provedor: ProvedorExtracaoPedido,
): ServicoExtracaoPedido {
  const modelo = provedor.modelo.trim();
  const versaoExtractor = provedor.versaoExtractor.trim();
  const versaoPrompt = provedor.versaoPrompt.trim();

  if (!modelo || !versaoExtractor || !versaoPrompt) {
    throw new Error(
      "Modelo e versões (extractor e prompt) do provedor são obrigatórios.",
    );
  }

  // Dedup entre chamadas que compartilham esta instância do serviço.
  const emAndamento = new Map<string, Promise<ResultadoExtracaoMensagem>>();

  async function executar(
    params: ExtrairPedidoBotnextParams,
  ): Promise<ResultadoExtracaoMensagem> {
    const mensagem = await buscarMensagem(params);

    const identificacao: IdentificacaoMensagem = {
      eventoId: params.eventoId,
      mensagemId: mensagem.id,
      conversaId: mensagem.conversationId,
    };

    // Idempotência: consulta o banco ANTES de qualquer chamada à IA.
    const existente = await prisma.botnextPedidoExtracao.findUnique({
      where: {
        conversationId_sourceMessageId: {
          conversationId: mensagem.conversationId,
          sourceMessageId: mensagem.id,
        },
      },
      select: { id: true, status: true, itensExtraidos: true },
    });

    if (existente && STATUS_TERMINAIS.has(existente.status)) {
      return {
        ...identificacao,
        situacao: "JA_EXTRAIDA",
        extracaoId: existente.id,
        resultado: lerResultadoPersistido(existente.itensExtraidos),
      };
    }

    if (mensagem.role !== BotnextConversationMessageRole.CUSTOMER) {
      return {
        ...identificacao,
        situacao: "IGNORADA",
        motivo: "MENSAGEM_NAO_CLIENTE",
      };
    }

    const texto = mensagem.text?.trim();
    if (!texto) {
      return {
        ...identificacao,
        situacao: "IGNORADA",
        motivo: "MENSAGEM_SEM_TEXTO",
      };
    }

    if (
      !params.permitirSemIntencaoDePedido &&
      mensagem.detectedIntent !== BotnextConversationIntent.FAZER_PEDIDO
    ) {
      return {
        ...identificacao,
        situacao: "IGNORADA",
        motivo: "INTENCAO_NAO_E_PEDIDO",
      };
    }

    const opcoes: OpcoesNormalizacao = {
      confiancaMinima: obterConfiancaMinima(),
      modelo,
      versaoExtractor,
      versaoPrompt,
    };
    const sourceHash = createHash("sha256").update(texto).digest("hex");

    let resultado: ResultadoExtracao;
    let situacao: "EXTRAIDA" | "FALHA_DEFINITIVA";

    try {
      const bruto = await provedor.extrair(texto);
      resultado = normalizarExtracao(bruto, opcoes);
      situacao = "EXTRAIDA";
    } catch (erro: unknown) {
      const normalizado =
        erro instanceof ExtracaoIaError
          ? erro
          : classificarErroExtracao(erro);

      if (normalizado.tipo === "TRANSITORIO") {
        // Não persiste — reprocessamento re-chama a IA.
        throw normalizado;
      }

      resultado = resultadoFalhaExtracao(normalizado.message, opcoes);
      situacao = "FALHA_DEFINITIVA";
    }

    const persistencia = await salvarExtracaoPedido({
      tenantId: params.tenantId,
      conversationId: mensagem.conversationId,
      sourceMessageId: mensagem.id,
      sourceHash,
      inputText: texto,
      resultado,
    });

    return {
      ...identificacao,
      situacao: persistencia.criada ? situacao : "JA_EXTRAIDA",
      extracaoId: persistencia.extracao.id,
      resultado: persistencia.extracao.resultado,
    };
  }

  return async (
    params: ExtrairPedidoBotnextParams,
  ): Promise<ResultadoExtracaoMensagem> => {
    const tenantId = params.tenantId.trim();
    const eventoId = params.eventoId.trim();

    if (!tenantId || !eventoId) {
      throw new Error("Tenant e evento são obrigatórios.");
    }

    const chave = JSON.stringify([tenantId, eventoId]);
    const existente = emAndamento.get(chave);
    if (existente) {
      return existente;
    }

    const processamento = executar({
      tenantId,
      eventoId,
      permitirSemIntencaoDePedido:
        params.permitirSemIntencaoDePedido ?? false,
    });
    emAndamento.set(chave, processamento);

    try {
      return await processamento;
    } finally {
      if (emAndamento.get(chave) === processamento) {
        emAndamento.delete(chave);
      }
    }
  };
}
