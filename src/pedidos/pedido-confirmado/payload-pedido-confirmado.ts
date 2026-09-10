// Builder PURO e determinístico do payload PEDIDO_CONFIRMADO_V1 (Etapa 3.1).
//
// Recebe o rascunho confirmado já hidratado e devolve o contrato externo com
// itens ordenados deterministicamente (mesma ordenação usada no dispatchKey).
// Sequências idênticas de entrada → payload byte-idêntico.

import {
  ordenarItensContrato,
} from "./dispatch-key.js";
import {
  paraItemPedidoConfirmado,
  type ConfirmacaoRascunho,
  type PedidoConfirmadoV1,
} from "./tipos.js";
import type { ItemRascunho } from "../rascunho/tipos.js";

export interface ParamsMontarPayload {
  tenantId: string;
  conversationId: string;
  extracaoId: string;
  rascunhoId: string;
  revision: number;
  confirmacao: ConfirmacaoRascunho;
  clienteArbrainId: string | null;
  itens: ItemRascunho[];
}

export function montarPayloadPedidoConfirmadoV1(
  params: ParamsMontarPayload,
): PedidoConfirmadoV1 {
  return {
    version: "1",
    tipoEvento: "PEDIDO_CONFIRMADO",
    dispatchKey: params.confirmacao.dispatchKey,
    tenantId: params.tenantId,
    conversationId: params.conversationId,
    extracaoId: params.extracaoId,
    rascunhoId: params.rascunhoId,
    revision: params.revision,
    confirmadoEm: params.confirmacao.confirmadoEm,
    cliente: {
      arbrainId: params.clienteArbrainId,
    },
    itens: ordenarItensContrato(
      params.itens.map(paraItemPedidoConfirmado),
    ),
  };
}