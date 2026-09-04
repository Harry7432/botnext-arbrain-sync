import { arbrainGet } from "./arbrain-client.js";

import type {
  ArbrainProdutoResumo,
} from "./arbrain-types.js";

export async function listarProdutos(): Promise<
  ArbrainProdutoResumo[]
> {
  return arbrainGet<ArbrainProdutoResumo[]>(
    "/v1/Cadastros/Produtos",
  );
}
