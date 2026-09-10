// Camada de acesso ao catálogo local do tenant.
//
// A interface CatalogoRepository (em ./tipos) é a fronteira injetável: os
// resolvedores dependem só dela. Aqui fica a fábrica em memória a partir de
// listas já carregadas — útil para testes e para quem já tem o catálogo em
// mãos. A implementação com PostgreSQL/Prisma fica em ./catalogo-repository-prisma
// para manter este módulo livre de Prisma.

import type {
  AliasCatalogo,
  CatalogoRepository,
  ItemCatalogo,
} from "./tipos.js";

export interface CatalogoEmMemoria {
  produtos: ItemCatalogo[];
  cervejas: ItemCatalogo[];
  aliases: AliasCatalogo[];
}

/**
 * Repositório em memória. Filtra rigidamente por tenantId — nunca devolve
 * linha de outro tenant, mesmo que a lista de origem contenha.
 */
export function criarCatalogoRepositoryEmMemoria(
  dados: CatalogoEmMemoria,
): CatalogoRepository {
  return {
    async listarProdutosDoTenant(
      tenantId: string,
    ): Promise<ItemCatalogo[]> {
      return dados.produtos.filter((p) => p.tenantId === tenantId);
    },

    async listarCervejasDoTenant(
      tenantId: string,
    ): Promise<ItemCatalogo[]> {
      return dados.cervejas.filter((c) => c.tenantId === tenantId);
    },

    async listarAliasesDoTenant(
      tenantId: string,
    ): Promise<AliasCatalogo[]> {
      return dados.aliases.filter((a) => a.tenantId === tenantId);
    },
  };
}
