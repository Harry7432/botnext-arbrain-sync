// Resolvedor de catálogo — fonte PRODUTO (Etapa 2 / 2.8).
//
// Carrega `produtos` + `produto_aliases` do tenant através do CatalogoRepository
// injetado e delega ao núcleo (resolver-nucleo). Mantém exatamente o
// comportamento da Etapa 2; a saída agora carrega `fonteCatalogo: "PRODUTO"` e
// `item.arbrainId`.

import { normalizarTexto } from "./normalizacao.js";
import { resolverContraFonte, semCorrespondencia } from "./resolver-nucleo.js";
import {
  CONFIG_RESOLUCAO_PADRAO,
  type ConfigResolucao,
  type CatalogoRepository,
  type EntradaResolucao,
  type ResultadoResolucao,
  type SinalAuditoria,
} from "./tipos.js";

export interface DependenciasResolucao {
  repository: CatalogoRepository;
  config?: Partial<ConfigResolucao>;
}

export async function resolverProduto(
  entrada: EntradaResolucao,
  deps: DependenciasResolucao,
): Promise<ResultadoResolucao> {
  const config: ConfigResolucao = {
    ...CONFIG_RESOLUCAO_PADRAO,
    ...(deps.config ?? {}),
  };

  // APENAS produtoMencionado resolve o item. unidadeMencionada e
  // embalagemMencionada seguem preservadas na entrada mas FORA do ranking.
  const consulta = normalizarTexto(entrada.produtoMencionado);
  if (consulta === "") {
    return semCorrespondencia("produtoMencionado vazio após normalização", [
      "ENTRADA_VAZIA",
    ]);
  }

  const [produtosBrutos, aliasesBrutos] = await Promise.all([
    deps.repository.listarProdutosDoTenant(entrada.tenantId),
    deps.repository.listarAliasesDoTenant(entrada.tenantId),
  ]);

  const sinais: SinalAuditoria[] = [];

  // Defesa em profundidade: descarta qualquer linha de outro tenant.
  const produtos = produtosBrutos.filter(
    (p) => p.tenantId === entrada.tenantId,
  );
  if (produtos.length !== produtosBrutos.length) {
    sinais.push("PRODUTO_CROSS_TENANT_IGNORADO");
  }

  const aliases = aliasesBrutos.filter(
    (a) => a.tenantId === entrada.tenantId,
  );
  if (aliases.length !== aliasesBrutos.length) {
    sinais.push("ALIAS_CROSS_TENANT_IGNORADO");
  }

  return resolverContraFonte({
    itens: produtos,
    aliases,
    fonte: "PRODUTO",
    consultaNormalizada: consulta,
    config,
    sinaisIniciais: sinais,
  });
}
