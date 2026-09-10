// Erros e versões do extractor de pedido (Etapa 2.9).
//
// Módulo SEM efeito colateral (não importa o cliente OpenAI) — pode ser
// importado por serviços que não devem carregar a stack de IA em tempo de
// módulo. `classificarErroExtracao` só usa as classes de erro do pacote
// `openai`, que não constroem cliente nenhum.

import {
  APIConnectionError,
  APIConnectionTimeoutError,
  APIError,
} from "openai";

export const VERSAO_EXTRACTOR_PEDIDO = "botnext-pedido-extractor-v1";
export const VERSAO_PROMPT_EXTRACTOR_PEDIDO = "pedido-extractor-prompt-v1";

/**
 * Erro normalizado do extractor.
 *  - TRANSITORIO: timeout / conexão / 5xx / 429 → não persiste, retentável.
 *  - DEFINITIVO: resposta fora do schema / recusa / 4xx → persiste FALHOU terminal.
 */
export class ExtracaoIaError extends Error {
  readonly tipo: "TRANSITORIO" | "DEFINITIVO";

  constructor(
    tipo: "TRANSITORIO" | "DEFINITIVO",
    message: string,
    options?: { cause?: unknown },
  ) {
    super(message, options);
    this.name = "ExtracaoIaError";
    this.tipo = tipo;
  }
}

export function classificarErroExtracao(erro: unknown): ExtracaoIaError {
  if (erro instanceof ExtracaoIaError) {
    return erro;
  }

  if (
    erro instanceof APIConnectionTimeoutError ||
    erro instanceof APIConnectionError
  ) {
    return new ExtracaoIaError("TRANSITORIO", "Falha de conexão com a OpenAI.", {
      cause: erro,
    });
  }

  if (erro instanceof APIError) {
    const status = erro.status ?? 0;
    if (status === 429 || status >= 500) {
      return new ExtracaoIaError(
        "TRANSITORIO",
        `OpenAI respondeu ${status}.`,
        { cause: erro },
      );
    }
    return new ExtracaoIaError(
      "DEFINITIVO",
      `OpenAI recusou a requisição (${status}).`,
      { cause: erro },
    );
  }

  return new ExtracaoIaError(
    "DEFINITIVO",
    erro instanceof Error ? erro.message : "Erro desconhecido no extractor.",
    { cause: erro },
  );
}
