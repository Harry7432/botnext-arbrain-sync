import { describe, expect, it } from "vitest";

import {
  criarCatalogoRepositoryEmMemoria,
} from "../src/pedidos/catalogo-repository.js";
import { normalizarTexto } from "../src/pedidos/normalizacao.js";
import { coeficienteDice } from "../src/pedidos/similaridade.js";
import { resolverProduto } from "../src/pedidos/resolver-produto.js";
import type {
  AliasCatalogo,
  CatalogoRepository,
  ItemCatalogo,
} from "../src/pedidos/tipos.js";

const TENANT_A = "aaaaaaaa-0000-4000-8000-000000000001";
const TENANT_B = "bbbbbbbb-0000-4000-8000-000000000002";

function produto(
  id: string,
  nome: string,
  sku: number,
  tenantId = TENANT_A,
): ItemCatalogo {
  return { fonte: "PRODUTO", id, tenantId, arbrainId: `arb-${id}`, sku, nome };
}

function alias(
  id: string,
  aliasNormalizado: string,
  produtoId: string,
  ativo: boolean,
  tenantId = TENANT_A,
): AliasCatalogo {
  return {
    id,
    tenantId,
    produtoId,
    alias: aliasNormalizado,
    aliasNormalizado,
    ativo,
  };
}

// Catálogo base do tenant A.
const P_IPA_MALTE = produto("p-a1", "Cerveja IPA Puro Malte", 101);
const P_PILSEN = produto("p-a2", "Cerveja Pilsen Lata 350", 102);
const P_WEST_IPA = produto("p-a3", "West Coast IPA", 103);
const P_COLA = produto("p-a4", "Refrigerante Cola 2L", 104);
const P_BRAHMA = produto("p-a5", "Brahma Duplo Malte", 105);
const CATALOGO_A: ItemCatalogo[] = [
  P_IPA_MALTE,
  P_PILSEN,
  P_WEST_IPA,
  P_COLA,
  P_BRAHMA,
];

function repo(
  produtos: ItemCatalogo[],
  aliases: AliasCatalogo[] = [],
): CatalogoRepository {
  return criarCatalogoRepositoryEmMemoria({ produtos, cervejas: [], aliases });
}

describe("normalização de texto", () => {
  it("caixa, acentos, pontuação e espaços repetidos", () => {
    expect(normalizarTexto("  Ãçaí   Lata 473ML! ")).toBe("acai lata 473ml");
    expect(normalizarTexto("CERVEJA  ipa\tPuro—Malte")).toBe(
      "cerveja ipa puro malte",
    );
    expect(normalizarTexto(null)).toBe("");
    expect(normalizarTexto(undefined)).toBe("");
    expect(normalizarTexto("   ")).toBe("");
  });

  it("é idempotente", () => {
    const uma = normalizarTexto("Pão de Açúcar  2un");
    expect(normalizarTexto(uma)).toBe(uma);
  });
});

describe("resolverProduto — fonte PRODUTO", () => {
  it("#1 alias direto único → RESOLVIDO / ALIAS_DIRETO", async () => {
    const r = await resolverProduto(
      { tenantId: TENANT_A, produtoMencionado: "Breja Gelada" },
      { repository: repo(CATALOGO_A, [alias("al-1", "breja gelada", P_PILSEN.id, true)]) },
    );

    expect(r.status).toBe("RESOLVIDO");
    expect(r.origemResolucao).toBe("ALIAS_DIRETO");
    expect(r.fonteCatalogo).toBe("PRODUTO");
    expect(r.item?.id).toBe(P_PILSEN.id);
    expect(r.item?.tenantId).toBe(TENANT_A);
    expect(r.item?.arbrainId).toBe(`arb-${P_PILSEN.id}`);
    expect(r.item?.fonteCatalogo).toBe("PRODUTO");
    expect(r.score).toBeNull();
    expect(r.candidatos).toEqual([]);
  });

  it("#2 alias inativo é ignorado e a busca normal assume", async () => {
    const r = await resolverProduto(
      { tenantId: TENANT_A, produtoMencionado: "West Coast IPA" },
      {
        repository: repo(CATALOGO_A, [
          alias("al-2", "west coast ipa", P_IPA_MALTE.id, false),
        ]),
      },
    );

    expect(r.status).toBe("RESOLVIDO");
    expect(r.origemResolucao).toBe("NOME_EXATO");
    expect(r.item?.id).toBe(P_WEST_IPA.id);
    expect(r.sinais).toContain("ALIAS_INATIVO_IGNORADO");
  });

  it("#3 nome exato único → RESOLVIDO / NOME_EXATO", async () => {
    const r = await resolverProduto(
      { tenantId: TENANT_A, produtoMencionado: "brahma   DUPLO malte" },
      { repository: repo(CATALOGO_A) },
    );

    expect(r.status).toBe("RESOLVIDO");
    expect(r.origemResolucao).toBe("NOME_EXATO");
    expect(r.item?.id).toBe(P_BRAHMA.id);
    expect(r.score).toBeNull();
  });

  it("#4 termo genérico com vários compatíveis → AMBIGUO / TOKENS", async () => {
    const r = await resolverProduto(
      { tenantId: TENANT_A, produtoMencionado: "IPA" },
      { repository: repo(CATALOGO_A) },
    );

    expect(r.status).toBe("AMBIGUO");
    expect(r.origemResolucao).toBe("TOKENS");
    expect(r.item).toBeNull();
    expect(r.candidatos.map((c) => c.item.id).sort()).toEqual(
      [P_IPA_MALTE.id, P_WEST_IPA.id].sort(),
    );
    expect(r.candidatos.every((c) => c.score === null)).toBe(true);
    expect(r.candidatos.every((c) => c.item.fonteCatalogo === "PRODUTO")).toBe(true);
  });

  it("#5 tokens suficientes para diferenciar → RESOLVIDO / TOKENS", async () => {
    const r = await resolverProduto(
      { tenantId: TENANT_A, produtoMencionado: "puro malte IPA" },
      { repository: repo(CATALOGO_A) },
    );

    expect(r.status).toBe("RESOLVIDO");
    expect(r.origemResolucao).toBe("TOKENS");
    expect(r.item?.id).toBe(P_IPA_MALTE.id);
  });

  it("#6 fuzzy único acima do limiar → RESOLVIDO / FUZZY", async () => {
    const r = await resolverProduto(
      { tenantId: TENANT_A, produtoMencionado: "Brama Dulpo Malte" },
      { repository: repo(CATALOGO_A) },
    );

    expect(r.status).toBe("RESOLVIDO");
    expect(r.origemResolucao).toBe("FUZZY");
    expect(r.item?.id).toBe(P_BRAHMA.id);
    expect(r.score).not.toBeNull();
    expect(r.score!).toBeGreaterThanOrEqual(0.6);
    expect(r.score!).toBeLessThanOrEqual(1);
  });

  it("#7 fuzzy abaixo do limiar → SEM_CORRESPONDENCIA", async () => {
    const r = await resolverProduto(
      { tenantId: TENANT_A, produtoMencionado: "xyzabc kombucha turbo" },
      { repository: repo(CATALOGO_A) },
    );

    expect(r.status).toBe("SEM_CORRESPONDENCIA");
    expect(r.origemResolucao).toBe("SEM_CORRESPONDENCIA");
    expect(r.fonteCatalogo).toBeNull();
    expect(r.item).toBeNull();
    expect(r.candidatos).toEqual([]);
  });

  it("#8 empate fuzzy relevante → AMBIGUO / FUZZY", async () => {
    const comGas = produto("p-f1", "Agua Mineral com Gas 500", 301);
    const semGas = produto("p-f2", "Agua Mineral sem Gas 500", 302);
    const r = await resolverProduto(
      { tenantId: TENANT_A, produtoMencionado: "agua minaral gas 500" },
      { repository: repo([...CATALOGO_A, comGas, semGas]) },
    );

    expect(r.status).toBe("AMBIGUO");
    expect(r.origemResolucao).toBe("FUZZY");
    expect(r.candidatos.map((c) => c.item.id).sort()).toEqual(
      [comGas.id, semGas.id].sort(),
    );
    expect(r.candidatos.every((c) => (c.score ?? 0) >= 0.6)).toBe(true);
  });

  it("#9 produto de outro tenant nunca aparece (repo com vazamento)", async () => {
    const foraDoTenant = produto("p-b1", "Produto Exclusivo Do Tenant B", 999, TENANT_B);
    const repoVazado: CatalogoRepository = {
      async listarProdutosDoTenant() {
        return [...CATALOGO_A, foraDoTenant];
      },
      async listarCervejasDoTenant() {
        return [];
      },
      async listarAliasesDoTenant() {
        return [];
      },
    };

    const r = await resolverProduto(
      { tenantId: TENANT_A, produtoMencionado: "Produto Exclusivo Do Tenant B" },
      { repository: repoVazado },
    );

    expect(r.status).toBe("SEM_CORRESPONDENCIA");
    expect(r.sinais).toContain("PRODUTO_CROSS_TENANT_IGNORADO");

    const legitima = await resolverProduto(
      { tenantId: TENANT_A, produtoMencionado: "West Coast IPA" },
      { repository: repoVazado },
    );
    expect(legitima.item?.id).toBe(P_WEST_IPA.id);
  });

  it("#10 alias de outro tenant nunca aparece (repo com vazamento)", async () => {
    const repoVazado: CatalogoRepository = {
      async listarProdutosDoTenant() {
        return CATALOGO_A;
      },
      async listarCervejasDoTenant() {
        return [];
      },
      async listarAliasesDoTenant() {
        return [alias("al-x", "breja gelada", P_PILSEN.id, true, TENANT_B)];
      },
    };

    const r = await resolverProduto(
      { tenantId: TENANT_A, produtoMencionado: "Breja Gelada" },
      { repository: repoVazado },
    );

    expect(r.origemResolucao).not.toBe("ALIAS_DIRETO");
    expect(r.status).toBe("SEM_CORRESPONDENCIA");
    expect(r.sinais).toContain("ALIAS_CROSS_TENANT_IGNORADO");
  });

  it("#11 catálogo vazio → SEM_CORRESPONDENCIA + CATALOGO_VAZIO", async () => {
    const r = await resolverProduto(
      { tenantId: TENANT_A, produtoMencionado: "qualquer coisa" },
      { repository: repo([], []) },
    );

    expect(r.status).toBe("SEM_CORRESPONDENCIA");
    expect(r.sinais).toContain("CATALOGO_VAZIO");
  });

  it("#12 normalização de maiúsculas/acentos/espaços na resolução", async () => {
    const acai = produto("p-n1", "Açaí Polpa 1Kg", 401);
    const r = await resolverProduto(
      { tenantId: TENANT_A, produtoMencionado: "  ACAI    polpa 1KG  " },
      { repository: repo([...CATALOGO_A, acai]) },
    );

    expect(r.status).toBe("RESOLVIDO");
    expect(r.origemResolucao).toBe("NOME_EXATO");
    expect(r.item?.id).toBe(acai.id);

    const viaAlias = await resolverProduto(
      { tenantId: TENANT_A, produtoMencionado: "AÇAÍ" },
      { repository: repo([...CATALOGO_A, acai], [alias("al-n", "acai", acai.id, true)]) },
    );
    expect(viaAlias.origemResolucao).toBe("ALIAS_DIRETO");
    expect(viaAlias.item?.id).toBe(acai.id);
  });

  it("#13 determinístico: mesma entrada e ordem de catálogo trocada → mesmo resultado", async () => {
    const entrada = { tenantId: TENANT_A, produtoMencionado: "IPA" } as const;

    const r1 = await resolverProduto(entrada, { repository: repo(CATALOGO_A) });
    const r2 = await resolverProduto(entrada, { repository: repo(CATALOGO_A) });
    const r3 = await resolverProduto(entrada, {
      repository: repo([...CATALOGO_A].reverse()),
    });

    expect(r2).toEqual(r1);
    expect(r3).toEqual(r1);
    expect(r1.candidatos.map((c) => c.item.id)).toEqual(
      r3.candidatos.map((c) => c.item.id),
    );
  });

  it("#U1 unidade/embalagem não mudam a resolução: 'IPA' + unidade 'caixa' == só 'IPA'", async () => {
    const repository = repo(CATALOGO_A);
    const soProduto = await resolverProduto(
      { tenantId: TENANT_A, produtoMencionado: "IPA" },
      { repository },
    );
    const comUnidade = await resolverProduto(
      {
        tenantId: TENANT_A,
        produtoMencionado: "IPA",
        unidadeMencionada: "caixa",
        embalagemMencionada: "fardo com 12",
      },
      { repository },
    );

    expect(comUnidade).toEqual(soProduto);
    expect(comUnidade.status).toBe("AMBIGUO");
    expect(comUnidade.origemResolucao).toBe("TOKENS");
  });

  it("#U2 embalagem desconhecida não reduz nem altera o score fuzzy do produto", async () => {
    const repository = repo(CATALOGO_A);
    const semEmbalagem = await resolverProduto(
      { tenantId: TENANT_A, produtoMencionado: "Brama Dulpo Malte" },
      { repository },
    );
    const comEmbalagem = await resolverProduto(
      {
        tenantId: TENANT_A,
        produtoMencionado: "Brama Dulpo Malte",
        embalagemMencionada: "engradado plastico retornavel 24",
        unidadeMencionada: "caixa",
      },
      { repository },
    );

    expect(comEmbalagem.status).toBe("RESOLVIDO");
    expect(comEmbalagem.origemResolucao).toBe("FUZZY");
    expect(comEmbalagem.item?.id).toBe(P_BRAHMA.id);
    expect(comEmbalagem.score).toBe(semEmbalagem.score);
    expect(comEmbalagem).toEqual(semEmbalagem);
  });

  it("#U3 unidade/embalagem não fazem um produto incorreto vencer", async () => {
    const repository = repo(CATALOGO_A);

    const exato = await resolverProduto(
      {
        tenantId: TENANT_A,
        produtoMencionado: "Brahma Duplo Malte",
        embalagemMencionada: "Cerveja Pilsen Lata 350",
        unidadeMencionada: "lata",
      },
      { repository },
    );
    expect(exato.status).toBe("RESOLVIDO");
    expect(exato.origemResolucao).toBe("NOME_EXATO");
    expect(exato.item?.id).toBe(P_BRAHMA.id);

    const fuzzy = await resolverProduto(
      {
        tenantId: TENANT_A,
        produtoMencionado: "Brama Dulpo Malte",
        embalagemMencionada: "Refrigerante Cola 2L",
      },
      { repository },
    );
    expect(fuzzy.status).toBe("RESOLVIDO");
    expect(fuzzy.origemResolucao).toBe("FUZZY");
    expect(fuzzy.item?.id).toBe(P_BRAHMA.id);
  });

  it("#U4 termo genérico continua AMBIGUO com qualquer unidade/embalagem", async () => {
    const repository = repo(CATALOGO_A);
    const base = await resolverProduto(
      { tenantId: TENANT_A, produtoMencionado: "ipa" },
      { repository },
    );

    for (const extra of [
      { unidadeMencionada: "caixa" },
      { unidadeMencionada: "garrafa", embalagemMencionada: "barril" },
      { embalagemMencionada: "fardo 6" },
      { unidadeMencionada: "unidade", embalagemMencionada: "pack" },
    ]) {
      const r = await resolverProduto(
        { tenantId: TENANT_A, produtoMencionado: "ipa", ...extra },
        { repository },
      );
      expect(r.status).toBe("AMBIGUO");
      expect(r.origemResolucao).toBe("TOKENS");
      expect(r).toEqual(base);
    }
  });

  it("#14 alias ativo apontando para produto inexistente → SEM_CORRESPONDENCIA + ALIAS_PRODUTO_INVALIDO", async () => {
    const r = await resolverProduto(
      { tenantId: TENANT_A, produtoMencionado: "Fantasma" },
      {
        repository: repo(CATALOGO_A, [
          alias("al-ghost", "fantasma", "produto-que-nao-existe", true),
        ]),
      },
    );

    expect(r.status).toBe("SEM_CORRESPONDENCIA");
    expect(r.origemResolucao).toBe("SEM_CORRESPONDENCIA");
    expect(r.sinais).toContain("ALIAS_PRODUTO_INVALIDO");
  });
});

describe("coeficienteDice — sanidade", () => {
  it("simétrico, [0,1], iguais = 1", () => {
    expect(coeficienteDice("brahma", "brahma")).toBe(1);
    expect(coeficienteDice("brahma", "braham")).toBe(
      coeficienteDice("braham", "brahma"),
    );
    const s = coeficienteDice("agua com gas", "agua sem gas");
    expect(s).toBeGreaterThan(0);
    expect(s).toBeLessThan(1);
  });
});
