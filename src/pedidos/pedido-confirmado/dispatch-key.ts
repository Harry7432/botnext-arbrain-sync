// dispatchKey (Etapa 3.1) — chave de idempotência determinística.
//
// hash sha256 do conteúdo canônico de um pedido CONFIRMADO:
//   tenantId + conversationId + extracaoId + rascunhoId + revision + itens
//
// Mesmo pedido re-confirmado → mesma chave; retry → mesma chave; alteração
// real do rascunho (revision/conteúdo) → chave diferente. NUNCA depende de
// timestamp ou UUID aleatório.

import { createHash } from "node:crypto";

import type { ItemPedidoConfirmadoV1 } from "./tipos.js";

export interface EntradaDispatchKey {
  tenantId: string;
  conversationId: string;
  extracaoId: string;
  rascunhoId: string;
  /** Revision APÓS a confirmação (linha.revision + 1). */
  revision: number;
  itens: ItemPedidoConfirmadoV1[];
}

/**
 * Serialização canônica: objetos com chaves ordenadas, arrays ordenados por
 * equivalência, sem espaços em branco. Determinística entre execuções.
 */
export function canonicalizar(valor: unknown): string {
  if (Array.isArray(valor)) {
    return `[${valor.map(canonicalizar).join(",")}]`;
  }
  if (valor !== null && typeof valor === "object") {
    const entradas = Object.entries(valor as Record<string, unknown>)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([chave, valorChave]) => `${JSON.stringify(chave)}:${canonicalizar(valorChave)}`);
    return `{${entradas.join(",")}}`;
  }
  return JSON.stringify(valor);
}

export function ordenarItensContrato(
  itens: ItemPedidoConfirmadoV1[],
): ItemPedidoConfirmadoV1[] {
  return [...itens].sort((a, b) => {
    const ca = canonicalizar(a);
    const cb = canonicalizar(b);
    return ca < cb ? -1 : ca > cb ? 1 : 0;
  });
}

export function calcularDispatchKey(
  entrada: EntradaDispatchKey,
): string {
  const itens = ordenarItensContrato(entrada.itens);
  const corpo = canonicalizar({
    tenantId: entrada.tenantId,
    conversationId: entrada.conversationId,
    extracaoId: entrada.extracaoId,
    rascunhoId: entrada.rascunhoId,
    revision: entrada.revision,
    itens,
  });

  return createHash("sha256").update(corpo).digest("hex");
}