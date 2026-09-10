// Persistência do rascunho de pedido (Etapa 3.0).
//
// Cria o rascunho usando o model BotnextPedidoRascunho existente (schema sem
// alteração). Idempotência pela FK unique (tenant_id, extracao_id): corrida
// P2002 devolve o vencedor. `revision` (CAS) fica intacto no default 0 — a
// evolução futura (confirmação/despacho) usará o mecanismo já suportado.

import {
  BotnextPedidoRascunhoStatus,
  Prisma,
} from "@prisma/client";

import { prisma } from "../../database/prisma.js";

import type { RascunhoConstruido } from "../../pedidos/rascunho/tipos.js";
import {
  VERSAO_RASCUNHO,
  type ConteudoRascunhoPersistido,
} from "../../pedidos/rascunho/tipos.js";

export interface SalvarRascunhoPedidoParams {
  tenantId: string;
  extracaoId: string;
  construido: RascunhoConstruido;
  observacoes: string | null;
}

export interface RascunhoPersistido {
  id: string;
  status: BotnextPedidoRascunhoStatus;
  conteudo: ConteudoRascunhoPersistido;
  totalItens: number;
  itensResolvidos: number;
  itensNaoResolvidos: number;
  observacoes: string | null;
}

export interface ResultadoPersistenciaRascunho {
  /** true quando esta chamada criou a linha; false se perdeu a corrida. */
  criado: boolean;
  rascunho: RascunhoPersistido;
}

/** Tipo da linha lida do banco (used pelo serviço em JA_CRIADO). */
export type LinhaRascunhoPersistidoSelecionado = {
  id: string;
  status: BotnextPedidoRascunhoStatus;
  itens: Prisma.JsonValue | null;
  totalItens: number;
  itensResolvidos: number;
  itensNaoResolvidos: number;
  observacoes: string | null;
};

export const CAMPOS_RASCUNHO_SELECIONADOS = {
  id: true,
  status: true,
  itens: true,
  totalItens: true,
  itensResolvidos: true,
  itensNaoResolvidos: true,
  observacoes: true,
} as const;

function statusBanco(
  status: RascunhoConstruido["status"],
): BotnextPedidoRascunhoStatus {
  return status === "PRONTO"
    ? BotnextPedidoRascunhoStatus.PRONTO
    : BotnextPedidoRascunhoStatus.RASCUNHO;
}

/**
 * Reconstrói o ConteudoRascunhoPersistido do JSON persistido. Lança se o
 * registro estiver inconsistente — NUNCA re-resolve para "consertar".
 */
export function lerConteudoPersistido(
  itens: Prisma.JsonValue | null,
): ConteudoRascunhoPersistido {
  if (
    itens === null ||
    typeof itens !== "object" ||
    Array.isArray(itens)
  ) {
    throw new Error(
      "Rascunho persistido sem objeto de conteúdo em itens.",
    );
  }

  const bruto = itens as Record<string, unknown>;

  if (
    bruto.versao !== VERSAO_RASCUNHO ||
    !Array.isArray(bruto.itens) ||
    !Array.isArray(bruto.sinaisExtracao)
  ) {
    throw new Error("Rascunho persistido com conteúdo inválido.");
  }

  return bruto as unknown as ConteudoRascunhoPersistido;
}

function paraRascunhoPersistido(
  linha: LinhaRascunhoPersistidoSelecionado,
): RascunhoPersistido {
  return {
    id: linha.id,
    status: linha.status,
    conteudo: lerConteudoPersistido(linha.itens),
    totalItens: linha.totalItens,
    itensResolvidos: linha.itensResolvidos,
    itensNaoResolvidos: linha.itensNaoResolvidos,
    observacoes: linha.observacoes,
  };
}

export { paraRascunhoPersistido };

export async function salvarRascunhoPedido(
  params: SalvarRascunhoPedidoParams,
): Promise<ResultadoPersistenciaRascunho> {
  try {
    const criado = await prisma.botnextPedidoRascunho.create({
      data: {
        tenantId: params.tenantId,
        extracaoId: params.extracaoId,
        status: statusBanco(params.construido.status),
        itens: params.construido.conteudo as unknown as Prisma.InputJsonValue,
        totalItens: params.construido.totalItens,
        itensResolvidos: params.construido.itensResolvidos,
        itensNaoResolvidos: params.construido.itensNaoResolvidos,
        observacoes: params.observacoes,
      },
      select: {
        id: true,
        status: true,
        itens: true,
        totalItens: true,
        itensResolvidos: true,
        itensNaoResolvidos: true,
        observacoes: true,
      },
    });

    return { criado: true, rascunho: paraRascunhoPersistido(criado) };
  } catch (erro: unknown) {
    const corrida =
      erro instanceof Prisma.PrismaClientKnownRequestError &&
      erro.code === "P2002";

    if (!corrida) {
      throw erro;
    }

    // Outro processo gravou primeiro — devolve o vencedor.
    const vencedor = await prisma.botnextPedidoRascunho.findUnique({
      where: {
        tenantId_extracaoId: {
          tenantId: params.tenantId,
          extracaoId: params.extracaoId,
        },
      },
      select: {
        id: true,
        status: true,
        itens: true,
        totalItens: true,
        itensResolvidos: true,
        itensNaoResolvidos: true,
        observacoes: true,
      },
    });

    if (!vencedor) {
      throw erro;
    }

    return { criado: false, rascunho: paraRascunhoPersistido(vencedor) };
  }
}