import { describe, expect, it } from "vitest";

import { criarCatalogoRepositoryEmMemoria } from "../src/pedidos/catalogo-repository.js";
import { resolverItemCatalogo } from "../src/pedidos/resolver-item-catalogo.js";
import { CONFIG_RESOLUCAO_PADRAO } from "../src/pedidos/tipos.js";
import type {
  CatalogoEmMemoria,
  CatalogoRepository,
  ItemCatalogo,
} from "../src/pedidos/index.js";

const TENANT_A = "aaaaaaaa-0000-4000-8000-000000000001";
const TENANT_B = "bbbbbbbb-0000-4000-8000-000000000002";

function produto(id: string, nome: string, sku: number, tenantId = TENANT_A): ItemCatalogo {
  return { fonte: "PRODUTO", id, tenantId, arbrainId: `arbP-${id}`, sku, nome };
}
function cerveja(id: string, nome: string, sku: number, tenantId = TENANT_A): ItemCatalogo {
  return { fonte: "CERVEJA", id, tenantId, arbrainId: `arbC-${id}`, sku, nome };
}

// --- catálogo base (espelha nuances reais do tenant lrc) ---
const P_COPO_STOUT = produto("p1", "Copo Stout 473 ML", 24);
const P_CACHACA = produto("p2", "Cachaça Premium 750 ml", 9);
const P_REFRI_LATA = produto("p3", "Refrigerante Lata", 47);
const PRODUTOS = [P_COPO_STOUT, P_CACHACA, P_REFRI_LATA];

const C_IPA = cerveja("c1", "IPA", 8);
const C_IPA_CINE = cerveja("c2", "IPA Cine Rock", 26);
const C_PILSEN_HOFF = cerveja("c3", "Pilsen Hoffnung", 1);
const C_PILSEN_VERDE = cerveja("c4", "Pilsen Verde", 24);
const CERVEJAS = [C_IPA, C_IPA_CINE, C_PILSEN_HOFF, C_PILSEN_VERDE];

function repo(dados: Partial<CatalogoEmMemoria> = {}): CatalogoRepository {
  return criarCatalogoRepositoryEmMemoria({
    produtos: dados.produtos ?? PRODUTOS,
    cervejas: dados.cervejas ?? CERVEJAS,
    aliases: dados.aliases ?? [],
  });
}

describe("resolverItemCatalogo — multi-fonte (Etapa 2.8)", () => {
  it("#1 'Cachaça Premium 750 ml' → RESOLVIDO / PRODUTO / NOME_EXATO", async () => {
    const r = await resolverItemCatalogo(
      { tenantId: TENANT_A, produtoMencionado: "Cachaça Premium 750 ML" },
      { repository: repo() },
    );
    expect(r.status).toBe("RESOLVIDO");
    expect(r.fonteCatalogo).toBe("PRODUTO");
    expect(r.origemResolucao).toBe("NOME_EXATO");
    expect(r.item?.id).toBe(P_CACHACA.id);
    expect(r.item?.arbrainId).toBe(`arbP-${P_CACHACA.id}`);
    expect(r.sinais).toContain("SEM_CONTEXTO_DE_FONTE");
  });

  it("#2 'Pilsen Hoffnung' → RESOLVIDO / CERVEJA / NOME_EXATO", async () => {
    const r = await resolverItemCatalogo(
      { tenantId: TENANT_A, produtoMencionado: "pilsen  hoffnung" },
      { repository: repo() },
    );
    expect(r.status).toBe("RESOLVIDO");
    expect(r.fonteCatalogo).toBe("CERVEJA");
    expect(r.origemResolucao).toBe("NOME_EXATO");
    expect(r.item?.id).toBe(C_PILSEN_HOFF.id);
    expect(r.item?.arbrainId).toBe(`arbC-${C_PILSEN_HOFF.id}`);
    expect(r.sinais).toContain("SEM_CONTEXTO_DE_FONTE");
  });

  it("#3 termo genérico 'pilsen' (2 cervejas, 0 produtos) → AMBIGUO fonte única CERVEJA", async () => {
    const semHint = await resolverItemCatalogo(
      { tenantId: TENANT_A, produtoMencionado: "PILSEN" },
      { repository: repo() },
    );
    expect(semHint.status).toBe("AMBIGUO");
    expect(semHint.origemResolucao).toBe("TOKENS");
    expect(semHint.fonteCatalogo).toBe("CERVEJA");
    expect(semHint.candidatos.map((c) => c.item.id).sort()).toEqual(
      [C_PILSEN_HOFF.id, C_PILSEN_VERDE.id].sort(),
    );
    expect(semHint.candidatos.every((c) => c.item.fonteCatalogo === "CERVEJA")).toBe(true);
    expect(semHint.sinais).not.toContain("AMBIGUIDADE_ENTRE_FONTES");

    const comHint = await resolverItemCatalogo(
      { tenantId: TENANT_A, produtoMencionado: "PILSEN", fonteEsperada: "CERVEJA" },
      { repository: repo() },
    );
    expect(comHint.status).toBe("AMBIGUO");
    expect(comHint.candidatos.map((c) => c.item.id).sort()).toEqual(
      [C_PILSEN_HOFF.id, C_PILSEN_VERDE.id].sort(),
    );
  });

  it("#3b 'IPA' com cerveja homônima → RESOLVIDO / CERVEJA / NOME_EXATO (exato vence ambiguidade de token)", async () => {
    const r = await resolverItemCatalogo(
      { tenantId: TENANT_A, produtoMencionado: "ipa" },
      { repository: repo() },
    );
    expect(r.status).toBe("RESOLVIDO");
    expect(r.fonteCatalogo).toBe("CERVEJA");
    expect(r.origemResolucao).toBe("NOME_EXATO");
    expect(r.item?.id).toBe(C_IPA.id);
  });

  it("#4a 'stout' com fonteEsperada=CERVEJA e sem cerveja stout → SEM_CORRESPONDENCIA (nunca COPO STOUT)", async () => {
    const r = await resolverItemCatalogo(
      { tenantId: TENANT_A, produtoMencionado: "stout", fonteEsperada: "CERVEJA" },
      { repository: repo() }, // produtos tem COPO STOUT; cervejas não tem stout
    );
    expect(r.status).toBe("SEM_CORRESPONDENCIA");
    expect(r.item).toBeNull();
  });

  it("#4b 'stout' sem hint: COPO STOUT (produto/TOKENS) e 'Cerveja Stout' (cerveja/TOKENS) → AMBIGUO entre fontes", async () => {
    const C_STOUT = cerveja("c9", "Cerveja Stout", 40);
    const r = await resolverItemCatalogo(
      { tenantId: TENANT_A, produtoMencionado: "stout" },
      { repository: repo({ cervejas: [...CERVEJAS, C_STOUT] }) },
    );
    expect(r.status).toBe("AMBIGUO");
    expect(r.item).toBeNull();
    expect(r.fonteCatalogo).toBeNull();
    expect(r.sinais).toContain("AMBIGUIDADE_ENTRE_FONTES");
    expect(r.candidatos.map((c) => c.item.fonteCatalogo).sort()).toEqual(["CERVEJA", "PRODUTO"]);
    expect(r.candidatos.map((c) => c.item.id).sort()).toEqual(
      [P_COPO_STOUT.id, C_STOUT.id].sort(),
    );
  });

  it("#4c 'stout' sem hint: COPO STOUT (produto/TOKENS) e 'Stout' (cerveja/NOME_EXATO) → RESOLVIDO CERVEJA", async () => {
    const C_STOUT = cerveja("c9", "Stout", 40);
    const r = await resolverItemCatalogo(
      { tenantId: TENANT_A, produtoMencionado: "stout" },
      { repository: repo({ cervejas: [...CERVEJAS, C_STOUT] }) },
    );
    expect(r.status).toBe("RESOLVIDO");
    expect(r.fonteCatalogo).toBe("CERVEJA");
    expect(r.origemResolucao).toBe("NOME_EXATO");
    expect(r.item?.id).toBe(C_STOUT.id);
    // NUNCA o copo
    expect(r.item?.id).not.toBe(P_COPO_STOUT.id);
  });

  it("#5 empate exato entre fontes ('Premium' em Produto E Cerveja) → AMBIGUO entre fontes", async () => {
    const P_PREMIUM = produto("p9", "Premium", 90);
    const C_PREMIUM = cerveja("cc9", "Premium", 13);
    const r = await resolverItemCatalogo(
      { tenantId: TENANT_A, produtoMencionado: "premium" },
      {
        repository: repo({
          produtos: [...PRODUTOS, P_PREMIUM],
          cervejas: [...CERVEJAS, C_PREMIUM],
        }),
      },
    );
    expect(r.status).toBe("AMBIGUO");
    expect(r.origemResolucao).toBe("NOME_EXATO");
    expect(r.sinais).toContain("AMBIGUIDADE_ENTRE_FONTES");
    expect(r.candidatos.map((c) => c.item.id).sort()).toEqual(
      [P_PREMIUM.id, C_PREMIUM.id].sort(),
    );
  });

  it("#5b exato numa fonte vs fuzzy na outra → a fonte mais forte vence (Q2)", async () => {
    const P_QUASE = produto("p8", "Pilsen Hoffnunga", 80); // fuzzy p/ "pilsen hoffnung"
    const r = await resolverItemCatalogo(
      { tenantId: TENANT_A, produtoMencionado: "Pilsen Hoffnung" },
      { repository: repo({ produtos: [...PRODUTOS, P_QUASE] }) },
    );
    expect(r.status).toBe("RESOLVIDO");
    expect(r.fonteCatalogo).toBe("CERVEJA");
    expect(r.origemResolucao).toBe("NOME_EXATO");
    expect(r.item?.id).toBe(C_PILSEN_HOFF.id);
    expect(r.sinais).not.toContain("SEM_CONTEXTO_DE_FONTE");
  });

  it("#6 tenant B nunca aparece (repo com vazamento nas duas fontes)", async () => {
    const pB = produto("pb", "Item So Do B", 999, TENANT_B);
    const cB = cerveja("cb", "Cerveja So Do B", 999, TENANT_B);
    const repoVazado: CatalogoRepository = {
      async listarProdutosDoTenant() {
        return [...PRODUTOS, pB];
      },
      async listarCervejasDoTenant() {
        return [...CERVEJAS, cB];
      },
      async listarAliasesDoTenant() {
        return [];
      },
    };
    const r = await resolverItemCatalogo(
      { tenantId: TENANT_A, produtoMencionado: "So Do B" },
      { repository: repoVazado },
    );
    expect(r.status).toBe("SEM_CORRESPONDENCIA");
    expect(r.sinais).toContain("PRODUTO_CROSS_TENANT_IGNORADO");
    expect(r.sinais).toContain("CERVEJA_CROSS_TENANT_IGNORADO");

    const legitima = await resolverItemCatalogo(
      { tenantId: TENANT_A, produtoMencionado: "pilsen hoffnung" },
      { repository: repoVazado },
    );
    expect(legitima.item?.id).toBe(C_PILSEN_HOFF.id);
  });

  it("#7 determinístico: mesma entrada 2× e catálogos invertidos → toEqual", async () => {
    const C_STOUT = cerveja("c9", "Cerveja Stout", 40);
    const entrada = { tenantId: TENANT_A, produtoMencionado: "stout" } as const;
    const dados = { cervejas: [...CERVEJAS, C_STOUT] };

    const r1 = await resolverItemCatalogo(entrada, { repository: repo(dados) });
    const r2 = await resolverItemCatalogo(entrada, { repository: repo(dados) });
    const r3 = await resolverItemCatalogo(entrada, {
      repository: repo({
        produtos: [...PRODUTOS].reverse(),
        cervejas: [...dados.cervejas].reverse(),
      }),
    });
    expect(r2).toEqual(r1);
    expect(r3).toEqual(r1);
  });

  it("#8 score e origem preservados num caso FUZZY", async () => {
    const r = await resolverItemCatalogo(
      { tenantId: TENANT_A, produtoMencionado: "pilsen hofnnung" },
      { repository: repo() },
    );
    expect(r.status).toBe("RESOLVIDO");
    expect(r.fonteCatalogo).toBe("CERVEJA");
    expect(r.origemResolucao).toBe("FUZZY");
    expect(r.score).not.toBeNull();
    expect(r.score!).toBeGreaterThanOrEqual(0.6);
    const deNovo = await resolverItemCatalogo(
      { tenantId: TENANT_A, produtoMencionado: "pilsen hofnnung" },
      { repository: repo() },
    );
    expect(deNovo).toEqual(r);
  });

  it("#9 unidade/embalagem continuam fora do ranking", async () => {
    const repository = repo({ cervejas: [...CERVEJAS, cerveja("c9", "Cerveja Stout", 40)] });
    const base = { tenantId: TENANT_A, produtoMencionado: "stout" };
    const extras = { unidadeMencionada: "barril", embalagemMencionada: "keg 30l" };

    const semExtra = await resolverItemCatalogo(base, { repository });
    const comExtra = await resolverItemCatalogo({ ...base, ...extras }, { repository });
    expect(comExtra).toEqual(semExtra);
  });

  it("#10 limiares inalterados; entrada vazia → ENTRADA_VAZIA", async () => {
    expect(CONFIG_RESOLUCAO_PADRAO).toEqual({
      limiarFuzzy: 0.6,
      margemAmbiguidadeFuzzy: 0.05,
    });
    const r = await resolverItemCatalogo(
      { tenantId: TENANT_A, produtoMencionado: "   " },
      { repository: repo() },
    );
    expect(r.status).toBe("SEM_CORRESPONDENCIA");
    expect(r.sinais).toEqual(["ENTRADA_VAZIA"]);
  });
});
