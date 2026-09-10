import { describe, expect, it } from "vitest";

import { criarCatalogoRepositoryEmMemoria } from "../src/pedidos/catalogo-repository.js";
import { resolverCerveja } from "../src/pedidos/resolver-cerveja.js";
import type { CatalogoRepository, ItemCatalogo } from "../src/pedidos/tipos.js";

const TENANT_A = "aaaaaaaa-0000-4000-8000-000000000001";
const TENANT_B = "bbbbbbbb-0000-4000-8000-000000000002";

function cerveja(
  id: string,
  nome: string,
  sku: number,
  tenantId = TENANT_A,
): ItemCatalogo {
  return { fonte: "CERVEJA", id, tenantId, arbrainId: `arb-${id}`, sku, nome };
}

// Espelha o catálogo real do tenant lrc (cervejas).
const C_IPA = cerveja("c-1", "IPA", 8);
const C_IPA_CINE = cerveja("c-2", "IPA Cine Rock", 26);
const C_PILSEN_HOFF = cerveja("c-3", "Pilsen Hoffnung", 1);
const C_PILSEN_VERDE = cerveja("c-4", "Pilsen Verde", 24);
const C_APA = cerveja("c-5", "APA", 5);
const CATALOGO_CERVEJAS: ItemCatalogo[] = [
  C_IPA,
  C_IPA_CINE,
  C_PILSEN_HOFF,
  C_PILSEN_VERDE,
  C_APA,
];

function repo(cervejas: ItemCatalogo[]): CatalogoRepository {
  return criarCatalogoRepositoryEmMemoria({ produtos: [], cervejas, aliases: [] });
}

describe("resolverCerveja — fonte CERVEJA", () => {
  it("nome exato único → RESOLVIDO / NOME_EXATO / CERVEJA", async () => {
    const r = await resolverCerveja(
      { tenantId: TENANT_A, produtoMencionado: "  PILSEN   hoffnung " },
      { repository: repo(CATALOGO_CERVEJAS) },
    );
    expect(r.status).toBe("RESOLVIDO");
    expect(r.origemResolucao).toBe("NOME_EXATO");
    expect(r.fonteCatalogo).toBe("CERVEJA");
    expect(r.item?.id).toBe(C_PILSEN_HOFF.id);
    expect(r.item?.fonteCatalogo).toBe("CERVEJA");
    expect(r.item?.arbrainId).toBe(`arb-${C_PILSEN_HOFF.id}`);
  });

  it("nome exato de estilo curto ('IPA') resolve a cerveja homônima", async () => {
    const r = await resolverCerveja(
      { tenantId: TENANT_A, produtoMencionado: "ipa" },
      { repository: repo(CATALOGO_CERVEJAS) },
    );
    expect(r.status).toBe("RESOLVIDO");
    expect(r.origemResolucao).toBe("NOME_EXATO");
    expect(r.item?.id).toBe(C_IPA.id);
  });

  it("termo genérico sem homônimo ('pilsen', 2 cervejas) → AMBIGUO / TOKENS", async () => {
    const r = await resolverCerveja(
      { tenantId: TENANT_A, produtoMencionado: "pilsen" },
      { repository: repo(CATALOGO_CERVEJAS) },
    );
    expect(r.status).toBe("AMBIGUO");
    expect(r.origemResolucao).toBe("TOKENS");
    expect(r.candidatos.map((c) => c.item.id).sort()).toEqual(
      [C_PILSEN_HOFF.id, C_PILSEN_VERDE.id].sort(),
    );
    expect(r.candidatos.every((c) => c.item.fonteCatalogo === "CERVEJA")).toBe(true);
  });

  it("fuzzy único acima do limiar → RESOLVIDO / FUZZY", async () => {
    const r = await resolverCerveja(
      { tenantId: TENANT_A, produtoMencionado: "pilsen hofnnung" },
      { repository: repo(CATALOGO_CERVEJAS) },
    );
    expect(r.status).toBe("RESOLVIDO");
    expect(r.origemResolucao).toBe("FUZZY");
    expect(r.item?.id).toBe(C_PILSEN_HOFF.id);
    expect(r.score).not.toBeNull();
    expect(r.score!).toBeGreaterThanOrEqual(0.6);
  });

  it("sem correspondência → SEM_CORRESPONDENCIA", async () => {
    const r = await resolverCerveja(
      { tenantId: TENANT_A, produtoMencionado: "cachaca premium 750 ml" },
      { repository: repo(CATALOGO_CERVEJAS) },
    );
    expect(r.status).toBe("SEM_CORRESPONDENCIA");
    expect(r.fonteCatalogo).toBeNull();
  });

  it("catálogo de cervejas vazio → SEM_CORRESPONDENCIA + CATALOGO_VAZIO", async () => {
    const r = await resolverCerveja(
      { tenantId: TENANT_A, produtoMencionado: "ipa" },
      { repository: repo([]) },
    );
    expect(r.status).toBe("SEM_CORRESPONDENCIA");
    expect(r.sinais).toContain("CATALOGO_VAZIO");
  });

  it("cerveja de outro tenant nunca aparece (repo com vazamento)", async () => {
    const foraDoTenant = cerveja("c-b1", "Cerveja Secreta Do B", 99, TENANT_B);
    const repoVazado: CatalogoRepository = {
      async listarProdutosDoTenant() {
        return [];
      },
      async listarCervejasDoTenant() {
        return [...CATALOGO_CERVEJAS, foraDoTenant];
      },
      async listarAliasesDoTenant() {
        return [];
      },
    };
    const r = await resolverCerveja(
      { tenantId: TENANT_A, produtoMencionado: "Cerveja Secreta Do B" },
      { repository: repoVazado },
    );
    expect(r.status).toBe("SEM_CORRESPONDENCIA");
    expect(r.sinais).toContain("CERVEJA_CROSS_TENANT_IGNORADO");
  });

  it("entrada vazia → SEM_CORRESPONDENCIA + ENTRADA_VAZIA", async () => {
    const r = await resolverCerveja(
      { tenantId: TENANT_A, produtoMencionado: "   " },
      { repository: repo(CATALOGO_CERVEJAS) },
    );
    expect(r.status).toBe("SEM_CORRESPONDENCIA");
    expect(r.sinais).toContain("ENTRADA_VAZIA");
  });

  it("determinístico com ordem de catálogo invertida", async () => {
    const entrada = { tenantId: TENANT_A, produtoMencionado: "pilsen" } as const;
    const r1 = await resolverCerveja(entrada, { repository: repo(CATALOGO_CERVEJAS) });
    const r2 = await resolverCerveja(entrada, {
      repository: repo([...CATALOGO_CERVEJAS].reverse()),
    });
    expect(r2).toEqual(r1);
  });
});
