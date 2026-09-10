// Normalização da extração de pedido (Etapa 2.9) — PURO, determinístico.
//
// Aqui ficam TODAS as regras de negócio. A IA só estrutura texto; este módulo
// decide status, problemas por item e sinais. Não há default de quantidade,
// não há palpite: campo ausente permanece null e é sinalizado.

import {
  LIMITES_EXTRACAO,
  type ExtracaoPedidoGerada,
  type ItemExtraido,
  type ItemExtraidoIa,
  type ProblemaItem,
  type ResultadoExtracao,
  type SinalExtracao,
  type StatusExtracao,
} from "./tipos.js";

export interface OpcoesNormalizacao {
  confiancaMinima: number;
  modelo: string;
  versaoExtractor: string;
  versaoPrompt: string;
  /** Injetável para testes determinísticos. */
  agora?: Date;
}

const MAX_QUANTIDADE = 100_000;

function textoNormalizado(
  valor: string | null,
  maxTamanho: number,
): string | null {
  if (valor === null) return null;
  const limpo = valor.trim().slice(0, maxTamanho).trim();
  return limpo === "" ? null : limpo;
}

function normalizarQuantidade(
  valor: number | null,
): { quantidade: number | null; problema: ProblemaItem | null } {
  if (valor === null) {
    return { quantidade: null, problema: "QUANTIDADE_AUSENTE" };
  }
  if (
    Number.isInteger(valor) &&
    valor > 0 &&
    valor <= MAX_QUANTIDADE
  ) {
    return { quantidade: valor, problema: null };
  }
  return { quantidade: null, problema: "QUANTIDADE_INVALIDA" };
}

function normalizarItem(cru: ItemExtraidoIa): ItemExtraido {
  const { quantidade, problema: problemaQuantidade } = normalizarQuantidade(
    cru.quantidade,
  );
  const produtoMencionado = textoNormalizado(
    cru.produtoMencionado,
    LIMITES_EXTRACAO.maxTamanhoProduto,
  );
  const unidadeMencionada = textoNormalizado(
    cru.unidadeMencionada,
    LIMITES_EXTRACAO.maxTamanhoUnidade,
  );
  const embalagemMencionada = textoNormalizado(
    cru.embalagemMencionada,
    LIMITES_EXTRACAO.maxTamanhoEmbalagem,
  );
  const observacaoItem = textoNormalizado(
    cru.observacaoItem,
    LIMITES_EXTRACAO.maxTamanhoObservacao,
  );

  const problemas: ProblemaItem[] = [];
  if (problemaQuantidade) problemas.push(problemaQuantidade);
  if (produtoMencionado === null) {
    problemas.push(
      cru.ehReferenciaAnterior === true
        ? "REFERENCIA_SEM_CONTEUDO"
        : "PRODUTO_AUSENTE",
    );
  }

  return {
    quantidade,
    produtoMencionado,
    unidadeMencionada,
    embalagemMencionada,
    observacaoItem,
    problemas,
  };
}

/** Item que é APENAS referência a pedido anterior, sem conteúdo. */
function ehPuraReferencia(item: ItemExtraido): boolean {
  return (
    item.produtoMencionado === null &&
    item.problemas.includes("REFERENCIA_SEM_CONTEUDO")
  );
}

function determinarStatus(
  itens: ItemExtraido[],
  desistenciaDetectada: boolean,
): StatusExtracao {
  if (itens.length === 0) {
    return desistenciaDetectada ? "DESISTENCIA" : "SEM_ITENS";
  }
  if (itens.every(ehPuraReferencia)) {
    return "REFERENCIA_SEM_CONTEUDO";
  }
  return "EXTRAIDO";
}

export function normalizarExtracao(
  bruto: ExtracaoPedidoGerada,
  opcoes: OpcoesNormalizacao,
): ResultadoExtracao {
  const agora = opcoes.agora ?? new Date();

  const itensCrus = Array.isArray(bruto.itens) ? bruto.itens : [];
  const truncou = itensCrus.length > LIMITES_EXTRACAO.maxItens;
  const itens = itensCrus
    .slice(0, LIMITES_EXTRACAO.maxItens)
    .map(normalizarItem);

  const observacaoPedido = textoNormalizado(
    bruto.observacaoPedido,
    LIMITES_EXTRACAO.maxTamanhoObservacao,
  );

  const desistenciaDetectada = bruto.desistenciaDetectada === true;
  const status = determinarStatus(itens, desistenciaDetectada);

  const confiancaIa = Number.isFinite(bruto.confianca)
    ? Math.min(1, Math.max(0, bruto.confianca))
    : null;

  const sinais: SinalExtracao[] = [];
  if (confiancaIa !== null && confiancaIa < opcoes.confiancaMinima) {
    sinais.push("BAIXA_CONFIANCA");
  }
  if (desistenciaDetectada && itens.length > 0) {
    sinais.push("DESISTENCIA_COM_ITENS");
  }
  if (bruto.correcaoDetectada === true) {
    sinais.push("CORRECAO_APLICADA");
  }
  if (
    observacaoPedido !== null ||
    itens.some((item) => item.observacaoItem !== null)
  ) {
    sinais.push("OBSERVACOES_PRESENTES");
  }
  if (truncou) {
    sinais.push("LIMITE_ITENS_EXCEDIDO");
  }

  return {
    status,
    itens,
    observacaoPedido,
    desistenciaDetectada,
    confiancaIa,
    sinais,
    modelo: opcoes.modelo,
    versaoExtractor: opcoes.versaoExtractor,
    versaoPrompt: opcoes.versaoPrompt,
    extraidoEm: agora.toISOString(),
    erro: null,
  };
}

/** Resultado terminal de falha definitiva da IA (persistido como FALHOU). */
export function resultadoFalhaExtracao(
  mensagemErro: string,
  opcoes: OpcoesNormalizacao,
): ResultadoExtracao {
  const agora = opcoes.agora ?? new Date();
  return {
    status: "FALHA_IA",
    itens: [],
    observacaoPedido: null,
    desistenciaDetectada: false,
    confiancaIa: null,
    sinais: [],
    modelo: opcoes.modelo,
    versaoExtractor: opcoes.versaoExtractor,
    versaoPrompt: opcoes.versaoPrompt,
    extraidoEm: agora.toISOString(),
    erro: mensagemErro.slice(0, 2_000),
  };
}
