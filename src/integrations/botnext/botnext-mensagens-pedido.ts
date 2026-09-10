// Mensagens de texto do fluxo de pedido BotNext (Etapa 3.2).
//
// Puramente formatação — não faz I/O, não chama IA. Mensagens duráveis e
// determinísticas enviadas ao cliente e registradas para auditoria.

import type { ItemRascunho } from "../../pedidos/rascunho/tipos.js";

// ---------------------------------------------------------------------------
// Mensagens fixas
// ---------------------------------------------------------------------------

export const MENSAGEM_AGUARDANDO_CLAREZA =
  "Não entendi. Pode confirmar (sim) ou cancelar (não)?";

export const MENSAGEM_PEDIDO_CANCELADO =
  "Pedido cancelado.";

export const MENSAGEM_RECEBENDO_PEDIDO =
  "Recebi sua confirmação e estou processando o pedido.";

// ---------------------------------------------------------------------------
// Resumo do pedido (PRONTO → envio para aguardar confirmação)
// ---------------------------------------------------------------------------

function nomeDoItem(item: ItemRascunho): string {
  return item.resolucao?.nome ?? item.produtoMencionado ?? "Item";
}

function formatarItemResumo(item: ItemRascunho): string {
  const nome = nomeDoItem(item);
  if (item.quantidade == null) {
    return `• ${nome}`;
  }
  return `• ${item.quantidade}x ${nome}`;
}

/** "• 2x Cachaça Premium\n• 1x Pilsen Hoffnung". */
export function montarResumoPedido(itens: ItemRascunho[]): string {
  return itens.map(formatarItemResumo).join("\n");
}

// ---------------------------------------------------------------------------
// Perguntas por pendência (PENDENTE → envio para o cliente)
// ---------------------------------------------------------------------------

export function montarPerguntaQuantidade(
  item: ItemRascunho,
): string {
  return `Quantas unidades você deseja de ${nomeDoItem(item)}?`;
}

export function montarPerguntaProduto(): string {
  return "Qual produto você deseja?";
}

export function montarMensagemSemCorrespondencia(
  item: ItemRascunho,
): string {
  const mencionado = item.produtoMencionado ?? "esse item";
  return `Não encontrei ${mencionado} no catálogo.`;
}

export function montarMensagemAmbiguidade(
  item: ItemRascunho,
): string {
  const nomes = (item.resolucao?.candidatos ?? [])
    .map((candidato) => candidato.item.nome)
    .filter((nome) => nome.length > 0);

  const lista = nomes.length > 0 ? nomes.join("; ") : "opções";
  return `Encontrei mais de uma opção: ${lista}. Qual delas você quer?`;
}

/**
 * Pergunta específica do PRIMEIRO item pendente. Sem chamadas externas.
 * Retorna null quando o item não tem pendência reconhecida.
 */
export function montarPerguntaPendencia(
  item: ItemRascunho,
): string | null {
  if (
    item.problemas.includes("QUANTIDADE_AUSENTE") ||
    item.problemas.includes("QUANTIDADE_INVALIDA") ||
    item.quantidade == null
  ) {
    return montarPerguntaQuantidade(item);
  }

  if (item.problemas.includes("PRODUTO_AUSENTE")) {
    return montarPerguntaProduto();
  }

  if (item.resolucao === null) {
    return montarPerguntaProduto();
  }

  if (item.resolucao.status === "AMBIGUO") {
    return montarMensagemAmbiguidade(item);
  }

  if (item.resolucao.status === "SEM_CORRESPONDENCIA") {
    return montarMensagemSemCorrespondencia(item);
  }

  // REFERENCIA_SEM_CONTEUDO e demais sinais sem pergunta específica.
  return null;
}

/** Perguntas de todos os itens pendentes, unidas por linha. */
export function montarPerguntasPendencias(
  itens: ItemRascunho[],
): string | null {
  const perguntas = itens
    .map(montarPerguntaPendencia)
    .filter((pergunta): pergunta is string => pergunta !== null);

  if (perguntas.length === 0) {
    return null;
  }

  const unicas = [...new Set(perguntas)];
  return unicas.length === 1
    ? unicas[0]!
    : unicas.join("\n");
}