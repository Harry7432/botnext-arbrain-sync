// Classificação determinística de confirmação de pedido (Etapa 3.2).
//
// SEM OpenAI: a IA nunca decide se o cliente confirmou ou cancelou. Esta
// função normaliza o texto e classifica contra listas fixas de afirmações.
// Ainda assim, a confirmação de fato acontece somente no fluxo quando o
// rascunho está PRONTO aguardando confirmação.

/** Frases (normalizadas) que confirmam o pedido. */
export const FRASES_POSITIVAS = [
  "sim",
  "confirmo",
  "pode confirmar",
  "pode fechar",
  "pode mandar",
  "pode enviar",
  "correto",
  "esta certo",
] as const;

/** Frases (normalizadas) que cancelam o pedido. */
export const FRASES_NEGATIVAS = [
  "nao",
  "cancelar",
  "cancela",
  "pode cancelar",
  "deixa pra la",
  "nao quero",
  "nao quero mais",
] as const;

const RESPOSTAS_CURTAS_NEUTRAS = new Set([
  "ok",
  "okay",
  "beleza",
  "ta bom",
  "tudo bem",
]);

export type ClassificacaoConfirmacao =
  | "POSITIVA"
  | "NEGATIVA"
  | "AMBIGUA"
  | "IRRELEVANTE";

/** Normaliza o texto: minúsculas, sem acentos/pontuação, espaços colapsados. */
export function normalizarFraseConfirmacao(texto: string): string {
  const semAcentos = texto
    .normalize("NFD")
    .replace(/[\p{M}]/gu, "");

  return semAcentos
    .toLowerCase()
    .replace(/[.,;:!?¡¿…()\[\]{}"„“”‘’'`\-_/\\|=*^~@#]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function escaparRegex(texto: string): string {
  return texto.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** true quando `frase` aparece como sequência completa (bordas de palavra). */
function contemFrase(texto: string, frase: string): boolean {
  if (texto === frase) {
    return true;
  }
  const regex = new RegExp(
    `(?:^|\\s)${escaparRegex(frase)}(?:\\s|$)`,
  );
  return regex.test(texto);
}

/**
 * Classifica a confirmação. Precedência: se contém frases positivas E
 * negativas → AMBIGUA; senão POSITIVA/NEGATIVA/IRRELEVANTE na ordem.
 */
export function classificarConfirmacao(
  texto: string,
): ClassificacaoConfirmacao {
  const normalizada = normalizarFraseConfirmacao(texto);

  if (!normalizada) {
    return "IRRELEVANTE";
  }

  const temPositivo = FRASES_POSITIVAS.some((frase) =>
    contemFrase(normalizada, frase),
  );
  const temNegativo = FRASES_NEGATIVAS.some((frase) =>
    contemFrase(normalizada, frase),
  );

  // "sim nao quero mais" é contraditório e NUNCA confirma — pede clareza.
  if (temPositivo && temNegativo) {
    return "AMBIGUA";
  }

  if (temPositivo) {
    return "POSITIVA";
  }

  if (temNegativo) {
    return "NEGATIVA";
  }

  return "IRRELEVANTE";
}

/**
 * Identifica respostas que não devem ser entregues à IA como uma nova
 * intenção quando o cliente está respondendo ao controle de um pedido.
 */
export function ehRespostaDeterministicaPedido(texto: string): boolean {
  const normalizada = normalizarFraseConfirmacao(texto);
  const classificacao = classificarConfirmacao(texto);

  return (
    FRASES_POSITIVAS.some((frase) => normalizada === frase) ||
    FRASES_NEGATIVAS.some((frase) => normalizada === frase) ||
    RESPOSTAS_CURTAS_NEUTRAS.has(normalizada) ||
    (classificacao === "AMBIGUA" && normalizada.split(" ").length <= 4)
  );
}
