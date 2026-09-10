import {
  BotnextPedidoExtracaoStatus,
  Prisma,
} from "@prisma/client";

import { prisma } from "../../database/prisma.js";

import type { ResultadoExtracao } from "../../pedidos/extracao/tipos.js";

export interface SalvarExtracaoPedidoParams {
  tenantId: string;
  conversationId: string;
  sourceMessageId: string;
  sourceHash: string;
  inputText: string;
  resultado: ResultadoExtracao;
}

export interface ExtracaoPersistida {
  id: string;
  status: BotnextPedidoExtracaoStatus;
  resultado: ResultadoExtracao;
}

export interface ResultadoPersistenciaExtracao {
  /** true quando esta chamada criou a linha; false se perdeu a corrida. */
  criada: boolean;
  extracao: ExtracaoPersistida;
}

function statusBanco(
  resultado: ResultadoExtracao,
): BotnextPedidoExtracaoStatus {
  return resultado.status === "FALHA_IA"
    ? BotnextPedidoExtracaoStatus.FALHOU
    : BotnextPedidoExtracaoStatus.EXTRAIDO;
}

/**
 * Reconstrói o ResultadoExtracao do JSON persistido. Lança se o registro
 * estiver inconsistente — NUNCA re-chama a IA para "consertar" silenciosamente.
 */
export function lerResultadoPersistido(
  itensExtraidos: Prisma.JsonValue | null,
): ResultadoExtracao {
  if (
    itensExtraidos === null ||
    typeof itensExtraidos !== "object" ||
    Array.isArray(itensExtraidos)
  ) {
    throw new Error(
      "Extração persistida sem objeto de resultado em itens_extraidos.",
    );
  }

  const bruto = itensExtraidos as Record<string, unknown>;

  if (
    typeof bruto.status !== "string" ||
    !Array.isArray(bruto.itens) ||
    typeof bruto.extraidoEm !== "string"
  ) {
    throw new Error("Extração persistida com resultado inválido.");
  }

  return bruto as unknown as ResultadoExtracao;
}

function paraExtracaoPersistida(linha: {
  id: string;
  status: BotnextPedidoExtracaoStatus;
  itensExtraidos: Prisma.JsonValue | null;
}): ExtracaoPersistida {
  return {
    id: linha.id,
    status: linha.status,
    resultado: lerResultadoPersistido(linha.itensExtraidos),
  };
}

export async function salvarExtracaoPedido(
  params: SalvarExtracaoPedidoParams,
): Promise<ResultadoPersistenciaExtracao> {
  const status = statusBanco(params.resultado);
  const extractedAt =
    status === BotnextPedidoExtracaoStatus.EXTRAIDO
      ? new Date(params.resultado.extraidoEm)
      : null;

  try {
    const criada = await prisma.botnextPedidoExtracao.create({
      data: {
        tenantId: params.tenantId,
        conversationId: params.conversationId,
        sourceMessageId: params.sourceMessageId,
        status,
        sourceHash: params.sourceHash,
        inputText: params.inputText,
        itensExtraidos:
          params.resultado as unknown as Prisma.InputJsonValue,
        observacoes: params.resultado.observacaoPedido,
        confianca: params.resultado.confiancaIa,
        extractorModel: params.resultado.modelo,
        extractorVersion: params.resultado.versaoExtractor,
        promptVersion: params.resultado.versaoPrompt,
        extractedAt,
        errorMessage: params.resultado.erro,
      },
      select: { id: true, status: true, itensExtraidos: true },
    });

    return { criada: true, extracao: paraExtracaoPersistida(criada) };
  } catch (erro: unknown) {
    const corrida =
      erro instanceof Prisma.PrismaClientKnownRequestError &&
      erro.code === "P2002";

    if (!corrida) {
      throw erro;
    }

    // Outro processo gravou primeiro — devolve o vencedor.
    const vencedora =
      await prisma.botnextPedidoExtracao.findUnique({
        where: {
          conversationId_sourceMessageId: {
            conversationId: params.conversationId,
            sourceMessageId: params.sourceMessageId,
          },
        },
        select: { id: true, status: true, itensExtraidos: true },
      });

    if (!vencedora) {
      throw erro;
    }

    return { criada: false, extracao: paraExtracaoPersistida(vencedora) };
  }
}
