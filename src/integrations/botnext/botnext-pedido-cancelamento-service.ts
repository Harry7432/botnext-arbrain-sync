// Serviço de cancelamento do pedido (Etapa 3.2).
//
// Transição idempotente RASCUNHO/PRONTO → CANCELADO com CAS por
// revision/status. Persiste `cancelamento.canceladoEm` no JSON do rascunho
// (aditivo, sem migration). Não dispara dispatch, não chama webhook — o
// cancelamento TERMINA o pedido.

import {
  BotnextPedidoRascunhoStatus,
  Prisma,
} from "@prisma/client";

import { prisma } from "../../database/prisma.js";

import {
  lerConteudoPersistido,
} from "./botnext-pedido-rascunho-persistence.js";

export interface CancelarPedidoParams {
  tenantId: string;
  rascunhoId: string;
}

export type ResultadoCancelamentoRascunho =
  | {
      situacao: "CANCELADO";
      rascunhoId: string;
      revision: number;
      canceladoEm: string;
    }
  | {
      situacao: "JA_CANCELADO";
      rascunhoId: string;
      revision: number;
    }
  | {
      situacao: "NAO_CANCELAVEL";
      rascunhoId: string;
      status: BotnextPedidoRascunhoStatus;
      motivo:
        | "JA_CONFIRMADO"
        | "JA_DESPACHADO"
        | "RASCUNHO_FALHOU";
    };

export type ServicoCancelamentoRascunho = (
  params: CancelarPedidoParams,
) => Promise<ResultadoCancelamentoRascunho>;

export function criarServicoCancelamentoRascunho(): ServicoCancelamentoRascunho {
  return async (
    params: CancelarPedidoParams,
  ): Promise<ResultadoCancelamentoRascunho> => {
    const tenantId = params.tenantId.trim();
    const rascunhoId = params.rascunhoId.trim();

    if (!tenantId || !rascunhoId) {
      throw new Error("Tenant e rascunho são obrigatórios.");
    }

    const linha = await prisma.botnextPedidoRascunho.findFirst({
      where: { id: rascunhoId, tenantId },
      select: {
        id: true,
        tenantId: true,
        status: true,
        revision: true,
        itens: true,
      },
    });

    if (!linha) {
      throw new Error("Rascunho não encontrado no tenant informado.");
    }

    if (linha.status === BotnextPedidoRascunhoStatus.CANCELADO) {
      return {
        situacao: "JA_CANCELADO",
        rascunhoId: linha.id,
        revision: linha.revision,
      };
    }

    if (linha.status !== BotnextPedidoRascunhoStatus.PRONTO &&
        linha.status !== BotnextPedidoRascunhoStatus.RASCUNHO) {
      return {
        situacao: "NAO_CANCELAVEL",
        rascunhoId: linha.id,
        status: linha.status,
        motivo:
          linha.status === BotnextPedidoRascunhoStatus.CONFIRMADO
            ? "JA_CONFIRMADO"
            : linha.status === BotnextPedidoRascunhoStatus.DESPACHADO
              ? "JA_DESPACHADO"
              : "RASCUNHO_FALHOU",
      };
    }

    const canceladoEm = new Date().toISOString();
    const conteudo = lerConteudoPersistido(linha.itens);
    const conteudoCancelado: Prisma.InputJsonValue = {
      ...conteudo,
      cancelamento: { canceladoEm },
    } as unknown as Prisma.InputJsonValue;

    const atualizado = await prisma.botnextPedidoRascunho.updateMany({
      where: {
        id: rascunhoId,
        tenantId,
        revision: linha.revision,
        status: linha.status,
      },
      data: {
        status: BotnextPedidoRascunhoStatus.CANCELADO,
        itens: conteudoCancelado,
        revision: { increment: 1 },
      },
    });

    if (atualizado.count === 1) {
      return {
        situacao: "CANCELADO",
        rascunhoId: linha.id,
        revision: linha.revision + 1,
        canceladoEm,
      };
    }

    // Corrida: re-lê o vencedor.
    const vencedor = await prisma.botnextPedidoRascunho.findFirst({
      where: { id: rascunhoId, tenantId },
      select: { id: true, status: true, revision: true },
    });

    if (!vencedor) {
      throw new Error("Rascunho não encontrado no tenant informado.");
    }

    if (vencedor.status === BotnextPedidoRascunhoStatus.CANCELADO) {
      return {
        situacao: "JA_CANCELADO",
        rascunhoId: vencedor.id,
        revision: vencedor.revision,
      };
    }

    return {
      situacao: "NAO_CANCELAVEL",
      rascunhoId: vencedor.id,
      status: vencedor.status,
      motivo: "JA_CONFIRMADO",
    };
  };
}