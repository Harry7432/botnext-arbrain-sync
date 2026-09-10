// Serviço de construção e persistência do rascunho de pedido (Etapa 3.0).
//
// Transforma uma BotnextPedidoExtracao concluída (status EXTRAIDO com itens)
// em um BotnextPedidoRascunho persistido, resolvendo cada item via
// resolverItemCatalogo SEM fonteEsperada. Standalone — não é ligado ao
// processor nesta etapa. Não chama OpenAI, ArBrain, BotNext, n8n nem
// POST /v1/Pedidos.
//
// Idempotência: FK unique (tenantId, extracaoId) — consulta antes de criar e,
// em corrida P2002, devolve o vencedor.

import {
  BotnextPedidoRascunhoStatus,
} from "@prisma/client";

import { prisma } from "../../database/prisma.js";

import {
  criarCatalogoRepositoryEmMemoria,
} from "../../pedidos/catalogo-repository.js";
import {
  resolverItemCatalogo,
} from "../../pedidos/resolver-item-catalogo.js";
import {
  construirRascunho,
  type ResolveItemRascunho,
} from "../../pedidos/rascunho/construir-rascunho.js";
import type {
  ConteudoRascunhoPersistido,
  RascunhoConstruido,
} from "../../pedidos/rascunho/tipos.js";
import type {
  CatalogoRepository,
} from "../../pedidos/tipos.js";
import type {
  StatusExtracao,
} from "../../pedidos/extracao/tipos.js";

import {
  lerResultadoPersistido,
} from "./botnext-pedido-extracao-persistence.js";
import {
  CAMPOS_RASCUNHO_SELECIONADOS,
  paraRascunhoPersistido,
  salvarRascunhoPedido,
  type LinhaRascunhoPersistidoSelecionado,
} from "./botnext-pedido-rascunho-persistence.js";

export interface ConstruirRascunhoPedidoParams {
  tenantId: string;
  extracaoId: string;
}

export type ResultadoConstrucaoRascunho =
  | {
      situacao: "RASCUNHO_CRIADO" | "JA_CRIADO";
      rascunhoId: string;
      status: BotnextPedidoRascunhoStatus;
      conteudo: ConteudoRascunhoPersistido;
      totalItens: number;
      itensResolvidos: number;
      itensNaoResolvidos: number;
      observacoes: string | null;
    }
  | {
      situacao: "SEM_RASCUNHO";
      extracaoId: string;
      statusExtracao: StatusExtracao;
      motivo: string;
    };

export type ServicoConstrucaoRascunho = (
  params: ConstruirRascunhoPedidoParams,
) => Promise<ResultadoConstrucaoRascunho>;

export interface DependenciasConstrucaoRascunho {
  /** Catálogo local do tenant (produtos/cervejas/aliases). Nunca ArBrain. */
  catalogo: CatalogoRepository;
}

async function lerLinhaRascunho(
  tenantId: string,
  extracaoId: string,
): Promise<LinhaRascunhoPersistidoSelecionado | null> {
  return prisma.botnextPedidoRascunho.findUnique({
    where: {
      tenantId_extracaoId: { tenantId, extracaoId },
    },
    select: CAMPOS_RASCUNHO_SELECIONADOS,
  });
}

export function criarServicoConstrucaoRascunho(
  deps: DependenciasConstrucaoRascunho,
): ServicoConstrucaoRascunho {
  return (params: ConstruirRascunhoPedidoParams) => executar(deps, params);
}

async function executar(
  deps: DependenciasConstrucaoRascunho,
  params: ConstruirRascunhoPedidoParams,
): Promise<ResultadoConstrucaoRascunho> {
  const tenantId = params.tenantId.trim();
  const extracaoId = params.extracaoId.trim();

  if (!tenantId || !extracaoId) {
    throw new Error("Tenant e extração são obrigatórios.");
  }

  // 1. Idempotência: consulta o banco ANTES de qualquer resolução.
  const existente = await lerLinhaRascunho(tenantId, extracaoId);
  if (existente) {
    const rascunho = paraRascunhoPersistido(existente);
    return {
      situacao: "JA_CRIADO",
      rascunhoId: rascunho.id,
      status: rascunho.status,
      conteudo: rascunho.conteudo,
      totalItens: rascunho.totalItens,
      itensResolvidos: rascunho.itensResolvidos,
      itensNaoResolvidos: rascunho.itensNaoResolvidos,
      observacoes: rascunho.observacoes,
    };
  }

  // 2. Lê a extração concluída do tenant.
  const extracao = await prisma.botnextPedidoExtracao.findUnique({
    where: {
      tenantId_id: { tenantId, id: extracaoId },
    },
    select: { id: true, itensExtraidos: true },
  });

  if (!extracao) {
    throw new Error("Extração não encontrada no tenant informado.");
  }

  const resultado = lerResultadoPersistido(extracao.itensExtraidos);

  // 3. Gate: somente EXTRAIDO com itens pode gerar rascunho.
  if (resultado.status !== "EXTRAIDO" || resultado.itens.length === 0) {
    return {
      situacao: "SEM_RASCUNHO",
      extracaoId,
      statusExtracao: resultado.status,
      motivo: motivoSemRascunho(resultado.status),
    };
  }

  // 4. Carrega o catálogo ONE vez para o rascunho inteiro (evita 3N consultas).
  const [produtos, cervejas, aliases] = await Promise.all([
    deps.catalogo.listarProdutosDoTenant(tenantId),
    deps.catalogo.listarCervejasDoTenant(tenantId),
    deps.catalogo.listarAliasesDoTenant(tenantId),
  ]);
  const repositorio = criarCatalogoRepositoryEmMemoria({
    produtos,
    cervejas,
    aliases,
  });

  const resolveItem: ResolveItemRascunho = (entrada) =>
    resolverItemCatalogo(
      {
        tenantId,
        produtoMencionado: entrada.produtoMencionado,
        unidadeMencionada: entrada.unidadeMencionada,
        embalagemMencionada: entrada.embalagemMencionada,
        // fonteEsperada NÃO é informado nesta etapa.
      },
      { repository: repositorio },
    );

  // 5. Constrói o rascunho (puro) e persiste.
  const construido: RascunhoConstruido = await construirRascunho(
    resultado,
    resolveItem,
  );

  const persistido = await salvarRascunhoPedido({
    tenantId,
    extracaoId,
    construido,
    observacoes: resultado.observacaoPedido,
  });

  return {
    situacao: persistido.criado ? "RASCUNHO_CRIADO" : "JA_CRIADO",
    rascunhoId: persistido.rascunho.id,
    status: persistido.rascunho.status,
    conteudo: persistido.rascunho.conteudo,
    totalItens: persistido.rascunho.totalItens,
    itensResolvidos: persistido.rascunho.itensResolvidos,
    itensNaoResolvidos: persistido.rascunho.itensNaoResolvidos,
    observacoes: persistido.rascunho.observacoes,
  };
}

function motivoSemRascunho(status: StatusExtracao): string {
  switch (status) {
    case "SEM_ITENS":
      return "Extração sem itens — não há pedido a gerar.";
    case "REFERENCIA_SEM_CONTEUDO":
      return "Extração é apenas referência a pedido anterior, sem conteúdo resolvível.";
    case "DESISTENCIA":
      return "Cliente desistiu do pedido.";
    case "FALHA_IA":
      return "Extração falhou — sem itens para gerar rascunho.";
    case "EXTRAIDO":
      return "Extração EXTRAIDO sem itens (inconsistente com o gate).";
  }
}