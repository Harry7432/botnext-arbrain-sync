// Tipos do rascunho de pedido (Etapa 3.0).
//
// O rascunho deriva de uma BotnextPedidoExtracao EXTRAIDO e evolui por uma
// máquina de estados (RASCUNHO/PRONTO/CONFIRMADO/DESPACHADO...). Nesta etapa
// geramos somente RASCUNHO (pendente) ou PRONTO e persistimos os itens como
// snapshot JSON versionado no campo `itens` do model existente.
//
// Nada aqui resolve idEmbalagem/idUnidade/valorUnitario/preço/contrato ArBrain:
// esses campos permanecem ausentes/null deliberadamente.

import type {
  CandidatoResolucao,
  FonteCatalogo,
  OrigemResolucao,
  SinalAuditoria,
  StatusResolucao,
} from "../tipos.js";
import type {
  ProblemaItem,
  SinalExtracao,
} from "../extracao/tipos.js";
import type { ConfirmacaoRascunho } from "../pedido-confirmado/tipos.js";

/**
 * Snapshot persistido da resolução de UM item pelo resolverItemCatalogo.
 * Espelha ResultadoResolucao achatando o item resolvido (arbrainId/id/sku/nome).
 * candidatos fica [] quando RESOLVIDO e >= 2 quando AMBIGUO.
 */
export interface ResolucaoSnapshot {
  status: StatusResolucao;
  origemResolucao: OrigemResolucao;
  /** null em SEM_CORRESPONDENCIA ou ambiguidade entre fontes. */
  fonteCatalogo: FonteCatalogo | null;
  /** String opaca do ArBrain (nunca parsear); null quando não RESOLVIDO. */
  arbrainId: string | null;
  /** Id local do catálogo do tenant; null quando não RESOLVIDO. */
  id: string | null;
  sku: number | null;
  nome: string | null;
  /** Score do item resolvido quando aplicável (FUZZY); senão null. */
  score: number | null;
  /** Candidatos da ambiguidade; [] em RESOLVIDO/SEM_CORRESPONDENCIA. */
  candidatos: CandidatoResolucao[];
  sinais: SinalAuditoria[];
  /** Texto técnico curto para auditoria/logs. */
  motivo: string;
}

/**
 * Item do rascunho. Réplica fiel do ItemExtraido + snapshot da resolução.
 * Nunca descarta conteúdo da extração (quantidade/produto/unidade/embalagem/
 * observacoes/problemas).
 */
export interface ItemRascunho {
  quantidade: number | null;
  produtoMencionado: string | null;
  unidadeMencionada: string | null;
  embalagemMencionada: string | null;
  observacaoItem: string | null;
  /** Problemas da extração, intactos. */
  problemas: ProblemaItem[];
  /** null quando produtoMencionado ausente (PRODUTO_AUSENTE/REFERENCIA_SEM_CONTEUDO). */
  resolucao: ResolucaoSnapshot | null;
  /** Derivado na montagem — pendências explícitas para confirmação futura. */
  pendente: boolean;
}

export const VERSAO_RASCUNHO = "rascunho-v1" as const;
export type VersaoRascunho = typeof VERSAO_RASCUNHO;

/**
 * Resposta enviada ao cliente (Etapa 3.2). Registro de envio para dedup do
 * envio no BotNext, indexado pelo webhookEventId que originou a resposta.
 * Durável no JSON do rascunho — sem migration.
 */
export interface RespostaEnviadaAoCliente {
  texto: string;
  /** ISO-8601 UTC do momento do envio. */
  enviadaEm: string;
}

/**
 * Conteúdo persistido no campo `itens` (Json) do BotnextPedidoRascunho.
 * Versionado porque o campo Json não tem schema no banco.
 */
export interface ConteudoRascunhoPersistido {
  versao: VersaoRascunho;
  itens: ItemRascunho[];
  /** Sinais da extração que influenciam o status do rascunho (auditoria). */
  sinaisExtracao: SinalExtracao[];
  /**
   * Confirmado (Etapa 3.1): preenchido pelo serviço de confirmação quando o
   * rascunho vai de PRONTO para CONFIRMADO. Campo ADITIVO — ausente em
   * rascunhos ainda não confirmados e tolerado pelo lerConteudoPersistido.
   */
  confirmacao?: ConfirmacaoRascunho;
  /**
   * Cancelado (Etapa 3.2): preenchido pelo serviço de cancelamento quando o
   * rascunho vai de RASCUNHO/PRONTO para CANCELADO. Campo ADITIVO.
   */
  cancelamento?: { canceladoEm: string };
  /**
   * Respostas enviadas ao cliente (Etapa 3.2), indexadas pelo webhookEventId
   * que as originou. Campo ADITIVO para dedup de envio no BotNext — ausente
   * em rascunhos sem respostas e tolerado pelo lerConteudoPersistido.
   */
  respostas?: Record<string, RespostaEnviadaAoCliente>;
}

/**
 * Estado do rascunho DERIVADO (antes do mapeamento para o enum do banco).
 * PRONTO → BotnextPedidoRascunhoStatus.PRONTO; PENDENTE → RASCUNHO.
 * O enum do banco não tem PENDENTE (sem migration); PENDENTE mapeia para
 * o status RASCUNHO, que semanticamente é o rascunho aguardando confirmação.
 */
export type StatusRascunhoConstruido = "PRONTO" | "PENDENTE";

/** Rascunho montado pelo builder puro, pronto para persistir. */
export interface RascunhoConstruido {
  itens: ItemRascunho[];
  totalItens: number;
  /** Itens com snapshot RESOLVIDO (independe de outras pendências). */
  itensResolvidos: number;
  itensNaoResolvidos: number;
  status: StatusRascunhoConstruido;
  conteudo: ConteudoRascunhoPersistido;
}

const PROBLEMAS_PENDENCIA = new Set<ProblemaItem>([
  "QUANTIDADE_AUSENTE",
  "QUANTIDADE_INVALIDA",
  "PRODUTO_AUSENTE",
  "REFERENCIA_SEM_CONTEUDO",
]);

/**
 * Item pendente (exige confirmação futura e impede o rascunho PRONTO):
 * qualquer problema estrutural da extração, ausência de resolução, resolução
 * AMBIGUO/SEM_CORRESPONDENCIA ou sinal SEM_CONTEXTO_DE_FONTE.
 */
export function itemEstaPendente(item: ItemRascunho): boolean {
  if (item.problemas.some((p) => PROBLEMAS_PENDENCIA.has(p))) {
    return true;
  }
  if (item.resolucao === null) {
    return true;
  }
  if (item.resolucao.status !== "RESOLVIDO") {
    return true;
  }
  if (item.resolucao.sinais.includes("SEM_CONTEXTO_DE_FONTE")) {
    return true;
  }
  return false;
}

/**
 * PRONTO somente quando TODOS os itens estão suficientemente resolvidos e a
 * extração não tem sinais que bloqueiam PRONTO (baixa confiança relevante ou
 * desistência com itens). Qualquer pendência → PENDENTE.
 */
export function determinarStatusRascunho(
  itens: ItemRascunho[],
  sinaisExtracao: SinalExtracao[],
): StatusRascunhoConstruido {
  if (sinaisExtracao.includes("BAIXA_CONFIANCA")) {
    return "PENDENTE";
  }
  if (sinaisExtracao.includes("DESISTENCIA_COM_ITENS")) {
    return "PENDENTE";
  }
  if (itens.some(itemEstaPendente)) {
    return "PENDENTE";
  }
  return "PRONTO";
}