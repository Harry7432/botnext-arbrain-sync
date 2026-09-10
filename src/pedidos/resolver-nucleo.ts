// Núcleo do resolvedor de catálogo (Etapa 2.8).
//
// Pipeline puro e determinístico, AGNÓSTICO DE FONTE: recebe itens + aliases já
// filtrados por tenant (todos da mesma fonte) e resolve o texto na ordem
// ALIAS_DIRETO → NOME_EXATO → TOKENS → FUZZY. Nunca lê repositório, nunca chama
// serviço externo, nunca inventa item/SKU/embalagem/código e nunca escolhe
// arbitrariamente entre múltiplos candidatos (→ AMBIGUO).
//
// Normalização, Sørensen–Dice e os parâmetros limiarFuzzy=0.60 /
// margemAmbiguidadeFuzzy=0.05 permanecem inalterados desde a Etapa 2.

import { conjuntoDeTokens, normalizarTexto } from "./normalizacao.js";
import { coeficienteDice } from "./similaridade.js";
import type {
  AliasCatalogo,
  CandidatoResolucao,
  ConfigResolucao,
  FonteCatalogo,
  ItemCatalogo,
  ItemCatalogoResolvido,
  OrigemResolucao,
  ResultadoResolucao,
  SinalAuditoria,
} from "./tipos.js";

export interface ParamsResolucaoFonte {
  /** Itens já filtrados por tenant, todos da fonte `fonte`. */
  itens: ItemCatalogo[];
  /** Aliases já filtrados por tenant (vazio para CERVEJA nesta etapa). */
  aliases: AliasCatalogo[];
  fonte: FonteCatalogo;
  /** Texto já normalizado e garantido não-vazio. */
  consultaNormalizada: string;
  config: ConfigResolucao;
  /** Sinais herdados do carregamento (ex.: *_CROSS_TENANT_IGNORADO). */
  sinaisIniciais: SinalAuditoria[];
}

/** Rank das origens para a precedência (entre estágios e entre fontes). */
export const RANK_ORIGEM: Record<OrigemResolucao, number> = {
  ALIAS_DIRETO: 4,
  NOME_EXATO: 3,
  TOKENS: 2,
  FUZZY: 1,
  SEM_CORRESPONDENCIA: 0,
};

/** Nível do status para a precedência entre fontes. */
export const NIVEL_STATUS = {
  RESOLVIDO: 2,
  AMBIGUO: 1,
  SEM_CORRESPONDENCIA: 0,
} as const;

export function paraItemResolvido(item: ItemCatalogo): ItemCatalogoResolvido {
  return {
    fonteCatalogo: item.fonte,
    id: item.id,
    tenantId: item.tenantId,
    arbrainId: item.arbrainId,
    sku: item.sku,
    nome: item.nome,
  };
}

/** Ordenação total determinística usada em toda saída com múltiplos itens. */
export function compararItens(a: ItemCatalogo, b: ItemCatalogo): number {
  if (a.fonte !== b.fonte) return a.fonte < b.fonte ? -1 : 1;
  const nomeA = normalizarTexto(a.nome);
  const nomeB = normalizarTexto(b.nome);
  if (nomeA !== nomeB) return nomeA < nomeB ? -1 : 1;
  if (a.sku !== b.sku) return a.sku - b.sku;
  if (a.id !== b.id) return a.id < b.id ? -1 : 1;
  return 0;
}

/** Mesma ordenação, mas sobre itens já resolvidos (usada entre fontes). */
export function compararItensResolvidos(
  a: ItemCatalogoResolvido,
  b: ItemCatalogoResolvido,
): number {
  if (a.fonteCatalogo !== b.fonteCatalogo) {
    return a.fonteCatalogo < b.fonteCatalogo ? -1 : 1;
  }
  const nomeA = normalizarTexto(a.nome);
  const nomeB = normalizarTexto(b.nome);
  if (nomeA !== nomeB) return nomeA < nomeB ? -1 : 1;
  if (a.sku !== b.sku) return a.sku - b.sku;
  if (a.id !== b.id) return a.id < b.id ? -1 : 1;
  return 0;
}

/** `fonteCatalogo` de topo: a fonte comum dos candidatos, ou null se misturam. */
export function fonteComumDosCandidatos(
  candidatos: CandidatoResolucao[],
): FonteCatalogo | null {
  const fontes = new Set(candidatos.map((c) => c.item.fonteCatalogo));
  return fontes.size === 1 ? [...fontes][0]! : null;
}

function resolvido(
  item: ItemCatalogo,
  origem: OrigemResolucao,
  score: number | null,
  motivo: string,
  sinais: SinalAuditoria[],
): ResultadoResolucao {
  return {
    status: "RESOLVIDO",
    origemResolucao: origem,
    fonteCatalogo: item.fonte,
    item: paraItemResolvido(item),
    candidatos: [],
    score,
    motivo,
    sinais,
  };
}

function ambiguo(
  candidatos: CandidatoResolucao[],
  origem: OrigemResolucao,
  motivo: string,
  sinais: SinalAuditoria[],
): ResultadoResolucao {
  return {
    status: "AMBIGUO",
    origemResolucao: origem,
    fonteCatalogo: fonteComumDosCandidatos(candidatos),
    item: null,
    candidatos,
    score: null,
    motivo,
    sinais,
  };
}

export function semCorrespondencia(
  motivo: string,
  sinais: SinalAuditoria[],
): ResultadoResolucao {
  return {
    status: "SEM_CORRESPONDENCIA",
    origemResolucao: "SEM_CORRESPONDENCIA",
    fonteCatalogo: null,
    item: null,
    candidatos: [],
    score: null,
    motivo,
    sinais,
  };
}

function candidatosSemScore(itens: ItemCatalogo[]): CandidatoResolucao[] {
  return [...itens]
    .sort(compararItens)
    .map((item) => ({ item: paraItemResolvido(item), score: null }));
}

export function resolverContraFonte(
  params: ParamsResolucaoFonte,
): ResultadoResolucao {
  const { itens, aliases, consultaNormalizada, config } = params;
  const sinais = [...params.sinaisIniciais];

  if (itens.length === 0) {
    return semCorrespondencia(
      `catálogo do tenant sem itens da fonte ${params.fonte}`,
      [...sinais, "CATALOGO_VAZIO"],
    );
  }

  const itensPorId = new Map(itens.map((i) => [i.id, i] as const));

  // ---------------------------------------------------------------- ALIAS_DIRETO
  const aliasesDoTexto = aliases.filter(
    (alias) => alias.aliasNormalizado === consultaNormalizada,
  );
  if (aliasesDoTexto.length > 0) {
    const ativos = aliasesDoTexto.filter((alias) => alias.ativo);

    if (ativos.length === 0) {
      sinais.push("ALIAS_INATIVO_IGNORADO");
    } else {
      const idsAlvo = [...new Set(ativos.map((alias) => alias.produtoId))];

      const idInvalido = idsAlvo.find((id) => !itensPorId.has(id));
      if (idInvalido !== undefined) {
        return semCorrespondencia(
          `alias "${consultaNormalizada}" ativo aponta para id inexistente/inválido no tenant (${idInvalido})`,
          [...sinais, "ALIAS_PRODUTO_INVALIDO"],
        );
      }

      if (idsAlvo.length === 1) {
        const item = itensPorId.get(idsAlvo[0]!)!;
        return resolvido(
          item,
          "ALIAS_DIRETO",
          null,
          `alias ativo exato "${consultaNormalizada}" → ${params.fonte} ${item.id}`,
          sinais,
        );
      }

      const alvo = idsAlvo
        .map((id) => itensPorId.get(id)!)
        .sort(compararItens);
      return ambiguo(
        candidatosSemScore(alvo),
        "ALIAS_DIRETO",
        `texto "${consultaNormalizada}" tem ${idsAlvo.length} aliases ativos para itens distintos`,
        sinais,
      );
    }
  }

  // ------------------------------------------------------------------ NOME_EXATO
  const nomeExato = itens.filter(
    (item) => normalizarTexto(item.nome) === consultaNormalizada,
  );
  if (nomeExato.length === 1) {
    return resolvido(
      nomeExato[0]!,
      "NOME_EXATO",
      null,
      `nome normalizado idêntico a "${consultaNormalizada}"`,
      sinais,
    );
  }
  if (nomeExato.length >= 2) {
    return ambiguo(
      candidatosSemScore(nomeExato),
      "NOME_EXATO",
      `${nomeExato.length} itens ${params.fonte} com nome normalizado "${consultaNormalizada}"`,
      sinais,
    );
  }

  // ---------------------------------------------------------------------- TOKENS
  const tokensConsulta = conjuntoDeTokens(consultaNormalizada);
  const porTokens = itens.filter((item) => {
    const tokensItem = conjuntoDeTokens(item.nome);
    for (const token of tokensConsulta) {
      if (!tokensItem.has(token)) return false;
    }
    return true;
  });
  if (porTokens.length === 1) {
    return resolvido(
      porTokens[0]!,
      "TOKENS",
      null,
      `todos os ${tokensConsulta.size} tokens da consulta presentes em um único item ${params.fonte}`,
      sinais,
    );
  }
  if (porTokens.length >= 2) {
    return ambiguo(
      candidatosSemScore(porTokens),
      "TOKENS",
      `${porTokens.length} itens ${params.fonte} contêm todos os tokens {${[...tokensConsulta].join(", ")}}`,
      sinais,
    );
  }

  // ----------------------------------------------------------------------- FUZZY
  const pontuados = itens
    .map((item) => ({
      item,
      score: coeficienteDice(consultaNormalizada, normalizarTexto(item.nome)),
    }))
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      return compararItens(a.item, b.item);
    });

  const acimaDoLimiar = pontuados.filter(
    (p) => p.score >= config.limiarFuzzy,
  );
  const melhorScore = pontuados[0]?.score ?? 0;

  if (acimaDoLimiar.length === 0) {
    return semCorrespondencia(
      `melhor score fuzzy ${melhorScore.toFixed(3)} < limiar ${config.limiarFuzzy} (fonte ${params.fonte})`,
      sinais,
    );
  }

  const topo = acimaDoLimiar[0]!;
  const empatados = acimaDoLimiar.filter(
    (p) => topo.score - p.score < config.margemAmbiguidadeFuzzy,
  );

  if (empatados.length >= 2) {
    return ambiguo(
      empatados.map((p) => ({
        item: paraItemResolvido(p.item),
        score: p.score,
      })),
      "FUZZY",
      `${empatados.length} itens ${params.fonte} dentro da margem ${config.margemAmbiguidadeFuzzy} do topo (score ${topo.score.toFixed(3)})`,
      sinais,
    );
  }

  const segundo = acimaDoLimiar[1];
  const motivoFuzzy =
    segundo === undefined
      ? `score fuzzy ${topo.score.toFixed(3)} >= limiar ${config.limiarFuzzy}, único acima do limiar (fonte ${params.fonte})`
      : `score fuzzy ${topo.score.toFixed(3)} >= limiar ${config.limiarFuzzy}, 2º melhor ${segundo.score.toFixed(3)} (dist. ${(topo.score - segundo.score).toFixed(3)} >= margem ${config.margemAmbiguidadeFuzzy})`;

  return resolvido(topo.item, "FUZZY", topo.score, motivoFuzzy, sinais);
}
