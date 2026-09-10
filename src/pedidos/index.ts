// API pública do módulo de pedidos — resolução de catálogo (Etapa 2 / 2.8).

export * from "./tipos.js";
export {
  normalizarTexto,
  tokenizar,
  conjuntoDeTokens,
} from "./normalizacao.js";
export { coeficienteDice } from "./similaridade.js";
export {
  criarCatalogoRepositoryEmMemoria,
  type CatalogoEmMemoria,
} from "./catalogo-repository.js";
export {
  criarCatalogoRepositoryPrisma,
  type PrismaCatalogo,
} from "./catalogo-repository-prisma.js";
export {
  resolverContraFonte,
  type ParamsResolucaoFonte,
} from "./resolver-nucleo.js";
export {
  resolverProduto,
  type DependenciasResolucao,
} from "./resolver-produto.js";
export { resolverCerveja } from "./resolver-cerveja.js";
export { resolverItemCatalogo } from "./resolver-item-catalogo.js";
export {
  construirRascunho,
  paraSnapshot,
  type EntradaResolveItem,
  type ResolveItemRascunho,
} from "./rascunho/construir-rascunho.js";
export {
  VERSAO_RASCUNHO,
  determinarStatusRascunho,
  itemEstaPendente,
  type ConteudoRascunhoPersistido,
  type ItemRascunho,
  type RascunhoConstruido,
  type ResolucaoSnapshot,
  type StatusRascunhoConstruido,
  type VersaoRascunho,
} from "./rascunho/tipos.js";
export {
  VERSAO_PEDIDO_CONFIRMADO,
  TIPO_EVENTO_PEDIDO_CONFIRMADO,
  paraItemPedidoConfirmado,
  type ConfirmacaoRascunho,
  type ItemPedidoConfirmadoV1,
  type PedidoConfirmadoV1,
  type ResolucaoContratoV1,
} from "./pedido-confirmado/tipos.js";
export {
  canonicalizar,
  ordenarItensContrato,
  calcularDispatchKey,
  type EntradaDispatchKey,
} from "./pedido-confirmado/dispatch-key.js";
export {
  montarPayloadPedidoConfirmadoV1,
  type ParamsMontarPayload,
} from "./pedido-confirmado/payload-pedido-confirmado.js";
