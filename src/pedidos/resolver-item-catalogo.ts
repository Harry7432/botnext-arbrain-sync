// Orquestrador de resolução de item de catálogo (Etapa 2.8).
//
// Resolve um "item comercial" contra as DUAS fontes locais — PRODUTO e CERVEJA —
// espelhando o polimorfismo da linha de pedido do ArBrain (idProduto XOR
// idCerveja). Reaproveita `resolverProduto` / `resolverCerveja` (mesmo núcleo,
// mesmos parâmetros) e aplica precedência determinística entre fontes.
//
// Não resolve idEmbalagem/idUnidade/tipo/valorUnitario — fora de escopo.

import { normalizarTexto } from "./normalizacao.js";
import {
  NIVEL_STATUS,
  RANK_ORIGEM,
  compararItensResolvidos,
  fonteComumDosCandidatos,
} from "./resolver-nucleo.js";
import { resolverProduto, type DependenciasResolucao } from "./resolver-produto.js";
import { resolverCerveja } from "./resolver-cerveja.js";
import type {
  CandidatoResolucao,
  EntradaResolucao,
  OrigemResolucao,
  ResultadoResolucao,
  SinalAuditoria,
} from "./tipos.js";

/** União de sinais preservando ordem; ignora CATALOGO_VAZIO da outra fonte. */
function mesclarSinaisDaOutraFonte(
  base: SinalAuditoria[],
  outros: SinalAuditoria[],
): SinalAuditoria[] {
  const resultado = [...base];
  for (const sinal of outros) {
    if (sinal === "CATALOGO_VAZIO") continue;
    if (!resultado.includes(sinal)) resultado.push(sinal);
  }
  return resultado;
}

function origemDeMaiorRank(
  a: OrigemResolucao,
  b: OrigemResolucao,
): OrigemResolucao {
  return RANK_ORIGEM[a] >= RANK_ORIGEM[b] ? a : b;
}

function candidatosDeLado(res: ResultadoResolucao): CandidatoResolucao[] {
  if (res.status === "RESOLVIDO" && res.item) {
    return [{ item: res.item, score: res.score }];
  }
  return res.candidatos;
}

/**
 * Vencedor claro entre dois resultados que CONTRIBUEM (≠ SEM_CORRESPONDENCIA):
 *  - RESOLVIDO x RESOLVIDO → vence rank de origem ESTRITAMENTE maior; empate → null;
 *  - RESOLVIDO x AMBIGUO   → o RESOLVIDO vence só se rank(RESOLVIDO) >= rank(AMBIGUO);
 *  - AMBIGUO x AMBIGUO     → null.
 */
function vencedorClaro(
  a: ResultadoResolucao,
  b: ResultadoResolucao,
): ResultadoResolucao | null {
  const na = NIVEL_STATUS[a.status];
  const nb = NIVEL_STATUS[b.status];
  const ra = RANK_ORIGEM[a.origemResolucao];
  const rb = RANK_ORIGEM[b.origemResolucao];

  if (a.status === "RESOLVIDO" && b.status === "RESOLVIDO") {
    if (ra > rb) return a;
    if (rb > ra) return b;
    return null;
  }
  if (na > nb) {
    // a é RESOLVIDO, b é AMBIGUO
    return ra >= rb ? a : null;
  }
  if (nb > na) {
    return rb >= ra ? b : null;
  }
  return null; // ambos AMBIGUO
}

export async function resolverItemCatalogo(
  entrada: EntradaResolucao,
  deps: DependenciasResolucao,
): Promise<ResultadoResolucao> {
  const consulta = normalizarTexto(entrada.produtoMencionado);
  if (consulta === "") {
    return {
      status: "SEM_CORRESPONDENCIA",
      origemResolucao: "SEM_CORRESPONDENCIA",
      fonteCatalogo: null,
      item: null,
      candidatos: [],
      score: null,
      motivo: "produtoMencionado vazio após normalização",
      sinais: ["ENTRADA_VAZIA"],
    };
  }

  // --- Com hint: consulta APENAS a fonte esperada ---
  if (entrada.fonteEsperada === "PRODUTO") {
    return resolverProduto(entrada, deps);
  }
  if (entrada.fonteEsperada === "CERVEJA") {
    return resolverCerveja(entrada, deps);
  }

  // --- Sem hint: resolve as duas fontes e combina ---
  const [p, c] = await Promise.all([
    resolverProduto(entrada, deps),
    resolverCerveja(entrada, deps),
  ]);

  const pContribui = p.status !== "SEM_CORRESPONDENCIA";
  const cContribui = c.status !== "SEM_CORRESPONDENCIA";

  // Nenhuma fonte casou.
  if (!pContribui && !cContribui) {
    return {
      status: "SEM_CORRESPONDENCIA",
      origemResolucao: "SEM_CORRESPONDENCIA",
      fonteCatalogo: null,
      item: null,
      candidatos: [],
      score: null,
      motivo: `nenhuma fonte casou — produto: ${p.motivo}; cerveja: ${c.motivo}`,
      sinais: mesclarSinaisDaOutraFonte(p.sinais, c.sinais),
    };
  }

  // Exatamente uma fonte casou → retorna essa.
  if (pContribui !== cContribui) {
    const vencedor = pContribui ? p : c;
    const perdedor = pContribui ? c : p;
    const sinais = mesclarSinaisDaOutraFonte(vencedor.sinais, perdedor.sinais);
    if (vencedor.status === "RESOLVIDO" && !sinais.includes("SEM_CONTEXTO_DE_FONTE")) {
      sinais.push("SEM_CONTEXTO_DE_FONTE");
    }
    return { ...vencedor, sinais };
  }

  // Ambas contribuem → precedência.
  const vencedor = vencedorClaro(p, c);
  if (vencedor) {
    const perdedor = vencedor === p ? c : p;
    return {
      ...vencedor,
      sinais: mesclarSinaisDaOutraFonte(vencedor.sinais, perdedor.sinais),
      motivo: `${vencedor.fonteCatalogo} venceu (${vencedor.status}/${vencedor.origemResolucao}) sobre ${perdedor.fonteCatalogo ?? "?"} (${perdedor.status}/${perdedor.origemResolucao}): ${vencedor.motivo}`,
    };
  }

  // Sem vencedor claro → AMBIGUO entre fontes.
  const candidatos = [...candidatosDeLado(p), ...candidatosDeLado(c)].sort(
    (x, y) => {
      const cmp = compararItensResolvidos(x.item, y.item);
      if (cmp !== 0) return cmp;
      return (y.score ?? -1) - (x.score ?? -1);
    },
  );
  const origem = origemDeMaiorRank(p.origemResolucao, c.origemResolucao);
  const sinais = mesclarSinaisDaOutraFonte(p.sinais, c.sinais);
  if (!sinais.includes("AMBIGUIDADE_ENTRE_FONTES")) {
    sinais.push("AMBIGUIDADE_ENTRE_FONTES");
  }

  return {
    status: "AMBIGUO",
    origemResolucao: origem,
    fonteCatalogo: fonteComumDosCandidatos(candidatos),
    item: null,
    candidatos,
    score: null,
    motivo: `ambiguidade entre fontes — produto: ${p.status}/${p.origemResolucao} (${p.candidatos.length || (p.item ? 1 : 0)}); cerveja: ${c.status}/${c.origemResolucao} (${c.candidatos.length || (c.item ? 1 : 0)})`,
    sinais,
  };
}
