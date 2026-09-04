import { arbrainGet } from "./arbrain-client.js";

import type {
  ArbrainPagamentoResumo,
} from "./arbrain-types.js";

export async function listarPagamentos(): Promise<
  ArbrainPagamentoResumo[]
> {
  return arbrainGet<ArbrainPagamentoResumo[]>(
    "/v1/Cadastros/Pagamentos",
  );
}
