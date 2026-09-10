// Tipos do resolvedor de catálogo (Etapa 2 / 2.8).
//
// O resolvedor é puro: recebe uma entrada + um repositório injetável e devolve
// um ResultadoResolucao. Não escreve em lugar nenhum, não chama serviços
// externos e não inventa item/SKU/embalagem/código.
//
// Etapa 2.8: o catálogo tem DUAS fontes independentes — PRODUTO (`produtos`) e
// CERVEJA (`cervejas`). A investigação real do ArBrain mostrou que a linha de
// pedido é polimórfica: linha de mercadoria usa `idProduto`, linha de cerveja
// usa `idCerveja` (+ embalagem/unidade/tipo/preço, que NÃO são resolvidos aqui).

/** Fonte do catálogo de onde o item veio. EQUIPAMENTO fica para etapa futura. */
export type FonteCatalogo = "PRODUTO" | "CERVEJA";

/**
 * Item do catálogo local do tenant. Unifica `produtos` e `cervejas` — ambos os
 * cadastros têm shape idêntico `{ id, tenantId, arbrainId, sku, nome }`.
 * `arbrainId` é o identificador do ArBrain (string OPACA — o formato varia por
 * entidade, nunca parsear) que a linha do pedido carrega.
 */
export interface ItemCatalogo {
  fonte: FonteCatalogo;
  id: string;
  tenantId: string;
  arbrainId: string;
  sku: number;
  nome: string;
}

/**
 * Alias de produto do catálogo local do tenant (`produto_aliases`).
 * `aliasNormalizado` é o texto já normalizado persistido na Etapa 1.
 * Nesta etapa os aliases são exclusivos de PRODUTO (ver README).
 */
export interface AliasCatalogo {
  id: string;
  tenantId: string;
  produtoId: string;
  alias: string;
  aliasNormalizado: string;
  ativo: boolean;
}

/**
 * Camada de acesso isolável ao catálogo. A implementação real usa PostgreSQL
 * local (Prisma); os testes injetam um fake em memória. Nunca consulta ArBrain.
 *
 * Cada método recebe `tenantId` e DEVE devolver somente linhas daquele tenant.
 */
export interface CatalogoRepository {
  listarProdutosDoTenant(tenantId: string): Promise<ItemCatalogo[]>;
  listarCervejasDoTenant(tenantId: string): Promise<ItemCatalogo[]>;
  listarAliasesDoTenant(tenantId: string): Promise<AliasCatalogo[]>;
}

export interface EntradaResolucao {
  tenantId: string;
  /**
   * Texto do produto/cerveja mencionado pelo cliente. Obrigatório. É a ÚNICA
   * entrada usada para resolver o item (ALIAS_DIRETO / NOME_EXATO / TOKENS /
   * FUZZY).
   */
  produtoMencionado: string;
  /**
   * Unidade mencionada (ex.: "caixa", "garrafa", "barril", "unidade"), se
   * houver. PRESERVADA para uma etapa posterior de validação de
   * unidade/embalagem — NÃO participa da resolução do item enquanto o catálogo
   * não tiver atributos estruturados para validá-la.
   */
  unidadeMencionada?: string | null;
  /**
   * Embalagem mencionada (ex.: "fardo", "pack 6"), se houver. Mesmo
   * tratamento de `unidadeMencionada`: preservada, fora da resolução.
   */
  embalagemMencionada?: string | null;
  /**
   * Hint opcional do extractor (etapa futura): quando a linha já foi
   * classificada como "cerveja" ou "produto", `resolverItemCatalogo` consulta
   * APENAS essa fonte. Ausente/null → consulta as duas e desambigua.
   */
  fonteEsperada?: FonteCatalogo | null;
}

export type StatusResolucao =
  | "RESOLVIDO"
  | "AMBIGUO"
  | "SEM_CORRESPONDENCIA";

export type OrigemResolucao =
  | "ALIAS_DIRETO"
  | "NOME_EXATO"
  | "TOKENS"
  | "FUZZY"
  | "SEM_CORRESPONDENCIA";

/**
 * Sinais de auditoria — não alteram o status, mas registram fatos relevantes
 * para diagnóstico.
 */
export type SinalAuditoria =
  | "ENTRADA_VAZIA"
  | "CATALOGO_VAZIO"
  | "ALIAS_INATIVO_IGNORADO"
  | "ALIAS_PRODUTO_INVALIDO"
  | "PRODUTO_CROSS_TENANT_IGNORADO"
  | "ALIAS_CROSS_TENANT_IGNORADO"
  | "CERVEJA_CROSS_TENANT_IGNORADO"
  // Produto e cerveja casaram com o mesmo "peso" → AMBIGUO entre fontes.
  | "AMBIGUIDADE_ENTRE_FONTES"
  // Match único sem `fonteEsperada` — a confirmação com o cliente decide a fonte.
  | "SEM_CONTEXTO_DE_FONTE";

export interface ItemCatalogoResolvido {
  fonteCatalogo: FonteCatalogo;
  id: string;
  tenantId: string;
  arbrainId: string;
  sku: number;
  nome: string;
}

export interface CandidatoResolucao {
  item: ItemCatalogoResolvido;
  /** Score no intervalo [0,1] quando a origem usa score (FUZZY); senão null. */
  score: number | null;
}

export interface ResultadoResolucao {
  status: StatusResolucao;
  origemResolucao: OrigemResolucao;
  /**
   * Fonte do item resolvido. `null` quando SEM_CORRESPONDENCIA ou quando a
   * ambiguidade abrange as duas fontes.
   */
  fonteCatalogo: FonteCatalogo | null;
  /** Preenchido somente quando status === "RESOLVIDO". */
  item: ItemCatalogoResolvido | null;
  /** Preenchido (>= 2 itens) somente quando status === "AMBIGUO". */
  candidatos: CandidatoResolucao[];
  /** Score do item resolvido quando aplicável (FUZZY); senão null. */
  score: number | null;
  /** Texto técnico curto para auditoria/logs. */
  motivo: string;
  /** Sinais de auditoria acumulados durante a resolução. */
  sinais: SinalAuditoria[];
}

export interface ConfigResolucao {
  /** Limiar mínimo de similaridade Dice para o estágio FUZZY. */
  limiarFuzzy: number;
  /**
   * Margem mínima entre o 1º e o 2º melhor score para considerar o topo
   * inequívoco no FUZZY. Abaixo dela, com 2+ acima do limiar → AMBIGUO.
   */
  margemAmbiguidadeFuzzy: number;
}

export const CONFIG_RESOLUCAO_PADRAO: ConfigResolucao = {
  limiarFuzzy: 0.6,
  margemAmbiguidadeFuzzy: 0.05,
};
