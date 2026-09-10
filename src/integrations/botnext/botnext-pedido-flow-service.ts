// Fluxo de pedido BotNext (Etapa 3.2).
//
// Orquestra, a partir de uma mensagem do cliente, o ciclo completo:
//   FAZER_PEDIDO → extração → rascunho (PRONTO/PENDENTE) → resumo/pergunta →
//   confirmação/cancelamento → dispatch ao webhook n8n → resposta ao cliente.
//
// Regras de negócio que NUNCA mudam:
//   - Backend nunca cria pedido na API do cliente. O fluxo TERMINA no
//     PEDIDO_CONFIRMADO_V1 enviado ao webhook do n8n.
//   - Confirmação é DETERMINÍSTICA (botnext-confirmacao-mensagem) e só
//     acontece com rascunho PRONTO aguardando + mensagem posterior + positiva.
//   - Cancelamento e ambiguidade nunca confirmam.
//   - Multi-turn: mensagem relevante em fluxo re-extrai a mensagem atual
//     (com permitirSemIntencaoDePedido=true) e reconstrói o rascunho.
//
// Estados da conversa observados: ACTIVE / WAITING_CUSTOMER /
// WAITING_CONFIRMATION / COMPLETED / CANCELLED. HUMAN_HANDOFF não é tocado.

import {
  BotnextConversationMessageRole,
  BotnextConversationStatus,
  BotnextPedidoRascunhoStatus,
} from "@prisma/client";

import { prisma } from "../../database/prisma.js";
import type { CatalogoRepository } from "../../pedidos/tipos.js";
import {
  criarCatalogoRepositoryPrisma,
} from "../../pedidos/catalogo-repository-prisma.js";
import {
  lerConteudoPersistido,
} from "./botnext-pedido-rascunho-persistence.js";
import {
  criarServicoConstrucaoRascunho,
  type ServicoConstrucaoRascunho,
} from "./botnext-pedido-rascunho-service.js";
import {
  criarServicoConfirmacaoRascunho,
  type ServicoConfirmacaoRascunho,
} from "./botnext-pedido-rascunho-confirmacao-service.js";
import {
  criarServicoDispatchPedido,
  enviarJsonComFetch,
  type ResultadoDispatchRascunho,
  type ServicoDispatchPedido,
} from "./botnext-pedido-rascunho-dispatch-service.js";
import {
  criarServicoCancelamentoRascunho,
  type ServicoCancelamentoRascunho,
} from "./botnext-pedido-cancelamento-service.js";
import type { ServicoExtracaoPedido } from "./botnext-pedido-extracao-service.js";
import {
  obterServicoExtraccaoPedidoReal,
} from "./botnext-pedido-ai-service.js";
import {
  obterServicoEnvioRespostaReal,
  type ServicoEnvioResposta,
} from "./botnext-message-sender.js";
import {
  alterarEstadoConversa,
  statusEncerraConversa,
  type AlterarEstadoConversaParams,
  type ResultadoAlteracaoEstado,
} from "./botnext-conversation-state-service.js";
import { iaBotnextHabilitada } from "./botnext-ai-service.js";
import { classificarConfirmacao } from "./botnext-confirmacao-mensagem.js";
import {
  MENSAGEM_AGUARDANDO_CLAREZA,
  MENSAGEM_PEDIDO_CANCELADO,
  MENSAGEM_RECEBENDO_PEDIDO,
  montarPerguntasPendencias,
  montarResumoPedido,
} from "./botnext-mensagens-pedido.js";

export interface ProcessarFluxoPedidoParams {
  tenantId: string;
  eventoId: string;
}

export type ResultadoFluxoPedido =
  | { situacao: "SEM_PEDIDO"; motivo: string }
  | {
      situacao: "RASCUNHO_CRIADO" | "RASCUNHO_ATUALIZADO";
      rascunhoId: string;
      status: BotnextPedidoRascunhoStatus;
      mensagemEnviada: boolean;
    }
  | {
      situacao: "AGUARDANDO_INFORMACAO";
      rascunhoId: string;
      mensagemEnviada: boolean;
    }
  | {
      situacao: "CONFIRMADO";
      rascunhoId: string;
      dispatch: ResultadoDispatchRascunho;
      conversaStatus: BotnextConversationStatus;
    }
  | { situacao: "CANCELADO"; rascunhoId: string }
  | { situacao: "AMBIGUO"; mensagemEnviada: boolean };

export type ServicoFluxoPedido = (
  params: ProcessarFluxoPedidoParams,
) => Promise<ResultadoFluxoPedido>;

export interface DependenciasFluxoPedido {
  /** Serviço real ou fake da extração (com lazy imports de OpenAI). */
  servicoExtracao: ServicoExtracaoPedido;
  /** Catálogo local do tenant (produtos/cervejas/aliases). Nunca ArBrain. */
  catalogo: CatalogoRepository;
  servicoConstrucao?: ServicoConstrucaoRascunho;
  servicoConfirmacao?: ServicoConfirmacaoRascunho;
  servicoCancelamento?: ServicoCancelamentoRascunho;
  servicoDispatch?: ServicoDispatchPedido;
  servicoEnvioResposta?: ServicoEnvioResposta;
  alterarEstadoConversa?: (
    params: AlterarEstadoConversaParams,
  ) => Promise<ResultadoAlteracaoEstado>;
}

const STATUS_RASCUNHO_NÃO_TERMINAL = new Set<BotnextPedidoRascunhoStatus>([
  BotnextPedidoRascunhoStatus.RASCUNHO,
  BotnextPedidoRascunhoStatus.PRONTO,
]);

const STATUS_CONVERSA_EM_FLUXO = new Set<BotnextConversationStatus>([
  BotnextConversationStatus.WAITING_CUSTOMER,
  BotnextConversationStatus.WAITING_CONFIRMATION,
]);

type LinhaRascunhoParaFluxo = {
  id: string;
  extracaoId: string;
  status: BotnextPedidoRascunhoStatus;
  revision: number;
  itens: unknown;
  atualizadoEm: Date;
};

type MensagemParaFluxo = {
  id: string;
  conversationId: string;
  role: BotnextConversationMessageRole;
  text: string | null;
  detectedIntent: string | null;
  eventDate: Date | null;
  createdAt: Date;
  conversaStatus: BotnextConversationStatus;
};

async function buscarMensagem(
  params: ProcessarFluxoPedidoParams,
): Promise<MensagemParaFluxo | null> {
  const linha = await prisma.botnextConversationMessage.findFirst({
    where: {
      webhookEventId: params.eventoId,
      conversation: { tenantId: params.tenantId },
    },
    select: {
      id: true,
      conversationId: true,
      role: true,
      text: true,
      detectedIntent: true,
      eventDate: true,
      createdAt: true,
      conversation: { select: { status: true } },
    },
  });

  if (!linha) {
    return null;
  }

  return {
    id: linha.id,
    conversationId: linha.conversationId,
    role: linha.role,
    text: linha.text,
    detectedIntent: linha.detectedIntent as string | null,
    eventDate: linha.eventDate,
    createdAt: linha.createdAt,
    conversaStatus: linha.conversation.status,
  };
}

async function buscarUltimoRascunho(
  conversaId: string,
): Promise<LinhaRascunhoParaFluxo | null> {
  const linha = await prisma.botnextPedidoRascunho.findFirst({
    where: { extracao: { conversationId: conversaId } },
    orderBy: { updatedAt: "desc" },
    select: {
      id: true,
      extracaoId: true,
      status: true,
      revision: true,
      itens: true,
      updatedAt: true,
    },
  });

  if (!linha) {
    return null;
  }

  return {
    id: linha.id,
    extracaoId: linha.extracaoId,
    status: linha.status,
    revision: linha.revision,
    itens: linha.itens,
    atualizadoEm: linha.updatedAt,
  };
}

function statusRascunhoTerminal(
  status: BotnextPedidoRascunhoStatus,
): boolean {
  return !STATUS_RASCUNHO_NÃO_TERMINAL.has(status);
}

export function criarServicoFluxoPedido(
  deps: DependenciasFluxoPedido,
): ServicoFluxoPedido {
  const servicoConstrucao =
    deps.servicoConstrucao ??
    criarServicoConstrucaoRascunho({ catalogo: deps.catalogo });
  const servicoConfirmacao =
    deps.servicoConfirmacao ?? criarServicoConfirmacaoRascunho();
  const servicoCancelamento =
    deps.servicoCancelamento ?? criarServicoCancelamentoRascunho();
  const servicoDispatch =
    deps.servicoDispatch ??
    criarServicoDispatchPedido({ enviadorHttp: enviarJsonComFetch });
  const servicoEnvioResposta =
    deps.servicoEnvioResposta ?? obterServicoEnvioRespostaReal();
  const alterarEstado =
    deps.alterarEstadoConversa ?? alterarEstadoConversa;

  async function enviarResposta(
    params: {
      tenantId: string;
      rascunhoId: string;
      eventoId: string;
      texto: string;
    },
  ): Promise<boolean> {
    const resultado = await servicoEnvioResposta(params);
    return (
      resultado.situacao === "ENVIADA" ||
      resultado.situacao === "JA_ENVIADA"
    );
  }

  async function confirmar(
    params: ProcessarFluxoPedidoParams,
    rascunho: LinhaRascunhoParaFluxo,
    conversaId: string,
  ): Promise<ResultadoFluxoPedido> {
    const confirmacao = await servicoConfirmacao({
      tenantId: params.tenantId,
      rascunhoId: rascunho.id,
    });

    if (
      confirmacao.situacao === "CONFIRMADO" ||
      confirmacao.situacao === "JA_CONFIRMADO"
    ) {
      const dispatch = await servicoDispatch({
        tenantId: params.tenantId,
        rascunhoId: rascunho.id,
      });

      const enviado =
        dispatch.situacao === "ENVIADO" ||
        dispatch.situacao === "JA_DESPACHADO";

      if (enviado) {
        await alterarEstado({
          conversaId,
          novoStatus: BotnextConversationStatus.COMPLETED,
        });
        return {
          situacao: "CONFIRMADO",
          rascunhoId: rascunho.id,
          dispatch,
          conversaStatus: BotnextConversationStatus.COMPLETED,
        };
      }

      // Não-ENVIADO → reconhece o pedido e mantém a conversa ativa.
      await enviarResposta({
        tenantId: params.tenantId,
        rascunhoId: rascunho.id,
        eventoId: params.eventoId,
        texto: MENSAGEM_RECEBENDO_PEDIDO,
      });
      await alterarEstado({
        conversaId,
        novoStatus: BotnextConversationStatus.ACTIVE,
      });

      return {
        situacao: "CONFIRMADO",
        rascunhoId: rascunho.id,
        dispatch,
        conversaStatus: BotnextConversationStatus.ACTIVE,
      };
    }

    if (confirmacao.situacao === "JA_DESPACHADO") {
      await alterarEstado({
        conversaId,
        novoStatus: BotnextConversationStatus.COMPLETED,
      });
      return {
        situacao: "SEM_PEDIDO",
        motivo: "PEDIDO_JA_DESPACHADO",
      };
    }

    // NAO_CONFIRMAVEL (rascunho PRONTO com pendência escondida): re-pergunta.
    const conteudo = lerConteudoPersistido(rascunho.itens as never);
    const perguntas = montarPerguntasPendencias(conteudo.itens);
    const mensagemPendencia =
      perguntas ?? MENSAGEM_AGUARDANDO_CLAREZA;

    const enviada = await enviarResposta({
      tenantId: params.tenantId,
      rascunhoId: rascunho.id,
      eventoId: params.eventoId,
      texto: mensagemPendencia,
    });

    return {
      situacao: "AGUARDANDO_INFORMACAO",
      rascunhoId: rascunho.id,
      mensagemEnviada: enviada,
    };
  }

  async function construirEPerguntar(
    params: ProcessarFluxoPedidoParams,
    extracaoId: string,
    conversaId: string,
  ): Promise<ResultadoFluxoPedido> {
    const construcao = await servicoConstrucao({
      tenantId: params.tenantId,
      extracaoId,
    });

    if (construcao.situacao === "SEM_RASCUNHO") {
      return {
        situacao: "SEM_PEDIDO",
        motivo: `CONSTRUCAO_SEM_RASCUNHO_${construcao.statusExtracao}`,
      };
    }

    const concretizado =
      construcao.situacao === "RASCUNHO_CRIADO"
        ? ("RASCUNHO_CRIADO" as const)
        : ("RASCUNHO_ATUALIZADO" as const);

    const conteudo = construcao.conteudo;

    if (construcao.status === BotnextPedidoRascunhoStatus.PRONTO) {
      const resumo = montarResumoPedido(conteudo.itens);
      const enviada = await enviarResposta({
        tenantId: params.tenantId,
        rascunhoId: construcao.rascunhoId,
        eventoId: params.eventoId,
        texto: resumo,
      });
      await alterarEstado({
        conversaId,
        novoStatus: BotnextConversationStatus.WAITING_CONFIRMATION,
      });
      return {
        situacao: concretizado,
        rascunhoId: construcao.rascunhoId,
        status: construcao.status,
        mensagemEnviada: enviada,
      };
    }

    const perguntas = montarPerguntasPendencias(conteudo.itens);
    const mensagemPendencia =
      perguntas ?? MENSAGEM_AGUARDANDO_CLAREZA;

    const enviada = await enviarResposta({
      tenantId: params.tenantId,
      rascunhoId: construcao.rascunhoId,
      eventoId: params.eventoId,
      texto: mensagemPendencia,
    });
    await alterarEstado({
      conversaId,
      novoStatus: BotnextConversationStatus.WAITING_CUSTOMER,
    });

    return {
      situacao: concretizado,
      rascunhoId: construcao.rascunhoId,
      status: construcao.status,
      mensagemEnviada: enviada,
    };
  }

  return async (
    params: ProcessarFluxoPedidoParams,
  ): Promise<ResultadoFluxoPedido> => {
    const tenantId = params.tenantId.trim();
    const eventoId = params.eventoId.trim();

    if (!tenantId || !eventoId) {
      throw new Error("Tenant e evento são obrigatórios.");
    }

    // 1) Mensagem do evento (tenant isolado).
    const mensagem = await buscarMensagem({ tenantId, eventoId });

    if (!mensagem) {
      throw new Error("Mensagem do evento não encontrada no tenant informado.");
    }

    if (mensagem.role !== BotnextConversationMessageRole.CUSTOMER) {
      return {
        situacao: "SEM_PEDIDO",
        motivo: "MENSAGEM_NAO_CLIENTE",
      };
    }

    const texto = mensagem.text?.trim();
    if (!texto) {
      return {
        situacao: "SEM_PEDIDO",
        motivo: "MENSAGEM_SEM_TEXTO",
      };
    }

    const conversaId = mensagem.conversationId;
    const conversaStatus = mensagem.conversaStatus;
    const intencao = mensagem.detectedIntent;

    // 2) Último rascunho da conversa (recepção do fluxo atual).
    const rascunho = await buscarUltimoRascunho(conversaId);

    const emFluxoDePedido =
      rascunho !== null ||
      STATUS_CONVERSA_EM_FLUXO.has(conversaStatus);

    // 3) Relevância: FAZER_PEDIDO ou continuação de fluxo em andamento.
    if (intencao !== "FAZER_PEDIDO" && !emFluxoDePedido) {
      return {
        situacao: "SEM_PEDIDO",
        motivo: "OUTRA_INTENCAO",
      };
    }

    // 4) Reabertura: nova FAZER_PEDIDO numa conversa terminal.
    if (
      intencao === "FAZER_PEDIDO" &&
      statusEncerraConversa(conversaStatus)
    ) {
      await alterarEstado({
        conversaId,
        novoStatus: BotnextConversationStatus.ACTIVE,
      });
    }

    // 5) Confirmação/cancelamento/ambiguidade quando há rascunho não-terminal.
    if (rascunho !== null && !statusRascunhoTerminal(rascunho.status)) {
      const classificacao = classificarConfirmacao(texto);

      if (classificacao === "NEGATIVA") {
        const cancelamento = await servicoCancelamento({
          tenantId,
          rascunhoId: rascunho.id,
        });

        if (
          cancelamento.situacao === "CANCELADO" ||
          cancelamento.situacao === "JA_CANCELADO"
        ) {
          await enviarResposta({
            tenantId,
            rascunhoId: rascunho.id,
            eventoId,
            texto: MENSAGEM_PEDIDO_CANCELADO,
          });
          await alterarEstado({
            conversaId,
            novoStatus: BotnextConversationStatus.CANCELLED,
          });
          return { situacao: "CANCELADO", rascunhoId: rascunho.id };
        }

        return {
          situacao: "SEM_PEDIDO",
          motivo: "NAO_CANCELAVEL",
        };
      }

      if (classificacao === "AMBIGUA") {
        const enviada = await enviarResposta({
          tenantId,
          rascunhoId: rascunho.id,
          eventoId,
          texto: MENSAGEM_AGUARDANDO_CLAREZA,
        });
        return { situacao: "AMBIGUO", mensagemEnviada: enviada };
      }

      // Confirmação válida: rascunho PRONTO aguardando + mensagem posterior.
      if (
        classificacao === "POSITIVA" &&
        rascunho.status === BotnextPedidoRascunhoStatus.PRONTO &&
        conversaStatus ===
          BotnextConversationStatus.WAITING_CONFIRMATION
      ) {
        const dataMensagem =
          mensagem.eventDate ?? mensagem.createdAt;
        const posterior =
          dataMensagem.getTime() > rascunho.atualizadoEm.getTime();

        if (posterior) {
          return await confirmar(params, rascunho, conversaId);
        }
      }
    }

    // 6) Multi-turn: nova mensagem relevante → extração + reconstrução.
    const permitirSemIntencaoDePedido =
      intencao !== "FAZER_PEDIDO";

    const extracao = await deps.servicoExtracao({
      tenantId,
      eventoId,
      permitirSemIntencaoDePedido,
    });

    if (extracao.situacao === "IGNORADA") {
      return {
        situacao: "SEM_PEDIDO",
        motivo: `EXTRACAO_${extracao.motivo}`,
      };
    }

    if (extracao.situacao === "FALHA_DEFINITIVA") {
      return {
        situacao: "SEM_PEDIDO",
        motivo: "EXTRACAO_FALHOU",
      };
    }

    const resultado = extracao.resultado;

    if (resultado.status !== "EXTRAIDO" || resultado.itens.length === 0) {
      return {
        situacao: "SEM_PEDIDO",
        motivo: `EXTRACAO_${resultado.status}`,
      };
    }

    return await construirEPerguntar(
      { tenantId, eventoId },
      extracao.extracaoId,
      conversaId,
    );
  };
}

// ---------------------------------------------------------------------------
// Wiring de produção: ponto único de delegação chamado pelo processor.
// Uma vez desligada a IA, retorna SEM_PEDIDO sem tocar em nada externo.
// ---------------------------------------------------------------------------

export async function processarFluxoPedidoBotnext(
  params: ProcessarFluxoPedidoParams,
): Promise<ResultadoFluxoPedido> {
  if (!iaBotnextHabilitada()) {
    return { situacao: "SEM_PEDIDO", motivo: "IA_DESATIVADA" };
  }

  const servicoExtracao = await obterServicoExtraccaoPedidoReal();

  const fluxo = criarServicoFluxoPedido({
    servicoExtracao,
    catalogo: criarCatalogoRepositoryPrisma(prisma),
  });

  return fluxo(params);
}