// Tipos da extração estruturada de pedido (Etapa 2.9).
//
// A IA é só uma ferramenta de estruturação de texto — TODAS as regras de
// negócio ficam no backend (`normalizar-extracao.ts`). O extractor considera
// SOMENTE a mensagem atual do cliente.

// --------------------------------------------------------------------------
// Saída CRUA da IA (validada por zod / structured output)
// --------------------------------------------------------------------------

export interface ItemExtraidoIa {
  quantidade: number | null;
  produtoMencionado: string | null;
  unidadeMencionada: string | null;
  embalagemMencionada: string | null;
  observacaoItem: string | null;
  /** "o de sempre", "mais um igual" — referência a pedido anterior. */
  ehReferenciaAnterior: boolean;
}

export interface ExtracaoPedidoGerada {
  itens: ItemExtraidoIa[];
  observacaoPedido: string | null;
  /** O texto (também) indica não querer pedir / desistir. */
  desistenciaDetectada: boolean;
  /** "2, na verdade 4" resolvido DENTRO da mensagem atual. */
  correcaoDetectada: boolean;
  confianca: number;
}

// --------------------------------------------------------------------------
// Saída FINAL do backend (após normalizar-extracao — pura)
// --------------------------------------------------------------------------

export type ProblemaItem =
  | "QUANTIDADE_AUSENTE"
  | "QUANTIDADE_INVALIDA"
  | "PRODUTO_AUSENTE"
  | "REFERENCIA_SEM_CONTEUDO";

export interface ItemExtraido {
  /** Inteiro positivo ou null. Sem default de quantidade nesta etapa. */
  quantidade: number | null;
  produtoMencionado: string | null;
  unidadeMencionada: string | null;
  embalagemMencionada: string | null;
  observacaoItem: string | null;
  /** Avaliação do BACKEND, não da IA. Sempre presente (pode ser []). */
  problemas: ProblemaItem[];
}

export type StatusExtracao =
  | "EXTRAIDO"
  | "SEM_ITENS"
  | "REFERENCIA_SEM_CONTEUDO"
  | "DESISTENCIA"
  | "FALHA_IA";

export type SinalExtracao =
  | "BAIXA_CONFIANCA"
  | "DESISTENCIA_COM_ITENS"
  | "CORRECAO_APLICADA"
  | "OBSERVACOES_PRESENTES"
  | "LIMITE_ITENS_EXCEDIDO";

export interface ResultadoExtracao {
  status: StatusExtracao;
  itens: ItemExtraido[];
  observacaoPedido: string | null;
  desistenciaDetectada: boolean;
  confiancaIa: number | null;
  sinais: SinalExtracao[];
  modelo: string;
  versaoExtractor: string;
  versaoPrompt: string;
  /** ISO-8601. */
  extraidoEm: string;
  erro: string | null;
}

// --------------------------------------------------------------------------
// Provedor de IA injetável (espelha ProvedorClassificacaoBotnext)
// --------------------------------------------------------------------------

export interface ProvedorExtracaoPedido {
  modelo: string;
  versaoExtractor: string;
  versaoPrompt: string;
  /** Recebe o texto da mensagem atual; devolve a saída CRUA da IA. */
  extrair: (texto: string) => Promise<ExtracaoPedidoGerada>;
}

/** Limites defensivos aplicados pelo backend. */
export const LIMITES_EXTRACAO = {
  maxItens: 30,
  maxTamanhoProduto: 200,
  maxTamanhoUnidade: 120,
  maxTamanhoEmbalagem: 200,
  maxTamanhoObservacao: 1_000,
} as const;
