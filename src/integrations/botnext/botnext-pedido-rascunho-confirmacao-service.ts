// Serviço de confirmação explícita do pedido (Etapa 3.1).
//
// Transição idempotente PRONTO → CONFIRMADO com CAS por revision/status.
// Somente a operação explícita /confirmar confirma: silêncio ou continuação
// da conversa NUNCA confirmam. No mesmo update em que confirma, persiste
// dispatchKey + confirmacao.confirmadoEm no JSON do rascunho (sem migration).

import {
  BotnextPedidoRascunhoStatus,
  Prisma,
} from "@prisma/client";

import { prisma } from "../../database/prisma.js";

import {
  lerConteudoPersistido,
} from "./botnext-pedido-rascunho-persistence.js";
import {
  calcularDispatchKey,
} from "../../pedidos/pedido-confirmado/dispatch-key.js";
import {
  paraItemPedidoConfirmado,
} from "../../pedidos/pedido-confirmado/tipos.js";
import {
  itemEstaPendente,
} from "../../pedidos/rascunho/tipos.js";
import { avaliarTelefoneNoEscopoBotnext } from "./botnext-test-scope.js";

export interface ConfirmarPedidoParams {
  tenantId: string;
  rascunhoId: string;
}

export type ResultadoConfirmacaoRascunho =
  | {
      situacao: "CONFIRMADO";
      rascunhoId: string;
      dispatchKey: string;
      confirmadoEm: string;
      revision: number;
    }
  | {
      situacao: "JA_CONFIRMADO";
      rascunhoId: string;
      dispatchKey: string;
      confirmadoEm: string;
      revision: number;
    }
  | {
      situacao: "JA_DESPACHADO";
      rascunhoId: string;
    }
  | {
      situacao: "NAO_CONFIRMAVEL";
      rascunhoId: string;
      status: BotnextPedidoRascunhoStatus;
      motivo: string;
    };

export type ServicoConfirmacaoRascunho = (
  params: ConfirmarPedidoParams,
) => Promise<ResultadoConfirmacaoRascunho>;

export function criarServicoConfirmacaoRascunho(): ServicoConfirmacaoRascunho {
  return async (
    params: ConfirmarPedidoParams,
  ): Promise<ResultadoConfirmacaoRascunho> => {
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
        extracaoId: true,
        status: true,
        revision: true,
        itens: true,
        dispatchKey: true,
        extracao: {
          select: {
            conversationId: true,
            sourceMessage: {
              select: {
                webhookEvent: { select: { senderPhone: true } },
              },
            },
          },
        },
      },
    });

    if (!linha) {
      throw new Error(
        "Rascunho não encontrado no tenant informado.",
      );
    }

    const escopo = avaliarTelefoneNoEscopoBotnext(
      linha.extracao.sourceMessage.webhookEvent?.senderPhone ?? null,
    );
    if (!escopo.permitido) {
      return {
        situacao: "NAO_CONFIRMAVEL",
        rascunhoId: linha.id,
        status: linha.status,
        motivo: "FORA_DO_ESCOPO_DE_TESTE",
      };
    }

    if (linha.status === BotnextPedidoRascunhoStatus.DESPACHADO) {
      return {
        situacao: "JA_DESPACHADO",
        rascunhoId: linha.id,
      };
    }

    if (linha.status === BotnextPedidoRascunhoStatus.CONFIRMADO) {
      const conteudo = lerConteudoPersistido(linha.itens);
      if (!linha.dispatchKey || !conteudo.confirmacao) {
        throw new Error(
          "Rascunho CONFIRMADO sem dispatchKey/confirmação persistida.",
        );
      }
      return {
        situacao: "JA_CONFIRMADO",
        rascunhoId: linha.id,
        dispatchKey: linha.dispatchKey,
        confirmadoEm: conteudo.confirmacao.confirmadoEm,
        revision: linha.revision,
      };
    }

    if (linha.status !== BotnextPedidoRascunhoStatus.PRONTO) {
      return {
        situacao: "NAO_CONFIRMAVEL",
        rascunhoId: linha.id,
        status: linha.status,
        motivo: "RASCUNHO_NAO_PRONTO",
      };
    }

    // Dupla checagem: mesmo com status PRONTO, qualquer pendência
    // escondida no conteúdo bloqueia a confirmação.
    const conteudo = lerConteudoPersistido(linha.itens);
    if (conteudo.itens.some(itemEstaPendente)) {
      return {
        situacao: "NAO_CONFIRMAVEL",
        rascunhoId: linha.id,
        status: linha.status,
        motivo: "ITEM_PENDENTE",
      };
    }

    const revisionPosConfirmacao = linha.revision + 1;
    const dispatchKey = calcularDispatchKey({
      tenantId: linha.tenantId,
      conversationId: linha.extracao.conversationId,
      extracaoId: linha.extracaoId,
      rascunhoId: linha.id,
      revision: revisionPosConfirmacao,
      itens: conteudo.itens.map(paraItemPedidoConfirmado),
    });

    const confirmadoEm = new Date().toISOString();
    const conteudoConfirmado: Prisma.InputJsonValue = {
      ...conteudo,
      confirmacao: { confirmadoEm, dispatchKey },
    } as unknown as Prisma.InputJsonValue;

    const atualizado = await prisma.botnextPedidoRascunho.updateMany({
      where: {
        id: rascunhoId,
        tenantId,
        revision: linha.revision,
        status: BotnextPedidoRascunhoStatus.PRONTO,
      },
      data: {
        status: BotnextPedidoRascunhoStatus.CONFIRMADO,
        dispatchKey,
        itens: conteudoConfirmado,
        revision: { increment: 1 },
      },
    });

    if (atualizado.count === 1) {
      return {
        situacao: "CONFIRMADO",
        rascunhoId: linha.id,
        dispatchKey,
        confirmadoEm,
        revision: revisionPosConfirmacao,
      };
    }

    // Corrida: re-lê o vencedor.
    const vencedor = await prisma.botnextPedidoRascunho.findFirst({
      where: { id: rascunhoId, tenantId },
      select: {
        id: true,
        status: true,
        revision: true,
        itens: true,
        dispatchKey: true,
      },
    });

    if (!vencedor) {
      throw new Error(
        "Rascunho não encontrado no tenant informado.",
      );
    }

    if (vencedor.status === BotnextPedidoRascunhoStatus.CONFIRMADO) {
      const conteudoVencedor = lerConteudoPersistido(vencedor.itens);
      if (!vencedor.dispatchKey || !conteudoVencedor.confirmacao) {
        throw new Error(
          "Rascunho CONFIRMADO sem dispatchKey/confirmação persistida.",
        );
      }
      return {
        situacao: "JA_CONFIRMADO",
        rascunhoId: vencedor.id,
        dispatchKey: vencedor.dispatchKey,
        confirmadoEm: conteudoVencedor.confirmacao.confirmadoEm,
        revision: vencedor.revision,
      };
    }

    if (vencedor.status === BotnextPedidoRascunhoStatus.DESPACHADO) {
      return {
        situacao: "JA_DESPACHADO",
        rascunhoId: vencedor.id,
      };
    }

    return {
      situacao: "NAO_CONFIRMAVEL",
      rascunhoId: vencedor.id,
      status: vencedor.status,
      motivo: "ESTADO_ALTERADO_NA_CORRIDA",
    };
  };
}
