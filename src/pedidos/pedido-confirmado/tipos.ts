// Contrato PEDIDO_CONFIRMADO_V1 (Etapa 3.1).
//
// Contrato versionado e DESACOPLADO do ArBrain: o rascunho confirmado vira um
// evento PEDIDO_CONFIRMADO enviado ao webhook do n8n. Nada aqui finge ser o
// payload do ArBrain — os campos ainda desconhecidos (idEmbalagem, idUnidade,
// tipoLinha, valorUnitario) são persistidos como null EXPLICITAMENTE
// documentados como pendentes.

import type {
  FonteCatalogo,
  OrigemResolucao,
  StatusResolucao,
} from "../tipos.js";
import type { ItemRascunho } from "../rascunho/tipos.js";

export const VERSAO_PEDIDO_CONFIRMADO = "1" as const;
export const TIPO_EVENTO_PEDIDO_CONFIRMADO =
  "PEDIDO_CONFIRMADO" as const;

/**
 * Snapshot de confirmação persistido dentro do JSON do rascunho (campo
 * aditivo `confirmacao` em ConteudoRascunhoPersistido), gravado no mesmo CAS
 * que leva o rascunho de PRONTO para CONFIRMADO. Sem migration.
 */
export interface ConfirmacaoRascunho {
  /** ISO-8601 UTC do momento da confirmação explícita. */
  confirmadoEm: string;
  /** Chave de idempotência do dispatch (sha256 determinístico). */
  dispatchKey: string;
}

/**
 * Projeção do snapshot da resolução no contrato externo. Espelha
 * ResolucaoSnapshot SEM os campos internos (candidatos/sinais/motivo).
 */
export interface ResolucaoContratoV1 {
  status: StatusResolucao;
  fonteCatalogo: FonteCatalogo | null;
  arbrainId: string | null;
  id: string | null;
  sku: number | null;
  nome: string | null;
  origemResolucao: OrigemResolucao;
  score: number | null;
}

/**
 * Item do contrato externo. Preserva a menção original do cliente e o
 * snapshot da resolução; os campos ArBrain pendentes ficam null por contrato.
 */
export interface ItemPedidoConfirmadoV1 {
  quantidade: number | null;
  produtoMencionado: string | null;
  unidadeMencionada: string | null;
  embalagemMencionada: string | null;
  observacaoItem: string | null;
  // Pendentes de etapas futuras do ArBrain — nunca inventar valor.
  idEmbalagem: null;
  idUnidade: null;
  tipoLinha: null;
  valorUnitario: null;
  resolucao: ResolucaoContratoV1;
}

export interface PedidoConfirmadoV1 {
  version: "1";
  tipoEvento: "PEDIDO_CONFIRMADO";
  dispatchKey: string;
  tenantId: string;
  conversationId: string;
  extracaoId: string;
  rascunhoId: string;
  /** Revision APÓS a confirmação. */
  revision: number;
  confirmadoEm: string;
  /** Cliente identificado quando a conversa tem clienteId; senão null. */
  cliente: {
    arbrainId: string | null;
  };
  itens: ItemPedidoConfirmadoV1[];
}

/**
 * Projeção de ItemRascunho para o contrato externo. Para um pedido
 * CONFIRMADO a resolução sempre existe e é RESOLVIDO; os fallbacks são
 * defensivos para nunca quebrar a serialização.
 */
export function paraItemPedidoConfirmado(
  item: ItemRascunho,
): ItemPedidoConfirmadoV1 {
  return {
    quantidade: item.quantidade,
    produtoMencionado: item.produtoMencionado,
    unidadeMencionada: item.unidadeMencionada,
    embalagemMencionada: item.embalagemMencionada,
    observacaoItem: item.observacaoItem,
    idEmbalagem: null,
    idUnidade: null,
    tipoLinha: null,
    valorUnitario: null,
    resolucao: {
      status: item.resolucao?.status ?? "SEM_CORRESPONDENCIA",
      fonteCatalogo: item.resolucao?.fonteCatalogo ?? null,
      arbrainId: item.resolucao?.arbrainId ?? null,
      id: item.resolucao?.id ?? null,
      sku: item.resolucao?.sku ?? null,
      nome: item.resolucao?.nome ?? null,
      origemResolucao: item.resolucao?.origemResolucao ?? "SEM_CORRESPONDENCIA",
      score: item.resolucao?.score ?? null,
    },
  };
}