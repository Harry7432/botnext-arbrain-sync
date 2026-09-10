// Resolvedor de catálogo — fonte CERVEJA (Etapa 2.8).
//
// Carrega `cervejas` do tenant através do CatalogoRepository injetado e delega
// ao núcleo (resolver-nucleo). Mesmos estágios e parâmetros da fonte PRODUTO.
// Nesta etapa NÃO há alias de cerveja: o estágio ALIAS_DIRETO recebe `[]` e
// nunca dispara (ver README / plano da Etapa 2.8, secção 9).

import { normalizarTexto } from "./normalizacao.js";
import { resolverContraFonte, semCorrespondencia } from "./resolver-nucleo.js";
import {
  CONFIG_RESOLUCAO_PADRAO,
  type ConfigResolucao,
  type EntradaResolucao,
  type ResultadoResolucao,
  type SinalAuditoria,
} from "./tipos.js";
import type { DependenciasResolucao } from "./resolver-produto.js";

export async function resolverCerveja(
  entrada: EntradaResolucao,
  deps: DependenciasResolucao,
): Promise<ResultadoResolucao> {
  const config: ConfigResolucao = {
    ...CONFIG_RESOLUCAO_PADRAO,
    ...(deps.config ?? {}),
  };

  const consulta = normalizarTexto(entrada.produtoMencionado);
  if (consulta === "") {
    return semCorrespondencia("produtoMencionado vazio após normalização", [
      "ENTRADA_VAZIA",
    ]);
  }

  const cervejasBrutas = await deps.repository.listarCervejasDoTenant(
    entrada.tenantId,
  );

  const sinais: SinalAuditoria[] = [];

  const cervejas = cervejasBrutas.filter(
    (c) => c.tenantId === entrada.tenantId,
  );
  if (cervejas.length !== cervejasBrutas.length) {
    sinais.push("CERVEJA_CROSS_TENANT_IGNORADO");
  }

  return resolverContraFonte({
    itens: cervejas,
    aliases: [],
    fonte: "CERVEJA",
    consultaNormalizada: consulta,
    config,
    sinaisIniciais: sinais,
  });
}
