import { describe, expect, it } from "vitest";

import {
  MENSAGEM_AGUARDANDO_CLAREZA,
  MENSAGEM_PEDIDO_CANCELADO,
  MENSAGEM_RECEBENDO_PEDIDO,
  montarMensagemAmbiguidade,
  montarMensagemSemCorrespondencia,
  montarPerguntasPendencias,
  montarResumoPedido,
} from "../src/integrations/botnext/botnext-mensagens-pedido.js";

function item(parcial: {
  quantidade?: number | null;
  problemas?: string[];
  resolucao?: {
    status?: string;
    nome?: string | null;
    candidatos?: { item: { nome: string } }[];
  } | null;
  produtoMencionado?: string | null;
}): any {
  return {
    quantidade: parcial.quantidade ?? null,
    problemas: parcial.problemas ?? [],
    resolucao:
      "resolucao" in parcial
        ? parcial.resolucao
        : { status: "OK", nome: "Pilsen Hoffnung" },
    produtoMencionado: parcial.produtoMencionado ?? null,
  };
}

describe("mensagens fixas (Etapa 3.2)", () => {
  it("são duráveis e sem emoji/lixo", () => {
    expect(MENSAGEM_AGUARDANDO_CLAREZA).toBe(
      "Não entendi. Pode confirmar (sim) ou cancelar (não)?",
    );
    expect(MENSAGEM_PEDIDO_CANCELADO).toBe("Pedido cancelado.");
    expect(MENSAGEM_RECEBENDO_PEDIDO).toBe(
      "Recebi sua confirmação e estou processando o pedido.",
    );
  });
});

describe("montarResumoPedido", () => {
  it("1 item com quantidade → '• 2x Nome'", () => {
    expect(
      montarResumoPedido([
        item({ quantidade: 2, resolucao: { status: "OK", nome: "Cachaça Premium" } }),
      ]),
    ).toBe("• 2x Cachaça Premium");
  });

  it("múltiplos itens → uma linha por item", () => {
    expect(
      montarResumoPedido([
        item({ quantidade: 2, resolucao: { status: "OK", nome: "Cachaça Premium" } }),
        item({ quantidade: 1, resolucao: { status: "OK", nome: "Pilsen Hoffnung" } }),
      ]),
    ).toBe("• 2x Cachaça Premium\n• 1x Pilsen Hoffnung");
  });

  it("sem quantidade → só o nome; sem resolução → nome mencionado", () => {
    expect(montarResumoPedido([item({})])).toBe("• Pilsen Hoffnung");
    expect(
      montarResumoPedido([
        item({ resolucao: null, produtoMencionado: "aquele whisky" }),
      ]),
    ).toBe("• aquele whisky");
  });
});

describe("montarPerguntaPendencia e montarPerguntasPendencias", () => {
  it("quantidade ausente → pergunta de quantidade", () => {
    const p = montarPerguntasPendencias([
      item({ problemas: ["QUANTIDADE_AUSENTE"] }),
    ]);
    expect(p).toBe("Quantas unidades você deseja de Pilsen Hoffnung?");
  });

  it("produto ausente → pergunta de produto", () => {
    const p = montarPerguntasPendencias([
      item({ quantidade: 2, problemas: ["PRODUTO_AUSENTE"] }),
    ]);
    expect(p).toBe("Qual produto você deseja?");
  });

  it("ambiguidade → lista de candidatos", () => {
    const p = montarPerguntasPendencias([
      item({
        quantidade: 2,
        resolucao: {
          status: "AMBIGUO",
          candidatos: [
            { item: { nome: "Pilsen Hoffnung" } },
            { item: { nome: "Pilsen Borck" } },
          ],
        },
      }),
    ]);
    expect(p).toBe(
      "Encontrei mais de uma opção: Pilsen Hoffnung; Pilsen Borck. Qual delas você quer?",
    );
  });

  it("sem correspondência → aviso do item mencionado", () => {
    const p = montarPerguntasPendencias([
      item({
        quantidade: 2,
        resolucao: { status: "SEM_CORRESPONDENCIA" },
        produtoMencionado: "cerveja imaginária",
      }),
    ]);
    expect(p).toBe("Não encontrei cerveja imaginária no catálogo.");
  });

  it("deduplica perguntas repetidas entre itens", () => {
    const p = montarPerguntasPendencias([
      item({ quantidade: 2, problemas: ["PRODUTO_AUSENTE"] }),
      item({ quantidade: 3, problemas: ["PRODUTO_AUSENTE"], resolucao: null }),
    ]);
    expect(p).toBe("Qual produto você deseja?");
  });

  it("sem pendência reconhecida → null", () => {
    expect(
      montarPerguntasPendencias([
        item({ quantidade: 2, resolucao: { status: "OK", nome: "COK" } }),
      ]),
    ).toBeNull();
    expect(montarPerguntasPendencias([])).toBeNull();
  });
});

describe("mensagens auxiliares", () => {
  it("montarMensagemAmbiguidade cai para 'opções' sem candidatos", () => {
    expect(montarMensagemAmbiguidade(item({ resolucao: { status: "AMBIGUO" } }))).toBe(
      "Encontrei mais de uma opção: opções. Qual delas você quer?",
    );
  });

  it("montarMensagemSemCorrespondencia usa 'esse item' sem menção", () => {
    expect(
      montarMensagemSemCorrespondencia(item({ resolucao: { status: "SEM_CORRESPONDENCIA" } })),
    ).toBe("Não encontrei esse item no catálogo.");
  });
});