import { describe, expect, it } from "vitest";

import {
  normalizarExtracao,
  resultadoFalhaExtracao,
  type OpcoesNormalizacao,
} from "../src/pedidos/extracao/normalizar-extracao.js";
import type {
  ExtracaoPedidoGerada,
  ItemExtraidoIa,
} from "../src/pedidos/extracao/tipos.js";

const OPCOES: OpcoesNormalizacao = {
  confiancaMinima: 0.8,
  modelo: "modelo-teste",
  versaoExtractor: "extractor-teste-v1",
  versaoPrompt: "prompt-teste-v1",
  agora: new Date("2026-09-09T12:00:00.000Z"),
};

function itemIa(over: Partial<ItemExtraidoIa> = {}): ItemExtraidoIa {
  return {
    quantidade: null,
    produtoMencionado: null,
    unidadeMencionada: null,
    embalagemMencionada: null,
    observacaoItem: null,
    ehReferenciaAnterior: false,
    ...over,
  };
}

function cru(over: Partial<ExtracaoPedidoGerada> = {}): ExtracaoPedidoGerada {
  return {
    itens: [],
    observacaoPedido: null,
    desistenciaDetectada: false,
    correcaoDetectada: false,
    confianca: 0.95,
    ...over,
  };
}

describe("normalizarExtracao — regras de negócio (backend, puro)", () => {
  it("'quero 3 caixas de Pilsen Hoffnung' → EXTRAIDO, 1 item sem problemas", () => {
    const r = normalizarExtracao(
      cru({
        itens: [
          itemIa({
            quantidade: 3,
            produtoMencionado: "Pilsen Hoffnung",
            unidadeMencionada: "caixas",
          }),
        ],
      }),
      OPCOES,
    );

    expect(r.status).toBe("EXTRAIDO");
    expect(r.itens).toHaveLength(1);
    expect(r.itens[0]).toEqual({
      quantidade: 3,
      produtoMencionado: "Pilsen Hoffnung",
      unidadeMencionada: "caixas",
      embalagemMencionada: null,
      observacaoItem: null,
      problemas: [],
    });
    expect(r.extraidoEm).toBe("2026-09-09T12:00:00.000Z");
    expect(r.modelo).toBe("modelo-teste");
  });

  it("'2 barris de IPA 30L e 5 Cachaça Premium' → EXTRAIDO, 2 itens", () => {
    const r = normalizarExtracao(
      cru({
        itens: [
          itemIa({
            quantidade: 2,
            produtoMencionado: "IPA",
            embalagemMencionada: "barril 30L",
          }),
          itemIa({ quantidade: 5, produtoMencionado: "Cachaça Premium" }),
        ],
      }),
      OPCOES,
    );

    expect(r.status).toBe("EXTRAIDO");
    expect(r.itens.map((i) => i.produtoMencionado)).toEqual([
      "IPA",
      "Cachaça Premium",
    ]);
    expect(r.itens[0]?.embalagemMencionada).toBe("barril 30L");
    expect(r.itens.every((i) => i.problemas.length === 0)).toBe(true);
  });

  it("'quero IPA' (sem quantidade) → EXTRAIDO + QUANTIDADE_AUSENTE, sem default", () => {
    const r = normalizarExtracao(
      cru({ itens: [itemIa({ produtoMencionado: "IPA" })] }),
      OPCOES,
    );

    expect(r.status).toBe("EXTRAIDO");
    expect(r.itens[0]?.quantidade).toBeNull();
    expect(r.itens[0]?.problemas).toEqual(["QUANTIDADE_AUSENTE"]);
  });

  it("'manda o mesmo de sempre' → REFERENCIA_SEM_CONTEUDO", () => {
    const r = normalizarExtracao(
      cru({ itens: [itemIa({ ehReferenciaAnterior: true })] }),
      OPCOES,
    );

    expect(r.status).toBe("REFERENCIA_SEM_CONTEUDO");
    expect(r.itens[0]?.problemas).toContain("REFERENCIA_SEM_CONTEUDO");
  });

  it("'quero 2 IPA, na verdade 4' → EXTRAIDO, quantidade 4, sinal CORRECAO_APLICADA", () => {
    const r = normalizarExtracao(
      cru({
        correcaoDetectada: true,
        itens: [itemIa({ quantidade: 4, produtoMencionado: "IPA" })],
      }),
      OPCOES,
    );

    expect(r.status).toBe("EXTRAIDO");
    expect(r.itens[0]?.quantidade).toBe(4);
    expect(r.sinais).toContain("CORRECAO_APLICADA");
  });

  it("'não quero mais' → DESISTENCIA (0 itens)", () => {
    const r = normalizarExtracao(
      cru({ desistenciaDetectada: true, itens: [] }),
      OPCOES,
    );

    expect(r.status).toBe("DESISTENCIA");
    expect(r.itens).toEqual([]);
    expect(r.desistenciaDetectada).toBe(true);
  });

  it("'quero 3 caixas, mas não lembro qual cerveja' → EXTRAIDO + PRODUTO_AUSENTE (mantém 3/caixas)", () => {
    const r = normalizarExtracao(
      cru({
        itens: [itemIa({ quantidade: 3, unidadeMencionada: "caixas" })],
      }),
      OPCOES,
    );

    expect(r.status).toBe("EXTRAIDO");
    expect(r.itens[0]?.quantidade).toBe(3);
    expect(r.itens[0]?.unidadeMencionada).toBe("caixas");
    expect(r.itens[0]?.produtoMencionado).toBeNull();
    expect(r.itens[0]?.problemas).toEqual(["PRODUTO_AUSENTE"]);
  });

  it("'quero fazer um pedido' (sem itens, sem desistência) → SEM_ITENS", () => {
    const r = normalizarExtracao(cru({ itens: [] }), OPCOES);
    expect(r.status).toBe("SEM_ITENS");
  });

  it("confiança da IA abaixo do limiar → sinal BAIXA_CONFIANCA, status inalterado", () => {
    const r = normalizarExtracao(
      cru({
        confianca: 0.4,
        itens: [itemIa({ quantidade: 1, produtoMencionado: "IPA" })],
      }),
      OPCOES,
    );

    expect(r.status).toBe("EXTRAIDO");
    expect(r.confiancaIa).toBe(0.4);
    expect(r.sinais).toContain("BAIXA_CONFIANCA");
  });

  it("quantidade 0 / negativa / fracionada → null + QUANTIDADE_INVALIDA", () => {
    for (const q of [0, -1, 1.5, Number.NaN]) {
      const r = normalizarExtracao(
        cru({ itens: [itemIa({ quantidade: q, produtoMencionado: "IPA" })] }),
        OPCOES,
      );
      expect(r.itens[0]?.quantidade).toBeNull();
      expect(r.itens[0]?.problemas).toContain("QUANTIDADE_INVALIDA");
    }
  });

  it("IA devolve 40 itens → 30 mantidos + LIMITE_ITENS_EXCEDIDO", () => {
    const itens = Array.from({ length: 40 }, (_, i) =>
      itemIa({ quantidade: 1, produtoMencionado: `Produto ${i}` }),
    );
    const r = normalizarExtracao(cru({ itens }), OPCOES);

    expect(r.itens).toHaveLength(30);
    expect(r.sinais).toContain("LIMITE_ITENS_EXCEDIDO");
  });

  it("pede E desiste no mesmo texto → EXTRAIDO + DESISTENCIA_COM_ITENS", () => {
    const r = normalizarExtracao(
      cru({
        desistenciaDetectada: true,
        itens: [itemIa({ quantidade: 2, produtoMencionado: "IPA" })],
      }),
      OPCOES,
    );

    expect(r.status).toBe("EXTRAIDO");
    expect(r.sinais).toContain("DESISTENCIA_COM_ITENS");
  });

  it("observações (item e pedido) são preservadas e sinalizadas", () => {
    const r = normalizarExtracao(
      cru({
        observacaoPedido: "  entrega amanhã de tarde  ",
        itens: [
          itemIa({
            quantidade: 1,
            produtoMencionado: "Pilsen Hoffnung",
            observacaoItem: "bem gelada",
          }),
        ],
      }),
      OPCOES,
    );

    expect(r.observacaoPedido).toBe("entrega amanhã de tarde");
    expect(r.itens[0]?.observacaoItem).toBe("bem gelada");
    expect(r.sinais).toContain("OBSERVACOES_PRESENTES");
  });

  it("é determinístico (mesma entrada + mesmo 'agora' → toEqual)", () => {
    const entrada = cru({
      itens: [itemIa({ quantidade: 3, produtoMencionado: "Pilsen Hoffnung", unidadeMencionada: "caixas" })],
    });
    expect(normalizarExtracao(entrada, OPCOES)).toEqual(
      normalizarExtracao(entrada, OPCOES),
    );
  });

  it("resultadoFalhaExtracao → status FALHA_IA, erro preenchido, sem itens", () => {
    const r = resultadoFalhaExtracao("resposta fora do schema", OPCOES);
    expect(r.status).toBe("FALHA_IA");
    expect(r.itens).toEqual([]);
    expect(r.erro).toBe("resposta fora do schema");
    expect(r.confiancaIa).toBeNull();
  });

  it("exemplo do enunciado — 'Quero 3 caixas de Pilsen Hoffnung e 2 barris de IPA 30L'", () => {
    const r = normalizarExtracao(
      cru({
        itens: [
          itemIa({ quantidade: 3, produtoMencionado: "Pilsen Hoffnung", unidadeMencionada: "caixas" }),
          itemIa({ quantidade: 2, produtoMencionado: "IPA", embalagemMencionada: "barril 30L" }),
        ],
      }),
      OPCOES,
    );

    expect(r.itens).toEqual([
      {
        quantidade: 3,
        produtoMencionado: "Pilsen Hoffnung",
        unidadeMencionada: "caixas",
        embalagemMencionada: null,
        observacaoItem: null,
        problemas: [],
      },
      {
        quantidade: 2,
        produtoMencionado: "IPA",
        unidadeMencionada: null,
        embalagemMencionada: "barril 30L",
        observacaoItem: null,
        problemas: [],
      },
    ]);
  });
});
