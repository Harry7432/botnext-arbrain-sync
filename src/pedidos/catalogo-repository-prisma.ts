// Implementação de CatalogoRepository sobre o PostgreSQL local (Prisma).
//
// Isolada neste módulo para que os resolvedores e seus testes não dependam de
// Prisma. Carrega apenas o catálogo do tenant informado — nunca consulta
// ArBrain, nunca escreve. `orderBy` fixo → ordem estável.

import type { PrismaClient } from "@prisma/client";

import type {
  AliasCatalogo,
  CatalogoRepository,
  ItemCatalogo,
} from "./tipos.js";

/**
 * Subconjunto do PrismaClient de que precisamos — mantém a fábrica testável
 * com um duble e evita acoplar a assinatura ao client inteiro.
 */
export type PrismaCatalogo = Pick<
  PrismaClient,
  "produto" | "cerveja" | "produtoAlias"
>;

export function criarCatalogoRepositoryPrisma(
  prisma: PrismaCatalogo,
): CatalogoRepository {
  return {
    async listarProdutosDoTenant(
      tenantId: string,
    ): Promise<ItemCatalogo[]> {
      const produtos = await prisma.produto.findMany({
        where: { tenantId },
        select: { id: true, tenantId: true, arbrainId: true, sku: true, nome: true },
        orderBy: [{ nome: "asc" }, { sku: "asc" }, { id: "asc" }],
      });

      return produtos.map((p) => ({ fonte: "PRODUTO" as const, ...p }));
    },

    async listarCervejasDoTenant(
      tenantId: string,
    ): Promise<ItemCatalogo[]> {
      const cervejas = await prisma.cerveja.findMany({
        where: { tenantId },
        select: { id: true, tenantId: true, arbrainId: true, sku: true, nome: true },
        orderBy: [{ nome: "asc" }, { sku: "asc" }, { id: "asc" }],
      });

      return cervejas.map((c) => ({ fonte: "CERVEJA" as const, ...c }));
    },

    async listarAliasesDoTenant(
      tenantId: string,
    ): Promise<AliasCatalogo[]> {
      const aliases = await prisma.produtoAlias.findMany({
        where: { tenantId },
        select: {
          id: true,
          tenantId: true,
          produtoId: true,
          alias: true,
          aliasNormalizado: true,
          ativo: true,
        },
        orderBy: [{ aliasNormalizado: "asc" }, { id: "asc" }],
      });

      return aliases;
    },
  };
}
