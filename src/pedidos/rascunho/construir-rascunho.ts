// Construção do rascunho de pedido (Etapa 3.0) — PURO, determinístico.
//
// Transforma um ResultadoExtracao EXTRAIDO em um RascunhoConstruido. A resolução
// do catálogo é injetada (`resolveItem`) para manter o módulo livre de banco e
// testável. Não escreve em lugar nenhum, não chama serviços externos.

import type { ResultadoResolucao } from "../tipos.js";
import type { ItemExtraido, ResultadoExtracao } from "../extracao/tipos.js";
import {
  determinarStatusRascunho,
  itemEstaPendente,
  type ItemRascunho,
  type ResolucaoSnapshot,
  type RascunhoConstruido,
  VERSAO_RASCUNHO,
} from "./tipos.js";

export interface EntradaResolveItem {
  produtoMencionado: string;
  unidadeMencionada: string | null;
  embalagemMencionada: string | null;
}

/** Resolvedor injetável: normalmente resolverItemCatalogo SEM fonteEsperada. */
export type ResolveItemRascunho = (
  entrada: EntradaResolveItem,
) => Promise<ResultadoResolucao>;

/** Acha o ResultadoResolucao no snapshot persistido (achatado). */
export function paraSnapshot(res: ResultadoResolucao): ResolucaoSnapshot {
  return {
    status: res.status,
    origemResolucao: res.origemResolucao,
    fonteCatalogo: res.fonteCatalogo,
    arbrainId: res.item?.arbrainId ?? null,
    id: res.item?.id ?? null,
    sku: res.item?.sku ?? null,
    nome: res.item?.nome ?? null,
    score: res.score,
    candidatos: res.candidatos,
    sinais: res.sinais,
    motivo: res.motivo,
  };
}

async function resolverItem(
  item: ItemExtraido,
  resolveItem: ResolveItemRascunho,
): Promise<ResolucaoSnapshot | null> {
  if (item.produtoMencionado === null) {
    // PRODUTO_AUSENTE / REFERENCIA_SEM_CONTEUDO — sem conteúdo para resolver.
    // O item permanece no rascunho como pendência (nunca descartado).
    return null;
  }
  const res = await resolveItem({
    produtoMencionado: item.produtoMencionado,
    unidadeMencionada: item.unidadeMencionada,
    embalagemMencionada: item.embalagemMencionada,
  });
  return paraSnapshot(res);
}

/**
 * Constrói o rascunho a partir da extração. NÃO valida o status da extração
 * aqui (o orquestrador decide se a extração pode gerar rascunho).
 */
export async function construirRascunho(
  resultado: ResultadoExtracao,
  resolveItem: ResolveItemRascunho,
): Promise<RascunhoConstruido> {
  const itens: ItemRascunho[] = [];

  for (const extraido of resultado.itens) {
    const resolucao = await resolverItem(extraido, resolveItem);
    const item: ItemRascunho = {
      quantidade: extraido.quantidade,
      produtoMencionado: extraido.produtoMencionado,
      unidadeMencionada: extraido.unidadeMencionada,
      embalagemMencionada: extraido.embalagemMencionada,
      observacaoItem: extraido.observacaoItem,
      problemas: extraido.problemas,
      resolucao,
      pendente: itemEstaPendente({
        ...extraido,
        resolucao,
        pendente: false,
      }),
    };
    itens.push(item);
  }

  const status = determinarStatusRascunho(itens, resultado.sinais);

  const totalItens = itens.length;
  const itensResolvidos = itens.filter(
    (i) => i.resolucao?.status === "RESOLVIDO",
  ).length;

  return {
    itens,
    totalItens,
    itensResolvidos,
    itensNaoResolvidos: totalItens - itensResolvidos,
    status,
    conteudo: {
      versao: VERSAO_RASCUNHO,
      itens,
      sinaisExtracao: resultado.sinais,
    },
  };
}