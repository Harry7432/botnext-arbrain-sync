// Normalização determinística de texto para resolução de catálogo.
//
// Objetivo: colapsar variações irrelevantes (caixa, acentos, pontuação,
// espaços repetidos) mantendo o conteúdo alfanumérico. Sem lista de stopwords
// — a desambiguação de termos genéricos é feita pelo resolvedor (múltiplos
// candidatos → AMBIGUO), não removendo palavras aqui.

const MARCAS_DE_COMBINACAO = /[̀-ͯ]/g;
const NAO_ALFANUMERICO = /[^a-z0-9]+/g;
const ESPACOS_REPETIDOS = /\s+/g;

/**
 * Passos (nesta ordem):
 *  1. coage para string (null/undefined → "");
 *  2. Unicode NFKD (separa diacríticos e normaliza compatibilidade);
 *  3. remove marcas de combinação U+0300–U+036F (tira os acentos);
 *  4. minúsculas via toLowerCase() (independente de locale → determinístico);
 *  5. troca toda sequência de caracteres fora de [a-z0-9] por um espaço;
 *  6. colapsa espaços repetidos e apara as pontas.
 *
 * Ex.: "  Ãçaí   Lata 473ML! " → "acai lata 473ml"
 */
export function normalizarTexto(valor: string | null | undefined): string {
  return String(valor ?? "")
    .normalize("NFKD")
    .replace(MARCAS_DE_COMBINACAO, "")
    .toLowerCase()
    .replace(NAO_ALFANUMERICO, " ")
    .trim()
    .replace(ESPACOS_REPETIDOS, " ");
}

/**
 * Tokens = texto normalizado dividido por espaço, sem vazios.
 * Ordem preservada; duplicatas mantidas (o resolvedor usa conjuntos quando
 * precisa de semântica de conjunto).
 */
export function tokenizar(valor: string | null | undefined): string[] {
  const normalizado = normalizarTexto(valor);

  if (normalizado === "") {
    return [];
  }

  return normalizado.split(" ");
}

/** Conjunto de tokens únicos (para comparação de subconjunto). */
export function conjuntoDeTokens(valor: string | null | undefined): Set<string> {
  return new Set(tokenizar(valor));
}
