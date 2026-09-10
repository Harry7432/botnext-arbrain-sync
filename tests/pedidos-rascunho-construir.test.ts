import { describe, expect, it, vi } from "vitest";

import type {
  ResultadoExtracao,
  ItemExtraido,
  SinalExtracao,
} from "../src/pedidos/extracao/tipos.js";
import {
  construirRascunho,
  paraSnapshot,
  type ResolveItemRascunho,
} from "../src/pedidos/rascunho/construir-rascunho.js";
import {
  itemEstaPendente,
  VERSAO_RASCUNHO,
  type ItemRascunho,
} from "../src/pedidos/rascunho/tipos.js";
import type {
  ItemCatalogoResolvido,
  ResultadoResolucao,
  SinalAuditoria,
} from "../src/pedidos/tipos.js";

const TENANT_A = "aaaaaaaa-0000-4000-8000-000000000001";

const PRODUTO_RESOLVIDO: ItemCatalogoResolvido = {
  fonteCatalogo: "PRODUTO",
  id: "p-cachaca",
  tenantId: TENANT_A,
  arbrainId: "arbP-cachaca",
  sku: 9,
  nome: "Cachaça Premium 750 ml",
};

const CERVEJA_RESOLVIDA: ItemCatalogoResolvido = {
  fonteCatalogo: "CERVEJA",
  id: "c-pilsen",
  tenantId: TENANT_A,
  arbrainId: "arbC-pilsen",
  sku: 1,
  nome: "Pilsen Hoffnung",
};

function resolvido(
  itemResolvido: ItemCatalogoResolvido,
  sinais: SinalAuditoria[] = [],
  origem: ResultadoResolucao["origemResolucao"] = "NOME_EXATO",
): ResultadoResolucao {
  return {
    status: "RESOLVIDO",
    origemResolucao: origem,
    fonteCatalogo: itemResolvido.fonteCatalogo,
    item: itemResolvido,
    candidatos: [],
    score: null,
    motivo: `nome normalizado idêntico a ${itemResolvido.nome}`,
    sinais,
  };
}

const AMBIGUO: ResultadoResolucao = {
  status: "AMBIGUO",
  origemResolucao: "FUZZY",
  fonteCatalogo: "CERVEJA",
  item: null,
  candidatos: [
    {
      item: { ...CERVEJA_RESOLVIDA, id: "c-pilsen-hoff", nome: "Pilsen Hoffnung" },
      score: 0.9,
    },
    {
      item: { ...CERVEJA_RESOLVIDA, id: "c-pilsen-verde", nome: "Pilsen Verde" },
      score: 0.88,
    },
  ],
  score: null,
  motivo: "2 itens dentro da margem do topo",
  sinais: [],
};

const SEM_CORRESPONDENCIA: ResultadoResolucao = {
  status: "SEM_CORRESPONDENCIA",
  origemResolucao: "SEM_CORRESPONDENCIA",
  fonteCatalogo: null,
  item: null,
  candidatos: [],
  score: null,
  motivo: "nenhuma fonte casou",
  sinais: [],
};

function item(parcial: Partial<ItemExtraido> = {}): ItemExtraido {
  return {
    quantidade: 3,
    produtoMencionado: "Pilsen Hoffnung",
    unidadeMencionada: "caixas",
    embalagemMencionada: null,
    observacaoItem: null,
    problemas: [],
    ...parcial,
  };
}

function extracao(
  itens: ItemExtraido[],
  sinais: SinalExtracao[] = [],
): ResultadoExtracao {
  return {
    status: "EXTRAIDO",
    itens,
    observacaoPedido: null,
    desistenciaDetectada: false,
    confiancaIa: 0.95,
    sinais,
    modelo: "modelo-teste",
    versaoExtractor: "extractor-teste-v1",
    versaoPrompt: "prompt-teste-v1",
    extraidoEm: "2026-09-09T00:00:00.000Z",
    erro: null,
  };
}

describe("construirRascunho (Etapa 3.0) — builder puro", () => {
  it("#1 1 produto resolvido sem pendência → PRONTO", async () => {
    const resolveItem: ResolveItemRascunho = vi
      .fn()
      .mockResolvedValue(resolvido(PRODUTO_RESOLVIDO));
    const r = await construirRascunho(
      extracao([item({ produtoMencionado: "Cachaça Premium 750 ml" })]),
      resolveItem,
    );

    expect(r.status).toBe("PRONTO");
    expect(r.totalItens).toBe(1);
    expect(r.itensResolvidos).toBe(1);
    expect(r.itensNaoResolvidos).toBe(0);
    expect(r.itens[0]?.pendente).toBe(false);
    expect(r.conteudo.versao).toBe(VERSAO_RASCUNHO);
    expect(resolveItem).toHaveBeenCalledTimes(1);
  });

  it("#2 1 cerveja resolvida sem pendência → PRONTO", async () => {
    const resolveItem: ResolveItemRascunho = vi
      .fn()
      .mockResolvedValue(resolvido(CERVEJA_RESOLVIDA));
    const r = await construirRascunho(
      extracao([item({ produtoMencionado: "pilsen hoffnung" })]),
      resolveItem,
    );

    expect(r.status).toBe("PRONTO");
    const snapshot = r.itens[0]?.resolucao;
    expect(snapshot?.fonteCatalogo).toBe("CERVEJA");
    expect(snapshot?.arbrainId).toBe("arbC-pilsen");
    expect(snapshot?.id).toBe("c-pilsen");
    expect(snapshot?.sku).toBe(1);
    expect(snapshot?.nome).toBe("Pilsen Hoffnung");
    expect(snapshot?.origemResolucao).toBe("NOME_EXATO");
  });

  it("#3 produto com QUANTIDADE_AUSENTE → PENDENTE (resolução preservada)", async () => {
    const resolveItem: ResolveItemRascunho = vi
      .fn()
      .mockResolvedValue(resolvido(PRODUTO_RESOLVIDO));
    const r = await construirRascunho(
      extracao([
        item({
          quantidade: null,
          problemas: ["QUANTIDADE_AUSENTE"],
        }),
      ]),
      resolveItem,
    );

    expect(r.status).toBe("PENDENTE");
    expect(r.itens[0]?.pendente).toBe(true);
    expect(r.itens[0]?.quantidade).toBeNull();
    // A resolução do produto ainda acontece (quantidade não bloqueia catálogo).
    expect(r.itens[0]?.resolucao?.status).toBe("RESOLVIDO");
    expect(r.itensResolvidos).toBe(1);
  });

  it("#4 produto ausente (PRODUTO_AUSENTE) → PENDENTE, resolver NÃO chamado, item preservado", async () => {
    const resolveItem: ResolveItemRascunho = vi.fn();
    const r = await construirRascunho(
      extracao([
        item({
          produtoMencionado: null,
          unidadeMencionada: null,
          problemas: ["PRODUTO_AUSENTE"],
        }),
      ]),
      resolveItem,
    );

    expect(r.status).toBe("PENDENTE");
    expect(r.itens[0]?.pendente).toBe(true);
    expect(r.itens[0]?.resolucao).toBeNull();
    expect(r.itens[0]?.produtoMencionado).toBeNull();
    expect(resolveItem).not.toHaveBeenCalled();
    expect(r.itensResolvidos).toBe(0);
  });

  it("#5 resolução AMBIGUO → PENDENTE, candidatos preservados", async () => {
    const resolveItem: ResolveItemRascunho = vi
      .fn()
      .mockResolvedValue(AMBIGUO);
    const r = await construirRascunho(extracao([item()]), resolveItem);

    expect(r.status).toBe("PENDENTE");
    expect(r.itens[0]?.pendente).toBe(true);
    expect(r.itens[0]?.resolucao?.status).toBe("AMBIGUO");
    expect(r.itens[0]?.resolucao?.candidatos.length).toBeGreaterThanOrEqual(2);
    expect(r.itens[0]?.resolucao?.id).toBeNull();
    expect(r.itens[0]?.resolucao?.arbrainId).toBeNull();
  });

  it("#6 SEM_CORRESPONDENCIA → PENDENTE", async () => {
    const resolveItem: ResolveItemRascunho = vi
      .fn()
      .mockResolvedValue(SEM_CORRESPONDENCIA);
    const r = await construirRascunho(extracao([item()]), resolveItem);

    expect(r.status).toBe("PENDENTE");
    expect(r.itens[0]?.pendente).toBe(true);
    expect(r.itens[0]?.resolucao?.status).toBe("SEM_CORRESPONDENCIA");
    expect(r.itens[0]?.resolucao?.fonteCatalogo).toBeNull();
  });

  it("#7 sinal SEM_CONTEXTO_DE_FONTE em item RESOLVIDO → PENDENTE", async () => {
    const resolveItem: ResolveItemRascunho = vi
      .fn()
      .mockResolvedValue(
        resolvido(PRODUTO_RESOLVIDO, ["SEM_CONTEXTO_DE_FONTE"]),
      );
    const r = await construirRascunho(
      extracao([item({ produtoMencionado: "cachaça premium" })]),
      resolveItem,
    );

    expect(r.status).toBe("PENDENTE");
    expect(r.itens[0]?.pendente).toBe(true);
    expect(r.itens[0]?.resolucao?.status).toBe("RESOLVIDO");
  });

  it("#8 múltiplos itens todos resolvidos sem pendência → PRONTO", async () => {
    const resolveItem: ResolveItemRascunho = vi.fn((entrada) =>
      Promise.resolve(
        entrada.produtoMencionado.includes("pilsen")
          ? resolvido(CERVEJA_RESOLVIDA)
          : resolvido(PRODUTO_RESOLVIDO),
      ),
    );
    const r = await construirRascunho(
      extracao([
        item({ produtoMencionado: "cachaça", quantidade: 2 }),
        item({ produtoMencionado: "pilsen hoffnung", quantidade: 1 }),
      ]),
      resolveItem,
    );

    expect(r.status).toBe("PRONTO");
    expect(r.totalItens).toBe(2);
    expect(r.itensResolvidos).toBe(2);
    expect(resolveItem).toHaveBeenCalledTimes(2);
  });

  it("#9 múltiplos itens com 1 pendência → PENDENTE", async () => {
    const resolveItem: ResolveItemRascunho = vi.fn((entrada) =>
      Promise.resolve(
        entrada.produtoMencionado.includes("pilsen")
          ? resolvido(CERVEJA_RESOLVIDA)
          : SEM_CORRESPONDENCIA,
      ),
    );
    const r = await construirRascunho(
      extracao([
        item({ produtoMencionado: "produto raro", quantidade: 2 }),
        item({ produtoMencionado: "pilsen hoffnung", quantidade: 1 }),
      ]),
      resolveItem,
    );

    expect(r.status).toBe("PENDENTE");
    expect(r.totalItens).toBe(2);
    expect(r.itensResolvidos).toBe(1);
    expect(r.itensNaoResolvidos).toBe(1);
  });

  it("#17 determinismo do snapshot — duas construções produzem o mesmo JSON", async () => {
    const resolveItem: ResolveItemRascunho = vi.fn((entrada) =>
      Promise.resolve(
        entrada.produtoMencionado.includes("pilsen")
          ? resolvido(CERVEJA_RESOLVIDA)
          : resolvido(PRODUTO_RESOLVIDO),
      ),
    );
    const fonte = extracao([
      item({ produtoMencionado: "cachaça", quantidade: 2 }),
      item({ produtoMencionado: "pilsen hoffnung", quantidade: 1 }),
    ]);

    const a = await construirRascunho(fonte, resolveItem);
    const b = await construirRascunho(fonte, resolveItem);

    expect(JSON.stringify(a.conteudo)).toBe(JSON.stringify(b.conteudo));
  });

  it("#18 idEmbalagem/idUnidade/valorUnitario/preço/contrato não existem no conteúdo", async () => {
    const resolveItem: ResolveItemRascunho = vi
      .fn()
      .mockResolvedValue(resolvido(PRODUTO_RESOLVIDO));
    const r = await construirRascunho(
      extracao([item({ produtoMencionado: "cachaça", quantidade: 2 })]),
      resolveItem,
    );
    const serializado = JSON.stringify(r.conteudo);

    for (const campo of [
      "idEmbalagem",
      "idUnidade",
      "valorUnitario",
      "preco",
      "contrato",
    ]) {
      expect(serializado).not.toContain(campo);
    }
  });

  it("#7b sinal DESISTENCIA_COM_ITENS na extração → PENDENTE com sinal carregado", async () => {
    const resolveItem: ResolveItemRascunho = vi
      .fn()
      .mockResolvedValue(resolvido(PRODUTO_RESOLVIDO));
    const r = await construirRascunho(
      extracao(
        [item({ produtoMencionado: "cachaça", quantidade: 2 })],
        ["DESISTENCIA_COM_ITENS"],
      ),
      resolveItem,
    );

    expect(r.status).toBe("PENDENTE");
    expect(r.conteudo.sinaisExtracao).toContain("DESISTENCIA_COM_ITENS");
  });

  it("#7c sinal BAIXA_CONFIANCA na extração → PENDENTE", async () => {
    const resolveItem: ResolveItemRascunho = vi
      .fn()
      .mockResolvedValue(resolvido(PRODUTO_RESOLVIDO));
    const r = await construirRascunho(
      extracao(
        [item({ produtoMencionado: "cachaça", quantidade: 2 })],
        ["BAIXA_CONFIANCA"],
      ),
      resolveItem,
    );

    expect(r.status).toBe("PENDENTE");
    expect(r.conteudo.sinaisExtracao).toContain("BAIXA_CONFIANCA");
  });

  it("campos da extração são preservados integralmente no item do rascunho", async () => {
    const resolveItem: ResolveItemRascunho = vi
      .fn()
      .mockResolvedValue(resolvido(PRODUTO_RESOLVIDO));
    const r = await construirRascunho(
      extracao([
        item({
          quantidade: 7,
          produtoMencionado: "refrigerante lata",
          unidadeMencionada: "cx",
          embalagemMencionada: "fardo c/ 12",
          observacaoItem: "gelado",
          problemas: ["QUANTIDADE_AUSENTE"],
        }),
      ]),
      resolveItem,
    );
    const montado = r.itens[0]!;

    expect(montado.quantidade).toBe(7);
    expect(montado.produtoMencionado).toBe("refrigerante lata");
    expect(montado.unidadeMencionada).toBe("cx");
    expect(montado.embalagemMencionada).toBe("fardo c/ 12");
    expect(montado.observacaoItem).toBe("gelado");
    expect(montado.problemas).toEqual(["QUANTIDADE_AUSENTE"]);
    expect(itemEstaPendente(montado)).toBe(true);
  });

  it("paraSnapshot achata o resultado resolvido", () => {
    const snapshot = paraSnapshot(resolvido(PRODUTO_RESOLVIDO));
    expect(snapshot).toMatchObject({
      status: "RESOLVIDO",
      fonteCatalogo: "PRODUTO",
      arbrainId: "arbP-cachaca",
      id: "p-cachaca",
      sku: 9,
      nome: "Cachaça Premium 750 ml",
      candidatos: [],
    });
  });
});